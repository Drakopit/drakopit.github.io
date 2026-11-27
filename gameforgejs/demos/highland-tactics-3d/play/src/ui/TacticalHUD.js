import { Input, Vector3D } from 'gameforgejs/core';
import { Draw, HUDFrame, InputHelpPanel, Button, Rectangle, TextBox, Touch } from 'gameforgejs/2d';
import { Equipment, EquipmentSlots, EquipmentSlot, EquipmentStats, ItemInfo } from '../data/HighlandCampaign.js';
import { WorldMapDisplay } from '../data/WorldMaps.js';
import { BattleRules, Commands, Facings, GetAbilityProfile } from '../data/BattleRules.js';
import { ActiveSkills, SkillTrees } from '../data/ClassSkills.js';
import { ControlModes, ControlSettings } from '../input/ControlModes.js';
import { CommandAvailable } from '../data/HighlandActions.js';

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

export function ItemHintLayout(screen, panel, headerHeight) {
    const width = Math.min(290, screen.Width - 20), height = 118, gap = 10;
    if (panel.x + panel.width + gap + width <= screen.Width)
        return { x: panel.x + panel.width + gap, y: panel.y, width, height };
    const below = panel.y + panel.height + 6;
    const barTop = ExplorationBarLayout(screen.Width, screen.Height)[0].y;
    if (below + height <= barTop - 8)
        return { x: panel.x, y: below, width, height };
    const above = panel.y - height - 4;
    if (above >= headerHeight)
        return { x: panel.x, y: above, width, height };
    return null;
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
            lines: ['Arrows / WASD move across zones and choose battle commands.', 'Click any reachable open tile to walk there; click highlighted tiles in battle.', 'I inventory · E gear · C character · K skills · M map · P party · F vendor · H help', 'Inventory: arrows select · [ / ] category · Enter use/equip.', 'Shop: up/down select · left/right buy/sell · Enter trade.', 'PC battle: 1–5 commands · 6–9 skills · V toggles tactical ring.'],
        });
        this.panel = null;
        this.selectedArchetype = 'vanguard';
        this.inventoryCategory = 'All';
        this.selectedBagIndex = 0;
        this.inventorySlots = [];
        this.slotRects = [];
        this.shopTab = 'buy';
        this.shopPage = 0;
        this.shopSelection = 0;
        this.panelPointer = null;
        this.selectedGearSlot = 'weapon';
        this.selectedGearIndex = 0;
        this.ringOpen = false;
        this.ringProgress = 0;
        this.ringSelected = 0;
        this.settingsSelection = 0;
        this.mapSelection = 0;
        this.skillTreeSelection = 0;
        this.skillChoiceFocus = null;
        this.skillChoicePointer = null;
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
            { label: 'Settings', shortcut: 'B', panel: 'settings', icon: 'help' },
        ].map(item => ({ ...item, button: this.Button('', () => this.ActivateBar(item)).button }));
        this.bagCategories = ['All', 'Weapons', 'Armor', 'Consumables'].map(category => ({
            ...this.Button(category.toUpperCase(), () => this.SelectBagCategory(category)),
            category,
        }));
        this.bagSlots = Array.from({ length: 30 }, (_, index) =>
            this.Button('', () => { this.selectedBagIndex = index; }));
        this.gearSlots = EquipmentSlots.map(slot => ({
            ...this.Button('', () => this.SelectGearSlot(slot.id)),
            slot: slot.id,
            slotLabel: slot.label,
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
        this.shopPrevious = this.Button('‹', () => this.SelectShopPage(this.shopPage - 1));
        this.shopNext = this.Button('›', () => this.SelectShopPage(this.shopPage + 1));
        this.shopTabs = [
            this.Button('BUY', () => this.SelectShopTab('buy')),
            this.Button('SELL', () => this.SelectShopTab('sell')),
        ];
        this.tools = [
            this.Button('↶', () => level.cameraStep--),
            this.Button('↷', () => level.cameraStep++),
            this.Button('RAIN', () => level.ToggleWeather()),
            this.Button('?', () => this.help.Toggle()),
        ];
        this.commands = Commands.map((label, index) => this.Button(label, () => level.controls.SelectCommand(index)));
        this.skillNodeButtons = Object.values(SkillTrees).flat().map(skill => ({
            ...this.Button('LEARN', () => level.LearnSkill(skill.id)),
            skill,
        }));
        this.skillChoiceButtons = Object.values(SkillTrees).flat()
            .filter(skill => skill.kind === 'active')
            .map(skill => ({
                ...this.Button(skill.name.toUpperCase(), () => this.FocusOrSelectSkill(skill.id)),
                skill,
            }));
        this.facings = Facings.map((direction, index) => this.Button(direction.name, () => { level.turn.active.stats.facing = index; }));
        this.wait = this.Button('CONFIRM WAIT', () => level.actions.EndTurn());
        this.battlePotion = this.Button('USE POTION', () => level.UseBattlePotion());
        this.begin = this.Button('BEGIN ADVENTURE', () => level.CreateCharacter(this.selectedArchetype, this.nameField.GetText()));
        this.continue = this.Button('CONTINUE', () => level.ContinueGame());
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
            save: this.Button('SAVE ADVENTURE', () => level.SaveGame()),
            companion: this.Button('TOGGLE ORIN', () => level.ToggleCompanion()),
            return: this.Button('RETURN TO EXPLORATION', () => level.ReturnToExplore()),
            close: this.Button('×', () => { this.panel = null; }),
        };
        this.talk = this.Button('', () => level.InteractShopkeeper());
        this.mapZones = WorldMapDisplay('').zones.map((zone, index) =>
            this.Button('', () => { this.mapSelection = index; }));
        this.modeButtons = ControlModes.map(mode => this.Button(mode.toUpperCase(), () => this.SetControlMode(mode)));
        this.customRadial = this.Button('', () => this.SetCustomOption('autoRadial'));
        this.customTarget = this.Button('', () => this.SetCustomOption('smartTarget'));
        this.settingsHelp = this.Button('HELP [H]', () => this.help.Toggle());
        this.nameField = new TextBox(this.screen);
        this.nameField.SetPlaceholder('Character name');
        this.nameField.SetMaxLength(20);
        this.nameField.SetText('Highland Recruit');
        this.nameField.onSubmit = () => this.nameField.SetActive(false);
        this.nameFieldInput = event => this.HandleNameInput(event);
        if (typeof window !== 'undefined') window.addEventListener('keydown', this.nameFieldInput);
    }

    Button(label, run) {
        const button = new Button(this.screen, { pointerInput: true });
        button.OnClick(run);
        const item = { label, button };
        this.buttons.push(item);
        return item;
    }

    HandleNameInput(event) {
        if (!this.nameField.isActive) return false;
        if (event.key === 'Enter') {
            this.nameField.onSubmit?.();
            event.preventDefault();
            return true;
        }
        if (event.key === 'Backspace' || (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey)) {
            this.nameField.HandleInput(event);
            event.preventDefault();
            return true;
        }
        return false;
    }

    TogglePanel(panel) {
        if (panel === 'shop') return this.level.InteractShopkeeper();
        this.panel = this.panel === panel ? null : panel;
        if (this.panel === 'map')
            this.mapSelection = Math.max(0, WorldMapDisplay(this.level.zone.id).zones.findIndex(zone => zone.current));
        if (this.panel === 'skills') this.skillTreeSelection = 0;
        this.panelPointer = null;
    }

    MoveMapSelection(step) {
        this.mapSelection = (this.mapSelection + step + this.mapZones.length) % this.mapZones.length;
    }

    MoveSkillTreeSelection(step) {
        const tree = SkillTrees[this.level.campaign.hero.archetype] ?? [];
        if (tree.length) this.skillTreeSelection = (this.skillTreeSelection + step + tree.length) % tree.length;
    }

    ActivateSkillTreeSelection() {
        const skill = SkillTrees[this.level.campaign.hero.archetype]?.[this.skillTreeSelection];
        if (skill) this.level.LearnSkill(skill.id);
    }

    FocusOrSelectSkill(id) {
        const turn = this.level.turn;
        const skills = ActiveSkills(turn.active.stats.archetype, turn.active.stats.unlockedSkills);
        const index = skills.findIndex(skill => skill.id === id);
        if (index < 0) return;
        turn.skillCursor = index;
        if (this.level.controlSettings?.mode === 'Mobile' && this.skillChoiceFocus !== id) {
            this.skillChoiceFocus = id;
            turn.message = 'Tap again to choose this skill.';
            return;
        }
        this.level.controls.SelectSkill(id);
    }

    UpdateSkillChoiceHover(pointer, choices, y, buttonWidth, gap) {
        if (this.skillChoicePointer && pointer.x === this.skillChoicePointer.x && pointer.y === this.skillChoicePointer.y) return;
        const index = choices.findIndex((skill, i) => pointer.x >= 15 + i * (buttonWidth + gap)
            && pointer.x <= 15 + i * (buttonWidth + gap) + buttonWidth && pointer.y >= y + 53 && pointer.y <= y + 87);
        if (index >= 0) this.level.turn.skillCursor = index;
        this.skillChoicePointer = { x: pointer.x, y: pointer.y };
    }

    ToggleRing() {
        if (this.level.exploring !== 'battle' || this.level.turn.phase !== 'command') return;
        this.ringOpen = !this.ringOpen;
        if (this.ringOpen) this.ringSelected = this.level.turn.command ?? 0;
    }

    SetControlMode(mode) {
        this.level.SetControlSettings(ControlSettings(mode, this.level.controlSettings));
        this.settingsSelection = ControlModes.indexOf(mode);
        this.ringOpen = false;
        this.wasBattleCommand = false;
    }

    SetCustomOption(option) {
        const settings = this.level.controlSettings;
        if (settings.mode !== 'Personalizado') return;
        this.level.SetControlSettings(ControlSettings('Personalizado', { ...settings, [option]: !settings[option] }));
        this.settingsSelection = option === 'autoRadial' ? 4 : 5;
    }

    MoveSettingsSelection(step) {
        const count = this.level.controlSettings.mode === 'Personalizado' ? 7 : 5;
        this.settingsSelection = (this.settingsSelection + step + count) % count;
    }

    ActivateSettingsSelection() {
        const selection = this.settingsSelection;
        if (selection < ControlModes.length) this.SetControlMode(ControlModes[selection]);
        else if (this.level.controlSettings.mode === 'Personalizado' && selection < 6)
            this.SetCustomOption(selection === 4 ? 'autoRadial' : 'smartTarget');
        else this.help.Toggle();
    }

    CloseRing() {
        this.ringOpen = false;
    }

    Update(dt) {
        if (this.level.exploring === 'creation' && this.nameField?.Click?.())
            this.level.controls?.SuppressNextWorldClick();
        const command = this.level.exploring === 'battle' && this.level.turn.phase === 'command';
        if (this.level.turn.phase !== 'skill-select') {
            this.skillChoiceFocus = null;
            this.skillChoicePointer = null;
        }
        if (!command) {
            this.ringOpen = false;
            this.ringProgress = 0;
            this.ringLayout = null;
            this.ringPointer = null;
        }
        else if (!this.wasBattleCommand) {
            this.ringOpen = this.level.controlSettings?.autoRadial ?? true;
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
        this.level.controls.SelectCommand(index);
    }

    CommandAvailable(index) {
        return this.level.exploring === 'battle'
            && CommandAvailable(this.level.turn, this.level.player, this.level.campaign, index);
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
        this.headerHeight = narrow ? (l.exploring === 'battle' ? 214 : 260) : 142;
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
        this.DrawExplorationBar(layout);
    }

    DrawVendorPrompt(vendor) {
        const { level: l, screen: s, frame: f } = this;
        const position = vendor.travel.position;
        const point = l.camera.Project(new Vector3D(position.x, position.y + 1.5, position.z), s.Width, s.Height);
        const width = 72, height = 28, x = point.x - width / 2, y = point.y - height;
        const bottom = ExplorationBarLayout(s.Width, s.Height)[0].y - 31;
        if (!point.visible || !Number.isFinite(x) || !Number.isFinite(y)
            || x < 0 || x + width > s.Width || y < this.headerHeight || y + height > bottom) return;
        this.Place(this.talk, x, y, width, height);
        const c = s.Context;
        c.save();
        c.strokeStyle = f.theme.gold;
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(x + 9, y + 8); c.lineTo(x + 21, y + 8); c.lineTo(x + 21, y + 17);
        c.lineTo(x + 16, y + 17); c.lineTo(x + 12, y + 20); c.lineTo(x + 12, y + 17);
        c.lineTo(x + 9, y + 17); c.closePath(); c.stroke();
        c.restore();
        f.Text('Talk', x + 47, y + 19, { size: 11, align: 'center', weight: 700, color: f.theme.gold });
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
        const { level: l, screen: s } = this;
        const route = l.exploreRoute;
        if (!route?.path.length) return;
        const tile = l.grid.Get(route.destination.col, route.destination.row);
        if (!tile) return;
        const world = l.terrain.World(tile);
        const point = l.camera.Project(new Vector3D(world.x, world.y + 0.06, world.z), s.Width, s.Height);
        if (!point.visible || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
        const c = s.Context;
        c.save();
        c.beginPath();
        c.moveTo(point.x, point.y - 5);
        c.lineTo(point.x - 8, point.y - 17);
        c.lineTo(point.x - 4, point.y - 17);
        c.lineTo(point.x - 4, point.y - 26);
        c.lineTo(point.x + 4, point.y - 26);
        c.lineTo(point.x + 4, point.y - 17);
        c.lineTo(point.x + 8, point.y - 17);
        c.closePath();
        c.fillStyle = '#f9cb5b';
        c.strokeStyle = '#172027';
        c.lineWidth = 2;
        c.fill();
        c.stroke();
        c.restore();
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
            inspected.stats.poison > 0 ? 'POISON' : null,
            inspected.stats.shield > 0 ? `SHIELD ${inspected.stats.shield}` : null,
            inspected.stats.haste > 0 ? 'HASTE' : null,
            inspected.stats.stunned > 0 ? 'STUN' : null,
            inspected.stats.exposed > 0 ? 'EXPOSED' : null,
            inspected.stats.slowed > 0 ? 'SLOW' : null,
            inspected.stats.guarded ? 'GUARD' : null,
        ].filter(Boolean).join('/') : '';
        const inspection = inspected
            ? `${inspected.stats.name} · ${inspected.stats.role ?? inspected.stats.team} · Lv ${inspected.stats.level ?? 1} · HP ${inspected.stats.hp}/${inspected.stats.maxHp} · EN ${inspected.stats.energy ?? 0}/${inspected.stats.energyMax ?? 2}${statuses ? ` · ${statuses}` : ''}${preview ? preview.heal !== undefined ? ` · +${preview.heal} HP` : preview.shield !== undefined ? ` · ${preview.shield} SHIELD` : preview.haste !== undefined ? ` · HASTE ${preview.haste} turns` : ` · ${preview.chance}% / ${preview.damage} dmg` : ''} · ${GetAbilityProfile(inspected.stats, inspected.stats.basicAbility).name}`
            : null;
        const gap = 5, buttonWidth = Math.max(54, (width - 20 - gap * (this.commands.length - 1)) / this.commands.length);
        if (t.phase === 'skill-select') {
            const pointer = Touch.ToScreen(Input.instance.mouse.position, s);
            this.UpdateSkillChoiceHover(pointer, ActiveSkills(t.active?.stats.archetype, t.active?.stats.unlockedSkills), y, buttonWidth, gap);
        }
        const selectedSkill = t.phase === 'skill-select' && t.active
            ? ActiveSkills(t.active.stats.archetype, t.active.stats.unlockedSkills)[t.skillCursor ?? 0]
            : null;
        const skillHint = selectedSkill
            ? `${selectedSkill.name} · ${GetAbilityProfile(t.active.stats, selectedSkill.id).energy} EN · ${selectedSkill.description} · Preview: nearest valid target`
            : null;
        f.Text(skillHint ?? inspection ?? (tile ? `Tile ${tile.col},${tile.row} · H ${tile.h} · ${t.message}` : t.message), 21, y + 40, {
            size: 10, color: f.theme.gold, maxWidth: width - 22,
        });
        if (inspected && !this.ringOpen) this.DrawBattleInspection(inspected, preview, statuses);
        if (t.phase === 'skill-select') {
            const choices = ActiveSkills(t.active?.stats.archetype, t.active?.stats.unlockedSkills);
            choices.forEach((skill, index) => {
                const item = this.skillChoiceButtons.find(entry => entry.skill.id === skill.id);
                if (item) this.Place(item, 15 + index * (buttonWidth + gap), y + 53, buttonWidth, 34, true, t.skillCursor === index);
            });
        }
        else if (t.phase === 'item')
            this.Place(this.battlePotion, 15, y + 53, Math.min(150, width - 20), 34, true);
        else if (t.phase === 'command') {
            this.Place(this.menuTrigger, 15, y + 53, Math.min(150, width - 20), 34, true, this.ringOpen);
            if (l.controlSettings?.mode === 'PC' || l.controlSettings?.mode === 'Personalizado')
                f.Text('1 MOVE · 2 ATTACK · 3 SKILL · 4 ITEM · 5 WAIT · 6–9 SKILLS',
                    175, y + 74, { size: 9, color: f.theme.gold, maxWidth: width - 185 });
        }
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
            if (feedback.effect && feedback.life > 1.1) {
                const context = s.Context;
                context.save();
                context.globalAlpha = Math.min(1, (feedback.life - 1.1) / 0.6);
                context.strokeStyle = { shield: '#84caff', haste: '#f5dc82', poison: '#96dd75', magic: '#bb9cff', heal: '#87ebc0', hit: '#ffac72' }[feedback.effect];
                context.lineWidth = 3;
                context.beginPath();
                context.arc(projected.x, projected.y, 12 + (1.7 - feedback.life) * 32, 0, Math.PI * 2);
                context.stroke();
                context.restore();
            }
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
        f.Panel({ x, y, width, height: 106 });
        f.Text(`${stats.name} · Lv ${stats.level ?? 1} · ${(stats.role ?? stats.team).toUpperCase()}`, x + 10, y + 18, { size: 10, weight: 700, color: f.theme.gold, maxWidth: width - 20 });
        f.Text(`HP ${stats.hp}/${stats.maxHp} · EN ${stats.energy ?? 0}/${stats.energyMax ?? 2}${statuses ? ` · ${statuses}` : ''}`, x + 10, y + 36, { size: 10, maxWidth: width - 20 });
        const ability = GetAbilityProfile(stats, stats.basicAbility);
        f.Text(`${ability.name} · range ${ability.range} · ${ability.energy} EN`, x + 10, y + 54, { size: 10, maxWidth: width - 20 });
        const detail = preview ? preview.heal !== undefined ? `Heal +${preview.heal} HP` : preview.shield !== undefined ? `Shield ${preview.shield} damage` : preview.haste !== undefined ? `Haste ${preview.haste} turns` : `${preview.chance}% hit · ${preview.damage} damage${preview.blocked ? ` · ${preview.blocked} blocked` : ''}`
            : `ATK ${stats.attack} · MAG ${stats.magic ?? stats.attack} · DEF ${stats.defense}`;
        f.Text(detail, x + 10, y + 72, { size: 10, maxWidth: width - 20 });
        const behavior = { bruiser: 'Closes distance; bash pushes; guards if idle.', flanker: 'Seeks a flank; retreats after striking.', caster: 'Targets groups; retreats after casting.' }[stats.role];
        if (behavior) f.Text(behavior, x + 10, y + 90, { size: 9, color: f.theme.muted, maxWidth: width - 20 });
    }

    DrawCharacterCreation() {
        const { level: l, screen: s, frame: f } = this;
        const width = Math.min(500, s.Width - 28), x = (s.Width - width) / 2, y = Math.max(120, (s.Height - 312) / 2);
        const context = s.Context;
        context.save(); context.fillStyle = 'rgba(5,12,17,.42)'; context.fillRect(0, 0, s.Width, s.Height); context.restore();
        f.Panel({ x, y, width, height: 300 });
        f.Text('BEGIN YOUR HIGHLAND JOURNEY', s.Width / 2, y + 35, { size: 19, align: 'center', weight: 700, color: f.theme.gold, maxWidth: width - 24 });
        f.Text(l.turn.message.startsWith('Continue failed:') ? l.turn.message : 'Name your hero and choose a calling.', s.Width / 2, y + 59, { size: 12, align: 'center', maxWidth: width - 24 });
        this.nameField.SetBox(new Rectangle(x + 24, y + 76, width - 48, 36));
        this.nameField.DrawCursor();
        const gap = 6, classWidth = (width - 32 - gap) / 2;
        const archetypes = ['vanguard', 'ranger', 'arcanist', 'cleric'];
        this.classButtons.forEach((item, index) => this.Place(item, x + 16 + (index % 2) * (classWidth + gap), y + 125 + Math.floor(index / 2) * 28, classWidth, 24, true, this.selectedArchetype === archetypes[index]));
        const callings = [
            'Vanguard · 48 HP · 14 ATK · 5 DEF',
            'Ranger · 40 HP · 13 ATK · 3 DEF',
            'Arcanist · 36 HP · 16 MAG · 2 DEF',
            'Cleric · 42 HP · 13 MAG · 4 DEF',
        ];
        const index = archetypes.indexOf(this.selectedArchetype);
        f.Text(callings[index], s.Width / 2, y + 198, { size: 12, align: 'center' });
        this.Place(this.begin, x + 16, y + 226, (width - 38) / 2, 48, true);
        this.Place(this.continue, x + 22 + (width - 38) / 2, y + 226, (width - 38) / 2, 48, true);
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

    SelectBagCategory(category) {
        this.inventoryCategory = category;
        this.selectedBagIndex = 0;
    }

    CycleBagCategory(step) {
        const categories = this.bagCategories.map(entry => entry.category);
        const index = categories.indexOf(this.inventoryCategory);
        this.SelectBagCategory(categories[(index + step + categories.length) % categories.length]);
    }

    MoveBagSelection(direction) {
        const count = this.BagItems().length;
        if (!count) return;
        const current = Math.min(this.selectedBagIndex, count - 1);
        const step = { UP: -5, RIGHT: 1, DOWN: 5, LEFT: -1 }[direction];
        if (step === undefined) return;
        this.selectedBagIndex = Math.max(0, Math.min(count - 1, current + step));
    }

    ActivateBagItem() {
        const item = this.SelectedBagItem();
        if (!item) {
            this.level.turn.message = 'Select an item first.';
            return false;
        }
        if (item.name === 'Potion') return this.level.UseItem(item.name);
        const slot = EquipmentSlot(item.name);
        if (!slot || !(this.level.campaign.inventory[item.name] > 0) || this.level.campaign.equipment[slot] === item.name) {
            this.level.turn.message = 'That item is already equipped.';
            return false;
        }
        return this.level.EquipItem(item.name);
    }

    PointerMoved(point) {
        const moved = !this.panelPointer || this.panelPointer.x !== point.x || this.panelPointer.y !== point.y;
        this.panelPointer = { x: point.x, y: point.y };
        return moved;
    }

    SelectShopTab(tab) {
        this.shopTab = tab;
        this.shopPage = 0;
        this.shopSelection = 0;
    }

    SelectShopPage(page) {
        const count = this.ShopOffers().length;
        this.shopPage = Math.max(0, Math.min(Math.max(0, Math.ceil(count / 2) - 1), page));
        this.shopSelection = this.shopPage * 2;
    }

    MoveShopSelection(step) {
        const count = this.ShopOffers().length;
        if (!count) return;
        this.shopSelection = Math.max(0, Math.min(count - 1, this.shopSelection + step));
        this.shopPage = Math.floor(this.shopSelection / 2);
    }

    ShopOffers() {
        const { campaign, activeVendor } = this.level;
        const specialty = activeVendor?.stats.specialty;
        if (this.shopTab === 'sell') {
            if (specialty === 'consumable')
                return (campaign.inventory.Potion ?? 0) > 0
                    ? [{ name: 'Potion', slot: 'potion', source: 'bag', price: 5, button: this.panelButtons.potionSell }] : [];
            if (specialty !== 'weapon' && specialty !== 'armor') return [];
            const equipped = this.sellSlots.filter(entry => {
                const name = campaign.equipment[entry.slot];
                return (entry.slot === 'weapon' ? 'weapon' : 'armor') === specialty
                    && (EquipmentStats(name)?.price ?? 0) > 0;
            }).map(entry => ({ ...entry, name: campaign.equipment[entry.slot], source: 'equipped' }));
            const bag = this.sellInventory.filter(entry => (campaign.inventory[entry.name] ?? 0) > 0
                && EquipmentStats(entry.name).price > 0
                && (EquipmentSlot(entry.name) === 'weapon' ? 'weapon' : 'armor') === specialty)
                .map(entry => ({ ...entry, slot: EquipmentSlot(entry.name), source: 'bag' }));
            return [...equipped, ...bag].map(offer => ({ ...offer, price: Math.floor(EquipmentStats(offer.name).price / 2) }));
        }
        if (specialty === 'weapon') return [
            { name: 'Highland Edge', button: this.panelButtons.buyBlade, slot: 'weapon' },
            { name: 'Runed Staff', button: this.panelButtons.buyStaff, slot: 'weapon' },
        ].map(offer => ({ ...offer, price: EquipmentStats(offer.name).price }));
        if (specialty === 'armor') return [
            { name: 'Ranger Leathers', button: this.panelButtons.buyLeathers, slot: 'armor' },
            { name: 'Iron Kilt', button: this.panelButtons.buyKilt, slot: 'armor' },
            ...this.extraStock.map(entry => ({ ...entry, slot: EquipmentSlot(entry.name) })),
        ].map(offer => ({ ...offer, price: EquipmentStats(offer.name).price }));
        if (specialty === 'consumable') return [{ name: 'Potion', button: this.panelButtons.buyPotion, slot: 'potion', price: 15 }];
        return [];
    }

    ActivateShopOffer() {
        const offer = this.ShopOffers()[this.shopSelection];
        if (!offer) {
            if (this.shopTab === 'buy' && this.level.activeVendor?.stats.specialty === 'rest') this.level.Rest();
            else this.level.turn.message = 'There is nothing to trade here.';
            return;
        }
        if (this.shopTab === 'buy') this.level.Buy(offer.name, offer.slot);
        else if (offer.slot === 'potion') this.level.SellPotion();
        else if (offer.source === 'equipped') this.level.SellEquipment(offer.slot);
        else this.level.SellOwned(offer.name);
        const count = this.ShopOffers().length;
        this.shopSelection = Math.max(0, Math.min(this.shopSelection, count - 1));
        this.shopPage = Math.floor(this.shopSelection / 2);
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
        else if (icon === 'blade') {
            c.moveTo(x + 6, y - 8); c.lineTo(x + 1, y + 3); c.lineTo(x - 2, y + 6);
            c.stroke(); c.beginPath(); c.moveTo(x - 6, y + 2); c.lineTo(x + 2, y + 4); c.stroke();
        }
        else if (icon === 'staff') {
            c.moveTo(x - 4, y + 8); c.lineTo(x + 4, y - 5); c.stroke();
            c.beginPath(); c.arc(x + 4, y - 6, 3, 0, Math.PI * 2); c.fill(); c.stroke();
        }
        else if (icon === 'ring') {
            c.arc(x, y + 2, 5, 0, Math.PI * 2); c.stroke();
            c.beginPath(); c.moveTo(x - 3, y - 4); c.lineTo(x, y - 8); c.lineTo(x + 3, y - 4); c.closePath(); c.fill(); c.stroke();
        }
        else if (icon === 'belt') {
            c.rect(x - 8, y - 3, 16, 6); c.fill(); c.stroke();
            c.beginPath(); c.rect(x - 2, y - 3, 4, 6); c.stroke();
        }
        else if (icon === 'boots') {
            c.moveTo(x - 5, y - 8); c.lineTo(x + 2, y - 8); c.lineTo(x + 2, y + 2);
            c.lineTo(x + 7, y + 4); c.lineTo(x + 7, y + 7); c.lineTo(x - 5, y + 7); c.closePath(); c.fill(); c.stroke();
        }
        else if (icon === 'gloves') {
            c.moveTo(x - 5, y + 8); c.lineTo(x - 6, y - 3); c.lineTo(x - 3, y - 3);
            c.lineTo(x - 3, y - 8); c.lineTo(x + 3, y - 8); c.lineTo(x + 4, y - 2);
            c.lineTo(x + 7, y - 3); c.lineTo(x + 5, y + 4); c.lineTo(x + 3, y + 8); c.closePath(); c.fill(); c.stroke();
        }
        else if (icon === 'helm') {
            c.moveTo(x - 7, y + 6); c.lineTo(x - 7, y - 3); c.lineTo(x - 4, y - 8);
            c.lineTo(x + 4, y - 8); c.lineTo(x + 7, y - 3); c.lineTo(x + 7, y + 6);
            c.lineTo(x + 3, y + 6); c.lineTo(x + 3, y); c.lineTo(x - 3, y);
            c.lineTo(x - 3, y + 6); c.closePath(); c.fill(); c.stroke();
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
        if (this.PointerMoved(pointer) && hoverIndex >= 0 && items[hoverIndex]) this.selectedBagIndex = hoverIndex;
        this.selectedBagIndex = Math.max(0, Math.min(this.selectedBagIndex, items.length - 1));
        const selectedIndex = this.selectedBagIndex;
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
        if (info) f.Text(`${info.category} · ${info.rarity.toUpperCase()} · ${this.ItemModifiers(selected.name)}`, x + 12, y + 97, {
            size: 9, color: f.theme.muted, maxWidth: width - 24,
        });
        const buttonY = gridY + 6 * (slotHeight + 2) + 2;
        this.Place(this.panelButtons.equipItem, x + 12, buttonY, (inner - 4) / 2, 24,
            Boolean(selected && (this.level.campaign.inventory[selected.name] ?? 0) > 0 && EquipmentSlot(selected.name)
                && this.level.campaign.equipment[EquipmentSlot(selected.name)] !== selected.name));
        this.Place(this.panelButtons.useItem, x + 16 + (inner - 4) / 2, buttonY, (inner - 4) / 2, 24,
            selected?.name === 'Potion');
        if (selected) {
            const action = selected.name === 'Potion' ? 'Enter: Use'
                : this.level.campaign.equipment[EquipmentSlot(selected.name)] === selected.name ? 'Equipped'
                    : 'Enter: Equip';
            this.DrawItemHint(selected.name, selected.count, action, x, y, width, 278);
        }
    }

    DrawItemHint(name, owned, action, x, y, width, panelHeight) {
        const { frame: f, screen: s } = this, info = ItemInfo[name];
        if (!info) return;
        const layout = ItemHintLayout(s, { x, y, width, height: panelHeight }, this.headerHeight);
        if (!layout) return;
        const { x: hintX, y: hintY, width: hintWidth } = layout;
        f.Panel(layout);
        this.DrawBagIcon({ name }, { x: hintX + 8, y: hintY + 9, width: 28, height: 28 });
        f.Text(`${name} · ${info.rarity.toUpperCase()}`, hintX + 42, hintY + 22, { size: 10, weight: 700, color: f.theme.gold, maxWidth: hintWidth - 50 });
        f.Text(`${info.category} · Owned ${owned} · ${action}`, hintX + 10, hintY + 48, { size: 9, maxWidth: hintWidth - 20 });
        f.Text(info.description, hintX + 10, hintY + 65, { size: 9, maxWidth: hintWidth - 20 });
        f.Text(this.ItemModifiers(name), hintX + 10, hintY + 82, { size: 9, maxWidth: hintWidth - 20 });
        if (name !== 'Potion') f.Text(`vs equipped: ${this.GearComparison(name)}`, hintX + 10, hintY + 101, { size: 9, color: f.theme.gold, maxWidth: hintWidth - 20 });
    }

    GearComparison(name) {
        const slot = EquipmentSlot(name), next = EquipmentStats(name);
        if (!slot || !next) return 'Not equipment';
        const current = EquipmentStats(this.level.campaign.equipment[slot]) ?? {};
        const labels = [['attack', 'ATK'], ['magic', 'MAG'], ['defense', 'DEF'], ['speed', 'SPD'], ['hp', 'HP'], ['energy', 'EN']];
        const changes = labels.map(([key, label]) => {
            const delta = (next[key] ?? 0) - (current[key] ?? 0);
            return delta ? `${label} ${delta > 0 ? '+' : ''}${delta}` : null;
        }).filter(Boolean);
        return changes.join(' · ') || 'No stat change';
    }

    ItemModifiers(name) {
        const item = EquipmentStats(name);
        if (!item) return name === 'Potion' ? '+24 HP' : 'No bonuses';
        const stats = [['attack', 'ATK'], ['magic', 'MAG'], ['defense', 'DEF'], ['speed', 'SPD'], ['hp', 'HP'], ['energy', 'EN']];
        return stats.filter(([key]) => item[key]).map(([key, label]) => `${label} +${item[key]}`).join(' · ') || 'No bonuses';
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
            f.Text(item.slotLabel, rect.x + rect.width / 2, rect.y + 11, {
                size: 9, align: 'center', weight: 700,
                color: this.selectedGearSlot === rect.slot ? f.theme.gold : f.theme.text, maxWidth: rect.width - 8,
            });
            f.Text(l.campaign.equipment[rect.slot] ?? 'Empty', rect.x + rect.width / 2, rect.y + 23, {
                size: 9, align: 'center', maxWidth: rect.width - 8,
            });
        }
        const slot = EquipmentSlots.find(entry => entry.id === this.selectedGearSlot);
        const equipped = l.campaign.equipment[slot.id];
        const candidates = this.GearCandidates();
        this.selectedGearIndex = Math.min(this.selectedGearIndex, Math.max(0, candidates.length - 1));
        const alternate = candidates[this.selectedGearIndex];
        f.Text(`ATK ${hero.attack} · MAG ${hero.magic} · DEF ${hero.defense} · SPD ${hero.speed} · HP ${hero.maxHp} · EN ${hero.energyMax}`, x + 12, y + 179, { size: 9, maxWidth: width - 24 });
        f.Text(`${slot.label}: ${equipped ?? 'Empty'}`, x + 12, y + 193, { size: 10, weight: 700, color: f.theme.gold, maxWidth: width - 24 });
        f.Text(alternate ? `${alternate} · ${this.GearComparison(alternate)}` : 'No owned alternatives for this slot.', x + 12, y + 211, { size: 9, maxWidth: width - 24 });
        this.Place(this.gearPrevious, x + 12, y + 227, 34, 28, candidates.length > 1);
        this.Place(this.gearNext, x + 50, y + 227, 34, 28, candidates.length > 1);
        this.Place(this.gearEquip, x + 90, y + 227, width - 102, 28, Boolean(alternate));
    }

    DrawWorldMap(x, y, width, height, hero) {
        const { frame: f, screen: s, level: l } = this;
        const map = WorldMapDisplay(l.zone.id, l.campaign.clearedZones);
        const c = s.Context;
        const left = x + 12, top = y + 39, mapWidth = width - 24, mapHeight = height - 122;
        const positions = map.zones.map((zone, index) => ({
            x: left + mapWidth * zone.position.x,
            y: top + mapHeight * [0.64, 0.39, 0.55][index],
        }));
        c.save();
        c.fillStyle = '#273d37';
        c.fillRect(left, top, mapWidth, mapHeight);
        c.beginPath();
        c.moveTo(left, top + mapHeight * 0.62);
        c.lineTo(left + mapWidth * 0.36, top + mapHeight * 0.27);
        c.lineTo(left + mapWidth * 0.67, top + mapHeight * 0.55);
        c.lineTo(left + mapWidth, top + mapHeight * 0.26);
        c.lineTo(left + mapWidth, top + mapHeight);
        c.lineTo(left, top + mapHeight); c.closePath();
        c.fillStyle = '#51654b'; c.fill();
        c.beginPath();
        c.moveTo(left + mapWidth * 0.48, top);
        c.lineTo(left + mapWidth, top);
        c.lineTo(left + mapWidth, top + mapHeight);
        c.lineTo(left + mapWidth * 0.72, top + mapHeight);
        c.closePath(); c.fillStyle = '#575247'; c.fill();
        c.strokeStyle = 'rgba(213, 227, 197, .13)'; c.lineWidth = 1;
        for (let i = 1; i < 6; i++) {
            c.beginPath(); c.moveTo(left + mapWidth * i / 6, top); c.lineTo(left + mapWidth * i / 6, top + mapHeight); c.stroke();
        }
        for (let i = 1; i < 4; i++) {
            c.beginPath(); c.moveTo(left, top + mapHeight * i / 4); c.lineTo(left + mapWidth, top + mapHeight * i / 4); c.stroke();
        }
        c.strokeStyle = '#89a99b'; c.lineWidth = 3;
        c.beginPath(); c.moveTo(left + mapWidth * 0.12, top);
        c.bezierCurveTo(left + mapWidth * 0.28, top + mapHeight * 0.3, left + mapWidth * 0.08, top + mapHeight * 0.65,
            left + mapWidth * 0.22, top + mapHeight); c.stroke();
        for (const [tx, ty] of [[0.08, 0.35], [0.24, 0.22], [0.34, 0.75], [0.43, 0.12], [0.56, 0.77]]) {
            const px = left + mapWidth * tx, py = top + mapHeight * ty;
            c.beginPath(); c.moveTo(px, py - 9); c.lineTo(px - 6, py + 4); c.lineTo(px + 6, py + 4); c.closePath();
            c.fillStyle = '#203b31'; c.fill(); c.strokeStyle = '#91aa81'; c.lineWidth = 1; c.stroke();
        }
        for (const [mx, my] of [[0.68, 0.18], [0.82, 0.28], [0.9, 0.73]]) {
            const px = left + mapWidth * mx, py = top + mapHeight * my;
            c.beginPath(); c.moveTo(px - 12, py + 8); c.lineTo(px, py - 12); c.lineTo(px + 12, py + 8);
            c.closePath(); c.fillStyle = '#827c6b'; c.fill(); c.strokeStyle = '#d7cba8'; c.stroke();
        }
        c.lineWidth = 3;
        for (const route of map.routes) {
            const from = positions[map.zones.findIndex(zone => zone.id === route.from)];
            const to = positions[map.zones.findIndex(zone => zone.id === route.to)];
            c.beginPath(); c.moveTo(from.x, from.y); c.lineTo(to.x, to.y);
            c.strokeStyle = route.open ? '#dfc483' : '#8b8374';
            c.setLineDash(route.open ? [] : [5, 4]); c.stroke();
        }
        c.setLineDash([]);
        map.zones.forEach((zone, index) => {
            const { x: px, y: py } = positions[index];
            const selected = index === this.mapSelection;
            const button = this.mapZones[index].button;
            button.enabled = true;
            button.SetButton(new Rectangle(px - 25, py - 23, 50, 46));
            c.beginPath(); c.arc(px, py, selected ? 19 : 16, 0, Math.PI * 2);
            c.fillStyle = zone.current ? '#dbbc6e' : '#263932';
            c.strokeStyle = selected ? '#fff1bb' : '#d2c292'; c.lineWidth = selected ? 3 : 1;
            c.fill(); c.stroke();
            c.strokeStyle = zone.current ? '#263932' : '#e5d6a5'; c.lineWidth = 2;
            c.beginPath();
            if (index === 0) {
                c.moveTo(px - 8, py + 7); c.lineTo(px - 8, py - 3); c.lineTo(px, py - 9);
                c.lineTo(px + 8, py - 3); c.lineTo(px + 8, py + 7); c.closePath();
            } else if (index === 1) {
                c.moveTo(px - 10, py + 7); c.lineTo(px - 3, py - 8); c.lineTo(px + 2, py + 1);
                c.lineTo(px + 5, py - 4); c.lineTo(px + 11, py + 7); c.closePath();
            } else {
                c.moveTo(px - 7, py + 8); c.lineTo(px - 7, py - 8); c.lineTo(px - 3, py - 8);
                c.lineTo(px - 3, py - 4); c.lineTo(px + 3, py - 4); c.lineTo(px + 3, py - 8);
                c.lineTo(px + 7, py - 8); c.lineTo(px + 7, py + 8); c.closePath();
            }
            c.stroke();
            f.Text(zone.name, px, py + 30, {
                size: 9, align: 'center', weight: 700, color: '#fff3d4', maxWidth: mapWidth / 3,
            });
        });
        c.restore();
        const selected = map.zones[this.mapSelection];
        const locked = selected.id === 'ashen-ridge' && !map.routes.find(route => route.to === selected.id)?.open;
        f.Text(`${selected.name}${selected.current ? ' · YOU ARE HERE' : selected.cleared ? ' · CLEARED' : ''}`,
            x + 14, y + height - 61, { size: 11, weight: 700, color: f.theme.gold, maxWidth: width - 28 });
        f.Text(locked ? 'Road locked: clear the Mistfell patrol.' : 'Follow the roads to travel between regions.',
            x + 14, y + height - 43, { size: 9, maxWidth: width - 28 });
        f.Text(`Select a region · arrows / tap   |   Current tile ${hero.col + 1}, ${hero.row + 1}`, x + 14, y + height - 22, {
            size: 9, maxWidth: width - 28,
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
        const hero = l.campaign.hero, panel = this.panel;
        const width = Math.min(panel === 'map' ? 680 : 300, s.Width - 20);
        const x = panel === 'map' ? (s.Width - width) / 2 : 10, y = this.headerHeight + 16;
        const heading = { hero: 'CHARACTER', bag: 'INVENTORY', gear: 'EQUIPMENT', skills: 'CLASS SKILL TREE', map: 'WORLD MAP', party: 'PARTY ROSTER', shop: 'HEARTHVALE VENDORS', settings: 'CONTROL & HUD MODE' }[panel];
        const height = panel === 'shop' ? 276
            : panel === 'settings' ? 228
            : panel === 'skills' ? 242
                : panel === 'gear' ? 268
                : panel === 'bag' ? (width < 400 ? 278 : 310)
                    : panel === 'map' ? Math.min(410, Math.max(246, ExplorationBarLayout(s.Width, s.Height)[0].y - y - 10))
                    : 190;
        f.Panel({ x, y, width, height });
        f.Text(heading, x + 14, y + 23, { size: 14, weight: 700, color: f.theme.gold });
        this.Place(this.panelButtons.close, x + width - 38, y + 7, 28, 28, true);
        if (panel === 'settings') {
            const settings = l.controlSettings;
            const buttonWidth = (width - 28) / 2;
            this.modeButtons.forEach((item, index) => this.Place(item,
                x + 12 + (index % 2) * (buttonWidth + 4), y + 36 + Math.floor(index / 2) * 32,
                buttonWidth, 28, true, settings.mode === ControlModes[index] || this.settingsSelection === index));
            this.customRadial.label = `AUTO RADIAL: ${settings.autoRadial ? 'ON' : 'OFF'}`;
            this.customTarget.label = `SMART TARGET: ${settings.smartTarget ? 'ON' : 'OFF'}`;
            this.Place(this.customRadial, x + 12, y + 105, width - 24, 28, settings.mode === 'Personalizado', this.settingsSelection === 4);
            this.Place(this.customTarget, x + 12, y + 137, width - 24, 28, settings.mode === 'Personalizado', this.settingsSelection === 5);
            if (settings.mode !== 'Personalizado')
                f.Text(`Auto radial ${settings.autoRadial ? 'ON' : 'OFF'} · Smart target ON`, x + 14, y + 126, { size: 10 });
            this.Place(this.settingsHelp, x + 12, y + 180, width - 24, 30, true,
                this.settingsSelection === (settings.mode === 'Personalizado' ? 6 : 4));
        }
        else if (panel === 'hero') {
            f.Text(`${hero.className} · Level ${hero.level}`, x + 14, y + 48, { size: 12 });
            f.Text(`HP ${hero.hp}/${hero.maxHp} · ATK ${hero.attack} · MAG ${hero.magic} · DEF ${hero.defense}`, x + 14, y + 68, { size: 10, maxWidth: width - 28 });
            f.Text(`XP ${hero.xp}/${hero.nextXp} · Speed ${hero.speed}`, x + 14, y + 88, { size: 11 });
            this.Place(this.panelButtons.save, x + 12, y + 102, width - 24, 27, true);
            this.Place(this.panelButtons.rest, x + 12, y + 134, width - 24, 32, l.zone.id === 'hearthvale');
        }
        else if (panel === 'bag') {
            this.DrawBag(x, y, width, hero);
        }
        else if (panel === 'map')
            this.DrawWorldMap(x, y, width, height, hero);
        else if (panel === 'party') {
            const companion = l.battleData.units.filter(unit => unit.team === 'ally')[1];
            const progress = l.campaign.companion, stats = l.campaign.CompanionStats();
            f.Text(`${hero.name} · ${hero.className} · Lv ${hero.level}`, x + 14, y + 52, { size: 11, weight: 700, maxWidth: width - 28 });
            f.Text(`HP ${hero.hp}/${hero.maxHp} · ATK ${hero.attack} · DEF ${hero.defense}`, x + 14, y + 70, { size: 10, maxWidth: width - 28 });
            if (companion) {
                f.Text(`${companion.name} · Lv ${progress.level} · ${l.campaign.companionDeployed ? 'DEPLOYED' : 'RESERVE'}`, x + 14, y + 100, { size: 11, weight: 700, color: f.theme.gold });
                f.Text(`HP ${stats.hp}/${stats.maxHp} · ATK ${stats.attack} · DEF ${stats.defense}`, x + 14, y + 118, { size: 10 });
                f.Text(`XP ${progress.xp}/${60 + (progress.level - 1) * 40} · Enter toggles deployment.`, x + 14, y + 136, { size: 9, maxWidth: width - 28 });
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
                const nodeY = y + 64 + index * 45, c = s.Context;
                c.save();
                c.strokeStyle = learned ? '#80c6a0' : '#9a906b'; c.lineWidth = 2;
                if (index > 0) { c.beginPath(); c.moveTo(x + 22, nodeY - 38); c.lineTo(x + 22, nodeY - 8); c.stroke(); }
                c.beginPath(); c.arc(x + 22, nodeY, 5, 0, Math.PI * 2);
                c.fillStyle = learned ? '#80c6a0' : this.skillTreeSelection === index ? '#f9cb5b' : '#26343a';
                c.fill(); c.stroke(); c.restore();
                f.Text(`${skill.name} · ${skill.kind.toUpperCase()}`, x + 34, y + 69 + index * 45, { size: 10, weight: 700, maxWidth: width - 132 });
                const requirement = skill.requires.map(id => tree.find(node => node.id === id)?.name ?? id).join(', ');
                f.Text(requirement ? `Requires: ${requirement}` : 'Starting skill', x + 34, y + 84 + index * 45, { size: 9, maxWidth: width - 46 });
                if (learned || !ready || l.campaign.skillPoints < 1)
                    f.Text(learned ? 'LEARNED' : ready ? 'NEED 1 SP' : 'LOCKED', x + width - 14, y + 69 + index * 45, {
                        size: 9, align: 'right', color: f.theme.muted,
                    });
                this.Place(item, x + width - 91, y + 52 + index * 45, 78, 28, !learned && ready && l.campaign.skillPoints > 0, this.skillTreeSelection === index);
            });
            if (tree[this.skillTreeSelection])
                f.Text(tree[this.skillTreeSelection].description, x + 14, y + 235, { size: 9, maxWidth: width - 28 });
        }
        else if (panel === 'shop') {
            const vendor = l.activeVendor?.stats;
            const context = s.Context;
            const pointer = Touch.ToScreen(Input.instance.mouse.position, s);
            const pointerMoved = this.PointerMoved(pointer);
            context.save();
            this.DrawVendorPortrait(context, x + 33, y + 63, vendor);
            context.restore();
            f.Text(vendor?.name ?? 'Hearthvale Vendor', x + 60, y + 52, { size: 11, weight: 700, maxWidth: width - 74 });
            f.Text(vendor?.greeting ?? 'Welcome, traveler.', x + 60, y + 68, { size: 9, maxWidth: width - 74 });
            f.Text(`${l.campaign.gold}G`, x + width - 12, y + 89, { size: 10, align: 'right', color: f.theme.gold });
            this.shopTabs.forEach((item, index) =>
                this.Place(item, x + 12 + index * ((width - 28) / 2 + 4), y + 94, (width - 28) / 2, 24, true,
                    this.shopTab === ['buy', 'sell'][index]));
            const offers = this.ShopOffers();
            this.shopSelection = Math.max(0, Math.min(this.shopSelection, offers.length - 1));
            this.shopPage = Math.floor(this.shopSelection / 2);
            if (vendor?.specialty === 'rest' && this.shopTab === 'buy')
                this.Place(this.panelButtons.rest, x + 12, y + 126, width - 24, 30, true);
            else if (!offers.length)
                f.Text(vendor?.specialty === 'rest' ? 'The trainer offers rest, not trade.' : 'No items to trade.', x + 14, y + 146, { size: 10 });
            else {
                offers.slice(this.shopPage * 2, this.shopPage * 2 + 2).forEach((offer, index) => {
                    const itemY = y + 126 + index * 48, absolute = this.shopPage * 2 + index;
                    if (pointerMoved && pointer.x >= x + 12 && pointer.x <= x + width - 12 && pointer.y >= itemY && pointer.y <= itemY + 28)
                        this.shopSelection = absolute;
                    offer.button.label = `${this.shopTab === 'buy' ? 'BUY' : 'SELL'} ${offer.name.toUpperCase()} · ${offer.price}G`;
                    this.Place(offer.button, x + 12, itemY, width - 58, 28, true, this.shopSelection === absolute);
                    this.DrawBagIcon({ name: offer.name }, { x: x + width - 37, y: itemY + 4, width: 22, height: 20 });
                    const owned = l.campaign.BagItems().find(item => item.name === offer.name)?.count ?? 0;
                    const source = offer.source === 'equipped' ? 'EQUIPPED · ' : '';
                    const detail = offer.slot === 'potion' ? '+24 HP per use' : `${this.ItemModifiers(offer.name)} · Δ ${this.GearComparison(offer.name)}`;
                    f.Text(`${source}OWNED ${owned} · ${detail}`, x + 14, itemY + 40, { size: 8, color: f.theme.muted, maxWidth: width - 28 });
                });
                this.DrawShopPages(x, y, width, offers.length);
                const selected = offers[this.shopSelection];
                const owned = l.campaign.BagItems().find(item => item.name === selected.name)?.count ?? 0;
                const description = ItemInfo[selected.name]?.description;
                if (description) f.Text(description, x + 14, y + 271, { size: 9, maxWidth: width - 28 });
                this.DrawItemHint(selected.name, owned, `Enter: ${this.shopTab === 'buy' ? 'Buy' : 'Sell'} ${selected.price}G`, x, y, width, 276);
            }
            f.Text(l.turn.message, x + 14, y + 225, { size: 9, color: f.theme.gold, maxWidth: width - 28 });
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
            if (!l.hud.panel) {
                const nearest = l.NearestVendor();
                for (const vendor of l.vendors ?? []) {
                    if (nearest?.vendor === vendor && nearest.distance <= 1) continue;
                    const position = vendor.travel.position;
                    const projected = l.camera.Project(new Vector3D(position.x, position.y + 1.15, position.z), s.Width, s.Height);
                    if (projected.visible)
                        this.frame.Text(vendor.stats.name.split(' ')[0].toUpperCase(), projected.x, projected.y - 12, {
                            size: 10, align: 'center', weight: 700, color: this.frame.theme.gold,
                        });
                }
                if (nearest?.distance <= 1) this.DrawVendorPrompt(nearest.vendor);
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
        if (typeof window !== 'undefined') window.removeEventListener('keydown', this.nameFieldInput);
        for (const item of this.buttons) item.button.Dispose();
        this.nameField.Dispose();
        this.help.Dispose();
    }
}
