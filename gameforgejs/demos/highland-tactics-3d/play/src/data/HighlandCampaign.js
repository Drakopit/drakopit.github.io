import { BasicAbilities, GetSkill } from './ClassSkills.js';
import { TurnBudget } from './BattleRules.js';
import { WorldZones } from './WorldMaps.js';

/** Calling base stats; `model` names the class's character in config/resources.json. */
export const Archetypes = Object.freeze({
    vanguard: { name: 'Vanguard', color: '#77c9cf', hp: 48, attack: 14, magic: 6, defense: 5, speed: 22, model: 'hero-knight' },
    ranger: { name: 'Ranger', color: '#82b77c', hp: 40, attack: 13, magic: 8, defense: 3, speed: 27, model: 'hero-ranger' },
    arcanist: { name: 'Arcanist', color: '#a993d4', hp: 36, attack: 9, magic: 16, defense: 2, speed: 24, model: 'hero-mage' },
    cleric: { name: 'Cleric', color: '#e5c987', hp: 42, attack: 9, magic: 13, defense: 4, speed: 23, model: 'hero-rogue-hooded' },
});

export const CompanionBase = Object.freeze({ hp: 44, attack: 14, defense: 4, speed: 20 });

/** Gear: `slot` is the kind of slot an item fits (rings fit either ring slot). */
export const Equipment = Object.freeze({
    weapons: {
        'Training Blade': { attack: 0, price: 0 },
        'Highland Edge': { attack: 4, price: 45 },
        'Runed Staff': { magic: 5, price: 55 },
    },
    armor: {
        'Wool Coat': { defense: 0, price: 0 },
        'Ranger Leathers': { defense: 3, price: 40 },
        'Iron Kilt': { defense: 5, price: 55 },
        'Scout Helm': { slot: 'helm', defense: 1, price: 20 },
        'Travel Belt': { slot: 'belt', hp: 6, price: 20 },
        'Leather Gloves': { slot: 'gloves', attack: 1, price: 20 },
        'Trail Boots': { slot: 'boots', speed: 2, price: 25 },
        'Oak Shield': { slot: 'offhand', defense: 2, price: 30 },
        'Focus Ring': { slot: 'ring', ap: 1, price: 30 },
        'Iron Band': { slot: 'ring', defense: 1, price: 18 },
        'Tactician Signet': { slot: 'ring', ap: 1, speed: 2, price: 90 },
        'Amber Amulet': { slot: 'amulet', magic: 2, price: 28 },
        'Wayfarer Charm': { slot: 'amulet', mp: 1, price: 75 },
        'Wool Cloak': { slot: 'cloak', defense: 1, price: 18 },
        'Shadow Cape': { slot: 'cloak', speed: 3, price: 45 },
    },
});

/** The paper doll, in display order. `accepts` is the item slot kind each one takes. */
export const EquipmentSlots = Object.freeze([
    { id: 'helm', label: 'HELM', accepts: 'helm' },
    { id: 'amulet', label: 'AMULET', accepts: 'amulet' },
    { id: 'cloak', label: 'CLOAK', accepts: 'cloak' },
    { id: 'armor', label: 'CHEST', accepts: 'armor' },
    { id: 'belt', label: 'BELT', accepts: 'belt' },
    { id: 'gloves', label: 'GLOVES', accepts: 'gloves' },
    { id: 'boots', label: 'BOOTS', accepts: 'boots' },
    { id: 'weapon', label: 'MAIN HAND', accepts: 'weapon' },
    { id: 'offhand', label: 'OFF-HAND', accepts: 'offhand' },
    { id: 'ring1', label: 'RING', accepts: 'ring' },
    { id: 'ring2', label: 'RING', accepts: 'ring' },
]);

/** The slot kind an item fits (`ring` for rings), or null for non-equipment. */
export function EquipmentSlot(item) {
    if (Equipment.weapons[item]) return 'weapon';
    const armor = Equipment.armor[item];
    return armor ? armor.slot ?? 'armor' : null;
}

export function EquipmentStats(item) {
    return Equipment.weapons[item] ?? Equipment.armor[item] ?? null;
}

/** Whether the paper-doll slot `slotId` can hold `item`. */
export function SlotAccepts(slotId, item) {
    const kind = EquipmentSlot(item);
    return Boolean(kind && EquipmentSlots.find(slot => slot.id === slotId)?.accepts === kind);
}

/** The slot an item goes to when equipped without choosing one: the first empty fitting slot. */
export function SlotFor(item, equipment) {
    const slots = EquipmentSlots.filter(slot => SlotAccepts(slot.id, item));
    return (slots.find(slot => !equipment[slot.id]) ?? slots[0])?.id ?? null;
}

/**
 * Item catalogue. Consumables carry `use` (battle AP cost and effect) and `price`/`sell`;
 * resources only sell. Gear prices live in `Equipment`.
 */
export const ItemInfo = Object.freeze({
    Potion: { category: 'Consumables', rarity: 'common', description: 'Restores 24 HP. Use only when wounded.', icon: 'potion', price: 15, sell: 5, use: { ap: 2, heal: 24 } },
    Ether: { category: 'Consumables', rarity: 'uncommon', description: 'Restores 2 AP in battle, once per turn.', icon: 'ether', price: 25, sell: 8, use: { ap: 0, restoreAp: 2, perTurn: 1 } },
    Antidote: { category: 'Consumables', rarity: 'common', description: 'Cures poison, burn and slow in battle.', icon: 'antidote', price: 12, sell: 4, use: { ap: 1, cleanse: true } },
    'Ash Shard': { category: 'Resources', rarity: 'uncommon', description: 'A warm shard from the Ashen Ridge. Alchemists buy it.', icon: 'shard', sell: 6 },
    'Hound Pelt': { category: 'Resources', rarity: 'common', description: 'A rough pelt from a shadow hound.', icon: 'pelt', sell: 4 },
    'Mist Herb': { category: 'Resources', rarity: 'common', description: 'A pale herb that grows in the Mistfell fog.', icon: 'herb', sell: 3 },
    'Training Blade': { category: 'Weapons', rarity: 'common', description: 'A balanced starter blade.', icon: 'blade' },
    'Highland Edge': { category: 'Weapons', rarity: 'rare', description: 'A keen highland steel blade.', icon: 'blade' },
    'Runed Staff': { category: 'Weapons', rarity: 'rare', description: 'A staff etched to steady arcane energy.', icon: 'staff' },
    'Wool Coat': { category: 'Armor', rarity: 'common', description: 'Warm travel clothes with light protection.', icon: 'armor' },
    'Ranger Leathers': { category: 'Armor', rarity: 'uncommon', description: 'Supple leather armor for a swift scout.', icon: 'armor' },
    'Iron Kilt': { category: 'Armor', rarity: 'rare', description: 'Heavy plates stitched for the front line.', icon: 'armor' },
    'Scout Helm': { category: 'Armor', rarity: 'common', description: 'A practical iron cap.', icon: 'helm' },
    'Travel Belt': { category: 'Armor', rarity: 'common', description: 'Sturdy gear for long journeys.', icon: 'belt' },
    'Leather Gloves': { category: 'Armor', rarity: 'common', description: 'A steady grip for any weapon.', icon: 'gloves' },
    'Trail Boots': { category: 'Armor', rarity: 'uncommon', description: 'Light boots for a quicker stride.', icon: 'boots' },
    'Oak Shield': { category: 'Armor', rarity: 'uncommon', description: 'A reliable shield of oak and iron.', icon: 'shield' },
    'Focus Ring': { category: 'Accessories', rarity: 'uncommon', description: 'A ring that sharpens tactical focus.', icon: 'ring' },
    'Iron Band': { category: 'Accessories', rarity: 'common', description: 'A plain iron ring worn by the watch.', icon: 'ring' },
    'Tactician Signet': { category: 'Accessories', rarity: 'epic', description: 'The seal of a highland tactician.', icon: 'ring' },
    'Amber Amulet': { category: 'Accessories', rarity: 'uncommon', description: 'Amber that hums with stored magic.', icon: 'amulet' },
    'Wayfarer Charm': { category: 'Accessories', rarity: 'rare', description: 'A charm that quickens every stride.', icon: 'amulet' },
    'Wool Cloak': { category: 'Armor', rarity: 'common', description: 'A warm cloak against the highland wind.', icon: 'cloak' },
    'Shadow Cape': { category: 'Armor', rarity: 'rare', description: 'A dark cape that moves like smoke.', icon: 'cloak' },
});

/** Backpack filters: each lists the item categories it shows. */
export const BagFilters = Object.freeze({
    All: null,
    Gear: ['Weapons', 'Armor', 'Accessories'],
    Consumables: ['Consumables'],
    Resources: ['Resources'],
});

const EmptyEquipment = () => Object.fromEntries(EquipmentSlots.map(slot => [slot.id, null]));

export class HighlandCampaign {
    constructor() {
        this.hero = null;
        this.gold = 50;
        this.inventory = { Potion: 2 };
        this.equipment = { ...EmptyEquipment(), weapon: 'Training Blade', armor: 'Wool Coat' };
        this.skillPoints = 0;
        this.unlockedSkills = [];
        this.clearedZones = new Set();
        this.zoneId = 'hearthvale';
        this.companionDeployed = true;
        this.companion = { level: 1, xp: 0, hp: CompanionBase.hp };
    }

    SaveData() {
        if (!this.hero) throw new Error('Create a character before saving.');
        return {
            version: 2,
            hero: { archetype: this.hero.archetype, name: this.hero.name, level: this.hero.level,
                xp: this.hero.xp, hp: this.hero.hp, col: this.hero.col, row: this.hero.row, facing: this.hero.facing },
            gold: this.gold, inventory: { ...this.inventory }, equipment: { ...this.equipment },
            skillPoints: this.skillPoints, unlockedSkills: [...this.unlockedSkills],
            clearedZones: [...this.clearedZones], zoneId: this.zoneId, companionDeployed: this.companionDeployed,
            companion: { ...this.companion },
        };
    }

    /** Version 1 saves had eight slots with one `accessory` ring; it becomes the first ring slot. */
    static MigrateSave(data) {
        if (data?.version !== 1 || !data.equipment || typeof data.equipment !== 'object' || Array.isArray(data.equipment)) return data;
        const { accessory = null, ...rest } = data.equipment;
        return { ...data, version: 2, equipment: { ...rest, amulet: null, cloak: null, ring1: accessory, ring2: null } };
    }

    static FromSave(saved) {
        const data = HighlandCampaign.MigrateSave(saved);
        const validNumber = value => Number.isSafeInteger(value) && value >= 0;
        const invalid = () => { throw new Error('Save data is invalid or from an unsupported version.'); };
        if (!data || data.version !== 2 || !data.hero || !Object.hasOwn(Archetypes, data.hero.archetype)) invalid();
        const hero = data.hero, zones = WorldZones(), zone = zones.find(item => item.id === data.zoneId);
        const encounters = new Set(zones.flatMap(item => item.encounters.map(encounter => encounter.id)));
        if (!zone || typeof hero.name !== 'string' || !hero.name.trim() || hero.name.length > 20
            || !validNumber(hero.level) || hero.level < 1 || hero.level > 10000
            || !validNumber(hero.xp) || hero.xp >= 60 + (hero.level - 1) * 40
            || !validNumber(hero.hp) || hero.hp < 1 || !validNumber(hero.col) || hero.col >= zone.cols
            || !validNumber(hero.row) || hero.row >= zone.rows || !validNumber(hero.facing) || hero.facing > 3
            || !validNumber(data.gold) || !validNumber(data.skillPoints) || typeof data.companionDeployed !== 'boolean'
            || !Array.isArray(data.unlockedSkills) || !Array.isArray(data.clearedZones)
            || !data.inventory || typeof data.inventory !== 'object' || Array.isArray(data.inventory)
            || !data.equipment || typeof data.equipment !== 'object' || Array.isArray(data.equipment)) invalid();
        if (Object.entries(data.inventory).some(([item, count]) => !Object.hasOwn(ItemInfo, item) || !validNumber(count))
            || Object.keys(data.equipment).length !== EquipmentSlots.length
            || EquipmentSlots.some(({ id }) => !Object.hasOwn(data.equipment, id)
                || (data.equipment[id] !== null && (!Object.hasOwn(ItemInfo, data.equipment[id]) || !SlotAccepts(id, data.equipment[id]))))
            || data.clearedZones.some(id => !encounters.has(id))
            || new Set(data.clearedZones).size !== data.clearedZones.length) invalid();
        const learned = new Set();
        for (const id of data.unlockedSkills) {
            const skill = GetSkill(hero.archetype, id);
            if (!skill || learned.has(id) || !skill.requires.every(required => learned.has(required))) invalid();
            learned.add(id);
        }
        if (data.skillPoints + learned.size !== hero.level - 1) invalid();
        const companion = Object.hasOwn(data, 'companion') ? data.companion
            : { level: hero.level, xp: hero.xp, hp: CompanionBase.hp + (hero.level - 1) * 6 };
        if (!companion || !validNumber(companion.level) || companion.level < 1 || companion.level > 10000
            || !validNumber(companion.xp) || companion.xp >= 60 + (companion.level - 1) * 40
            || !validNumber(companion.hp) || companion.hp < 1
            || companion.hp > CompanionBase.hp + (companion.level - 1) * 6) invalid();
        const campaign = new HighlandCampaign();
        campaign.CreateCharacter(hero.archetype);
        campaign.inventory = { ...data.inventory };
        campaign.equipment = { ...data.equipment };
        campaign.gold = data.gold;
        campaign.skillPoints = data.skillPoints;
        campaign.unlockedSkills = [...learned];
        campaign.clearedZones = new Set(data.clearedZones);
        campaign.zoneId = zone.id;
        campaign.companionDeployed = data.companionDeployed;
        campaign.companion = { level: companion.level, xp: companion.xp, hp: companion.hp };
        Object.assign(campaign.hero, { name: hero.name, level: hero.level, xp: hero.xp,
            nextXp: 60 + (hero.level - 1) * 40, col: hero.col, row: hero.row, facing: hero.facing,
            skillPoints: campaign.skillPoints, unlockedSkills: [...learned] });
        campaign.ApplyEquipment();
        if (hero.hp > campaign.hero.maxHp) invalid();
        campaign.hero.hp = hero.hp;
        return campaign;
    }

    CreateCharacter(archetype) {
        const base = Archetypes[archetype];
        if (!base) return false;
        this.skillPoints = 0;
        this.unlockedSkills = [];
        this.companion = { level: 1, xp: 0, hp: CompanionBase.hp };
        this.hero = {
            id: 'hero',
            name: 'Highland Recruit',
            className: base.name,
            archetype,
            color: base.color,
            model: base.model,
            baseHp: base.hp,
            baseAttack: base.attack,
            baseMagic: base.magic,
            baseDefense: base.defense,
            baseSpeed: base.speed,
            hp: base.hp,
            maxHp: base.hp,
            attack: base.attack,
            magic: base.magic,
            defense: base.defense,
            speed: base.speed,
            basicAbility: BasicAbilities[archetype],
            level: 1,
            xp: 0,
            nextXp: 60,
            skillPoints: this.skillPoints,
            unlockedSkills: [...this.unlockedSkills],
            col: 1,
            row: 4,
            facing: 1,
            team: 'ally',
        };
        this.ApplyEquipment();
        return true;
    }

    ApplyEquipment() {
        if (!this.hero) return;
        const gear = Object.values(this.equipment).map(EquipmentStats).filter(Boolean);
        const total = stat => gear.reduce((sum, item) => sum + (item[stat] ?? 0), 0);
        const passive = stat => this.unlockedSkills.reduce((sum, id) => sum + (GetSkill(this.hero.archetype, id)?.[stat] ?? 0), 0);
        this.hero.attack = this.hero.baseAttack + (this.hero.level - 1) * 2 + total('attack') + passive('attack');
        this.hero.magic = this.hero.baseMagic + (this.hero.level - 1) * 2 + total('magic');
        this.hero.defense = this.hero.baseDefense + (this.hero.level - 1) + total('defense') + passive('defense');
        this.hero.speed = this.hero.baseSpeed + total('speed');
        this.hero.apMax = TurnBudget.ap + total('ap') + passive('ap');
        this.hero.mpMax = TurnBudget.mp + total('mp');
        this.hero.maxHp = this.hero.baseHp + (this.hero.level - 1) * 6 + total('hp');
        this.hero.hp = Math.min(this.hero.hp, this.hero.maxHp);
    }

    SyncHero(stats) {
        if (!this.hero || !stats) return;
        this.hero.hp = Math.max(0, Math.min(this.hero.maxHp, stats.hp));
        this.hero.col = stats.col;
        this.hero.row = stats.row;
        this.hero.facing = stats.facing;
    }

    CompanionStats() {
        const level = this.companion.level;
        return {
            level, hp: this.companion.hp, maxHp: CompanionBase.hp + (level - 1) * 6,
            attack: CompanionBase.attack + (level - 1) * 2,
            defense: CompanionBase.defense + level - 1, speed: CompanionBase.speed,
        };
    }

    SyncCompanion(stats) {
        if (stats) this.companion.hp = Math.max(0, Math.min(this.CompanionStats().maxHp, stats.hp));
    }

    AwardCompanionExperience(amount) {
        if (!Number.isSafeInteger(amount) || amount <= 0) return 0;
        this.companion.xp += amount;
        let levels = 0;
        while (this.companion.xp >= 60 + (this.companion.level - 1) * 40) {
            this.companion.xp -= 60 + (this.companion.level - 1) * 40;
            this.companion.level++;
            this.companion.hp += 6;
            levels++;
        }
        return levels;
    }

    AwardExperience(amount) {
        if (!this.hero || !Number.isFinite(amount) || amount <= 0) return 0;
        this.hero.xp += amount;
        let levels = 0;
        while (this.hero.xp >= this.hero.nextXp) {
            this.hero.xp -= this.hero.nextXp;
            this.hero.level++;
            this.skillPoints++;
            this.hero.nextXp = 60 + (this.hero.level - 1) * 40;
            this.hero.hp += 6;
            levels++;
        }
        this.ApplyEquipment();
        this.hero.skillPoints = this.skillPoints;
        this.hero.unlockedSkills = [...this.unlockedSkills];
        return levels;
    }

    /** Adds battle loot (`[{ item, count }]`) to the backpack and returns what was added. */
    AddLoot(loot = []) {
        const added = [];
        for (const { item, count = 1 } of loot) {
            if (!Object.hasOwn(ItemInfo, item) || !Number.isSafeInteger(count) || count < 1) continue;
            this.inventory[item] = (this.inventory[item] ?? 0) + count;
            added.push({ item, count });
        }
        return added;
    }

    LearnSkill(id) {
        if (!this.hero || this.unlockedSkills.includes(id) || this.skillPoints < 1) return false;
        const skill = GetSkill(this.hero.archetype, id);
        if (!skill || !skill.requires.every(required => this.unlockedSkills.includes(required))) return false;
        this.unlockedSkills.push(id);
        this.skillPoints--;
        this.ApplyEquipment();
        this.hero.skillPoints = this.skillPoints;
        this.hero.unlockedSkills = [...this.unlockedSkills];
        return true;
    }

    Buy(item, slot = SlotFor(item, this.equipment)) {
        const offer = EquipmentStats(item);
        if (!SlotAccepts(slot, item)) return false;
        if (!this.hero || !offer || this.gold < offer.price) return false;
        if (this.equipment[slot] === item) return false;
        this.gold -= offer.price;
        const previous = this.equipment[slot];
        if (previous) this.inventory[previous] = (this.inventory[previous] ?? 0) + 1;
        this.equipment[slot] = item;
        this.ApplyEquipment();
        return true;
    }

    EquipOwned(item, slot = SlotFor(item, this.equipment)) {
        if (!this.hero || !EquipmentStats(item) || !SlotAccepts(slot, item) || !(this.inventory[item] > 0) || this.equipment[slot] === item)
            return false;
        const previous = this.equipment[slot];
        this.inventory[item]--;
        if (previous) this.inventory[previous] = (this.inventory[previous] ?? 0) + 1;
        this.equipment[slot] = item;
        this.ApplyEquipment();
        return true;
    }

    /** Moves an equipped item back to the backpack, leaving its slot empty. */
    Unequip(slot) {
        const item = this.equipment[slot];
        if (!this.hero || !item) return false;
        this.equipment[slot] = null;
        this.inventory[item] = (this.inventory[item] ?? 0) + 1;
        this.ApplyEquipment();
        return true;
    }

    BuyConsumable(item) {
        const info = ItemInfo[item];
        if (info?.category !== 'Consumables' || this.gold < info.price) return false;
        this.gold -= info.price;
        this.inventory[item] = (this.inventory[item] ?? 0) + 1;
        return true;
    }

    /** Sells one consumable or resource from the backpack. */
    SellItem(item) {
        const info = ItemInfo[item];
        if (!info?.sell || !(this.inventory[item] > 0)) return false;
        this.inventory[item]--;
        this.gold += info.sell;
        return true;
    }

    BuyPotion() {
        return this.BuyConsumable('Potion');
    }

    SellPotion() {
        return this.SellItem('Potion');
    }

    SellEquipment(slot) {
        const item = this.equipment[slot];
        const offer = EquipmentStats(item);
        if (!offer || offer.price === 0) return false;
        this.gold += Math.floor(offer.price / 2);
        const fallback = slot === 'weapon' ? 'Training Blade' : slot === 'armor' ? 'Wool Coat' : null;
        this.equipment[slot] = fallback;
        if (fallback && this.inventory[fallback] > 0) this.inventory[fallback]--;
        this.ApplyEquipment();
        return true;
    }

    SellOwned(item) {
        const offer = EquipmentStats(item);
        if (!offer || offer.price <= 0 || !(this.inventory[item] > 0)) return false;
        this.inventory[item]--;
        this.gold += Math.floor(offer.price / 2);
        return true;
    }

    BagItems() {
        const items = new Map(Object.entries(this.inventory)
            .filter(([, count]) => count > 0)
            .map(([name, count]) => [name, { name, count, equipped: false }]));
        for (const [slot, name] of Object.entries(this.equipment)) {
            if (!name) continue;
            const existing = items.get(name);
            if (existing)
                Object.assign(existing, { equipped: true, slot, count: existing.count + 1 });
            else
                items.set(name, { name, count: 1, equipped: true, slot });
        }
        return [...items.values()];
    }

    UsePotion() {
        if (!this.hero || !(this.inventory.Potion > 0) || this.hero.hp >= this.hero.maxHp) return false;
        this.inventory.Potion--;
        this.hero.hp = Math.min(this.hero.maxHp, this.hero.hp + ItemInfo.Potion.use.heal);
        return true;
    }
}
