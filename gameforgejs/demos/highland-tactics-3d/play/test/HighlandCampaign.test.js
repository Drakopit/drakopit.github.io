import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HighlandCampaign, EquipmentSlot, EquipmentSlots, SlotAccepts } from '../src/data/HighlandCampaign.js';
import { GetZone as ReadZone, WorldMapDisplay, WorldZones } from '../src/data/WorldMaps.js';
import { BattleRules } from '../src/data/BattleRules.js';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const zoneScenes = Object.fromEntries(['hearthvale', 'mistfell', 'ashen-ridge'].map(id => [
    id,
    JSON.parse(readFileSync(path.join(testDirectory, '..', 'scenes', `${id}.gfscene.json`), 'utf8')),
]));
const GetZone = id => ReadZone(id, zoneScenes[id]);

test('character creation applies class stats and starting equipment', () => {
    const campaign = new HighlandCampaign();
    assert.equal(campaign.CreateCharacter('ranger'), true);
    assert.equal(campaign.hero.className, 'Ranger');
    assert.equal(campaign.hero.speed, 27);
    assert.equal(campaign.hero.attack, campaign.hero.baseAttack);
});

test('experience levels up and recalculates maximum health and stats', () => {
    const campaign = new HighlandCampaign();
    campaign.CreateCharacter('vanguard');
    const levels = campaign.AwardExperience(60);
    assert.equal(levels, 1);
    assert.equal(campaign.hero.level, 2);
    assert.equal(campaign.hero.maxHp, 54);
    assert.equal(campaign.hero.attack, campaign.hero.baseAttack + 2);
});

test('class skills unlock with level-earned points and passive nodes change stats', () => {
    const campaign = new HighlandCampaign();
    campaign.CreateCharacter('vanguard');
    assert.equal(campaign.LearnSkill('iron-vow'), false);

    campaign.AwardExperience(160);
    assert.equal(campaign.skillPoints, 2);
    assert.equal(campaign.LearnSkill('shield-bash'), true);
    assert.equal(campaign.LearnSkill('iron-vow'), true);
    assert.equal(campaign.skillPoints, 0);
    assert.equal(campaign.hero.defense, campaign.hero.baseDefense + 4);
    assert.deepEqual(campaign.hero.unlockedSkills, ['shield-bash', 'iron-vow']);
    assert.equal(campaign.LearnSkill('shield-bash'), false);
});

test('basic attacks have class-specific tactical ranges and costs', () => {
    const grid = { Get: () => ({ h: 0 }), CanSee: () => true };
    const ranger = { id: 'r', team: 'ally', hp: 20, col: 0, row: 0, ap: 3, basicAbility: 'quick-shot' };
    const vanguard = { ...ranger, basicAbility: 'cleave' };
    const target = { id: 'e', team: 'enemy', hp: 20, col: 3, row: 0 };
    assert.equal(BattleRules.CanAttack(grid, ranger, target), true);
    assert.equal(BattleRules.CanAttack(grid, vanguard, target), false);
    assert.equal(BattleRules.CanAttack(grid, { ...ranger, basicAbility: 'spark', ap: 3 }, target), true);
    assert.equal(BattleRules.CanAttack(grid, { ...ranger, basicAbility: 'spark', ap: 2 }, target), false);
});

test('Cleric has a distinct attack and learns support skills through progression', () => {
    const campaign = new HighlandCampaign();
    assert.equal(campaign.CreateCharacter('cleric'), true);
    assert.equal(campaign.hero.basicAbility, 'radiant-bolt');
    assert.equal(campaign.LearnSkill('heal'), false);
    campaign.AwardExperience(160);
    assert.equal(campaign.LearnSkill('devotion'), false);
    assert.equal(campaign.LearnSkill('heal'), true);
    assert.equal(campaign.LearnSkill('devotion'), true);
    assert.equal(campaign.hero.apMax, 7);
    assert.equal(campaign.hero.mpMax, 3);
});

test('advanced class abilities require their preceding nodes and a skill point', () => {
    for (const [archetype, first, passive, advanced] of [
        ['vanguard', 'shield-bash', 'iron-vow', 'sweeping-strike'],
        ['ranger', 'piercing-arrow', 'keen-eye', 'pinning-shot'],
        ['arcanist', 'fireball', 'deep-focus', 'arcane-burst'],
        ['cleric', 'heal', 'devotion', 'healing-light'],
    ]) {
        const campaign = new HighlandCampaign();
        campaign.CreateCharacter(archetype);
        campaign.AwardExperience(300);
        assert.equal(campaign.LearnSkill(advanced), false);
        assert.equal(campaign.LearnSkill(first), true);
        assert.equal(campaign.LearnSkill(passive), true);
        assert.equal(campaign.LearnSkill(advanced), true);
        assert.equal(campaign.skillPoints, 0);
    }
});

test('fourth class nodes require all previous unlocks', () => {
    for (const [archetype, first, passive, advanced, capstone] of [
        ['vanguard', 'shield-bash', 'iron-vow', 'sweeping-strike', 'bulwark'],
        ['ranger', 'piercing-arrow', 'keen-eye', 'pinning-shot', 'venom-shot'],
        ['arcanist', 'fireball', 'deep-focus', 'arcane-burst', 'chain-lightning'],
        ['cleric', 'heal', 'devotion', 'healing-light', 'haste'],
    ]) {
        const campaign = new HighlandCampaign();
        campaign.CreateCharacter(archetype);
        campaign.AwardExperience(480);
        assert.equal(campaign.LearnSkill(capstone), false);
        for (const id of [first, passive, advanced, capstone]) assert.equal(campaign.LearnSkill(id), true);
    }
});

test('save round-trip restores progression, world state and equipment without trusting derived stats', () => {
    const campaign = new HighlandCampaign();
    campaign.CreateCharacter('arcanist');
    campaign.hero.name = 'Mira';
    campaign.AwardExperience(160);
    campaign.LearnSkill('fireball');
    campaign.LearnSkill('deep-focus');
    campaign.Buy('Runed Staff', 'weapon');
    campaign.inventory.Potion = 4;
    campaign.zoneId = 'mistfell';
    campaign.hero.col = 9;
    campaign.hero.row = 8;
    campaign.hero.hp = 20;
    campaign.clearedZones.add('mistfell');
    campaign.companionDeployed = false;
    const saved = JSON.parse(JSON.stringify(campaign.SaveData()));
    saved.hero.magic = 9999;
    const restored = HighlandCampaign.FromSave(saved);
    assert.deepEqual(restored.SaveData(), campaign.SaveData());
    assert.equal(restored.hero.magic, campaign.hero.magic);
    assert.equal(restored.hero.apMax, 7);
    assert.equal(restored.hero.mpMax, 3);
    assert.notEqual(restored.inventory, campaign.inventory);
});

test('save validation rejects corrupt and incompatible data without mutating the campaign', () => {
    const campaign = new HighlandCampaign();
    campaign.CreateCharacter('cleric');
    const original = campaign.SaveData();
    for (const change of [
        { version: 99 }, { zoneId: 'missing' }, { inventory: { Potion: -1 } },
        { equipment: { ...original.equipment, weapon: 'Oak Shield' } },
        { unlockedSkills: ['devotion'] }, { hero: { ...original.hero, col: 900 } },
        { clearedZones: ['not-an-encounter'] }, { companion: null }, { companion: { level: 1, xp: 0, hp: 999 } },
    ]) {
        assert.throws(() => HighlandCampaign.FromSave({ ...original, ...change }), /invalid|unsupported/i);
        assert.deepEqual(campaign.SaveData(), original);
    }
});

test('companion progression survives saves and older saves migrate safely', () => {
    const campaign = new HighlandCampaign();
    campaign.CreateCharacter('cleric');
    campaign.AwardExperience(160);
    campaign.SyncCompanion({ hp: 18 });
    campaign.AwardCompanionExperience(60);
    assert.deepEqual(campaign.CompanionStats(), { level: 2, hp: 24, maxHp: 50, attack: 16, defense: 5, speed: 20 });
    const save = campaign.SaveData();
    assert.deepEqual(HighlandCampaign.FromSave(save).companion, { level: 2, xp: 0, hp: 24 });
    delete save.companion;
    const migrated = HighlandCampaign.FromSave(save);
    assert.equal(migrated.companion.level, 3);
    assert.equal(migrated.companion.xp, 0);
    assert.equal(migrated.companion.hp, 56);
});

test('magic equipment changes spell power without changing physical attack', () => {
    const campaign = new HighlandCampaign();
    campaign.CreateCharacter('arcanist');
    const attack = campaign.hero.attack, magic = campaign.hero.magic;
    campaign.gold = 55;
    assert.equal(campaign.Buy('Runed Staff', 'weapon'), true);
    assert.equal(campaign.hero.attack, attack);
    assert.equal(campaign.hero.magic, magic + 5);
    campaign.AwardExperience(60);
    assert.equal(campaign.hero.magic, magic + 7);
});

test('shops enforce affordability and equipment changes combat stats', () => {
    const campaign = new HighlandCampaign();
    campaign.CreateCharacter('arcanist');
    assert.equal(campaign.Buy('Highland Edge', 'weapon'), true);
    assert.equal(campaign.hero.attack, campaign.hero.baseAttack + 4);
    assert.equal(campaign.Buy('Iron Kilt', 'armor'), false);
    assert.equal(campaign.SellEquipment('weapon'), true);
    assert.equal(campaign.gold, 27);
    assert.equal(campaign.hero.attack, campaign.hero.baseAttack);
});

test('armor purchases and sales apply defense bonuses and restore default gear', () => {
    const campaign = new HighlandCampaign();
    campaign.CreateCharacter('ranger');
    assert.equal(campaign.Buy('Ranger Leathers', 'armor'), true);
    assert.equal(campaign.hero.defense, 6);
    assert.equal(campaign.SellEquipment('armor'), true);
    assert.equal(campaign.equipment.armor, 'Wool Coat');
    assert.equal(campaign.hero.defense, 3);
    assert.equal(campaign.gold, 30);
});

test('selling owned gear consumes one bag item without changing equipped stats', () => {
    const campaign = new HighlandCampaign();
    campaign.CreateCharacter('vanguard');
    campaign.inventory['Highland Edge'] = 2;
    assert.equal(campaign.SellOwned('Highland Edge'), true);
    assert.equal(campaign.inventory['Highland Edge'], 1);
    assert.equal(campaign.gold, 72);
    assert.equal(campaign.equipment.weapon, 'Training Blade');
    assert.equal(campaign.SellOwned('Wool Coat'), false);
    assert.equal(campaign.SellOwned('Unknown'), false);
});

test('owned gear can be equipped from inventory and displaced equipment is retained', () => {
    const campaign = new HighlandCampaign();
    campaign.CreateCharacter('vanguard');
    assert.equal(campaign.Buy('Highland Edge', 'weapon'), true);
    assert.equal(campaign.equipment.weapon, 'Highland Edge');
    assert.equal(campaign.inventory['Training Blade'], 1);
    assert.equal(campaign.EquipOwned('Training Blade', 'weapon'), true);
    assert.equal(campaign.equipment.weapon, 'Training Blade');
    assert.equal(campaign.inventory['Highland Edge'], 1);
    assert.equal(campaign.BagItems().find(item => item.name === 'Training Blade').equipped, true);
});

test('all eleven gear slots apply and remove their bonuses without duplicating empty slots', () => {
    const campaign = new HighlandCampaign();
    campaign.CreateCharacter('vanguard');
    campaign.gold = 900;
    const gear = [
        ['Scout Helm', 'helm', 'helm'], ['Travel Belt', 'belt', 'belt'], ['Leather Gloves', 'gloves', 'gloves'],
        ['Trail Boots', 'boots', 'boots'], ['Oak Shield', 'offhand', 'offhand'], ['Focus Ring', 'ring', 'ring1'],
        ['Iron Band', 'ring', 'ring2'], ['Amber Amulet', 'amulet', 'amulet'], ['Wool Cloak', 'cloak', 'cloak'],
    ];
    assert.deepEqual(EquipmentSlots.map(slot => slot.id),
        ['helm', 'amulet', 'cloak', 'armor', 'belt', 'gloves', 'boots', 'weapon', 'offhand', 'ring1', 'ring2']);
    for (const [name, kind, slot] of gear) {
        assert.equal(EquipmentSlot(name), kind);
        assert.equal(campaign.Buy(name, slot), true);
        assert.equal(campaign.equipment[slot], name);
    }
    assert.equal(campaign.hero.attack, 15);
    assert.equal(campaign.hero.defense, 10);
    assert.equal(campaign.hero.magic, campaign.hero.baseMagic + 2);
    assert.equal(campaign.hero.speed, 24);
    assert.equal(campaign.hero.maxHp, 54);
    assert.equal(campaign.hero.apMax, 7);
    assert.equal(campaign.hero.mpMax, 3);
    assert.equal(campaign.inventory.null, undefined);
    assert.equal(SlotAccepts('ring2', 'Focus Ring'), true);
    assert.equal(SlotAccepts('amulet', 'Focus Ring'), false);
    assert.equal(campaign.SellEquipment('boots'), true);
    assert.equal(campaign.equipment.boots, null);
    assert.equal(campaign.hero.speed, 22);
    assert.equal(campaign.Buy('Oak Shield', 'helm'), false);
});

test('swapping owned equipment preserves the displaced item and recalculates stats', () => {
    const campaign = new HighlandCampaign();
    campaign.CreateCharacter('ranger');
    campaign.inventory['Scout Helm'] = 1;
    assert.equal(campaign.EquipOwned('Scout Helm', 'helm'), true);
    assert.equal(campaign.hero.defense, 4);
    assert.equal(campaign.EquipOwned('Scout Helm', 'helm'), false);
    assert.equal(campaign.BagItems().filter(item => item.name === 'Scout Helm').length, 1);
    assert.equal(campaign.BagItems().some(item => item.name == null), false);
});

test('potion use consumes inventory and restores health only when useful', () => {
    const campaign = new HighlandCampaign();
    campaign.CreateCharacter('vanguard');
    assert.equal(campaign.UsePotion(), false);
    campaign.hero.hp = 20;
    assert.equal(campaign.UsePotion(), true);
    assert.equal(campaign.hero.hp, 44);
    assert.equal(campaign.inventory.Potion, 1);
    assert.equal(campaign.SellPotion(), true);
    assert.equal(campaign.gold, 55);
    assert.equal(campaign.inventory.Potion, 0);
});

test('battle damage respects equipment defense', () => {
    const grid = { Get: () => ({ h: 0 }) };
    const attacker = { col: 0, row: 0, attack: 15 };
    const defender = { col: 1, row: 0, facing: 1, defense: 5 };
    const armored = BattleRules.Preview(grid, attacker, defender).damage;
    const unarmored = BattleRules.Preview(grid, attacker, { ...defender, defense: 1 }).damage;
    assert.ok(armored < unarmored);
});

test('hound bite has a distinct back-attack bonus', () => {
    const grid = { Get: () => ({ h: 0 }) };
    const hound = { col: 0, row: 0, attack: 12 };
    const target = { col: 1, row: 0, facing: 1, defense: 2 };
    assert.ok(BattleRules.Preview(grid, hound, target, 'hound-bite').damage
        > BattleRules.Preview(grid, hound, target, 'strike').damage);
});

test('connected zones define valid reciprocal routes and unique height maps', () => {
    const zones = WorldZones();
    assert.equal(zones.length, 3);
    assert.equal(GetZone('hearthvale').portal.to, 'mistfell');
    assert.equal(GetZone('mistfell').returnPortal.to, 'hearthvale');
    assert.notDeepEqual(GetZone('mistfell').heights, GetZone('ashen-ridge').heights);
    assert.ok(zones.every(zone => zone.cols === 21 && zone.rows === 17));
});

test('every portal and encounter remains reachable with exploration climb limits', () => {
    for (const { id } of WorldZones()) {
        const zone = GetZone(id);
        const reachable = new Set([`${zone.spawn.col},${zone.spawn.row}`]);
        const queue = [[zone.spawn.col, zone.spawn.row]];
        for (let index = 0; index < queue.length; index++) {
            const [col, row] = queue[index];
            for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
                const nextCol = col + dx, nextRow = row + dy;
                const height = zone.heights[nextRow]?.[nextCol], current = zone.heights[row][col];
                const key = `${nextCol},${nextRow}`;
                if (height === undefined || reachable.has(key) || height - current > 1 || current - height > 2) continue;
                reachable.add(key);
                queue.push([nextCol, nextRow]);
            }
        }
        for (const point of [zone.portal, zone.returnPortal, ...zone.encounters, zone.shop].filter(Boolean))
            assert.ok(reachable.has(`${point.col},${point.row}`), `${zone.id} cannot reach ${point.label ?? point.id ?? 'map point'}`);
    }
});

test('map transitions sit on outer corner tiles', () => {
    for (const { id } of WorldZones()) {
        const zone = GetZone(id);
        const lastCol = zone.heights[0].length - 1, lastRow = zone.heights.length - 1;
        for (const point of [zone.portal, zone.returnPortal].filter(Boolean))
            assert.ok(
                (point.col === 0 || point.col === lastCol) && (point.row === 0 || point.row === lastRow),
                `${zone.id} transition ${point.label} should be on a map corner`,
            );
    }
});

test('expanded zones have reachable specialist vendors and connected world map state', () => {
    const hearthvale = GetZone('hearthvale');
    assert.deepEqual(hearthvale.vendors.map(vendor => vendor.specialty), ['weapon', 'armor', 'consumable', 'rest']);
    const map = WorldMapDisplay('mistfell', new Set(['mistfell']));
    assert.equal(map.zones.find(zone => zone.id === 'mistfell').current, true);
    assert.equal(map.zones.find(zone => zone.id === 'mistfell').cleared, true);
    assert.equal(map.routes.find(route => route.to === 'ashen-ridge').open, true);
    assert.equal(map.routes.length, 2);
});

test('AP and MP gear raise the turn budget and unequipping returns items to the backpack', () => {
    const campaign = new HighlandCampaign();
    campaign.CreateCharacter('ranger');
    campaign.inventory['Tactician Signet'] = 1;
    campaign.inventory['Wayfarer Charm'] = 1;
    assert.equal(campaign.EquipOwned('Tactician Signet'), true);
    assert.equal(campaign.equipment.ring1, 'Tactician Signet');
    assert.equal(campaign.EquipOwned('Wayfarer Charm'), true);
    assert.equal(campaign.hero.apMax, 7);
    assert.equal(campaign.hero.mpMax, 4);
    assert.equal(campaign.Unequip('ring1'), true);
    assert.equal(campaign.equipment.ring1, null);
    assert.equal(campaign.inventory['Tactician Signet'], 1);
    assert.equal(campaign.hero.apMax, 6);
    assert.equal(campaign.Unequip('ring1'), false);
});

test('consumables and resources trade by their own prices and loot only adds known items', () => {
    const campaign = new HighlandCampaign();
    campaign.CreateCharacter('cleric');
    campaign.gold = 40;
    assert.equal(campaign.BuyConsumable('Ether'), true);
    assert.equal(campaign.BuyConsumable('Antidote'), true);
    assert.equal(campaign.BuyConsumable('Ash Shard'), false);
    assert.equal(campaign.gold, 3);
    assert.deepEqual(campaign.AddLoot([{ item: 'Ash Shard', count: 2 }, { item: 'Unknown', count: 1 }, { item: 'Mist Herb', count: 0 }]),
        [{ item: 'Ash Shard', count: 2 }]);
    assert.equal(campaign.SellItem('Ash Shard'), true);
    assert.equal(campaign.inventory['Ash Shard'], 1);
    assert.equal(campaign.gold, 9);
    assert.equal(campaign.SellItem('Highland Edge'), false);
});

test('version 1 saves migrate the accessory slot to the first ring slot', () => {
    const campaign = new HighlandCampaign();
    campaign.CreateCharacter('vanguard');
    const save = campaign.SaveData();
    assert.equal(save.version, 2);
    const { amulet, cloak, ring1, ring2, ...legacy } = save.equipment;
    const v1 = { ...save, version: 1, equipment: { ...legacy, accessory: 'Focus Ring' } };
    const migrated = HighlandCampaign.FromSave(v1);
    assert.equal(migrated.equipment.ring1, 'Focus Ring');
    assert.equal(migrated.equipment.ring2, null);
    assert.equal(migrated.equipment.amulet, null);
    assert.equal(Object.hasOwn(migrated.equipment, 'accessory'), false);
    assert.equal(migrated.hero.apMax, 7);
    assert.throws(() => HighlandCampaign.FromSave({ ...v1, equipment: { ...legacy, accessory: 'Oak Shield' } }), /invalid/i);
});
