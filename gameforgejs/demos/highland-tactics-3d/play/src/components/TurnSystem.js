import { Component } from 'gameforgejs/core';
import { AbilityBlocked, BattleRules, GetAbilityProfile, TurnBudget } from '../data/BattleRules.js';
import { ActiveSkills } from '../data/ClassSkills.js';

/** Phases in which the active ally is choosing what to do (the turn timer runs in these). */
const InputPhases = new Set(['command', 'move', 'target', 'skill-select', 'item', 'face']);

/**
 * CT turn order with Dofus-style budgets: each turn grants AP for abilities and items and MP
 * for movement, both spendable in any order and split across several actions. No input or
 * rendering dependencies.
 */
export class TurnSystem extends Component {
    constructor(grid, pawns, sound) { super(); this.grid = grid; this.pawns = pawns; this.sound = sound; this.turnLimit = null; this.Reset(); }
    Reset() { this.phase = 'charge'; this.active = null; this.message = 'The highland watch — defeat the Ash patrol'; this.result = null; this.seed = 74; this.feedback = []; this.command = 0; this.turnTime = 0; this.lastTarget = null; }
    Alive() { return this.pawns.filter(p => p.stats.hp > 0); }
    Occupied(actor) { return new Set(this.Alive().filter(p => p !== actor).map(p => this.grid.Key(p.stats))); }
    /** Tiles the actor can reach with its remaining MP (`cost` is the MP each one takes). */
    Range(actor = this.active) { return this.grid.Reachable(actor.stats, { move: Math.max(0, actor.stats.mp ?? actor.stats.mpMax ?? (['flanker', 'bruiser'].includes(actor.stats.role) ? 4 : TurnBudget.mp)), climb: 1, jump: 2, occupied: this.Occupied(actor) }); }
    Begin(actor) {
        this.active = actor;
        this.moved = false;
        this.acted = false;
        this.command = 0;
        this.turnTime = 0;
        this.lastTarget = null;
        const stats = actor.stats;
        stats.guarded = false;
        stats.ap = stats.apMax ?? TurnBudget.ap;
        stats.mp = Math.max(1, (stats.mpMax ?? TurnBudget.mp) - (stats.slowed > 0 ? 2 : 0));
        stats.casts = {};
        for (const [id, turns] of Object.entries(stats.cooldowns ?? {})) {
            if (turns > 1) stats.cooldowns[id] = turns - 1;
            else delete stats.cooldowns[id];
        }
        stats.exposed = Math.max(0, stats.exposed - 1);
        stats.haste = Math.max(0, (stats.haste ?? 0) - 1);
        for (const [status, base, label, effect, resist] of [['burn', 4, 'BURN', undefined, 'fire'], ['poison', 3, 'POISON', 'poison', 'poison']]) {
            if (!(stats[status] > 0)) continue;
            // Fire / Poison resistance (percent, at most 50) softens the tick; it never drops below 1.
            const damage = Math.max(1, Math.round(base * (1 - Math.min(50, Math.max(0, stats.resist?.[resist] ?? 0)) / 100)));
            stats.hp = Math.max(0, stats.hp - damage);
            stats[status]--;
            this.feedback.push({ pawn: actor, text: `-${damage} ${label}`, life: 1.7, effect });
            if (stats.hp === 0) {
                this.CheckResult();
                stats.ct = 0;
                this.active = null;
                this.phase = this.result ? 'result' : 'charge';
                return;
            }
        }
        if (stats.stunned > 0) {
            stats.stunned--;
            stats.slowed = Math.max(0, (stats.slowed ?? 0) - 1);
            stats.ct = 0;
            this.active = null;
            this.phase = 'charge';
            this.message = `${stats.name} is stunned and loses the turn`;
            return;
        }
        this.cursor = { col: stats.col, row: stats.row };
        this.phase = stats.team === 'ally' ? 'command' : 'ai';
        this.delay = 0.55;
        this.message = `${stats.name}: ${stats.ap} AP · ${stats.mp} MP`;
    }
    OnUpdate(dt) {
        for (const text of this.feedback)
            text.life -= dt;
        this.feedback = this.feedback.filter(text => text.life > 0);
        if (this.result)
            return;
        if (this.phase === 'charge') {
            for (const pawn of this.Alive())
                pawn.stats.ct += pawn.stats.speed * dt * 3 * (pawn.stats.haste > 0 ? 1.5 : 1);
            const ready = this.Alive().filter(p => p.stats.ct >= 100).sort((a, b) => b.stats.ct - a.stats.ct || a.stats.id.localeCompare(b.stats.id));
            if (ready.length)
                this.Begin(ready[0]);
        }
        else if (this.phase === 'ai') {
            this.delay -= dt;
            if (this.delay <= 0)
                this.EnemyStep();
        }
        else if (this.phase === 'resolve') {
            this.delay -= dt;
            if (this.delay <= 0) {
                this.ResolveAttack();
            }
        }
        if (this.turnLimit && this.active?.stats.team === 'ally' && InputPhases.has(this.phase)) {
            this.turnTime += dt;
            if (this.turnTime >= this.turnLimit) {
                this.Cancel();
                this.message = `${this.active.stats.name}'s time ran out`;
                this.PassTurn();
            }
        }
    }
    /** Seconds left on the active ally's turn timer, or null when the turn is untimed. */
    TimeLeft() {
        return this.turnLimit && this.active?.stats.team === 'ally' ? Math.max(0, this.turnLimit - this.turnTime) : null;
    }
    Choose(index) {
        if (this.phase !== 'command' || !Number.isInteger(index) || index < 0 || index > 4)
            return;
        this.command = index;
        const stats = this.active.stats;
        if (index === 0) {
            if (!(stats.mp > 0)) {
                this.message = 'No movement points left';
                return;
            }
            this.area = this.Range();
            this.phase = 'move';
        }
        else if (index === 4) {
            this.previousFacing = stats.facing;
            this.phase = 'face';
            this.message = 'Choose a direction, then confirm Wait';
        }
        else if (index === 3) {
            this.phase = 'item';
            this.message = 'Use a consumable on the active hero, or cancel';
        }
        else if (index === 1) {
            const ability = stats.basicAbility ?? 'strike';
            const blocked = AbilityBlocked(stats, ability);
            if (blocked) {
                this.message = blocked;
                return;
            }
            this.ability = ability;
            this.phase = 'target';
            this.message = `${GetAbilityProfile(stats, ability).name}: choose a target`;
        }
        else {
            this.phase = 'skill-select';
            this.skillCursor = 0;
            this.message = ActiveSkills(stats.archetype, stats.unlockedSkills).length
                ? 'Choose an unlocked class skill'
                : 'No class skills unlocked — earn a skill point by leveling up';
        }
    }
    /** Targets an ability directly (the PC hotbar), from the command, move or target phase. */
    SelectAbility(id) {
        if (!this.active || !['command', 'move', 'target', 'skill-select'].includes(this.phase)) return false;
        const stats = this.active.stats;
        const known = id === (stats.basicAbility ?? 'strike')
            || ActiveSkills(stats.archetype, stats.unlockedSkills).some(skill => skill.id === id);
        if (!known) return false;
        const blocked = AbilityBlocked(stats, id);
        if (blocked) {
            this.message = blocked;
            return false;
        }
        this.ability = id;
        this.phase = 'target';
        this.message = `${GetAbilityProfile(stats, id).name}: choose a target`;
        return true;
    }
    SelectSkill(id) {
        if (this.phase !== 'skill-select' || !this.active) return false;
        if (!ActiveSkills(this.active.stats.archetype, this.active.stats.unlockedSkills).some(item => item.id === id)) return false;
        return this.SelectAbility(id);
    }
    CanTarget(pawn) {
        return Boolean(this.active && pawn && BattleRules.CanAttack(this.grid, this.active.stats, pawn.stats, this.ability));
    }
    /** Walks to a reachable tile, spending one MP per step; the rest stays for later moves. */
    Move(tile) {
        if (!this.active || !['move', 'command', 'ai'].includes(this.phase))
            return false;
        const entry = this.Range().get(this.grid.Key(tile));
        if (!entry || !entry.path.length)
            return false;
        const stats = this.active.stats;
        stats.facing = BattleRules.Facing(stats, entry.path[0]);
        if (stats.mp !== undefined) stats.mp = Math.max(0, stats.mp - entry.cost);
        this.moved = true;
        const next = stats.team === 'ally' ? 'command' : 'ai';
        this.phase = 'travel';
        this.active.travel.Follow(entry.path, () => { this.phase = next; this.cursor = { col: tile.col, row: tile.row }; this.delay = 0.45; });
        this.sound.Play('step');
        return true;
    }
    Attack(target, ability = this.ability) {
        if (!this.active || !['target', 'ai'].includes(this.phase))
            return false;
        if (!target || !BattleRules.CanAttack(this.grid, this.active.stats, target.stats, ability))
            return false;
        const stats = this.active.stats, profile = GetAbilityProfile(stats, ability);
        this.target = target;
        this.lastTarget = target;
        this.ability = ability;
        this.preview = BattleRules.Preview(this.grid, stats, target.stats, ability);
        if (target !== this.active)
            stats.facing = BattleRules.Facing(stats, target.stats);
        stats.action = profile.heal || profile.shield || profile.haste || profile.magic ? 'cast' : profile.range > 1 ? 'shoot' : 'melee';
        stats.actionTime = 0.9;
        this.phase = 'resolve';
        this.delay = 0.35;
        this.message = this.preview.heal !== undefined
            ? `Restore ${this.preview.heal} HP`
            : this.preview.shield !== undefined ? `Shield ${this.preview.shield} damage`
            : this.preview.haste !== undefined ? `Haste for ${this.preview.haste} turns`
            : `${this.preview.side} · ${this.preview.chance}% · ${this.preview.damage} damage`;
        this.sound.Play('warning');
        return true;
    }
    /** Pays an ability's AP and records its per-turn use and cooldown. */
    Spend(ability) {
        const stats = this.active.stats, profile = GetAbilityProfile(stats, ability);
        if (stats.ap !== undefined) stats.ap = Math.max(0, stats.ap - profile.ap);
        stats.casts = { ...stats.casts, [ability]: (stats.casts?.[ability] ?? 0) + 1 };
        if (profile.cooldown) stats.cooldowns = { ...stats.cooldowns, [ability]: profile.cooldown };
        this.acted = true;
    }
    /** Spends AP on something other than an ability (a consumable). */
    SpendAP(amount) {
        if (!this.active || this.active.stats.ap < amount) return false;
        this.active.stats.ap -= amount;
        this.acted = true;
        return true;
    }
    AfterAction() {
        this.phase = this.active.stats.team === 'ally' ? 'command' : 'ai';
        this.delay = 0.5;
    }
    ResolveAttack() {
        const profile = GetAbilityProfile(this.active.stats, this.ability);
        if (profile.shield || profile.haste) {
            if (profile.shield) this.target.stats.shield = profile.shield;
            if (profile.haste) this.target.stats.haste = profile.haste;
            this.target.stats.flash = 0.3;
            this.feedback.push({
                pawn: this.target, text: profile.shield ? `${profile.shield} SHIELD` : 'HASTE',
                effect: profile.shield ? 'shield' : 'haste', life: 1.7,
            });
            this.Spend(this.ability);
            this.sound.Play('success');
            this.AfterAction();
            return;
        }
        if (profile.heal) {
            const target = this.target.stats;
            const recipients = this.Alive().filter(pawn => pawn === this.target || (profile.healSplash
                && pawn.stats.team === this.active.stats.team
                && Math.abs(pawn.stats.col - target.col) + Math.abs(pawn.stats.row - target.row) === 1));
            for (const pawn of recipients) {
                if (profile.cleanse && (pawn.stats.poison > 0 || pawn.stats.burn > 0 || pawn.stats.slowed > 0)) {
                    pawn.stats.poison = 0;
                    pawn.stats.burn = 0;
                    pawn.stats.slowed = 0;
                    this.feedback.push({ pawn, text: 'PURIFIED', effect: 'heal', life: 1.7 });
                }
                const healed = Math.min(BattleRules.HealAmount(this.active.stats, profile), pawn.stats.maxHp - pawn.stats.hp);
                if (!healed) continue;
                pawn.stats.hp += healed;
                pawn.stats.flash = 0.3;
                this.feedback.push({ pawn, text: `+${healed} HP`, effect: 'heal', life: 1.7 });
            }
            this.Spend(this.ability);
            this.sound.Play('success');
            this.AfterAction();
            return;
        }
        this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
        const hit = this.seed / 4294967296 * 100 < this.preview.chance, defender = this.target.stats;
        const affected = [];
        if (hit) {
            defender.hp = Math.max(0, defender.hp - this.preview.damage);
            defender.shield = Math.max(0, (defender.shield ?? 0) - (this.preview.blocked ?? 0));
            defender.flash = 0.3;
            affected.push({ pawn: this.target, damage: this.preview.damage });
            if (profile.expose)
                defender.exposed = 2;
            if (profile.stun)
                defender.stunned = 1;
            if (profile.burn)
                defender.burn = profile.burn;
            if (profile.slow)
                defender.slowed = profile.slow;
            if (profile.poison)
                defender.poison = profile.poison;
            if (profile.splash) {
                const splashBase = defender.guarded
                    ? BattleRules.Preview(this.grid, this.active.stats, { ...defender, guarded: false, shield: 0 }, this.ability).damage
                    : this.preview.rawDamage ?? this.preview.damage;
                for (const pawn of this.Alive()) {
                    if (pawn === this.target || pawn.stats.team === this.active.stats.team) continue;
                    if (!BattleRules.InSplash(this.grid, this.active.stats, defender, pawn.stats, profile)) continue;
                    const damage = Math.max(1, Math.floor(splashBase * profile.splash * (pawn.stats.guarded ? 0.5 : 1)));
                    const blocked = Math.min(damage, pawn.stats.shield ?? 0);
                    pawn.stats.shield = Math.max(0, (pawn.stats.shield ?? 0) - blocked);
                    pawn.stats.hp = Math.max(0, pawn.stats.hp - (damage - blocked));
                    pawn.stats.flash = 0.3;
                    if (profile.burn) pawn.stats.burn = profile.burn;
                    if (profile.expose) pawn.stats.exposed = 2;
                    if (profile.stun) pawn.stats.stunned = 1;
                    if (profile.slow) pawn.stats.slowed = profile.slow;
                    affected.push({ pawn, damage: damage - blocked });
                }
            }
            if (profile.knockback && defender.hp > 0)
                this.Knockback(this.target);
        }
        this.Spend(this.ability);
        if (hit)
            for (const entry of affected)
                this.feedback.push({ pawn: entry.pawn, text: `-${entry.damage}${entry.pawn === this.target && profile.expose ? ' EXPOSED' : ''}`, effect: profile.poison ? 'poison' : profile.magic ? 'magic' : 'hit', life: 1.7 });
        else
            this.feedback.push({ pawn: this.target, text: 'MISS', life: 1.7 });
        this.sound.Play(hit ? 'hit' : 'select');
        if (this.CheckResult()) return;
        this.AfterAction();
    }
    Knockback(pawn) {
        const source = this.active.stats, target = pawn.stats;
        const dx = Math.sign(target.col - source.col), dy = Math.sign(target.row - source.row);
        if (Math.abs(dx) + Math.abs(dy) !== 1) return false;
        const current = this.grid.Get(target.col, target.row);
        const next = this.grid.Get(target.col + dx, target.row + dy);
        if (!current || !next || Math.abs(next.h - current.h) > 1 || this.Occupied(pawn).has(this.grid.Key(next))) return false;
        target.col = next.col;
        target.row = next.row;
        pawn.travel.Snap();
        return true;
    }
    Cancel() {
        if (this.phase === 'face') this.active.stats.facing = this.previousFacing;
        if (['move', 'target', 'face', 'skill-select', 'item'].includes(this.phase)) this.phase = 'command';
    }
    /** Faces the last target of this turn, or else the nearest opponent. */
    AutoFace() {
        const actor = this.active?.stats;
        if (!actor) return;
        const last = this.lastTarget?.stats.hp > 0 && this.lastTarget !== this.active ? this.lastTarget : null;
        const target = last ?? this.Alive().filter(pawn => pawn.stats.team !== actor.team)
            .sort((a, b) => {
                const distance = pawn => Math.abs(pawn.stats.col - actor.col) + Math.abs(pawn.stats.row - actor.row);
                return distance(a) - distance(b) || String(a.stats.id).localeCompare(String(b.stats.id));
            })[0];
        if (target) actor.facing = BattleRules.Facing(actor, target.stats);
    }
    /** Ends the active ally's turn straight from the command phase, facing its last target. */
    PassTurn() {
        if (!this.active || this.phase !== 'command') return false;
        this.AutoFace();
        this.phase = 'face';
        this.EndTurn();
        return true;
    }
    EndTurn() {
        if (!this.active || !['face', 'ai'].includes(this.phase))
            return;
        this.active.stats.slowed = Math.max(0, (this.active.stats.slowed ?? 0) - 1);
        this.active.stats.ct = Math.max(0, this.active.stats.ct - (20 + (this.moved ? 30 : 0) + (this.acted ? 50 : 0)));
        this.phase = 'charge';
        this.active = null;
        this.preview = null;
        this.sound.Play('select');
    }
    EnemyStep() {
        if (this.active.stats.stunned > 0) {
            this.active.stats.stunned--;
            this.EndTurn();
            return;
        }
        const foes = this.Alive().filter(p => p.stats.team !== this.active.stats.team);
        const role = this.active.stats.role ?? 'bruiser';
        const ability = this.active.stats.basicAbility ?? 'strike';
        const targets = foes.filter(p => BattleRules.CanAttack(this.grid, this.active.stats, p.stats, ability));
        if (role === 'caster')
            targets.sort((a, b) => foes.filter(p => Math.abs(p.stats.col - b.stats.col) + Math.abs(p.stats.row - b.stats.row) === 1).length
                - foes.filter(p => Math.abs(p.stats.col - a.stats.col) + Math.abs(p.stats.row - a.stats.row) === 1).length);
        const inRange = targets[0];
        const distance = tile => Math.min(...foes.map(p => Math.abs(p.stats.col - tile.col) + Math.abs(p.stats.row - tile.row)));
        if (this.acted && !this.moved && (role === 'flanker' || role === 'caster')) {
            const currentDistance = distance(this.active.stats);
            const retreat = [...this.Range().values()].filter(tile => tile.path.length && distance(tile) > currentDistance)
                .sort((a, b) => distance(b) - distance(a) || a.cost - b.cost)[0];
            if (retreat && this.Move(retreat)) return;
        }
        if (!this.acted && !this.moved && inRange && role === 'flanker') {
            const currentDamage = BattleRules.Preview(this.grid, this.active.stats, inRange.stats, ability).damage;
            const positions = [...this.Range().values()].filter(tile => tile.path.length
                && BattleRules.CanAttack(this.grid, { ...this.active.stats, ...tile }, inRange.stats, ability))
                .map(tile => ({
                    tile,
                    damage: BattleRules.Preview(this.grid, { ...this.active.stats, ...tile }, inRange.stats, ability).damage,
                }))
                .filter(entry => entry.damage > currentDamage)
                .sort((a, b) => b.damage - a.damage || a.tile.cost - b.tile.cost);
            if (positions.length && this.Move(positions[0].tile)) return;
        }
        if (!this.acted && inRange) {
            this.Attack(inRange, ability);
            return;
        }
        if (!this.moved && !this.acted) {
            const range = [...this.Range().values()].filter(tile => tile.path.length);
            const desiredDistance = role === 'caster' ? 3 : 1;
            const score = tile => role === 'caster' ? Math.abs(distance(tile) - desiredDistance) : distance(tile);
            range.sort((a, b) => score(a) - score(b) || a.cost - b.cost);
            const currentScore = score(this.active.stats);
            const direct = range.find(tile => score(tile) < currentScore);
            if (direct && this.Move(direct)) return;
            // A ridge or occupied choke point can require moving away before approaching.
            const routes = [...this.grid.Reachable(this.active.stats, {
                move: this.grid.cols * this.grid.rows * 2, climb: 1, jump: 2,
                occupied: this.Occupied(this.active),
            }).values()].sort((a, b) => a.cost - b.cost);
            const approach = routes.find(tile => tile.path.length && foes.some(foe =>
                BattleRules.CanAttack(this.grid, { ...this.active.stats, ...tile }, foe.stats, ability)));
            const next = approach?.path.findLast(tile => range.some(entry =>
                entry.col === tile.col && entry.row === tile.row));
            if (next && this.Move(next)) return;
        }
        const target = foes.sort((a, b) => Math.abs(a.stats.col - this.active.stats.col) + Math.abs(a.stats.row - this.active.stats.row) - Math.abs(b.stats.col - this.active.stats.col) - Math.abs(b.stats.row - this.active.stats.row))[0];
        if (target)
            this.active.stats.facing = BattleRules.Facing(this.active.stats, target.stats);
        if (role === 'bruiser' && !this.acted) {
            this.active.stats.guarded = true;
            this.message = `${this.active.stats.name} braces behind a guard stance`;
        }
        this.EndTurn();
    }
    CheckResult() {
        const teams = new Set(this.Alive().map(p => p.stats.team));
        if (teams.size >= 2) return false;
        this.result = teams.has('ally') ? 'VICTORY' : 'DEFEAT';
        this.phase = 'result';
        this.message = 'Battle complete — Retry to play again';
        this.sound.Play('success');
        return true;
    }
}
