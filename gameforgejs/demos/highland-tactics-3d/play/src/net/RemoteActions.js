import { HighlandActions } from '../data/HighlandActions.js';

/** HighlandActions that also tell the server about every hero command and gear change. */
export class RemoteActions extends HighlandActions {
    constructor(state, link) {
        super(state);
        this.link = link;
    }

    Move(tile) {
        const battle = this.state.exploring === 'battle';
        const ok = super.Move(tile);
        if (ok && battle) this.link.Command({ action: 'move', col: tile.col, row: tile.row });
        return ok;
    }

    UseSkill(target, ability = null) {
        const chosen = ability ?? this.state.turn.ability;
        const ok = super.UseSkill(target, ability);
        if (ok) this.link.Command({ action: 'skill', target: target.stats.id, ability: chosen });
        return ok;
    }

    UseItem(item) {
        const battle = this.state.exploring === 'battle';
        const ok = super.UseItem(item);
        if (ok && battle) this.link.Command({ action: 'item', item });
        return ok;
    }

    EndTurn() {
        const hero = this.state.turn.active;
        const ok = super.EndTurn();
        if (ok) this.link.Command({ action: 'end', facing: hero?.stats.facing });
        return ok;
    }

    Equip(item, slot = null) {
        const ok = super.Equip(item, slot);
        if (ok) this.link.Change('equip', { item, slot });
        return ok;
    }

    Unequip(slot) {
        const ok = super.Unequip(slot);
        if (ok) this.link.Change('unequip', { slot });
        return ok;
    }
}
