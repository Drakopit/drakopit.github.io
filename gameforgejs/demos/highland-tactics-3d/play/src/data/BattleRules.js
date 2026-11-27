import { AbilityProfiles } from './ClassSkills.js';

export const Facings = Object.freeze([
    { name: 'NORTH', col: 0, row: -1 }, { name: 'EAST', col: 1, row: 0 },
    { name: 'SOUTH', col: 0, row: 1 }, { name: 'WEST', col: -1, row: 0 },
]);
export const Commands = Object.freeze(['MOVE', 'ATTACK', 'SKILL', 'ITEM', 'WAIT / FACE']);
/** Action and movement points every unit starts a turn with (gear and passives add to them). */
export const TurnBudget = Object.freeze({ ap: 6, mp: 3, mpMobile: 4 });
export const MapScale = Object.freeze({ tile: 1.15, base: 0.45, elevation: 0.55 });

export function GetAbilityProfile(attacker, ability) {
    return AbilityProfiles[ability] ?? AbilityProfiles[attacker.basicAbility] ?? AbilityProfiles.strike;
}

/**
 * Why an ability cannot be cast right now (AP, cooldown or per-turn limit), or null when it can.
 * Stats without an `ap` value have no tracked budget (hypothetical previews), so only the
 * cooldown and per-turn limits apply to them.
 */
export function AbilityBlocked(attacker, ability) {
    const profile = GetAbilityProfile(attacker, ability);
    if ((attacker.cooldowns?.[ability] ?? 0) > 0) return `${profile.name} recharges in ${attacker.cooldowns[ability]} turn${attacker.cooldowns[ability] > 1 ? 's' : ''}`;
    if (profile.perTurn && (attacker.casts?.[ability] ?? 0) >= profile.perTurn) return `${profile.name} already used this turn`;
    if (attacker.ap !== undefined && attacker.ap < profile.ap) return `Not enough AP for ${profile.name} (${profile.ap} AP)`;
    return null;
}

/** Deterministic previews and resolution use exactly the same rules. */
export class BattleRules {
    static Facing(from, to) {
        const dx = to.col - from.col, dz = to.row - from.row;
        return Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 1 : 3) : (dz > 0 ? 2 : 0);
    }
    static Preview(grid, attacker, defender, ability = attacker.basicAbility ?? 'strike') {
        const profile = GetAbilityProfile(attacker, ability);
        if (profile.heal)
            return { chance: 100, heal: Math.min(BattleRules.HealAmount(attacker, profile), defender.maxHp - defender.hp) };
        if (profile.shield) return { chance: 100, shield: profile.shield };
        if (profile.haste) return { chance: 100, haste: profile.haste };
        const source = grid.Get(attacker.col, attacker.row), target = grid.Get(defender.col, defender.row);
        const direction = Facings[defender.facing];
        const dx = attacker.col - defender.col, dz = attacker.row - defender.row;
        const length = Math.max(1, Math.hypot(dx, dz));
        const dot = (dx * direction.col + dz * direction.row) / length;
        const side = dot > 0.5 ? 'FRONT' : dot < -0.5 ? 'BACK' : 'SIDE';
        const elevation = Math.max(-2, Math.min(2, source.h - target.h));
        const chance = Math.max(50, Math.min(100, (side === 'BACK' ? 100 : side === 'SIDE' ? 95 : 85) + elevation * 3));
        const armor = defender.exposed ? 0 : Math.round((defender.defense ?? 3) * (1 - (profile.pierce ?? 0)));
        const power = profile.magic ? (attacker.magic ?? attacker.attack) : attacker.attack;
        // Arcane resistance (percent, from gear, at most 50) softens magic damage.
        const arcane = profile.magic ? 1 - Math.min(50, Math.max(0, defender.resist?.arcane ?? 0)) / 100 : 1;
        const damage = Math.max(1, Math.round((power * profile.power - armor + elevation * 2)
            * (side === 'BACK' ? 1.35 + (profile.backBonus ?? 0) : side === 'SIDE' ? 1.15 : 1)
            * (defender.guarded ? 0.5 : 1) * arcane));
        const blocked = Math.min(damage, defender.shield ?? 0);
        return { chance, damage: damage - blocked, blocked, rawDamage: damage, side, elevation };
    }
    static HealAmount(attacker, profile) {
        return profile.heal + Math.floor((attacker.magic ?? 0) / 3);
    }
    static InSplash(grid, attacker, target, other, profile) {
        const dc = other.col - target.col, dr = other.row - target.row;
        if (profile.shape === 'line') {
            const dx = Math.sign(target.col - attacker.col), dy = Math.sign(target.row - attacker.row);
            const distance = Math.abs(other.col - attacker.col) + Math.abs(other.row - attacker.row);
            return (dx ? dr === 0 && dc * dx > 0 : dc === 0 && dr * dy > 0)
                && distance <= profile.range && Math.abs(grid.Get(attacker.col, attacker.row).h - grid.Get(other.col, other.row).h) <= profile.height
                && grid.CanSee(attacker, other);
        }
        if (profile.shape === 'cone') {
            const dx = target.col - attacker.col, dy = target.row - attacker.row;
            return dx ? dc === 0 && Math.abs(dr) === 1 : dr === 0 && Math.abs(dc) === 1;
        }
        return Math.abs(dc) + Math.abs(dr) === 1;
    }
    static CanAttack(grid, attacker, defender, ability = attacker.basicAbility ?? 'strike') {
        if (attacker.hp <= 0 || defender.hp <= 0)
            return false;
        const profile = GetAbilityProfile(attacker, ability);
        const support = profile.heal || profile.shield || profile.haste;
        const ailing = profile.cleanse && (defender.poison > 0 || defender.burn > 0 || defender.slowed > 0);
        if (support ? attacker.team !== defender.team || (profile.heal && defender.hp >= defender.maxHp && !ailing) : attacker.team === defender.team)
            return false;
        const distance = Math.abs(attacker.col - defender.col) + Math.abs(attacker.row - defender.row);
        const source = grid.Get(attacker.col, attacker.row), target = grid.Get(defender.col, defender.row);
        if ((!support && distance === 0) || !source || !target) return false;
        if (profile.shape === 'line' && attacker.col !== defender.col && attacker.row !== defender.row) return false;
        const height = Math.abs(source.h - target.h);
        return distance <= profile.range && height <= profile.height
            && !AbilityBlocked(attacker, ability) && (distance === 0 || grid.CanSee(attacker, defender));
    }
}
