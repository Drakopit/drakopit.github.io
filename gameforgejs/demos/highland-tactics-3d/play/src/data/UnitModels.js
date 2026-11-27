// Character presentation data. Model names refer to config/resources.json; each unit's model
// comes from its scene node (Data.model), its calling (Archetypes) or its encounter data.

/** Clips bound from the KayKit Rig_Medium animation libraries onto every character model. */
export const UnitAnimations = Object.freeze({
    idle: { library: 'rig-general', clip: 'Idle_A' },
    walk: { library: 'rig-movement', clip: 'Walking_A' },
    hit: { library: 'rig-general', clip: 'Hit_A' },
    death: { library: 'rig-general', clip: 'Death_A' },
    item: { library: 'rig-general', clip: 'Use_Item' },
    melee: { library: 'rig-melee', clip: 'Melee_1H_Attack_Chop' },
    guard: { library: 'rig-melee', clip: 'Melee_Blocking' },
    shoot: { library: 'rig-ranged', clip: 'Ranged_Bow_Release' },
    cast: { library: 'rig-ranged', clip: 'Ranged_Magic_Spellcasting' },
});

/** KayKit characters are about 2.5 units tall; this fits them to a 1.15-unit tile. */
export const UnitModelScale = 0.44;

/** Held models for equipped items, attached to the hand slots of the character's rig. */
export const HeldModels = Object.freeze({
    'Training Blade': { model: 'highland-sword', hand: 'right' },
    'Highland Edge': { model: 'highland-sword-b', hand: 'right' },
    'Runed Staff': { model: 'highland-staff', hand: 'right' },
    'Oak Shield': { model: 'highland-shield', hand: 'left' },
});
