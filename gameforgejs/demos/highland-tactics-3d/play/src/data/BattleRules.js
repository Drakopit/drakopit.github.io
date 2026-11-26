import { AbilityProfiles } from './ClassSkills.js';

export const Facings = Object.freeze([
    { name: 'NORTH', col: 0, row: -1 }, { name: 'EAST', col: 1, row: 0 },
    { name: 'SOUTH', col: 0, row: 1 }, { name: 'WEST', col: -1, row: 0 },
]);
export const Commands = Object.freeze(['MOVE', 'ATTACK', 'SKILL', 'ITEM', 'WAIT / FACE']);
export const MapScale = Object.freeze({ tile: 1.15, base: 0.45, elevation: 0.55 });

export function GetAbilityProfile(attacker, ability) {
    return AbilityProfiles[ability] ?? AbilityProfiles[attacker.basicAbility] ?? AbilityProfiles.strike;
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
            return { chance: 100, heal: Math.min(profile.heal, defender.maxHp - defender.hp) };
        const source = grid.Get(attacker.col, attacker.row), target = grid.Get(defender.col, defender.row);
        const direction = Facings[defender.facing];
        const dx = attacker.col - defender.col, dz = attacker.row - defender.row;
        const length = Math.max(1, Math.hypot(dx, dz));
        const dot = (dx * direction.col + dz * direction.row) / length;
        const side = dot > 0.5 ? 'FRONT' : dot < -0.5 ? 'BACK' : 'SIDE';
        const elevation = Math.max(-2, Math.min(2, source.h - target.h));
        const chance = Math.max(50, Math.min(100, (side === 'BACK' ? 100 : side === 'SIDE' ? 95 : 85) + elevation * 3));
        const armor = defender.exposed ? 0 : Math.round((defender.defense ?? 3) * (1 - (profile.pierce ?? 0)));
        const damage = Math.max(1, Math.round((attacker.attack * profile.power - armor + elevation * 2) * (side === 'BACK' ? 1.35 + (profile.backBonus ?? 0) : side === 'SIDE' ? 1.15 : 1)));
        return { chance, damage, side, elevation };
    }
    static CanAttack(grid, attacker, defender, ability = attacker.basicAbility ?? 'strike') {
        if (attacker.hp <= 0 || defender.hp <= 0)
            return false;
        const profile = GetAbilityProfile(attacker, ability);
        if (profile.heal ? attacker.team !== defender.team || defender.hp >= defender.maxHp : attacker.team === defender.team)
            return false;
        const distance = Math.abs(attacker.col - defender.col) + Math.abs(attacker.row - defender.row);
        const source = grid.Get(attacker.col, attacker.row), target = grid.Get(defender.col, defender.row);
        if ((!profile.heal && distance === 0) || !source || !target) return false;
        const height = Math.abs(source.h - target.h);
        return distance <= profile.range && height <= profile.height
            && (attacker.energy ?? 0) >= profile.energy && (distance === 0 || grid.CanSee(attacker, defender));
    }
}
