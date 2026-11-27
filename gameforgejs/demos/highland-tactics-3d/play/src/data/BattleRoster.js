import { Archetypes } from './HighlandCampaign.js';

/**
 * Battle rosters, shared by the browser and the MMO server: no engine imports, so a headless
 * server builds exactly the units the client shows.
 */

/** Enemy templates beyond the ones authored in the battlefield scene. */
export const ExtraEnemies = Object.freeze([
    { id: 'hound', name: 'Ash Hound', team: 'enemy', role: 'flanker', basicAbility: 'hound-bite', visualStyle: 'wolf', col: 7, row: 7, facing: 0, hp: 28, speed: 26, attack: 12, defense: 2, color: '#b98b59' },
    { id: 'adept', name: 'Ash Adept', team: 'enemy', role: 'caster', basicAbility: 'ember-flare', visualStyle: 'wisp', model: 'skeleton-mage', weapon: 'highland-wand', col: 4, row: 7, facing: 0, hp: 26, speed: 21, attack: 8, magic: 14, defense: 1, color: '#9676b8' },
]);

/** The hero's battle unit from the campaign: stats, gear visuals and learned skills. */
export function HeroUnit(campaign) {
    const hero = campaign.hero;
    return {
        ...hero,
        name: hero.name,
        hp: hero.hp,
        color: hero.color,
        team: 'ally',
        heroWeapon: true,
        model: Archetypes[hero.archetype]?.model,
        visualWeapon: campaign.equipment.weapon,
        visualOffhand: campaign.equipment.offhand,
        unlockedSkills: [...campaign.unlockedSkills],
    };
}

/**
 * Every unit of an encounter on the battlefield: the hero (and, with party control, the
 * companion) on the authored ally tiles, then the encounter's composition on the enemy spawn
 * points, scaled by the encounter level.
 * @param {{ units: Object[] }} battleData - From `BattleFromScene`.
 * @param {{ composition: { name: string, count: number }[], level: number }} encounter
 */
export function BuildBattleUnits(battleData, encounter, campaign, { partyControlEnabled = false } = {}) {
    const allyUnits = battleData.units.filter(unit => unit.team === 'ally');
    const enemies = battleData.units.filter(unit => unit.team === 'enemy').map(unit => ({
        ...unit,
        role: unit.id === 'scout' ? 'flanker' : 'bruiser',
        basicAbility: unit.id === 'scout' ? 'quick-shot' : 'guard-bash',
    }));
    const party = allyUnits.filter((unit, index) => index === 0 || (partyControlEnabled && campaign.companionDeployed)).map((unit, index) => index === 0
        ? { ...HeroUnit(campaign), col: unit.col, row: unit.row }
        : { ...unit, ...campaign.CompanionStats() });
    const templates = [...enemies, ...ExtraEnemies];
    const spawnPoints = templates.map(({ col, row }) => ({ col, row }));
    const roster = encounter.composition.flatMap(({ name, count }) => {
        const unit = templates.find(template => template.name === name);
        if (!unit) throw new RangeError(`Unknown encounter unit: ${name}`);
        return Array.from({ length: count }, () => unit);
    });
    if (roster.length > spawnPoints.length) throw new RangeError('Encounter exceeds available battle spawn points');
    const difficulty = encounter.level >= 4 ? 1.2 : 1;
    return [
        ...party,
        ...roster.map((unit, index) => ({
            ...unit, ...spawnPoints[index], id: `${unit.id}-${index}`, level: encounter.level,
            hp: Math.round(unit.hp * difficulty), attack: Math.round(unit.attack * difficulty),
            magic: Math.round((unit.magic ?? unit.attack) * difficulty),
            defense: unit.defense ?? 2,
        })),
    ];
}
