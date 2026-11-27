export const BasicAbilities = Object.freeze({
    vanguard: 'cleave',
    ranger: 'quick-shot',
    arcanist: 'spark',
    cleric: 'radiant-bolt',
});

/**
 * Every ability's tactical profile. `ap` is the action-point cost, `cooldown` the number of the
 * caster's own turns before it can be cast again (0 = none) and `perTurn` how often it can be
 * cast in one turn. Range, height, power and effects drive previews and resolution alike.
 */
export const AbilityProfiles = Object.freeze({
    strike: { name: 'Strike', range: 1, height: 1, ap: 3, perTurn: 1, power: 1 },
    cleave: { name: 'Cleave', range: 1, height: 1, ap: 3, perTurn: 1, power: 1, splash: 0.55 },
    'quick-shot': { name: 'Quick Shot', range: 3, height: 2, ap: 3, perTurn: 1, power: 0.9 },
    spark: { name: 'Spark', range: 3, height: 3, ap: 3, perTurn: 1, power: 1.1, magic: true, expose: true },
    'radiant-bolt': { name: 'Radiant Bolt', range: 2, height: 2, ap: 3, perTurn: 1, power: 0.85, magic: true },
    'guard-bash': { name: 'Guard Bash', range: 1, height: 1, ap: 3, perTurn: 1, power: 0.85, stun: true, knockback: true },
    'hound-bite': { name: 'Hound Bite', range: 1, height: 1, ap: 3, perTurn: 1, power: 1, backBonus: 0.3 },
    'ember-flare': { name: 'Ember Flare', range: 3, height: 3, ap: 3, perTurn: 1, power: 0.9, magic: true, burn: 1, splash: 0.5 },
    // Vanguard
    'shield-bash': { name: 'Shield Bash', range: 1, height: 1, ap: 3, cooldown: 2, power: 1, stun: true },
    'sweeping-strike': { name: 'Sweeping Strike', range: 1, height: 1, ap: 4, cooldown: 2, power: 1.2, shape: 'cone', splash: 0.8 },
    bulwark: { name: 'Bulwark', range: 1, height: 1, ap: 4, cooldown: 2, shield: 12 },
    lunge: { name: 'Lunge', range: 2, height: 1, ap: 3, cooldown: 1, power: 1.15, shape: 'line', expose: true },
    'ground-slam': { name: 'Ground Slam', range: 1, height: 1, ap: 5, cooldown: 3, power: 1.1, splash: 0.7, slow: 1 },
    'rallying-guard': { name: 'Rallying Guard', range: 2, height: 2, ap: 3, cooldown: 3, shield: 8 },
    // Ranger
    'piercing-arrow': { name: 'Piercing Arrow', range: 4, height: 2, ap: 3, cooldown: 1, power: 1.2, pierce: 0.5, shape: 'line', splash: 0.6 },
    'pinning-shot': { name: 'Pinning Shot', range: 3, height: 2, ap: 3, cooldown: 2, power: 0.8, slow: 1 },
    'venom-shot': { name: 'Venom Shot', range: 3, height: 2, ap: 4, cooldown: 2, power: 0.9, poison: 2 },
    'hunters-mark': { name: "Hunter's Mark", range: 5, height: 3, ap: 2, cooldown: 2, power: 0.6, expose: true },
    volley: { name: 'Volley', range: 4, height: 2, ap: 5, cooldown: 3, power: 0.9, splash: 0.6 },
    'crippling-arrow': { name: 'Crippling Arrow', range: 4, height: 2, ap: 4, cooldown: 2, power: 0.8, slow: 1, expose: true },
    // Arcanist
    fireball: { name: 'Fireball', range: 3, height: 3, ap: 4, cooldown: 2, power: 1.5, magic: true, burn: 2, splash: 0.6 },
    'arcane-burst': { name: 'Arcane Burst', range: 3, height: 3, ap: 4, cooldown: 2, power: 1.1, magic: true, splash: 0.7, expose: true },
    'chain-lightning': { name: 'Chain Lightning', range: 3, height: 3, ap: 5, cooldown: 3, power: 1.2, magic: true, splash: 0.7, stun: true },
    'frost-lance': { name: 'Frost Lance', range: 4, height: 3, ap: 3, cooldown: 1, power: 1, magic: true, shape: 'line', slow: 1 },
    'mana-shield': { name: 'Mana Shield', range: 0, height: 0, ap: 2, cooldown: 3, shield: 10 },
    meteor: { name: 'Meteor', range: 4, height: 4, ap: 6, cooldown: 4, power: 1.7, magic: true, burn: 2, splash: 0.7 },
    // Cleric
    heal: { name: 'Heal', range: 3, height: 2, ap: 3, cooldown: 1, heal: 18 },
    'healing-light': { name: 'Healing Light', range: 3, height: 2, ap: 4, cooldown: 2, heal: 12, healSplash: true },
    haste: { name: 'Haste', range: 2, height: 2, ap: 4, cooldown: 3, haste: 2 },
    smite: { name: 'Smite', range: 3, height: 2, ap: 3, cooldown: 2, power: 1.05, magic: true, stun: true },
    purify: { name: 'Purify', range: 3, height: 2, ap: 2, cooldown: 2, heal: 6, cleanse: true },
    sanctuary: { name: 'Sanctuary', range: 2, height: 2, ap: 4, cooldown: 3, shield: 10 },
});

export const SkillTrees = Object.freeze({
    vanguard: [
        { id: 'shield-bash', name: 'Shield Bash', kind: 'active', description: 'Strike a nearby foe and stun them.', requires: [] },
        { id: 'iron-vow', name: 'Iron Vow', kind: 'passive', description: '+2 defense.', requires: ['shield-bash'], defense: 2 },
        { id: 'sweeping-strike', name: 'Sweeping Strike', kind: 'active', description: 'A close cone strike.', requires: ['iron-vow'] },
        { id: 'bulwark', name: 'Bulwark', kind: 'active', description: 'Shield an ally from 12 damage.', requires: ['sweeping-strike'] },
        { id: 'lunge', name: 'Lunge', kind: 'active', description: 'Thrust two tiles in a line and expose the foe.', requires: ['shield-bash'] },
        { id: 'rallying-guard', name: 'Rallying Guard', kind: 'active', description: 'Shield an ally up to two tiles away.', requires: ['bulwark'] },
        { id: 'ground-slam', name: 'Ground Slam', kind: 'active', description: 'Shake the ground: hits around the foe and slows.', requires: ['sweeping-strike'] },
    ],
    ranger: [
        { id: 'piercing-arrow', name: 'Piercing Arrow', kind: 'active', description: 'A straight line that pierces armor.', requires: [] },
        { id: 'keen-eye', name: 'Keen Eye', kind: 'passive', description: '+2 attack.', requires: ['piercing-arrow'], attack: 2 },
        { id: 'pinning-shot', name: 'Pinning Shot', kind: 'active', description: 'A shot that slows movement.', requires: ['keen-eye'] },
        { id: 'venom-shot', name: 'Venom Shot', kind: 'active', description: 'Poison a foe for two turns.', requires: ['pinning-shot'] },
        { id: 'hunters-mark', name: "Hunter's Mark", kind: 'active', description: 'A long, cheap shot that exposes the foe.', requires: ['piercing-arrow'] },
        { id: 'crippling-arrow', name: 'Crippling Arrow', kind: 'active', description: 'Slow and expose a distant foe.', requires: ['pinning-shot'] },
        { id: 'volley', name: 'Volley', kind: 'active', description: 'Rain arrows around the target.', requires: ['venom-shot'] },
    ],
    arcanist: [
        { id: 'fireball', name: 'Fireball', kind: 'active', description: 'A fiery cross that burns nearby foes.', requires: [] },
        { id: 'deep-focus', name: 'Deep Focus', kind: 'passive', description: '+1 maximum AP.', requires: ['fireball'], ap: 1 },
        { id: 'arcane-burst', name: 'Arcane Burst', kind: 'active', description: 'A cross blast that exposes foes.', requires: ['deep-focus'] },
        { id: 'chain-lightning', name: 'Chain Lightning', kind: 'active', description: 'A stunning cross blast.', requires: ['arcane-burst'] },
        { id: 'frost-lance', name: 'Frost Lance', kind: 'active', description: 'A piercing line of ice that slows.', requires: ['fireball'] },
        { id: 'mana-shield', name: 'Mana Shield', kind: 'active', description: 'Wrap yourself in a 10-point shield.', requires: ['deep-focus'] },
        { id: 'meteor', name: 'Meteor', kind: 'active', description: 'A burning crater. Costs every AP.', requires: ['chain-lightning'] },
    ],
    cleric: [
        { id: 'heal', name: 'Heal', kind: 'active', description: 'Heal yourself or an ally; scales with MAG.', requires: [] },
        { id: 'devotion', name: 'Devotion', kind: 'passive', description: '+1 maximum AP.', requires: ['heal'], ap: 1 },
        { id: 'healing-light', name: 'Healing Light', kind: 'active', description: 'Heals allies in a cross.', requires: ['devotion'] },
        { id: 'haste', name: 'Haste', kind: 'active', description: 'Speed an ally for two turns.', requires: ['healing-light'] },
        { id: 'smite', name: 'Smite', kind: 'active', description: 'Holy light that stuns a foe.', requires: ['heal'] },
        { id: 'purify', name: 'Purify', kind: 'active', description: 'Cure poison, burn and slow, and heal a little.', requires: ['devotion'] },
        { id: 'sanctuary', name: 'Sanctuary', kind: 'active', description: 'Shield an ally from 10 damage.', requires: ['haste'] },
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

/** A class's active skills in tree order: the fixed contents of hotbar slots 2–7. */
export function SkillBar(archetype) {
    return (SkillTrees[archetype] ?? []).filter(skill => skill.kind === 'active').slice(0, 6);
}
