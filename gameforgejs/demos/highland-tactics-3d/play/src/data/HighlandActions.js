import { BattleRules, GetAbilityProfile } from './BattleRules.js';
import { ActiveSkills } from './ClassSkills.js';
import { EquipmentSlot } from './HighlandCampaign.js';

export function CommandAvailable(turn, player, campaign, index) {
    if (turn.phase !== 'command' || !turn.active || turn.active.stats.team !== 'ally') return false;
    if (index === 0) return !turn.moved;
    if (index === 1) return !turn.acted
        && (turn.active.stats.energy ?? 0) >= GetAbilityProfile(turn.active.stats, turn.active.stats.basicAbility).energy;
    if (index === 2) return !turn.acted && ActiveSkills(turn.active.stats.archetype, turn.active.stats.unlockedSkills)
        .some(skill => (turn.active.stats.energy ?? 0) >= GetAbilityProfile(turn.active.stats, skill.id).energy);
    if (index === 3) return !turn.acted && turn.active === player && (campaign.inventory.Potion ?? 0) > 0
        && turn.active.stats.hp < turn.active.stats.maxHp;
    return index === 4;
}

/** State-only action entry points; presentation and transport stay outside this class. */
export class HighlandActions {
    constructor(state) { this.state = state; }

    Move(tile) {
        const { turn, exploring } = this.state;
        if (exploring !== 'battle' || turn.active?.stats.team !== 'ally') return false;
        return turn.Move(tile);
    }

    UseSkill(target) {
        const { turn, exploring } = this.state;
        if (exploring !== 'battle' || turn.active?.stats.team !== 'ally') return false;
        return turn.Attack(target);
    }

    EndTurn() {
        const { turn, exploring } = this.state;
        if (exploring !== 'battle' || turn.phase !== 'face' || turn.active?.stats.team !== 'ally') return false;
        turn.EndTurn();
        return true;
    }

    Equip(item) {
        const { campaign, exploring } = this.state;
        if (exploring !== 'explore') return false;
        const slot = EquipmentSlot(item);
        return Boolean(slot && campaign.EquipOwned(item, slot));
    }

    Loot() {
        const { campaign, turn, encounterId, pawns, player } = this.state;
        if (this.state.exploring !== 'battle' || turn.result !== 'VICTORY'
            || this.state.resultHandled || this.state.lootResult || !player) return null;
        campaign.SyncHero(player.stats);
        const companion = pawns.find(pawn => pawn.stats.id === 'orin');
        if (companion) campaign.SyncCompanion(companion.stats);
        campaign.clearedZones.add(encounterId);
        campaign.hero.hp = Math.max(1, campaign.hero.hp);
        campaign.gold += encounterId === 'ashen-ridge' ? 45 : 30;
        const experience = encounterId === 'ashen-ridge' ? 90 : 60;
        const levels = campaign.AwardExperience(experience);
        if (companion) {
            campaign.AwardCompanionExperience(experience);
            campaign.companion.hp = Math.max(1, campaign.companion.hp);
        }
        this.state.lootResult = { experience, levels };
        return this.state.lootResult;
    }
}

export function FaceNearestEnemy(turn) {
    const actor = turn.active?.stats;
    if (!actor) return;
    const target = turn.Alive().filter(pawn => pawn.stats.team !== actor.team)
        .sort((a, b) => {
            const distance = pawn => Math.abs(pawn.stats.col - actor.col) + Math.abs(pawn.stats.row - actor.row);
            return distance(a) - distance(b) || String(a.stats.id).localeCompare(String(b.stats.id));
        })[0];
    if (target) actor.facing = BattleRules.Facing(actor, target.stats);
}
