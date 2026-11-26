import { Component } from 'gameforgejs/core';
/** Tactical values belong to a unit component, independent of mesh representation. */
export class UnitStats extends Component {
    constructor(definition) { super(); this.definition = { ...definition }; this.Reset(); }
    Reset() { Object.assign(this, this.definition); this.maxHp = this.definition.maxHp ?? this.definition.hp; this.magic = this.definition.magic ?? this.definition.attack; this.defense = this.definition.defense ?? 3; this.level = this.definition.level ?? 1; this.ct = 0; this.energyMax = this.definition.energyMax ?? 2; this.energy = this.energyMax; this.exposed = 0; this.stunned = 0; this.burn = 0; this.poison = 0; this.haste = 0; this.shield = 0; this.slowed = 0; this.guarded = false; this.flash = 0; }
    OnUpdate(dt) { this.flash = Math.max(0, this.flash - dt); }
}
