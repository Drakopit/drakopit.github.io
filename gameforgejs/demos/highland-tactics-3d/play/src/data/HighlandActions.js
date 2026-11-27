import { AbilityBlocked, BattleRules } from './BattleRules.js';
import { ActiveSkills, SkillBar } from './ClassSkills.js';
import { EquipmentStats, ItemInfo, SlotAccepts, SlotFor } from './HighlandCampaign.js';

/** Consumables that can be used in battle, in hotbar order (slots 8, 9 and 0). */
export const BattleConsumables = Object.freeze(['Potion', 'Ether', 'Antidote']);

/** Why the active hero cannot use `item` in battle right now, or null when it can. */
export function BattleItemBlocked(turn, player, campaign, item) {
    const use = ItemInfo[item]?.use, stats = turn.active?.stats;
    if (!use) return `${item} cannot be used in battle`;
    if (!stats || turn.active !== player) return 'Only your hero carries the backpack';
    if (!(campaign.inventory[item] > 0)) return `No ${item} left`;
    if ((stats.casts?.[item] ?? 0) >= (use.perTurn ?? Infinity)) return `${item} already used this turn`;
    if (stats.ap < use.ap) return `Not enough AP for ${item} (${use.ap} AP)`;
    if (use.heal && stats.hp >= stats.maxHp) return 'Already at full health';
    if (use.restoreAp && stats.ap >= stats.apMax) return 'AP already full';
    if (use.cleanse && !(stats.poison > 0 || stats.burn > 0 || stats.slowed > 0)) return 'Nothing to cure';
    return null;
}

/**
 * The ten hotbar slots for the active hero: slot 1 is the basic attack, slots 2-7 the class's
 * active skills in tree order (`locked` until learned), slots 8-0 the battle consumables.
 * `blocked` is why the slot cannot be used right now, or null.
 */
export function HotbarSlots(turn, player, campaign) {
    const stats = turn.active?.stats ?? player?.stats;
    if (!stats) return [];
    const unlocked = stats.unlockedSkills ?? [];
    const ability = (id, locked = false) => ({
        kind: 'ability', id, locked,
        blocked: locked ? 'Not learned yet' : turn.active ? AbilityBlocked(stats, id) : 'Not your turn',
    });
    const skills = SkillBar(stats.archetype);
    return [
        ability(stats.basicAbility ?? 'strike'),
        ...Array.from({ length: 6 }, (_, index) => skills[index]
            ? ability(skills[index].id, !unlocked.includes(skills[index].id))
            : { kind: 'empty', id: null, locked: true, blocked: 'Empty slot' }),
        ...BattleConsumables.map(item => ({
            kind: 'item', id: item, locked: false, count: campaign?.inventory[item] ?? 0,
            blocked: turn.active ? BattleItemBlocked(turn, player, campaign, item) : 'Not your turn',
        })),
    ];
}

export function CommandAvailable(turn, player, campaign, index) {
    if (turn.phase !== 'command' || !turn.active || turn.active.stats.team !== 'ally') return false;
    const stats = turn.active.stats;
    if (index === 0) return stats.mp > 0;
    if (index === 1) return !AbilityBlocked(stats, stats.basicAbility ?? 'strike');
    if (index === 2) return ActiveSkills(stats.archetype, stats.unlockedSkills).some(skill => !AbilityBlocked(stats, skill.id));
    if (index === 3) return BattleConsumables.some(item => !BattleItemBlocked(turn, player, campaign, item));
    return index === 4;
}

/**
 * State-only action entry points shared by every control mode (PC dock, console ring, touch).
 * Each validates against the current state and returns whether it applied; presentation and
 * transport (a future online session) stay outside this class.
 */
export class HighlandActions {
    constructor(state) { this.state = state; }

    AllyTurn() {
        const { turn, exploring } = this.state;
        return exploring === 'battle' && turn.active?.stats.team === 'ally';
    }

    /** Walks the active ally to a reachable tile, spending MP; in exploration, walks the hero. */
    Move(tile) {
        if (this.state.exploring === 'explore') return Boolean(this.state.MoveExplore?.(tile));
        if (!this.AllyTurn()) return false;
        return this.state.turn.Move(tile);
    }

    /** Casts `ability` (default: the one being targeted) on `target`. */
    UseSkill(target, ability = null) {
        if (!this.AllyTurn()) return false;
        const turn = this.state.turn;
        if (ability && turn.ability !== ability && !turn.SelectAbility(ability)) return false;
        return turn.Attack(target);
    }

    /** Uses a consumable: in battle on the active hero (costs AP), in exploration from the backpack. */
    UseItem(item) {
        const { turn, campaign, player } = this.state;
        if (this.state.exploring === 'explore') return Boolean(this.state.UseItem?.(item));
        if (!this.AllyTurn() || !['command', 'item'].includes(turn.phase)) return false;
        const blocked = BattleItemBlocked(turn, player, campaign, item);
        if (blocked) {
            turn.message = blocked;
            return false;
        }
        const use = ItemInfo[item].use, stats = player.stats;
        campaign.inventory[item]--;
        turn.SpendAP(use.ap);
        stats.casts = { ...stats.casts, [item]: (stats.casts?.[item] ?? 0) + 1 };
        let text = item.toUpperCase();
        if (use.heal) {
            const healed = Math.min(use.heal, stats.maxHp - stats.hp);
            stats.hp += healed;
            text = `+${healed} HP`;
        }
        if (use.restoreAp) {
            const restored = Math.min(use.restoreAp, stats.apMax - stats.ap);
            stats.ap += restored;
            text = `+${restored} AP`;
        }
        if (use.cleanse) {
            stats.poison = 0;
            stats.burn = 0;
            stats.slowed = 0;
            text = 'CURED';
        }
        stats.flash = 0.3;
        stats.action = 'item';
        stats.actionTime = 0.8;
        turn.feedback.push({ pawn: player, text, effect: 'heal', life: 1.7 });
        campaign.SyncHero(stats);
        turn.phase = 'command';
        turn.message = `${item} used · ${text}`;
        turn.sound?.Play('success');
        return true;
    }

    /** Ends the ally's turn: confirms Wait from the facing step, or passes from the command phase. */
    EndTurn() {
        if (!this.AllyTurn()) return false;
        const turn = this.state.turn;
        if (turn.phase === 'command') return turn.PassTurn();
        if (turn.phase !== 'face') return false;
        turn.EndTurn();
        return true;
    }

    /** Equips an owned item, into `slot` or the first fitting slot. */
    Equip(item, slot = null) {
        const { campaign, exploring } = this.state;
        if (exploring !== 'explore' || !EquipmentStats(item)) return false;
        const target = slot ?? SlotFor(item, campaign.equipment);
        return Boolean(target && SlotAccepts(target, item) && campaign.EquipOwned(item, target));
    }

    Unequip(slot) {
        const { campaign, exploring } = this.state;
        if (exploring !== 'explore') return false;
        return campaign.Unequip(slot);
    }

    Loot() {
        const { campaign, turn, encounterId, pawns, player } = this.state;
        if (this.state.exploring !== 'battle' || turn.result !== 'VICTORY'
            || this.state.resultHandled || this.state.lootResult || !player) return null;
        campaign.SyncHero(player.stats);
        const companion = pawns.find(pawn => pawn.stats.id === 'orin');
        if (companion) campaign.SyncCompanion(companion.stats);
        const encounter = this.state.zone?.encounters?.find(entry => entry.id === encounterId);
        const firstClear = !campaign.clearedZones.has(encounterId);
        campaign.clearedZones.add(encounterId);
        campaign.hero.hp = Math.max(1, campaign.hero.hp);
        campaign.gold += encounterId === 'ashen-ridge' ? 45 : 30;
        const experience = encounterId === 'ashen-ridge' ? 90 : 60;
        const levels = campaign.AwardExperience(experience);
        if (companion) {
            campaign.AwardCompanionExperience(experience);
            campaign.companion.hp = Math.max(1, campaign.companion.hp);
        }
        const items = campaign.AddLoot([...(encounter?.loot ?? []), ...(firstClear ? encounter?.firstClear ?? [] : [])]);
        this.state.lootResult = { experience, levels, items };
        return this.state.lootResult;
    }
}

export function FaceNearestEnemy(turn) {
    const actor = turn.active?.stats;
    if (!actor) return;
    const target = turn.Alive().filter(pawn => pawn.stats.team !== actor.team)
        .sort((a, b) => {
            const distance = pawn => Math.abs(pawn.stats.col - actor.col) + Math.abs(pawn.stats.row - actor.row);
            return distance(a) - distance(b) || String(a.stats.id).localeCompare(String(b.stats.id));
        })[0];
    if (target) actor.facing = BattleRules.Facing(actor, target.stats);
}
