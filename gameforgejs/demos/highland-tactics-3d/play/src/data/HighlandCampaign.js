import { BasicAbilities, GetSkill } from './ClassSkills.js';

export const Archetypes = Object.freeze({
    vanguard: { name: 'Vanguard', color: '#77c9cf', hp: 48, attack: 14, defense: 5, speed: 22 },
    ranger: { name: 'Ranger', color: '#82b77c', hp: 40, attack: 13, defense: 3, speed: 27 },
    arcanist: { name: 'Arcanist', color: '#a993d4', hp: 36, attack: 16, defense: 2, speed: 24 },
    cleric: { name: 'Cleric', color: '#e5c987', hp: 42, attack: 11, defense: 4, speed: 23 },
});

export const Equipment = Object.freeze({
    weapons: {
        'Training Blade': { attack: 0, price: 0 },
        'Highland Edge': { attack: 4, price: 45 },
        'Runed Staff': { attack: 5, price: 55 },
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
        'Focus Ring': { slot: 'accessory', energy: 1, price: 30 },
    },
});

export const EquipmentSlots = Object.freeze([
    { id: 'helm', label: 'HELM' }, { id: 'armor', label: 'ARMOR' },
    { id: 'belt', label: 'BELT' }, { id: 'gloves', label: 'GLOVES' },
    { id: 'boots', label: 'BOOTS' }, { id: 'weapon', label: 'WEAPON' },
    { id: 'offhand', label: 'SHIELD' }, { id: 'accessory', label: 'RING' },
]);

export function EquipmentSlot(item) {
    if (Equipment.weapons[item]) return 'weapon';
    const armor = Equipment.armor[item];
    return armor ? armor.slot ?? 'armor' : null;
}

export function EquipmentStats(item) {
    return Equipment.weapons[item] ?? Equipment.armor[item] ?? null;
}

export const ItemInfo = Object.freeze({
    Potion: { category: 'Consumables', rarity: 'common', description: 'Restores 24 HP. Use only when wounded.', icon: 'potion' },
    'Training Blade': { category: 'Weapons', rarity: 'common', description: 'A balanced starter blade.', icon: 'blade' },
    'Highland Edge': { category: 'Weapons', rarity: 'rare', description: 'A keen highland steel blade.', icon: 'blade' },
    'Runed Staff': { category: 'Weapons', rarity: 'rare', description: 'A staff etched to steady arcane energy.', icon: 'staff' },
    'Wool Coat': { category: 'Armor', rarity: 'common', description: 'Warm travel clothes with light protection.', icon: 'armor' },
    'Ranger Leathers': { category: 'Armor', rarity: 'uncommon', description: 'Supple leather armor for a swift scout.', icon: 'armor' },
    'Iron Kilt': { category: 'Armor', rarity: 'rare', description: 'Heavy plates stitched for the front line.', icon: 'armor' },
    'Scout Helm': { category: 'Armor', rarity: 'common', description: 'A practical iron cap.', icon: 'armor' },
    'Travel Belt': { category: 'Armor', rarity: 'common', description: 'Sturdy gear for long journeys.', icon: 'armor' },
    'Leather Gloves': { category: 'Armor', rarity: 'common', description: 'A steady grip for any weapon.', icon: 'armor' },
    'Trail Boots': { category: 'Armor', rarity: 'uncommon', description: 'Light boots for a quicker stride.', icon: 'armor' },
    'Oak Shield': { category: 'Armor', rarity: 'uncommon', description: 'A reliable shield of oak and iron.', icon: 'armor' },
    'Focus Ring': { category: 'Armor', rarity: 'uncommon', description: 'A ring that steadies tactical focus.', icon: 'armor' },
});

export class HighlandCampaign {
    constructor() {
        this.hero = null;
        this.gold = 50;
        this.inventory = { Potion: 2 };
        this.equipment = { weapon: 'Training Blade', armor: 'Wool Coat', helm: null, belt: null, gloves: null, boots: null, offhand: null, accessory: null };
        this.skillPoints = 0;
        this.unlockedSkills = [];
        this.clearedZones = new Set();
        this.zoneId = 'hearthvale';
        this.companionDeployed = true;
    }

    CreateCharacter(archetype) {
        const base = Archetypes[archetype];
        if (!base) return false;
        this.skillPoints = 0;
        this.unlockedSkills = [];
        this.hero = {
            id: 'hero',
            name: 'Highland Recruit',
            className: base.name,
            archetype,
            color: base.color,
            baseHp: base.hp,
            baseAttack: base.attack,
            baseDefense: base.defense,
            baseSpeed: base.speed,
            hp: base.hp,
            maxHp: base.hp,
            attack: base.attack,
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
        const passiveAttack = this.unlockedSkills.reduce((sum, id) => sum + (GetSkill(this.hero.archetype, id)?.attack ?? 0), 0);
        const passiveDefense = this.unlockedSkills.reduce((sum, id) => sum + (GetSkill(this.hero.archetype, id)?.defense ?? 0), 0);
        const passiveEnergy = this.unlockedSkills.reduce((sum, id) => sum + (GetSkill(this.hero.archetype, id)?.energy ?? 0), 0);
        this.hero.attack = this.hero.baseAttack + (this.hero.level - 1) * 2 + total('attack') + passiveAttack;
        this.hero.defense = this.hero.baseDefense + (this.hero.level - 1) + total('defense') + passiveDefense;
        this.hero.speed = this.hero.baseSpeed + total('speed');
        this.hero.energyMax = 2 + total('energy') + passiveEnergy;
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

    Buy(item, slot) {
        const offer = EquipmentStats(item);
        if (EquipmentSlot(item) !== slot) return false;
        if (!this.hero || !offer || this.gold < offer.price) return false;
        if (this.equipment[slot] === item) return false;
        this.gold -= offer.price;
        const previous = this.equipment[slot];
        if (previous) this.inventory[previous] = (this.inventory[previous] ?? 0) + 1;
        this.equipment[slot] = item;
        this.ApplyEquipment();
        return true;
    }

    EquipOwned(item, slot) {
        if (!this.hero || !EquipmentStats(item) || EquipmentSlot(item) !== slot || !(this.inventory[item] > 0) || this.equipment[slot] === item)
            return false;
        const previous = this.equipment[slot];
        this.inventory[item]--;
        if (previous) this.inventory[previous] = (this.inventory[previous] ?? 0) + 1;
        this.equipment[slot] = item;
        this.ApplyEquipment();
        return true;
    }

    BuyPotion() {
        if (this.gold < 15) return false;
        this.gold -= 15;
        this.inventory.Potion = (this.inventory.Potion ?? 0) + 1;
        return true;
    }

    SellPotion() {
        if (!(this.inventory.Potion > 0)) return false;
        this.inventory.Potion--;
        this.gold += 5;
        return true;
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
        this.hero.hp = Math.min(this.hero.maxHp, this.hero.hp + 24);
        return true;
    }
}
