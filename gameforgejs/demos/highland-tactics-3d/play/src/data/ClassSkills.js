export const BasicAbilities = Object.freeze({
    vanguard: 'cleave',
    ranger: 'quick-shot',
    arcanist: 'spark',
    cleric: 'radiant-bolt',
});

export const AbilityProfiles = Object.freeze({
    strike: { name: 'Strike', range: 1, height: 1, energy: 0, power: 1 },
    cleave: { name: 'Cleave', range: 1, height: 1, energy: 0, power: 1, splash: 0.55 },
    'quick-shot': { name: 'Quick Shot', range: 3, height: 2, energy: 0, power: 0.9 },
    spark: { name: 'Spark', range: 3, height: 3, energy: 1, power: 1.1, magic: true, expose: true },
    'radiant-bolt': { name: 'Radiant Bolt', range: 2, height: 2, energy: 0, power: 0.85, magic: true },
    'guard-bash': { name: 'Guard Bash', range: 1, height: 1, energy: 1, power: 0.85, stun: true, knockback: true },
    'hound-bite': { name: 'Hound Bite', range: 1, height: 1, energy: 0, power: 1, backBonus: 0.3 },
    'ember-flare': { name: 'Ember Flare', range: 3, height: 3, energy: 1, power: 0.9, magic: true, burn: 1, splash: 0.5 },
    'shield-bash': { name: 'Shield Bash', range: 1, height: 1, energy: 1, power: 1, stun: true },
    'piercing-arrow': { name: 'Piercing Arrow', range: 4, height: 2, energy: 1, power: 1.2, pierce: 0.5, shape: 'line', splash: 0.6 },
    fireball: { name: 'Fireball', range: 3, height: 3, energy: 2, power: 1.5, magic: true, burn: 2, splash: 0.6 },
    heal: { name: 'Heal', range: 3, height: 2, energy: 1, heal: 18 },
    'sweeping-strike': { name: 'Sweeping Strike', range: 1, height: 1, energy: 2, power: 1.2, shape: 'cone', splash: 0.8 },
    'pinning-shot': { name: 'Pinning Shot', range: 3, height: 2, energy: 1, power: 0.8, slow: 1 },
    'arcane-burst': { name: 'Arcane Burst', range: 3, height: 3, energy: 2, power: 1.1, magic: true, splash: 0.7, expose: true },
    'healing-light': { name: 'Healing Light', range: 3, height: 2, energy: 2, heal: 12, healSplash: true },
    bulwark: { name: 'Bulwark', range: 1, height: 1, energy: 2, shield: 12 },
    'venom-shot': { name: 'Venom Shot', range: 3, height: 2, energy: 2, power: 0.9, poison: 2 },
    'chain-lightning': { name: 'Chain Lightning', range: 3, height: 3, energy: 3, power: 1.2, magic: true, splash: 0.7, stun: true },
    haste: { name: 'Haste', range: 2, height: 2, energy: 2, haste: 2 },
});

export const SkillTrees = Object.freeze({
    vanguard: [
        { id: 'shield-bash', name: 'Shield Bash', kind: 'active', description: 'Strike a nearby foe and stun them.', requires: [] },
        { id: 'iron-vow', name: 'Iron Vow', kind: 'passive', description: '+2 defense.', requires: ['shield-bash'], defense: 2 },
        { id: 'sweeping-strike', name: 'Sweeping Strike', kind: 'active', description: 'A close cone strike · 2 EN.', requires: ['iron-vow'] },
        { id: 'bulwark', name: 'Bulwark', kind: 'active', description: 'Shield an ally from 12 damage · 2 EN.', requires: ['sweeping-strike'] },
    ],
    ranger: [
        { id: 'piercing-arrow', name: 'Piercing Arrow', kind: 'active', description: 'A straight line that pierces armor.', requires: [] },
        { id: 'keen-eye', name: 'Keen Eye', kind: 'passive', description: '+2 attack.', requires: ['piercing-arrow'], attack: 2 },
        { id: 'pinning-shot', name: 'Pinning Shot', kind: 'active', description: 'A shot that slows movement · 1 EN.', requires: ['keen-eye'] },
        { id: 'venom-shot', name: 'Venom Shot', kind: 'active', description: 'Poison a foe for two turns · 2 EN.', requires: ['pinning-shot'] },
    ],
    arcanist: [
        { id: 'fireball', name: 'Fireball', kind: 'active', description: 'A fiery cross that burns nearby foes.', requires: [] },
        { id: 'deep-focus', name: 'Deep Focus', kind: 'passive', description: '+1 maximum energy.', requires: ['fireball'], energy: 1 },
        { id: 'arcane-burst', name: 'Arcane Burst', kind: 'active', description: 'A cross blast exposes foes · 2 EN.', requires: ['deep-focus'] },
        { id: 'chain-lightning', name: 'Chain Lightning', kind: 'active', description: 'A stunning cross blast · 3 EN.', requires: ['arcane-burst'] },
    ],
    cleric: [
        { id: 'heal', name: 'Heal', kind: 'active', description: 'Heal yourself or an ally · scales with MAG.', requires: [] },
        { id: 'devotion', name: 'Devotion', kind: 'passive', description: '+1 maximum energy.', requires: ['heal'], energy: 1 },
        { id: 'healing-light', name: 'Healing Light', kind: 'active', description: 'Heals allies in a cross · 2 EN.', requires: ['devotion'] },
        { id: 'haste', name: 'Haste', kind: 'active', description: 'Speed an ally for two turns · 2 EN.', requires: ['healing-light'] },
    ],
});

export function GetSkill(archetype, id) {
    return SkillTrees[archetype]?.find(skill => skill.id === id) ?? null;
}

export function ActiveSkills(archetype, unlocked = []) {
    return unlocked
        .map(id => GetSkill(archetype, id))
        .filter(skill => skill?.kind === 'active');
}
