import { Component } from 'gameforgejs/core';
import { BattleRules, GetAbilityProfile } from '../data/BattleRules.js';
import { ActiveSkills } from '../data/ClassSkills.js';
/** CT, action budgets and phase transitions. No input or rendering dependencies. */
export class TurnSystem extends Component {
    constructor(grid, pawns, sound) { super(); this.grid = grid; this.pawns = pawns; this.sound = sound; this.Reset(); }
    Reset() { this.phase = 'charge'; this.active = null; this.message = 'The highland watch — defeat the Ash patrol'; this.result = null; this.seed = 74; this.feedback = []; this.command = 0; }
    Alive() { return this.pawns.filter(p => p.stats.hp > 0); }
    Occupied(actor) { return new Set(this.Alive().filter(p => p !== actor).map(p => this.grid.Key(p.stats))); }
    Range(actor = this.active) { return this.grid.Reachable(actor.stats, { move: Math.max(1, (['flanker', 'bruiser'].includes(actor.stats.role) ? 4 : 3) - (actor.stats.slowed > 0 ? 2 : 0)), climb: 1, jump: 2, occupied: this.Occupied(actor) }); }
    Begin(actor) {
        this.active = actor;
        this.moved = false;
        this.acted = false;
        this.command = 0;
        actor.stats.guarded = false;
        actor.stats.energy = Math.min(actor.stats.energyMax ?? 2, actor.stats.energy + 1);
        actor.stats.exposed = Math.max(0, actor.stats.exposed - 1);
        actor.stats.haste = Math.max(0, (actor.stats.haste ?? 0) - 1);
        if (actor.stats.burn > 0) {
            actor.stats.hp = Math.max(0, actor.stats.hp - 4);
            actor.stats.burn--;
            this.feedback.push({ pawn: actor, text: '-4 BURN', life: 1.7 });
            if (actor.stats.hp === 0) {
                this.CheckResult();
                actor.stats.ct = 0;
                this.active = null;
                this.phase = this.result ? 'result' : 'charge';
                return;
            }
        }
        if (actor.stats.poison > 0) {
            actor.stats.hp = Math.max(0, actor.stats.hp - 3);
            actor.stats.poison--;
            this.feedback.push({ pawn: actor, text: '-3 POISON', life: 1.7, effect: 'poison' });
            if (actor.stats.hp === 0) {
                this.CheckResult();
                actor.stats.ct = 0;
                this.active = null;
                this.phase = this.result ? 'result' : 'charge';
                return;
            }
        }
        if (actor.stats.stunned > 0) {
            actor.stats.stunned--;
            actor.stats.slowed = Math.max(0, (actor.stats.slowed ?? 0) - 1);
            actor.stats.ct = 0;
            this.active = null;
            this.phase = 'charge';
            this.message = `${actor.stats.name} is stunned and loses the turn`;
            return;
        }
        this.cursor = { col: actor.stats.col, row: actor.stats.row };
        this.phase = actor.stats.team === 'ally' ? 'command' : 'ai';
        this.delay = 0.55;
        this.message = `${actor.stats.name}: Move, Act, then choose a facing`;
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
    }
    Choose(index) {
        if (this.phase !== 'command' || !Number.isInteger(index) || index < 0 || index > 4)
            return;
        this.command = index;
        if (index === 0) {
            if (this.moved) {
                this.message = 'Movement already spent';
                return;
            }
            this.area = this.Range();
            this.phase = 'move';
        }
        else if (index === 4) {
            this.previousFacing = this.active.stats.facing;
            this.phase = 'face';
            this.message = 'Choose a direction, then confirm Wait';
        }
        else if (index === 3) {
            if (this.acted) {
                this.message = 'Action already spent';
                return;
            }
            this.phase = 'item';
            this.message = 'Use a potion on the active hero, or cancel';
        }
        else if (index === 1) {
            if (this.acted) {
                this.message = 'Action already spent';
                return;
            }
            this.ability = this.active.stats.basicAbility ?? 'strike';
            this.phase = 'target';
            this.message = `${GetAbilityProfile(this.active.stats, this.ability).name}: choose a target`;
        }
        else {
            if (this.acted) {
                this.message = 'Action already spent';
                return;
            }
            this.phase = 'skill-select';
            this.skillCursor = 0;
            this.message = ActiveSkills(this.active.stats.archetype, this.active.stats.unlockedSkills).length
                ? 'Choose an unlocked class skill'
                : 'No class skills unlocked — earn a skill point by leveling up';
        }
    }
    SelectSkill(id) {
        if (this.phase !== 'skill-select' || !this.active) return false;
        const skill = ActiveSkills(this.active.stats.archetype, this.active.stats.unlockedSkills).find(item => item.id === id);
        if (!skill) return false;
        const profile = GetAbilityProfile(this.active.stats, id);
        if (this.active.stats.energy < profile.energy) {
            this.message = 'Not enough energy for that skill';
            return false;
        }
        this.ability = id;
        this.phase = 'target';
        this.message = `${profile.name}: choose a target`;
        return true;
    }
    Move(tile) {
        if (!this.active || !['move', 'ai'].includes(this.phase))
            return false;
        const entry = this.Range().get(this.grid.Key(tile));
        if (!entry || !entry.path.length || this.moved)
            return false;
        this.active.stats.facing = BattleRules.Facing(this.active.stats, entry.path[0]);
        this.moved = true;
        const next = this.active.stats.team === 'ally' ? 'command' : 'ai';
        this.phase = 'travel';
        this.active.travel.Follow(entry.path, () => { this.phase = next; this.cursor = { col: tile.col, row: tile.row }; this.delay = 0.45; });
        this.sound.Play('step');
        return true;
    }
    Attack(target, ability = this.ability) {
        if (!this.active || !['target', 'ai'].includes(this.phase))
            return false;
        if (this.acted || !target || !BattleRules.CanAttack(this.grid, this.active.stats, target.stats, ability))
            return false;
        this.target = target;
        this.ability = ability;
        this.preview = BattleRules.Preview(this.grid, this.active.stats, target.stats, ability);
        if (target !== this.active)
            this.active.stats.facing = BattleRules.Facing(this.active.stats, target.stats);
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
            this.active.stats.energy -= profile.energy;
            this.sound.Play('success');
            this.acted = true;
            this.phase = this.active.stats.team === 'ally' ? 'command' : 'ai';
            this.delay = 0.5;
            return;
        }
        if (profile.heal) {
            const target = this.target.stats;
            const recipients = this.Alive().filter(pawn => pawn === this.target || (profile.healSplash
                && pawn.stats.team === this.active.stats.team
                && Math.abs(pawn.stats.col - target.col) + Math.abs(pawn.stats.row - target.row) === 1));
            for (const pawn of recipients) {
                const healed = Math.min(BattleRules.HealAmount(this.active.stats, profile), pawn.stats.maxHp - pawn.stats.hp);
                if (!healed) continue;
                pawn.stats.hp += healed;
                pawn.stats.flash = 0.3;
                this.feedback.push({ pawn, text: `+${healed} HP`, effect: 'heal', life: 1.7 });
            }
            this.active.stats.energy -= profile.energy;
            this.sound.Play('success');
            this.acted = true;
            this.phase = this.active.stats.team === 'ally' ? 'command' : 'ai';
            this.delay = 0.5;
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
                    affected.push({ pawn, damage: damage - blocked });
                }
            }
            if (profile.knockback && defender.hp > 0)
                this.Knockback(this.target);
        }
        this.active.stats.energy -= profile.energy;
        if (hit)
            for (const entry of affected)
                this.feedback.push({ pawn: entry.pawn, text: `-${entry.damage}${entry.pawn === this.target && profile.expose ? ' EXPOSED' : ''}`, effect: profile.poison ? 'poison' : profile.magic ? 'magic' : 'hit', life: 1.7 });
        else
            this.feedback.push({ pawn: this.target, text: 'MISS', life: 1.7 });
        this.sound.Play(hit ? 'hit' : 'select');
        this.acted = true;
        if (this.CheckResult()) return;
        this.phase = this.active.stats.team === 'ally' ? 'command' : 'ai';
        this.delay = 0.5;
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
