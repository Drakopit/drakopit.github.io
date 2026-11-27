import { Archetypes, HighlandCampaign } from '../data/HighlandCampaign.js';

/**
 * Online/LAN play for one level. The browser keeps running the same rules it runs offline, so
 * the game stays responsive; every change is also sent to the server, and the server's answer
 * wins: campaign changes are replaced by the returned save, and battles are corrected from the
 * server's snapshot whenever the hero's next command phase comes up. No engine imports.
 */

/** Visual-only or identity fields that a battle snapshot never overwrites. */
const SnapshotSkip = new Set(['owner', 'definition', 'enabled', 'flash', 'action', 'actionTime', 'id', 'team', 'name', 'model', 'color', 'visualStyle']);

/** How long a held battle snapshot waits for the local animation before it is applied anyway. */
export const SnapshotPatience = 45;

/** The pawn definition for another player seen in the zone. */
export function GhostDefinition(player) {
    const archetype = Archetypes[player.archetype] ? player.archetype : 'vanguard';
    return {
        id: `player-${player.id}`,
        playerId: player.id,
        name: String(player.name ?? 'Adventurer').slice(0, 20),
        archetype,
        level: player.level ?? 1,
        team: 'ally',
        col: player.col,
        row: player.row,
        facing: [0, 1, 2, 3].includes(player.facing) ? player.facing : 1,
        hp: 1, maxHp: 1, speed: 1, attack: 0, defense: 0,
        color: Archetypes[archetype].color,
        model: Archetypes[archetype].model,
        heroWeapon: Boolean(player.weapon),
        visualWeapon: player.weapon ?? null,
        visualOffhand: player.offhand ?? null,
        remote: true,
        inBattle: Boolean(player.inBattle),
    };
}

/**
 * Copies a server battle snapshot onto the local pawns (matched by id). Pawns whose tile changed
 * (or still walking) are snapped there. Returns true when anything changed tile.
 */
export function ApplyBattleSnapshot(pawns, snapshot) {
    let moved = false;
    for (const stats of snapshot?.pawns ?? []) {
        const pawn = pawns.find(entry => entry.stats.id === stats.id);
        if (!pawn) continue;
        const relocated = pawn.stats.col !== stats.col || pawn.stats.row !== stats.row;
        for (const [key, value] of Object.entries(stats))
            if (!SnapshotSkip.has(key) && typeof value !== 'function') pawn.stats[key] = value;
        // A walk still animating would finish later and change the phase; the server already finished it.
        if (relocated || pawn.travel?.path?.length) {
            pawn.travel?.Snap();
            moved ||= relocated;
        }
    }
    return moved;
}

export class RemoteLink {
    /**
     * @param {Object} level - The HighlandLevel (or a stand-in) this link serves.
     * @param {{ client: import('./MmoClient.js').MmoClient, account: Object }} session
     */
    constructor(level, session) {
        this.level = level;
        this.session = session;
        this.client = session.client;
        this.ghosts = new Map();
        this.unsubscribe = [];
        this.snapshot = null;
        this.snapshotAge = 0;
        this.settled = null;
        this.queue = Promise.resolve();
        this.status = 'online';
    }

    /** Subscribes to pushes and announces the hero: `enter` in a zone, `battle.start` on the battlefield. */
    Attach() {
        const on = (type, listener) => this.unsubscribe.push(this.client.On(type, listener));
        on('presence', message => this.Presence(message.player));
        on('presence.leave', message => this.RemoveGhost(message.id));
        on('chat', message => this.level.hud?.RecordChat?.(message.from, message.text));
        on('kicked', message => this.Lost(message.reason ?? 'Signed in from another window.'));
        on('close', message => this.Lost(message.reason));
        if (this.level.exploring === 'battle')
            return this.Send('battle.start', { encounter: this.level.encounterId }).then(reply => this.Hold(reply)).catch(error => this.Fail(error));
        if (this.level.exploring === 'explore')
            return this.Send('enter').then(reply => {
                for (const player of reply.players ?? []) this.Presence(player);
            }).catch(error => this.Fail(error));
        return Promise.resolve();
    }

    Detach() {
        for (const off of this.unsubscribe) off();
        this.unsubscribe = [];
        for (const id of [...this.ghosts.keys()]) this.RemoveGhost(id);
    }

    /** Requests run one after another, in the order the player made them. */
    Send(type, payload = {}) {
        const run = this.queue.then(() => this.client.Request(type, payload));
        this.queue = run.catch(() => {});
        return run;
    }

    Message(text) {
        if (this.level.turn) this.level.turn.message = text;
    }

    Fail(error) {
        this.Message(`Server: ${error.message}`);
    }

    /** The connection is gone: the level keeps working offline from here, without saving. */
    Lost(reason) {
        if (this.status === 'lost') return;
        this.status = 'lost';
        this.Message(`${reason} · Playing offline now.`);
        this.level.OnRemoteLost?.(reason);
    }

    // ---------- presence ----------

    Presence(player) {
        if (!player || player.id === this.session.account?.id) return;
        if (player.zone && player.zone !== this.level.zone?.id) {
            this.RemoveGhost(player.id);
            return;
        }
        const ghost = this.ghosts.get(player.id);
        if (!ghost) {
            const pawn = this.level.CreateGhost?.(GhostDefinition(player));
            if (pawn) this.ghosts.set(player.id, pawn);
            return;
        }
        ghost.stats.inBattle = Boolean(player.inBattle);
        ghost.stats.level = player.level ?? ghost.stats.level;
        if (ghost.stats.col === player.col && ghost.stats.row === player.row) {
            if ([0, 1, 2, 3].includes(player.facing)) ghost.stats.facing = player.facing;
            return;
        }
        const path = this.level.GhostPath?.(ghost, player);
        if (path?.length) ghost.travel.Follow(path, () => { if ([0, 1, 2, 3].includes(player.facing)) ghost.stats.facing = player.facing; });
        else {
            ghost.stats.col = player.col;
            ghost.stats.row = player.row;
            ghost.travel.Snap();
        }
    }

    RemoveGhost(id) {
        const ghost = this.ghosts.get(id);
        if (!ghost) return;
        this.ghosts.delete(id);
        this.level.RemoveGhost?.(ghost);
    }

    Ghosts() {
        return [...this.ghosts.values()];
    }

    // ---------- exploration ----------

    /** Sends a campaign change; the reply's save replaces the local campaign (or the server's copy is fetched on refusal). */
    Change(type, payload = {}) {
        if (this.status !== 'online') return Promise.resolve(null);
        return this.Send(type, payload).then(reply => {
            if (reply.save) this.level.ApplyServerSave(reply.save);
            return reply;
        }).catch(error => {
            this.Fail(error);
            return this.Send('character.get').then(reply => { if (reply.save) this.level.ApplyServerSave(reply.save); }).catch(() => null);
        });
    }

    /** Reports where the hero stopped walking. A refusal snaps the hero back to the server's tile. */
    Moved(stats) {
        if (this.status !== 'online') return Promise.resolve(null);
        return this.Send('move', { col: stats.col, row: stats.row, facing: stats.facing }).catch(error => {
            this.Fail(error);
            return this.Send('character.get').then(reply => { if (reply.save) this.level.ApplyServerSave(reply.save, { position: true }); }).catch(() => null);
        });
    }

    /** Walks onto a portal on the server too, then travels; resolves with the new save. */
    Travel(stats) {
        return this.Send('move', { col: stats.col, row: stats.row, facing: stats.facing })
            .then(() => this.Send('travel'))
            .then(reply => reply.save);
    }

    Chat(text) {
        const clean = String(text ?? '').trim();
        if (!clean || this.status !== 'online') return Promise.resolve(false);
        return this.Send('chat', { text: clean }).then(() => true).catch(error => { this.Fail(error); return false; });
    }

    // ---------- battles ----------

    /** Mirrors one hero command; the reply's snapshot is held until the local battle catches up. */
    Command(command) {
        if (this.status !== 'online') return Promise.resolve(null);
        return this.Send('battle.command', { command }).then(reply => {
            this.Hold(reply);
            if (!reply.ok) {
                this.Message(`Server: ${reply.error ?? 'command refused'} · battle resynced.`);
                this.ApplySnapshot();
            }
            return reply;
        }).catch(error => this.Fail(error));
    }

    Hold(reply) {
        if (!reply?.battle) return;
        this.snapshot = reply.battle;
        this.snapshotAge = 0;
        if (reply.settled) this.settled = { ...reply.settled, save: reply.save };
    }

    /**
     * Applies the held snapshot now: every pawn, and the turn itself. When the server is waiting
     * for the hero, the local turn is put there too (whatever it was animating), so both sides
     * continue from the same state.
     */
    ApplySnapshot() {
        const snapshot = this.snapshot, turn = this.level.turn, hero = this.level.player;
        if (!snapshot) return false;
        this.snapshot = null;
        ApplyBattleSnapshot(this.level.pawns, snapshot);
        if (snapshot.result) {
            if (!turn.result) turn.result = snapshot.result;
            turn.phase = 'result';
            return true;
        }
        if (hero && snapshot.active === hero.stats.id && snapshot.phase === 'command') {
            turn.active = hero;
            turn.phase = 'command';
            if (typeof snapshot.moved === 'boolean') turn.moved = snapshot.moved;
            if (typeof snapshot.acted === 'boolean') turn.acted = snapshot.acted;
            turn.target = null;
            turn.preview = null;
            turn.ability = null;
            turn.area = null;
            turn.delay = 0;
            turn.cursor = { col: hero.stats.col, row: hero.stats.row };
        }
        return true;
    }

    /**
     * Per frame in battle: once the local battle reaches the hero's command phase (or a result),
     * or the snapshot has waited `SnapshotPatience` seconds, the server's state replaces the local one.
     */
    Update(dt) {
        if (!this.snapshot || this.level.exploring !== 'battle') return;
        this.snapshotAge += dt;
        const turn = this.level.turn;
        const heroCommand = turn.phase === 'command' && turn.active === this.level.player;
        if (heroCommand || turn.result || this.snapshotAge >= SnapshotPatience) this.ApplySnapshot();
    }

    /** The settled battle (rewards and the new save), once the server has decided it. */
    Settled() {
        return this.settled;
    }
}

/** Builds a campaign from a server save, keeping `position` (col/row/facing) when given. */
export function CampaignFromServer(save, position = null) {
    const campaign = HighlandCampaign.FromSave(save);
    if (position && campaign.hero) {
        campaign.hero.col = position.col;
        campaign.hero.row = position.row;
        if (position.facing !== undefined) campaign.hero.facing = position.facing;
    }
    return campaign;
}
