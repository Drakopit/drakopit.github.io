import { Component } from 'gameforgejs/core';
import { TurnBudget } from '../data/BattleRules.js';

/** Tactical values belong to a unit component, independent of mesh representation. */
export class UnitStats extends Component {
    constructor(definition) { super(); this.definition = { ...definition }; this.Reset(); }
    Reset() {
        Object.assign(this, this.definition);
        this.maxHp = this.definition.maxHp ?? this.definition.hp;
        this.magic = this.definition.magic ?? this.definition.attack;
        this.defense = this.definition.defense ?? 3;
        this.level = this.definition.level ?? 1;
        this.ct = 0;
        this.apMax = this.definition.apMax ?? TurnBudget.ap;
        this.mpMax = this.definition.mpMax ?? (['flanker', 'bruiser'].includes(this.definition.role) ? TurnBudget.mpMobile : TurnBudget.mp);
        this.ap = this.apMax;
        this.mp = this.mpMax;
        this.cooldowns = {};
        this.casts = {};
        this.exposed = 0; this.stunned = 0; this.burn = 0; this.poison = 0; this.haste = 0; this.shield = 0; this.slowed = 0;
        this.guarded = false;
        this.flash = 0;
        // Presentation cue for the unit's visual: the clip of the action being performed.
        this.action = null;
        this.actionTime = 0;
    }
    OnUpdate(dt) {
        this.flash = Math.max(0, this.flash - dt);
        this.actionTime = Math.max(0, this.actionTime - dt);
        if (!this.actionTime) this.action = null;
    }
}
