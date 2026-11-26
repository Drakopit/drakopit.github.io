import { Input, Vector3D } from 'gameforgejs/core';
import { Draw, HUDFrame, InputHelpPanel, Button, Rectangle, TextBox, Touch } from 'gameforgejs/2d';
import { Equipment, EquipmentSlots, EquipmentSlot, EquipmentStats, ItemInfo } from '../data/HighlandCampaign.js';
import { WorldMapDisplay } from '../data/WorldMaps.js';
import { BattleRules, Commands, Facings, GetAbilityProfile } from '../data/BattleRules.js';
import { ActiveSkills, SkillTrees } from '../data/ClassSkills.js';

export function InventoryGridLayout(x, y, width, slotHeight) {
    const gap = 2, inner = width - 24, slotWidth = (inner - 8) / 5;
    return Array.from({ length: 30 }, (_, index) => ({
        x: x + 12 + (index % 5) * (slotWidth + gap),
        y: y + 108 + Math.floor(index / 5) * (slotHeight + gap),
        width: slotWidth,
        height: slotHeight,
    }));
}

export function EquipmentLayout(x, y, width) {
    const left = ['helm', 'weapon', 'gloves', 'boots'];
    const right = ['armor', 'offhand', 'belt', 'accessory'];
    return [...left, ...right].map((slot, index) => ({
        slot, x: index < 4 ? x + 12 : x + width - 94,
        y: y + 42 + (index % 4) * 34, width: 82, height: 29,
    }));
}

export function RadialMenuLayout(width, height, count, progress, center, bounds = { top: 0, bottom: height }) {
    const radius = Math.max(30, Math.min(72, Math.min(width, height) * 0.16, (bounds.bottom - bounds.top) / 2 - 22));
    const marginX = Math.min(radius + 22, width / 2 - 4);
    const cx = Math.max(marginX, Math.min(width - marginX, center.x));
    const cy = Math.max(bounds.top + radius + 22, Math.min(bounds.bottom - radius - 22, center.y));
    const open = Math.max(0, Math.min(1, progress));
    const rotation = (1 - open) * 0.8;
    return {
        center: { x: cx, y: cy },
        radius: radius * open,
        items: Array.from({ length: count }, (_, index) => {
            const angle = -Math.PI / 2 + index * Math.PI * 2 / count + rotation;
            return {
                index,
                angle,
                x: cx + Math.cos(angle) * radius * open,
                y: cy + Math.sin(angle) * radius * open,
                size: 38 * open,
            };
        }),
    };
}

export function ExplorationBarLayout(width, height) {
    const columns = width < 640 ? 4 : 8, rows = 8 / columns;
    const gap = 3, totalWidth = Math.min(width - 20, 880), x = (width - totalWidth) / 2;
    const buttonWidth = (totalWidth - gap * (columns - 1)) / columns, buttonHeight = 42;
    const y = height - 10 - rows * buttonHeight - (rows - 1) * gap;
    return Array.from({ length: 8 }, (_, index) => ({
        x: x + (index % columns) * (buttonWidth + gap),
        y: y + Math.floor(index / columns) * (buttonHeight + gap),
        width: buttonWidth, height: buttonHeight,
    }));
}

export function RadialMenuHitTest(point, layout) {
    let closest = -1, distance = Infinity;
    for (const item of layout.items) {
        const next = Math.hypot(point.x - item.x, point.y - item.y);
        if (next <= item.size * 0.72 && next < distance) {
            closest = item.index;
            distance = next;
        }
    }
    return closest;
}

/** Compact status bars and optional side panels keep the 3D field visible. */
export class TacticalHUD {
    constructor(level) {
        this.level = level;
        this.screen = level.ui.Screen;
        this.frame = new HUDFrame(level.ui.Draw);
        this.help = new InputHelpPanel(new Draw(this.screen), {
            title: 'Highland Tactics / Controls',
            lines: ['Arrows / WASD move across zones and choose battle commands.', 'Click any reachable open tile to walk there; click highlighted tiles in battle.', 'I inventory · E gear · C character · K skills · M map · P party · F vendor · H help', 'In battle: V tactical ring · arrows / 1–5 select · Enter confirm'],
        });
        this.panel = null;
        this.selectedArchetype = 'vanguard';
        this.inventoryCategory = 'All';
        this.selectedBagIndex = 0;
        this.inventorySlots = [];
        this.slotRects = [];
        this.shopTab = 'buy';
        this.shopPage = 0;
        this.selectedGearSlot = 'weapon';
        this.selectedGearIndex = 0;
        this.ringOpen = false;
        this.ringProgress = 0;
        this.ringSelected = 0;
        this.ringLayout = null;
        this.headerHeight = 140;
        this.buttons = [];
        this.menuTrigger = this.Button('TACTICS [V]', () => this.ToggleRing());
        this.ringItems = ['Move', 'Attack', 'Skills', 'Item', 'Wait'].map((label, index) => ({
            label, shortcut: ['M', 'A', 'S', 'I', 'W'][index],
            button: this.Button('', () => this.ActivateRing(index)).button,
        }));
        this.barItems = [
            { label: 'Character', shortcut: 'C', panel: 'hero', icon: 'character' },
            { label: 'Skills', shortcut: 'K', panel: 'skills', icon: 'skills' },
            { label: 'Inventory', shortcut: 'I', panel: 'bag', icon: 'bag' },
            { label: 'Equipment', shortcut: 'E', panel: 'gear', icon: 'gear' },
            { label: 'Map', shortcut: 'M', panel: 'map', icon: 'map' },
            { label: 'Shop', shortcut: 'F', icon: 'shop' },
            { label: 'Party', shortcut: 'P', panel: 'party', icon: 'party' },
            { label: 'Help', shortcut: 'H', icon: 'help' },
        ].map(item => ({ ...item, button: this.Button('', () => this.ActivateBar(item)).button }));
        this.bagCategories = ['All', 'Weapons', 'Armor', 'Consumables'].map(category => ({
            ...this.Button(category.toUpperCase(), () => { this.inventoryCategory = category; this.selectedBagIndex = 0; }),
            category,
        }));
        this.bagSlots = Array.from({ length: 30 }, (_, index) =>
            this.Button('', () => { this.selectedBagIndex = index; }));
        this.gearSlots = EquipmentSlots.map(slot => ({
            ...this.Button(slot.label, () => this.SelectGearSlot(slot.id)),
            slot: slot.id,
        }));
        this.gearPrevious = this.Button('‹', () => this.CycleGear(-1));
        this.gearNext = this.Button('›', () => this.CycleGear(1));
        this.gearEquip = this.Button('EQUIP', () => {
            const item = this.GearCandidates()[this.selectedGearIndex];
            if (item) level.EquipItem(item);
            this.selectedGearIndex = 0;
        });
        this.extraStock = ['Scout Helm', 'Travel Belt', 'Leather Gloves', 'Trail Boots', 'Oak Shield', 'Focus Ring'].map(name => ({
            name, button: this.Button(`BUY ${name.toUpperCase()} · ${EquipmentStats(name).price}G`, () => level.Buy(name, EquipmentSlot(name))),
        }));
        this.sellSlots = EquipmentSlots.map(slot => ({
            slot: slot.id, button: this.Button(`SELL ${slot.label}`, () => level.SellEquipment(slot.id)),
        }));
        this.sellInventory = [...Object.keys(Equipment.weapons), ...Object.keys(Equipment.armor)].map(name => ({
            name, button: this.Button('', () => level.SellOwned(name)),
        }));
        this.shopPrevious = this.Button('‹', () => { this.shopPage = Math.max(0, this.shopPage - 1); });
        this.shopNext = this.Button('›', () => { this.shopPage++; });
        this.shopTabs = [
            this.Button('BUY', () => { this.shopTab = 'buy'; this.shopPage = 0; }),
            this.Button('SELL', () => { this.shopTab = 'sell'; this.shopPage = 0; }),
        ];
        this.tools = [
            this.Button('↶', () => level.cameraStep--),
            this.Button('↷', () => level.cameraStep++),
            this.Button('RAIN', () => level.ToggleWeather()),
            this.Button('?', () => this.help.Toggle()),
        ];
        this.commands = Commands.map((label, index) => this.Button(label, () => level.turn.Choose(index)));
        this.skillNodeButtons = Object.values(SkillTrees).flat().map(skill => ({
            ...this.Button('LEARN', () => level.LearnSkill(skill.id)),
            skill,
        }));
        this.skillChoiceButtons = Object.values(SkillTrees).flat()
            .filter(skill => skill.kind === 'active')
            .map(skill => ({
                ...this.Button(skill.name.toUpperCase(), () => level.turn.SelectSkill(skill.id)),
                skill,
            }));
        this.facings = Facings.map((direction, index) => this.Button(direction.name, () => { level.turn.active.stats.facing = index; }));
        this.wait = this.Button('CONFIRM WAIT', () => level.turn.EndTurn());
        this.battlePotion = this.Button('USE POTION', () => level.UseBattlePotion());
        this.begin = this.Button('BEGIN ADVENTURE', () => level.CreateCharacter(this.selectedArchetype, this.nameField.GetText()));
        this.classButtons = [
            this.Button('VANGUARD', () => { this.selectedArchetype = 'vanguard'; }),
            this.Button('RANGER', () => { this.selectedArchetype = 'ranger'; }),
            this.Button('ARCANIST', () => { this.selectedArchetype = 'arcanist'; }),
            this.Button('CLERIC', () => { this.selectedArchetype = 'cleric'; }),
        ];
        this.panelButtons = {
            potionUse: this.Button('USE POTION', () => level.UsePotion()),
            potionSell: this.Button('SELL POTION · 5G', () => level.SellPotion()),
            buyPotion: this.Button('BUY POTION · 15G', () => level.Buy('Potion', 'potion')),
            buyBlade: this.Button('BUY HIGHLAND EDGE · 45G', () => level.Buy('Highland Edge', 'weapon')),
            buyStaff: this.Button('BUY RUNED STAFF · 55G', () => level.Buy('Runed Staff', 'weapon')),
            buyLeathers: this.Button('BUY RANGER LEATHERS · 40G', () => level.Buy('Ranger Leathers', 'armor')),
            buyKilt: this.Button('BUY IRON KILT · 55G', () => level.Buy('Iron Kilt', 'armor')),
            sellWeapon: this.Button('SELL WEAPON', () => level.SellEquipment('weapon')),
            sellArmor: this.Button('SELL ARMOR', () => level.SellEquipment('armor')),
            equipItem: this.Button('EQUIP ITEM', () => this.SelectedBagItem() && level.EquipItem(this.SelectedBagItem().name)),
            useItem: this.Button('USE ITEM', () => this.SelectedBagItem() && level.UseItem(this.SelectedBagItem().name)),
            rest: this.Button('REST · RESTORE HP', () => level.Rest()),
            companion: this.Button('TOGGLE ORIN', () => level.ToggleCompanion()),
            return: this.Button('RETURN TO EXPLORATION', () => level.ReturnToExplore()),
            close: this.Button('×', () => { this.panel = null; }),
        };
        this.talk = this.Button('TALK TO VENDOR', () => level.InteractShopkeeper());
        this.nameField = new TextBox(this.screen, { nativeInput: true });
        this.nameField.SetPlaceholder('Character name');
        this.nameField.SetMaxLength(20);
        this.nameField.SetText('Highland Recruit');
        this.nameField.onSubmit = () => this.nameField.SetActive(false);
    }

    Button(label, run) {
        const button = new Button(this.screen, { pointerInput: true });
        button.OnClick(run);
        const item = { label, button };
        this.buttons.push(item);
        return item;
    }

    TogglePanel(panel) {
        if (panel === 'shop') return this.level.InteractShopkeeper();
        this.panel = this.panel === panel ? null : panel;
    }

    ToggleRing() {
        if (this.level.exploring !== 'battle' || this.level.turn.phase !== 'command') return;
        this.ringOpen = !this.ringOpen;
        if (this.ringOpen) this.ringSelected = this.level.turn.command ?? 0;
    }

    CloseRing() {
        this.ringOpen = false;
    }

    Update(dt) {
        const command = this.level.exploring === 'battle' && this.level.turn.phase === 'command';
        if (!command) {
            this.ringOpen = false;
            this.ringProgress = 0;
            this.ringLayout = null;
            this.ringPointer = null;
        }
        else if (!this.wasBattleCommand) {
            this.ringOpen = true;
            this.ringSelected = this.level.turn.command ?? 0;
        }
        this.wasBattleCommand = command;
        const target = this.ringOpen ? 1 : 0;
        this.ringProgress += (target - this.ringProgress) * Math.min(1, dt * 10);
        if (!this.ringOpen && this.ringProgress < 0.015) this.ringProgress = 0;
    }

    SelectRing(index) {
        this.ringSelected = (index + this.ringItems.length) % this.ringItems.length;
        this.level.turn.command = this.ringSelected;
    }

    ActivateRing(index = this.ringSelected) {
        const item = this.ringItems[index];
        if (!item) return;
        if (!this.CommandAvailable(index)) {
            this.level.turn.message = `${item.label} is unavailable this turn.`;
            return;
        }
        this.ringSelected = index;
        this.ringOpen = false;
        this.level.turn.Choose(index);
    }

    CommandAvailable(index) {
        const t = this.level.turn;
        if (this.level.exploring !== 'battle' || t.phase !== 'command' || !t.active || t.active.stats.team !== 'ally') return false;
        if (index === 0) return !t.moved;
        if (index === 1) return !t.acted && (t.active.stats.energy ?? 0) >= GetAbilityProfile(t.active.stats, t.active.stats.basicAbility).energy;
        if (index === 2) return !t.acted && ActiveSkills(t.active.stats.archetype, t.active.stats.unlockedSkills)
            .some(skill => (t.active.stats.energy ?? 0) >= GetAbilityProfile(t.active.stats, skill.id).energy);
        if (index === 3) return !t.acted && t.active === this.level.player && (this.level.campaign.inventory.Potion ?? 0) > 0 && t.active.stats.hp < t.active.stats.maxHp;
        return index === 4;
    }

    ActivateBar(item) {
        if (this.level.exploring !== 'explore' || item.unavailable) return;
        if (item.panel) this.TogglePanel(item.panel);
        else if (item.icon === 'shop') this.level.InteractShopkeeper();
        else if (item.icon === 'help') this.help.Toggle();
    }

    RingItemAt(point) {
        return this.ringLayout ? RadialMenuHitTest(point, this.ringLayout) : -1;
    }

    RingTriggerAt(point) {
        const rect = this.menuTrigger.button.rect;
        return point.x >= rect.x && point.x <= rect.x + rect.width
            && point.y >= rect.y && point.y <= rect.y + rect.height;
    }

    Place(item, x, y, width, height = 36, enabled = true, selected = false) {
        item.button.enabled = enabled;
        if (!enabled) return;
        const rect = new Rectangle(x, y, width, height);
        item.button.SetButton(rect);
        this.frame.Panel(rect);
        this.frame.Text(item.label, x + width / 2, y + height * 0.66, {
            size: width < 82 ? 10 : 11,
            align: 'center',
            weight: selected ? 700 : 400,
            color: selected ? this.frame.theme.gold : this.frame.theme.text,
            maxWidth: width - 8,
        });
    }

    DrawStatus() {
        const { level: l, screen: s, frame: f } = this, hero = l.campaign.hero;
        const hp = l.exploring === 'battle' && l.player?.stats ? l.player.stats.hp : hero.hp;
        const maxHp = l.exploring === 'battle' && l.player?.stats ? l.player.stats.maxHp : hero.maxHp;
        const compact = s.Width < 620, narrow = s.Width < 400;
        const statusWidth = narrow ? s.Width - 20 : compact ? Math.min(230, s.Width - 20) : 280;
        f.Panel({ x: 10, y: 10, width: statusWidth, height: 76 });
        const context = s.Context;
        context.save();
        context.fillStyle = 'rgba(7,14,21,.95)';
        context.strokeStyle = f.theme.gold;
        context.lineWidth = 2;
        context.beginPath();
        context.arc(44, 48, 23, 0, Math.PI * 2);
        context.fill();
        context.stroke();
        context.fillStyle = hero.color;
        context.font = '700 18px sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(hero.className[0], 44, 48);
        context.restore();
        f.Text(hero.name, 75, 29, { size: 12, weight: 700, maxWidth: statusWidth - 85 });
        f.Text(`Lv ${hero.level} · ${hero.className}`, 75, 44, { size: 10, color: f.theme.gold, maxWidth: statusWidth - 85 });
        f.Text(`HP ${hp}/${maxHp} · ${l.campaign.gold}G`, 75, 58, { size: 10, maxWidth: statusWidth - 85 });
        f.Meter(hp / maxHp, { x: 75, y: 63, width: statusWidth - 86, height: 4 }, '#72d4b0');
        f.Meter(hero.xp / hero.nextXp, { x: 75, y: 72, width: statusWidth - 86, height: 4 }, f.theme.gold);

        const mapWidth = narrow ? s.Width - 20 : compact ? Math.min(160, s.Width - statusWidth - 30) : 210;
        const mapX = narrow ? 10 : s.Width - mapWidth - 10;
        const mapY = narrow ? 92 : 10;
        f.Panel({ x: mapX, y: mapY, width: mapWidth, height: 76 });
        f.Text(l.zone.name.toUpperCase(), mapX + 12, mapY + 28, { size: 13, weight: 700, color: f.theme.gold, maxWidth: mapWidth - 24 });
        f.Text(l.zone.subtitle, mapX + 12, mapY + 50, { size: 10, maxWidth: mapWidth - 24 });

        const tabsY = narrow ? 178 : 96;
        this.headerHeight = narrow ? 260 : 142;
        if (l.exploring === 'explore') {
            const toolsX = s.Width - 152;
            const toolsY = narrow ? tabsY + 36 : tabsY;
            this.Place(this.tools[0], toolsX, toolsY, 30, 32);
            this.Place(this.tools[1], toolsX + 34, toolsY, 30, 32);
            this.Place(this.tools[2], toolsX + 68, toolsY, 42, 32);
            this.Place(this.tools[3], toolsX + 114, toolsY, 36, 32);
        }
        else if (l.exploring === 'battle') {
            const toolsX = s.Width - 94;
            this.Place(this.tools[2], toolsX, tabsY, 42, 32);
            this.Place(this.tools[3], toolsX + 46, tabsY, 36, 32);
        }
    }

    DrawRingMenu() {
        const { level: l, screen: s, frame: f } = this;
        if (l.exploring !== 'battle' || l.turn.phase !== 'command' || (!this.ringOpen && this.ringProgress <= 0.015)) {
            for (const item of this.ringItems) item.button.enabled = false;
            this.ringLayout = null;
            return;
        }
        const active = l.turn.active;
        const position = l.camera.Project(
            new Vector3D(active.travel.position.x, active.travel.position.y + 0.7, active.travel.position.z),
            s.Width, s.Height,
        );
        this.ringLayout = RadialMenuLayout(
            s.Width, s.Height, this.ringItems.length, this.ringProgress,
            position.visible ? position : { x: s.Width / 2, y: s.Height / 2 },
            { top: this.headerHeight, bottom: s.Height - 145 },
        );
        const point = Touch.ToScreen(Input.instance.mouse.position, s);
        const hovered = this.ringOpen ? RadialMenuHitTest(point, this.ringLayout) : -1;
        if (this.ringOpen && (!this.ringPointer || point.x !== this.ringPointer.x || point.y !== this.ringPointer.y)) {
            if (hovered >= 0) this.ringSelected = hovered;
            this.ringPointer = { x: point.x, y: point.y };
        }

        const context = s.Context, layout = this.ringLayout;
        context.save();
        context.beginPath();
        context.arc(layout.center.x, layout.center.y, layout.radius + 22 * this.ringProgress, 0, Math.PI * 2);
        context.fillStyle = 'rgba(7, 14, 21, .48)';
        context.fill();
        context.strokeStyle = 'rgba(223, 197, 122, .8)';
        context.lineWidth = 2;
        context.stroke();
        for (const item of layout.items) {
            context.beginPath();
            context.moveTo(layout.center.x, layout.center.y);
            context.lineTo(item.x, item.y);
            context.strokeStyle = 'rgba(223, 197, 122, .32)';
            context.lineWidth = 1;
            context.stroke();
        }
        context.restore();

        const selected = this.ringItems[this.ringSelected];
        context.save();
        context.beginPath();
        context.arc(layout.center.x, layout.center.y, 20 * this.ringProgress, 0, Math.PI * 2);
        context.fillStyle = 'rgba(12, 24, 33, .98)';
        context.fill();
        context.strokeStyle = f.theme.gold;
        context.lineWidth = 2;
        context.stroke();
        context.restore();
        f.Text(selected?.label ?? 'Menu', layout.center.x, layout.center.y - 2, {
            size: 9, align: 'center', weight: 700, color: f.theme.gold, maxWidth: 42,
        });
        f.Text('ENTER', layout.center.x, layout.center.y + 13, {
            size: 7, align: 'center', color: f.theme.text,
        });

        layout.items.forEach((position, index) => {
            const item = this.ringItems[index], size = Math.max(10, position.size);
            const available = this.CommandAvailable(index);
            item.button.enabled = this.ringOpen && this.ringProgress >= 0.75 && available;
            item.button.SetButton(new Rectangle(position.x - size / 2, position.y - size / 2, size, size));
            context.save();
            context.beginPath();
            context.arc(position.x, position.y, size / 2, 0, Math.PI * 2);
            context.fillStyle = !available ? 'rgba(37, 43, 46, .92)' : index === this.ringSelected ? 'rgba(223, 197, 122, .96)' : 'rgba(24, 38, 48, .98)';
            context.fill();
            context.strokeStyle = index === this.ringSelected ? '#fff1be' : 'rgba(223, 197, 122, .78)';
            context.lineWidth = index === this.ringSelected ? 3 : 1.5;
            context.stroke();
            context.restore();
            f.Text(item.shortcut, position.x, position.y + 4, {
                size: 13, align: 'center', weight: 700,
                color: !available ? '#718087' : index === this.ringSelected ? '#13212a' : f.theme.text,
            });
            f.Text(`${index + 1}`, position.x, position.y - size / 2 + 9, {
                size: 7, align: 'center', weight: 700,
                color: index === this.ringSelected ? '#13212a' : f.theme.gold,
            });
        });
    }

    DrawExploration() {
        const { level: l, screen: s, frame: f } = this;
        this.DrawExploreRoute();
        if (this.panel) return;
        const layout = ExplorationBarLayout(s.Width, s.Height);
        const width = Math.min(430, s.Width - 20), y = layout[0].y - 31;
        f.Panel({ x: 10, y, width, height: 28 });
        f.Text(l.turn.message, 22, y + 19, { size: 10, color: f.theme.gold, maxWidth: width - 24 });
        if (l.CanInteractShopkeeper())
            this.Place(this.talk, 12, y - 38, Math.min(170, width - 4), 34, true);
        this.DrawExplorationBar(layout);
    }

    DrawExplorationBar(layout) {
        const { screen: s, frame: f } = this, c = s.Context;
        const pointer = Touch.ToScreen(Input.instance.mouse.position, s);
        let hovered = null;
        layout.forEach((rect, index) => {
            const item = this.barItems[index];
            const over = pointer.x >= rect.x && pointer.x <= rect.x + rect.width
                && pointer.y >= rect.y && pointer.y <= rect.y + rect.height;
            if (over) hovered = { item, rect };
            item.button.enabled = !item.unavailable;
            item.button.SetButton(new Rectangle(rect.x, rect.y, rect.width, rect.height));
            f.Panel(rect);
            c.save();
            c.strokeStyle = item.unavailable ? '#647079' : over ? '#fff0bd' : f.theme.gold;
            c.fillStyle = c.strokeStyle;
            c.lineWidth = 1.5;
            const x = rect.x + rect.width / 2, y = rect.y + 11;
            c.beginPath();
            if (item.icon === 'character' || item.icon === 'party') {
                c.arc(x, y - 3, 3, 0, Math.PI * 2);
                c.moveTo(x - 6, y + 7); c.quadraticCurveTo(x, y - 1, x + 6, y + 7);
                if (item.icon === 'party') { c.moveTo(x - 9, y + 3); c.lineTo(x - 7, y - 1); c.moveTo(x + 9, y + 3); c.lineTo(x + 7, y - 1); }
            }
            else if (item.icon === 'skills') {
                c.moveTo(x + 2, y - 8); c.lineTo(x - 5, y + 1); c.lineTo(x, y + 1); c.lineTo(x - 2, y + 8); c.lineTo(x + 6, y - 2); c.lineTo(x + 1, y - 2); c.closePath();
            }
            else if (item.icon === 'bag') {
                c.rect(x - 6, y - 3, 12, 10); c.moveTo(x - 3, y - 3); c.quadraticCurveTo(x, y - 10, x + 3, y - 3);
            }
            else if (item.icon === 'gear') {
                c.moveTo(x, y - 8); c.lineTo(x + 7, y - 4); c.lineTo(x + 5, y + 4); c.lineTo(x, y + 8); c.lineTo(x - 5, y + 4); c.lineTo(x - 7, y - 4); c.closePath();
            }
            else if (item.icon === 'map') {
                c.moveTo(x - 8, y - 6); c.lineTo(x - 3, y - 8); c.lineTo(x + 3, y - 5); c.lineTo(x + 8, y - 7); c.lineTo(x + 8, y + 5); c.lineTo(x + 3, y + 7); c.lineTo(x - 3, y + 4); c.lineTo(x - 8, y + 6); c.closePath(); c.moveTo(x - 3, y - 8); c.lineTo(x - 3, y + 4); c.moveTo(x + 3, y - 5); c.lineTo(x + 3, y + 7);
            }
            else if (item.icon === 'shop') {
                c.moveTo(x - 7, y - 1); c.lineTo(x, y - 7); c.lineTo(x + 7, y - 1); c.lineTo(x + 7, y + 7); c.lineTo(x - 7, y + 7); c.closePath(); c.moveTo(x - 2, y + 7); c.lineTo(x - 2, y + 1); c.lineTo(x + 2, y + 1); c.lineTo(x + 2, y + 7);
            }
            c.stroke();
            if (item.icon === 'help') { c.font = 'bold 16px sans-serif'; c.textAlign = 'center'; c.fillText('?', x, y + 6); }
            c.restore();
            f.Text(`${item.label} [${item.shortcut}]`, x, rect.y + 35, {
                size: 10, align: 'center', weight: over ? 700 : 400,
                color: item.unavailable ? '#718087' : f.theme.text, maxWidth: rect.width - 4,
            });
        });
        if (hovered) {
            const text = hovered.item.unavailable ? 'Party / roster not available yet'
                : hovered.item.icon === 'shop' ? 'Trade with a nearby vendor [F]'
                : `${hovered.item.label} [${hovered.item.shortcut}]`;
            const width = Math.min(220, s.Width - 20), x = Math.max(10, Math.min(s.Width - width - 10, hovered.rect.x));
            const y = layout[0].y - 57;
            f.Panel({ x, y, width, height: 23 });
            f.Text(text, x + 8, y + 16, { size: 10, color: f.theme.gold, maxWidth: width - 16 });
        }
    }

    DrawExploreRoute() {
        const { level: l, screen: s, frame: f } = this;
        const route = l.exploreRoute;
        if (!route?.path.length) return;
        const project = tile => {
            const world = l.terrain.World(l.grid.Get(tile.col, tile.row));
            return l.camera.Project(new Vector3D(world.x, world.y + 0.06, world.z), s.Width, s.Height);
        };
        const points = [route.origin, ...route.path].map(project);
        const drawLabel = (label, point) => {
            const width = 72, height = 22;
            const x = Math.max(4, Math.min(s.Width - width - 4, point.x - width / 2));
            const preferredY = point.y < this.headerHeight + 50 ? point.y + 12 : point.y - height - 12;
            const y = Math.max(this.headerHeight + 4, Math.min(s.Height - 126, preferredY));
            const context = s.Context;
            context.save();
            context.beginPath();
            context.roundRect(x, y, width, height, 5);
            context.fillStyle = 'rgba(8, 15, 22, .96)';
            context.fill();
            context.strokeStyle = 'rgba(233, 221, 165, .85)';
            context.lineWidth = 1;
            context.stroke();
            context.fillStyle = '#f9cb5b';
            context.font = '700 10px Arial';
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillText(label, x + width / 2, y + height / 2);
            context.restore();
        };
        if (points[0].visible && Number.isFinite(points[0].x) && Number.isFinite(points[0].y))
            drawLabel('MoveFrom', points[0]);
        const destination = points[points.length - 1];
        if (destination.visible && Number.isFinite(destination.x) && Number.isFinite(destination.y))
            drawLabel('MoveTo', destination);
    }

    DrawBattle() {
        const { level: l, screen: s, frame: f } = this, t = l.turn;
        const y = s.Height - 108, width = s.Width - 20;
        f.Panel({ x: 10, y, width, height: 98 });
        const active = t.active?.stats, tile = t.cursor ? l.grid.Get(t.cursor.col, t.cursor.row) : null;
        const description = active
            ? `${active.name}${active.role ? ` · ${active.role.toUpperCase()}` : ''} · HP ${active.hp}/${active.maxHp} · DEF ${active.defense} · EN ${active.energy}/${active.energyMax ?? 2}`
            : `${l.zone.name} patrol · CT advances by speed`;
        f.Text(description, 21, y + 20, { size: 12, weight: 700, maxWidth: width - 22 });
        const inspected = l.hoveredPawn ?? (t.phase === 'target' && t.cursor
            ? t.pawns.find(pawn => pawn.stats.col === t.cursor.col && pawn.stats.row === t.cursor.row)
            : null);
        const preview = inspected && t.active && t.phase === 'target' && BattleRules.CanAttack(l.grid, t.active.stats, inspected.stats, t.ability)
            ? BattleRules.Preview(l.grid, t.active.stats, inspected.stats, t.ability)
            : null;
        const statuses = inspected ? [
            inspected.stats.burn > 0 ? 'BURN' : null,
            inspected.stats.stunned > 0 ? 'STUN' : null,
            inspected.stats.exposed > 0 ? 'EXPOSED' : null,
            inspected.stats.slowed > 0 ? 'SLOW' : null,
        ].filter(Boolean).join('/') : '';
        const inspection = inspected
            ? `${inspected.stats.name} · ${inspected.stats.role ?? inspected.stats.team} · Lv ${inspected.stats.level ?? 1} · HP ${inspected.stats.hp}/${inspected.stats.maxHp} · EN ${inspected.stats.energy ?? 0}/${inspected.stats.energyMax ?? 2}${statuses ? ` · ${statuses}` : ''}${preview ? preview.heal !== undefined ? ` · +${preview.heal} HP` : ` · ${preview.chance}% / ${preview.damage} dmg` : ''} · ${GetAbilityProfile(inspected.stats, inspected.stats.basicAbility).name}`
            : null;
        f.Text(inspection ?? (tile ? `Tile ${tile.col},${tile.row} · H ${tile.h} · ${t.message}` : t.message), 21, y + 40, {
            size: 10, color: f.theme.gold, maxWidth: width - 22,
        });
        if (inspected && !this.ringOpen) this.DrawBattleInspection(inspected, preview, statuses);
        const gap = 5, buttonWidth = Math.max(54, (width - 20 - gap * (this.commands.length - 1)) / this.commands.length);
        if (t.phase === 'skill-select') {
            const choices = ActiveSkills(t.active?.stats.archetype, t.active?.stats.unlockedSkills);
            choices.forEach((skill, index) => {
                const item = this.skillChoiceButtons.find(entry => entry.skill.id === skill.id);
                if (item) this.Place(item, 15 + index * (buttonWidth + gap), y + 53, buttonWidth, 34, true, t.skillCursor === index);
            });
        }
        else if (t.phase === 'item')
            this.Place(this.battlePotion, 15, y + 53, Math.min(150, width - 20), 34, true);
        else if (t.phase === 'command')
            this.Place(this.menuTrigger, 15, y + 53, Math.min(150, width - 20), 34, true, this.ringOpen);
        if (t.phase === 'face') {
            const faceWidth = (width - 18) / 5;
            this.facings.forEach((item, index) => this.Place(item, 13 + index * (faceWidth + 3), y + 53, faceWidth, 34, true, active?.facing === index));
            this.Place(this.wait, 13 + 4 * (faceWidth + 3), y + 53, faceWidth, 34, true);
        }
        const queue = t.Alive().slice().sort((a, b) => {
            if (a === t.active) return -1;
            if (b === t.active) return 1;
            return (100 - a.stats.ct) / a.stats.speed - (100 - b.stats.ct) / b.stats.speed;
        }).slice(0, 4);
        queue.forEach((pawn, index) => {
            const cx = 27 + index * Math.min(95, (width - 30) / 4), cy = y - 24, context = s.Context;
            this.DrawUnitPortrait(context, cx, cy, pawn.stats, pawn === t.active);
            f.Text(`${Math.floor(pawn.stats.ct)}`, cx + 17, cy + 3, { size: 8, color: f.theme.gold });
        });
        for (const pawn of t.Alive()) {
            const position = pawn.travel.position;
            const projected = l.camera.Project(new Vector3D(position.x, position.y + 1.15, position.z), s.Width, s.Height);
            if (!projected.visible) continue;
            f.Meter(pawn.stats.hp / pawn.stats.maxHp, { x: projected.x - 18, y: projected.y, width: 36, height: 4 },
                pawn.stats.team === 'ally' ? '#7cddc5' : '#ed9c91');
            if (pawn === t.active)
                f.Text('▼', projected.x, projected.y - 9, { size: 12, align: 'center', color: f.theme.gold });
        }
        for (const feedback of t.feedback) {
            const position = feedback.pawn.travel.position;
            const projected = l.camera.Project(new Vector3D(position.x, position.y + 1.5, position.z), s.Width, s.Height);
            f.Text(feedback.text, projected.x, projected.y - (1.7 - feedback.life) * 18, {
                size: 14, align: 'center', weight: 700, color: f.theme.gold, maxWidth: 160,
            });
        }
    }

    DrawUnitPortrait(context, x, y, stats, active) {
        context.save();
        context.beginPath(); context.arc(x, y, 13, 0, Math.PI * 2); context.clip();
        context.fillStyle = stats.team === 'ally' ? '#365a5b' : '#693e40';
        context.fillRect(x - 13, y - 13, 26, 26);
        context.fillStyle = stats.color ?? '#b7c8ca';
        context.beginPath(); context.ellipse(x, y + 13, 10, 9, 0, 0, Math.PI * 2); context.fill();
        context.fillStyle = '#e3b58f';
        context.beginPath(); context.ellipse(x, y - 2, 6, 8, 0, 0, Math.PI * 2); context.fill();
        context.fillStyle = stats.role === 'caster' ? '#a58dc5' : '#37424b';
        context.beginPath(); context.arc(x, y - 6, 7, Math.PI, 0); context.lineTo(x + 7, y - 3); context.lineTo(x - 7, y - 3); context.fill();
        context.restore();
        context.save(); context.beginPath(); context.arc(x, y, 13, 0, Math.PI * 2);
        context.strokeStyle = active ? this.frame.theme.gold : '#a8b7b7';
        context.lineWidth = active ? 2 : 1; context.stroke(); context.restore();
    }

    DrawBattleInspection(pawn, preview, statuses) {
        const { frame: f, screen: s } = this, stats = pawn.stats;
        const width = Math.min(250, s.Width - 20), x = s.Width - width - 10, y = this.headerHeight + 8;
        f.Panel({ x, y, width, height: 70 });
        f.Text(`${stats.name} · Lv ${stats.level ?? 1} · ${(stats.role ?? stats.team).toUpperCase()}`, x + 10, y + 18, { size: 10, weight: 700, color: f.theme.gold, maxWidth: width - 20 });
        f.Text(`HP ${stats.hp}/${stats.maxHp} · EN ${stats.energy ?? 0}/${stats.energyMax ?? 2}${statuses ? ` · ${statuses}` : ''}`, x + 10, y + 36, { size: 10, maxWidth: width - 20 });
        const detail = preview ? preview.heal !== undefined ? `Heal +${preview.heal} HP` : `${preview.chance}% hit · ${preview.damage} damage`
            : `Ability: ${GetAbilityProfile(stats, stats.basicAbility).name}`;
        f.Text(detail, x + 10, y + 54, { size: 10, maxWidth: width - 20 });
    }

    DrawCharacterCreation() {
        const { level: l, screen: s, frame: f } = this;
        const width = Math.min(500, s.Width - 28), x = (s.Width - width) / 2, y = Math.max(120, (s.Height - 312) / 2);
        const context = s.Context;
        context.save(); context.fillStyle = 'rgba(5,12,17,.42)'; context.fillRect(0, 0, s.Width, s.Height); context.restore();
        f.Panel({ x, y, width, height: 300 });
        f.Text('BEGIN YOUR HIGHLAND JOURNEY', s.Width / 2, y + 35, { size: 19, align: 'center', weight: 700, color: f.theme.gold, maxWidth: width - 24 });
        f.Text('Name your hero and choose a calling.', s.Width / 2, y + 59, { size: 12, align: 'center' });
        this.nameField.SetBox(new Rectangle(x + 24, y + 76, width - 48, 36));
        this.nameField.DrawCursor();
        const gap = 6, classWidth = (width - 32 - gap) / 2;
        const archetypes = ['vanguard', 'ranger', 'arcanist', 'cleric'];
        this.classButtons.forEach((item, index) => this.Place(item, x + 16 + (index % 2) * (classWidth + gap), y + 125 + Math.floor(index / 2) * 28, classWidth, 24, true, this.selectedArchetype === archetypes[index]));
        const callings = [
            'Vanguard · 48 HP · 14 ATK · 5 DEF',
            'Ranger · 40 HP · 13 ATK · 3 DEF',
            'Arcanist · 36 HP · 16 ATK · 2 DEF',
            'Cleric · 42 HP · 11 ATK · 4 DEF',
        ];
        const index = archetypes.indexOf(this.selectedArchetype);
        f.Text(callings[index], s.Width / 2, y + 198, { size: 12, align: 'center' });
        this.Place(this.begin, x + 30, y + 226, width - 60, 48, true);
    }

    BagItems() {
        const all = this.level.campaign.BagItems();
        return this.inventoryCategory === 'All'
            ? all
            : all.filter(item => ItemInfo[item.name]?.category === this.inventoryCategory);
    }

    SelectedBagItem() {
        return this.BagItems()[this.selectedBagIndex] ?? null;
    }

    DrawBagIcon(item, rect) {
        const c = this.screen.Context, x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
        const icon = ItemInfo[item.name]?.icon;
        c.save();
        c.lineWidth = 2;
        c.strokeStyle = item.equipped ? '#e5c46d' : '#c8d0d2';
        c.fillStyle = item.name === 'Potion' ? '#b65372' : item.equipped ? '#b38b4e' : '#7294a3';
        c.beginPath();
        if (icon === 'potion') {
            c.moveTo(x - 4, y - 7); c.lineTo(x + 4, y - 7); c.lineTo(x + 3, y - 2);
            c.lineTo(x + 7, y + 3); c.lineTo(x + 6, y + 7); c.lineTo(x - 6, y + 7);
            c.lineTo(x - 7, y + 3); c.lineTo(x - 3, y - 2); c.closePath();
            c.fill(); c.stroke();
        }
        else if (icon === 'blade' || icon === 'staff') {
            c.moveTo(x + 6, y - 8); c.lineTo(x + 1, y + 3); c.lineTo(x - 2, y + 6);
            c.stroke(); c.beginPath(); c.moveTo(x - 6, y + 2); c.lineTo(x + 2, y + 4); c.stroke();
        }
        else {
            c.moveTo(x, y - 8); c.lineTo(x + 8, y - 4); c.lineTo(x + 6, y + 7);
            c.lineTo(x, y + 9); c.lineTo(x - 6, y + 7); c.lineTo(x - 8, y - 4);
            c.closePath(); c.fill(); c.stroke();
        }
        c.strokeStyle = ({ common: '#69777d', uncommon: '#67b68c', rare: '#68a6dc', epic: '#bd82d6' })[ItemInfo[item.name]?.rarity] ?? '#69777d';
        c.lineWidth = 1;
        c.strokeRect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2);
        c.restore();
    }

    DrawVendorPortrait(context, x, y, vendor) {
        const colors = {
            weaponsmith: ['#bb6148', '#e1ae83', '#5a3031'],
            armorer: ['#84979e', '#d2ab89', '#33414b'],
            alchemist: ['#7cae79', '#d8b28e', '#39493a'],
            trainer: ['#b282bd', '#e0b998', '#58435d'],
        }[vendor?.vendorId] ?? ['#8295a1', '#d8b28e', '#38434c'];
        context.save();
        context.beginPath();
        context.arc(x, y, 18, 0, Math.PI * 2);
        context.clip();
        context.fillStyle = '#172630';
        context.fillRect(x - 18, y - 18, 36, 36);
        context.fillStyle = colors[0];
        context.beginPath();
        context.ellipse(x, y + 23, 16, 13, 0, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = colors[1];
        context.beginPath();
        context.ellipse(x, y - 1, 10, 12, 0, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = colors[2];
        context.beginPath();
        context.arc(x, y - 6, 11, Math.PI, Math.PI * 2);
        context.lineTo(x + 10, y - 1);
        context.lineTo(x - 10, y - 1);
        context.closePath();
        context.fill();
        context.fillStyle = '#27313a';
        context.beginPath();
        context.arc(x - 4, y - 1, 1, 0, Math.PI * 2);
        context.arc(x + 4, y - 1, 1, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = '#794b46';
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(x - 3, y + 5);
        context.lineTo(x + 3, y + 5);
        context.stroke();
        context.restore();
        context.beginPath();
        context.arc(x, y, 18, 0, Math.PI * 2);
        context.strokeStyle = this.frame.theme.gold;
        context.lineWidth = 2;
        context.stroke();
    }

    DrawBag(x, y, width, hero) {
        const { frame: f, screen: s } = this, items = this.BagItems();
        const categories = this.bagCategories, inner = width - 24;
        const catGap = 2, catWidth = (inner - catGap * (categories.length - 1)) / categories.length;
        categories.forEach((entry, index) => this.Place(
            entry, x + 12 + index * (catWidth + catGap), y + 33, catWidth, 22, true, this.inventoryCategory === entry.category,
        ));

        const pointer = Touch.ToScreen(Input.instance.mouse.position, s);
        const slotHeight = width < 400 ? 20 : 25;
        const gridY = y + 108;
        this.slotRects = InventoryGridLayout(x, y, width, slotHeight);
        const hoverIndex = this.slotRects.findIndex(rect =>
            pointer.x >= rect.x && pointer.x <= rect.x + rect.width && pointer.y >= rect.y && pointer.y <= rect.y + rect.height);
        const selectedIndex = hoverIndex >= 0 && items[hoverIndex] ? hoverIndex : this.selectedBagIndex;
        const selected = items[selectedIndex] ?? null;
        if (selected) this.selectedBagIndex = selectedIndex;

        for (let index = 0; index < this.bagSlots.length; index++) {
            const rect = this.slotRects[index], item = items[index];
            if (!item) {
                this.bagSlots[index].button.enabled = false;
                f.Panel(rect);
                continue;
            }
            this.bagSlots[index].label = '';
            this.Place(this.bagSlots[index], rect.x, rect.y, rect.width, rect.height, true, index === selectedIndex);
            this.DrawBagIcon(item, rect);
            f.Text(item.count > 1 ? `${item.count}` : '1', rect.x + rect.width - 6, rect.y + rect.height - 2, {
                size: 8, align: 'right', weight: 700, color: item.equipped ? f.theme.gold : f.theme.text,
            });
        }
        const info = selected ? ItemInfo[selected.name] : null;
        let modifier = selected?.name === 'Potion' ? '+24 HP · stack'
            : selected ? this.GearComparison(selected.name) : 'Empty slot';
        if (selected?.equipped) modifier += ' · EQUIPPED';
        f.Text(selected ? `${selected.name} · ${modifier}` : 'Select an item to inspect it', x + 12, y + 65, {
            size: 10, weight: 700, color: f.theme.gold, maxWidth: width - 24,
        });
        f.Text(info?.description ?? 'Choose an item slot for details and actions.', x + 12, y + 81, {
            size: 9, maxWidth: width - 24,
        });
        const buttonY = gridY + 6 * (slotHeight + 2) + 2;
        this.Place(this.panelButtons.equipItem, x + 12, buttonY, (inner - 4) / 2, 24,
            Boolean(selected && (this.level.campaign.inventory[selected.name] ?? 0) > 0 && EquipmentSlot(selected.name)));
        this.Place(this.panelButtons.useItem, x + 16 + (inner - 4) / 2, buttonY, (inner - 4) / 2, 24,
            selected?.name === 'Potion');
    }

    GearComparison(name) {
        const slot = EquipmentSlot(name), next = EquipmentStats(name);
        if (!slot || !next) return 'Not equipment';
        const current = EquipmentStats(this.level.campaign.equipment[slot]) ?? {};
        const labels = [['attack', 'ATK'], ['defense', 'DEF'], ['speed', 'SPD'], ['hp', 'HP'], ['energy', 'EN']];
        const changes = labels.map(([key, label]) => {
            const delta = (next[key] ?? 0) - (current[key] ?? 0);
            return delta ? `${label} ${delta > 0 ? '+' : ''}${delta}` : null;
        }).filter(Boolean);
        return changes.join(' · ') || 'No stat change';
    }

    GearCandidates() {
        return Object.entries(this.level.campaign.inventory)
            .filter(([name, count]) => count > 0 && EquipmentSlot(name) === this.selectedGearSlot)
            .map(([name]) => name).sort();
    }

    SelectGearSlot(slot) {
        if (this.selectedGearSlot !== slot) this.selectedGearIndex = 0;
        this.selectedGearSlot = slot;
    }

    CycleGear(direction) {
        const count = this.GearCandidates().length;
        if (count) this.selectedGearIndex = (this.selectedGearIndex + direction + count) % count;
    }

    DrawEquipment(x, y, width, hero) {
        const { frame: f, screen: s, level: l } = this, c = s.Context;
        const center = x + width / 2;
        c.save();
        c.fillStyle = '#30414a';
        c.strokeStyle = '#c9ae69';
        c.lineWidth = 2;
        c.beginPath(); c.arc(center, y + 67, 13, 0, Math.PI * 2); c.fill(); c.stroke();
        c.beginPath(); c.moveTo(center - 18, y + 87); c.lineTo(center + 18, y + 87);
        c.lineTo(center + 24, y + 132); c.lineTo(center + 13, y + 141);
        c.lineTo(center + 15, y + 170); c.lineTo(center + 3, y + 170);
        c.lineTo(center, y + 144); c.lineTo(center - 3, y + 170);
        c.lineTo(center - 15, y + 170); c.lineTo(center - 13, y + 141);
        c.lineTo(center - 24, y + 132); c.closePath(); c.fill(); c.stroke();
        c.restore();
        const pointer = Touch.ToScreen(Input.instance.mouse.position, s);
        for (const rect of EquipmentLayout(x, y, width)) {
            const item = this.gearSlots.find(entry => entry.slot === rect.slot);
            const hovered = pointer.x >= rect.x && pointer.x <= rect.x + rect.width
                && pointer.y >= rect.y && pointer.y <= rect.y + rect.height;
            if (hovered) this.SelectGearSlot(rect.slot);
            this.Place(item, rect.x, rect.y, rect.width, rect.height, true, this.selectedGearSlot === rect.slot);
        }
        const slot = EquipmentSlots.find(entry => entry.id === this.selectedGearSlot);
        const equipped = l.campaign.equipment[slot.id];
        const candidates = this.GearCandidates();
        this.selectedGearIndex = Math.min(this.selectedGearIndex, Math.max(0, candidates.length - 1));
        const alternate = candidates[this.selectedGearIndex];
        f.Text(`ATK ${hero.attack} · DEF ${hero.defense} · SPD ${hero.speed} · HP ${hero.maxHp} · EN ${hero.energyMax}`, x + 12, y + 179, { size: 9, maxWidth: width - 24 });
        f.Text(`${slot.label}: ${equipped ?? 'Empty'}`, x + 12, y + 193, { size: 10, weight: 700, color: f.theme.gold, maxWidth: width - 24 });
        f.Text(alternate ? `${alternate} · ${this.GearComparison(alternate)}` : 'No owned alternatives for this slot.', x + 12, y + 211, { size: 9, maxWidth: width - 24 });
        this.Place(this.gearPrevious, x + 12, y + 227, 34, 28, candidates.length > 1);
        this.Place(this.gearNext, x + 50, y + 227, 34, 28, candidates.length > 1);
        this.Place(this.gearEquip, x + 90, y + 227, width - 102, 28, Boolean(alternate));
    }

    DrawWorldMap(x, y, width, hero) {
        const { frame: f, screen: s, level: l } = this;
        const map = WorldMapDisplay(l.zone.id, l.campaign.clearedZones);
        const context = s.Context;
        const left = x + 30, right = x + width - 30, centerY = y + 132;
        const nodeX = zone => x + 30 + zone.position.x * (width - 60);
        context.save();
        context.strokeStyle = '#7a8990';
        context.lineWidth = 3;
        for (const route of map.routes) {
            const from = map.zones.find(zone => zone.id === route.from);
            const to = map.zones.find(zone => zone.id === route.to);
            context.beginPath();
            context.moveTo(nodeX(from), centerY);
            context.lineTo(nodeX(to), centerY);
            context.strokeStyle = route.open ? '#cfb76e' : '#58636a';
            context.setLineDash(route.open ? [] : [5, 4]);
            context.stroke();
        }
        context.setLineDash([]);
        for (const zone of map.zones) {
            const px = nodeX(zone);
            context.beginPath();
            context.arc(px, centerY, zone.current ? 17 : 13, 0, Math.PI * 2);
            context.fillStyle = zone.current ? '#d6b65d' : zone.cleared ? '#6aa88d' : '#243741';
            context.strokeStyle = zone.current ? '#f5e1a1' : '#a9b5b8';
            context.lineWidth = zone.current ? 3 : 1;
            context.fill();
            context.stroke();
            f.Text(zone.current ? 'YOU' : zone.cleared ? '✓' : '·', px, centerY + 4, {
                size: zone.current ? 9 : 12, align: 'center', weight: 700, color: zone.current ? '#15232b' : '#f2e7c7',
            });
            f.Text(zone.name, px, centerY + 36, {
                size: 9, align: 'center', weight: zone.current ? 700 : 400, color: zone.current ? f.theme.gold : f.theme.text,
                maxWidth: width / 3,
            });
        }
        context.restore();
        f.Text('CONNECTED HIGHLANDS', x + width / 2, y + 53, {
            size: 12, align: 'center', weight: 700, color: f.theme.gold,
        });
        f.Text(`Current: ${l.zone.name} · Local tile ${hero.col + 1}, ${hero.row + 1}`, x + width / 2, y + 80, {
            size: 10, align: 'center', maxWidth: width - 28,
        });
        const nextZone = map.zones.find(zone => zone.id === 'ashen-ridge');
        f.Text(nextZone && !map.routes.find(route => route.to === nextZone.id)?.open
            ? 'The Ashen Ridge road opens after the Mistfell patrol is cleared.'
            : 'Follow the marked roads between highland zones.', x + width / 2, y + 190, {
            size: 9, align: 'center', maxWidth: width - 28,
        });
    }

    DrawEncounterTooltip() {
        const { level: l, screen: s, frame: f } = this;
        const encounter = l.zone.encounters.find(entry => entry.id === l.hoveredEncounter.stats.encounterId);
        if (!encounter) return;
        const width = Math.min(290, s.Width - 24);
        const x = (s.Width - width) / 2, y = this.headerHeight + 8;
        const difference = encounter.level - l.campaign.hero.level;
        const difficulty = difference >= 2 ? 'DANGEROUS' : difference <= -2 ? 'FAVORABLE' : 'EVEN';
        f.Panel({ x, y, width, height: 82 });
        f.Text(`Lv ${encounter.level} PATROL · ${encounter.name}`, x + 12, y + 22, {
            size: 11, weight: 700, color: f.theme.gold, maxWidth: width - 24,
        });
        f.Text(encounter.composition.map(group => `${group.count}× ${group.name}`).join(' · '), x + 12, y + 43, {
            size: 9, maxWidth: width - 24,
        });
        f.Text(`DIFFICULTY: ${difficulty} · Approach to engage`, x + 12, y + 65, {
            size: 9, weight: 700, color: difficulty === 'DANGEROUS' ? '#e38a78' : '#8ed0b0',
            maxWidth: width - 24,
        });
    }

    DrawPanel() {
        if (!this.panel || this.level.exploring === 'creation') return;
        const { level: l, screen: s, frame: f } = this;
        const x = 10, y = this.headerHeight + 16, width = Math.min(300, s.Width - 20);
        const hero = l.campaign.hero, panel = this.panel;
        const heading = { hero: 'CHARACTER', bag: 'INVENTORY', gear: 'EQUIPMENT', skills: 'CLASS SKILL TREE', map: 'WORLD MAP', party: 'PARTY ROSTER', shop: 'HEARTHVALE VENDORS' }[panel];
        const height = panel === 'shop' ? 276
            : panel === 'skills' ? 242
                : panel === 'gear' ? 268
                : panel === 'bag' ? (width < 400 ? 278 : 310)
                    : panel === 'map' ? 246
                    : 190;
        f.Panel({ x, y, width, height });
        f.Text(heading, x + 14, y + 23, { size: 14, weight: 700, color: f.theme.gold });
        this.Place(this.panelButtons.close, x + width - 38, y + 7, 28, 28, true);
        if (panel === 'hero') {
            f.Text(`${hero.className} · Level ${hero.level}`, x + 14, y + 48, { size: 12 });
            f.Text(`HP ${hero.hp}/${hero.maxHp} · ATK ${hero.attack} · DEF ${hero.defense}`, x + 14, y + 68, { size: 11 });
            f.Text(`XP ${hero.xp}/${hero.nextXp} · Speed ${hero.speed}`, x + 14, y + 88, { size: 11 });
            this.Place(this.panelButtons.rest, x + 12, y + 128, width - 24, 38, l.zone.id === 'hearthvale');
        }
        else if (panel === 'bag') {
            this.DrawBag(x, y, width, hero);
        }
        else if (panel === 'map')
            this.DrawWorldMap(x, y, width, hero);
        else if (panel === 'party') {
            const companion = l.battleData.units.filter(unit => unit.team === 'ally')[1];
            f.Text(`${hero.name} · ${hero.className} · Lv ${hero.level}`, x + 14, y + 52, { size: 11, weight: 700, maxWidth: width - 28 });
            f.Text(`HP ${hero.hp}/${hero.maxHp} · ATK ${hero.attack} · DEF ${hero.defense}`, x + 14, y + 70, { size: 10, maxWidth: width - 28 });
            if (companion) {
                f.Text(`${companion.name} · ${l.campaign.companionDeployed ? 'DEPLOYED' : 'RESERVE'}`, x + 14, y + 100, { size: 11, weight: 700, color: f.theme.gold });
                f.Text(`HP ${companion.hp} · ATK ${companion.attack} · SPD ${companion.speed}`, x + 14, y + 118, { size: 10 });
                f.Text('Orin refreshes each battle · Enter toggles deployment.', x + 14, y + 136, { size: 9, maxWidth: width - 28 });
                this.panelButtons.companion.label = l.campaign.companionDeployed ? 'MOVE TO RESERVE' : 'DEPLOY ORIN';
                this.Place(this.panelButtons.companion, x + 12, y + 146, width - 24, 30, true);
            }
        }
        else if (panel === 'gear') {
            this.DrawEquipment(x, y, width, hero);
        }
        else if (panel === 'skills') {
            const tree = SkillTrees[hero.archetype] ?? [];
            f.Text(`${hero.className} · ${l.campaign.skillPoints} SP`, x + 14, y + 44, { size: 11, color: f.theme.gold });
            tree.forEach((skill, index) => {
                const learned = l.campaign.unlockedSkills.includes(skill.id);
                const ready = skill.requires.every(required => l.campaign.unlockedSkills.includes(required));
                const item = this.skillNodeButtons.find(entry => entry.skill.id === skill.id);
                item.label = learned ? 'LEARNED' : ready && l.campaign.skillPoints > 0 ? 'UNLOCK' : 'LOCKED';
                f.Text(`${skill.name} · ${skill.kind.toUpperCase()}`, x + 14, y + 69 + index * 64, { size: 11, weight: 700, maxWidth: width - 112 });
                f.Text(skill.description, x + 14, y + 86 + index * 64, { size: 10, maxWidth: width - 28 });
                if (learned || !ready || l.campaign.skillPoints < 1)
                    f.Text(learned ? 'LEARNED' : ready ? 'NEED 1 SP' : 'LOCKED', x + width - 14, y + 69 + index * 64, {
                        size: 9, align: 'right', color: f.theme.muted,
                    });
                this.Place(item, x + width - 91, y + 52 + index * 64, 78, 28, !learned && ready && l.campaign.skillPoints > 0);
            });
        }
        else if (panel === 'shop') {
            const vendor = l.activeVendor?.stats;
            const context = s.Context;
            context.save();
            this.DrawVendorPortrait(context, x + 33, y + 63, vendor);
            context.restore();
            f.Text(vendor?.name ?? 'Hearthvale Vendor', x + 60, y + 52, { size: 11, weight: 700, maxWidth: width - 74 });
            f.Text(vendor?.greeting ?? 'Welcome, traveler.', x + 60, y + 68, { size: 9, maxWidth: width - 74 });
            f.Text(`${l.campaign.gold}G`, x + width - 12, y + 89, { size: 10, align: 'right', color: f.theme.gold });
            this.shopTabs.forEach((item, index) =>
                this.Place(item, x + 12 + index * ((width - 28) / 2 + 4), y + 94, (width - 28) / 2, 24, true,
                    this.shopTab === ['buy', 'sell'][index]));
            if (this.shopTab === 'sell') {
                if (vendor?.specialty === 'consumable')
                    this.Place(this.panelButtons.potionSell, x + 12, y + 126, width - 24, 28, (l.campaign.inventory.Potion ?? 0) > 0);
                else if (vendor?.specialty === 'weapon' || vendor?.specialty === 'armor') {
                    const equipped = this.sellSlots.filter(entry => {
                        const name = l.campaign.equipment[entry.slot];
                        return (entry.slot === 'weapon' ? 'weapon' : 'armor') === vendor.specialty
                            && (EquipmentStats(name)?.price ?? 0) > 0;
                    }).map(entry => ({ ...entry, name: l.campaign.equipment[entry.slot], equipped: true }));
                    const bag = this.sellInventory.filter(entry => (l.campaign.inventory[entry.name] ?? 0) > 0
                        && EquipmentStats(entry.name).price > 0
                        && (EquipmentSlot(entry.name) === 'weapon' ? 'weapon' : 'armor') === vendor.specialty);
                    const offers = [...equipped, ...bag];
                    this.shopPage = Math.min(this.shopPage, Math.max(0, Math.ceil(offers.length / 2) - 1));
                    if (!offers.length) f.Text('No gear to sell.', x + 14, y + 146, { size: 10 });
                    offers.slice(this.shopPage * 2, this.shopPage * 2 + 2).forEach((offer, index) => {
                        const name = offer.name, itemY = y + 126 + index * 48;
                        offer.button.label = `SELL ${name.toUpperCase()} · ${Math.floor(EquipmentStats(name).price / 2)}G`;
                        this.Place(offer.button, x + 12, itemY, width - 24, 28, true);
                        const source = offer.equipped ? 'EQUIPPED' : `BAG ×${l.campaign.inventory[name]}`;
                        f.Text(`${source} · ${this.GearComparison(name)}`, x + 14, itemY + 40, { size: 8, maxWidth: width - 28 });
                    });
                    this.DrawShopPages(x, y, width, offers.length);
                }
                else
                    f.Text('The trainer offers rest, not trade.', x + 14, y + 146, { size: 10 });
            }
            else {
                const stock = vendor?.specialty === 'weapon'
                    ? [
                        { name: 'Highland Edge', button: this.panelButtons.buyBlade, slot: 'weapon' },
                        { name: 'Runed Staff', button: this.panelButtons.buyStaff, slot: 'weapon' },
                    ]
                    : vendor?.specialty === 'armor'
                        ? [
                            { name: 'Ranger Leathers', button: this.panelButtons.buyLeathers, slot: 'armor' },
                            { name: 'Iron Kilt', button: this.panelButtons.buyKilt, slot: 'armor' },
                            ...this.extraStock.map(entry => ({ ...entry, slot: EquipmentSlot(entry.name) })),
                        ]
                        : vendor?.specialty === 'consumable'
                            ? [{ name: 'Potion', button: this.panelButtons.buyPotion, slot: 'consumable' }]
                            : [];
                if (vendor?.specialty === 'rest')
                    this.Place(this.panelButtons.rest, x + 12, y + 126, width - 24, 30, true);
                else if (stock.length) {
                    this.shopPage = Math.min(this.shopPage, Math.ceil(stock.length / 2) - 1);
                    stock.slice(this.shopPage * 2, this.shopPage * 2 + 2).forEach((offer, index) => {
                        const itemY = y + 126 + index * 48;
                        this.Place(offer.button, x + 12, itemY, width - 58, 28, true);
                        this.DrawBagIcon({ name: offer.name }, {
                            x: x + width - 37, y: itemY + 4, width: 22, height: 20,
                        });
                        const owned = l.campaign.BagItems().find(item => item.name === offer.name)?.count ?? 0;
                        const detail = offer.slot === 'consumable' ? '+24 HP per use' : this.GearComparison(offer.name);
                        f.Text(`OWNED ${owned} · ${detail}`, x + 14, itemY + 40, {
                            size: 8, color: f.theme.muted, maxWidth: width - 28,
                        });
                    });
                    this.DrawShopPages(x, y, width, stock.length);
                }
            }
        }
    }

    DrawShopPages(x, y, width, count) {
        const pages = Math.ceil(count / 2);
        if (pages <= 1) return;
        this.Place(this.shopPrevious, x + 12, y + 238, 35, 25, this.shopPage > 0);
        this.frame.Text(`${this.shopPage + 1} / ${pages}`, x + width / 2, y + 254, { size: 10, align: 'center' });
        this.Place(this.shopNext, x + width - 47, y + 238, 35, 25, this.shopPage + 1 < pages);
    }

    Draw() {
        for (const item of this.buttons) item.button.enabled = false;
        this.nameField.SetBox(new Rectangle(-1000, -1000, 0, 0));
        const l = this.level, s = this.screen;
        this.DrawStatus();
        if (l.exploring === 'creation')
            this.DrawCharacterCreation();
        else if (l.exploring === 'battle')
            this.DrawBattle();
        else if (l.exploring === 'explore') {
            this.DrawExploration();
            this.DrawPanel();
            if (!l.hud.panel) for (const vendor of l.vendors ?? []) {
                const position = vendor.travel.position;
                const projected = l.camera.Project(new Vector3D(position.x, position.y + 1.15, position.z), s.Width, s.Height);
                if (projected.visible)
                    this.frame.Text(vendor.stats.name.split(' ')[0].toUpperCase(), projected.x, projected.y - 12, {
                        size: 10, align: 'center', weight: 700, color: this.frame.theme.gold,
                    });
            }
            if (l.hoveredEncounter)
                this.DrawEncounterTooltip();
        }
        else if (l.exploring === 'result') {
            const width = Math.min(420, s.Width - 32), x = (s.Width - width) / 2, y = (s.Height - 132) / 2;
            this.frame.Panel({ x, y, width, height: 120 });
            this.frame.Text(l.turn.result === 'VICTORY' ? 'PATROL DEFEATED' : 'PARTY DEFEATED', s.Width / 2, y + 34, {
                size: 20, align: 'center', weight: 700, color: this.frame.theme.gold,
            });
            this.frame.Text(l.turn.message, s.Width / 2, y + 57, { size: 11, align: 'center', maxWidth: width - 24 });
            this.Place(this.panelButtons.return, x + 16, y + 73, width - 32, 36, true);
        }
        this.DrawRingMenu();
        this.help.OnDrawn();
    }

    Dispose() {
        for (const item of this.buttons) item.button.Dispose();
        this.nameField.Dispose();
        this.help.Dispose();
    }
}
