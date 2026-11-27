import { Input, Vector3D } from 'gameforgejs/core';
import { Draw, HUDFrame, InputHelpPanel, Button, Rectangle, TextBox, Touch } from 'gameforgejs/2d';
import { BagFilters, Equipment, EquipmentSlots, EquipmentSlot, EquipmentStats, ItemInfo, SlotFor } from '../data/HighlandCampaign.js';
import { WorldMapDisplay } from '../data/WorldMaps.js';
import { BattleRules, Commands, Facings, GetAbilityProfile } from '../data/BattleRules.js';
import { ActiveSkills, SkillTrees } from '../data/ClassSkills.js';
import { ControlModes, ControlSettings } from '../input/ControlModes.js';
import { BattleConsumables, CommandAvailable } from '../data/HighlandActions.js';
import { CombatDock, DockLayout } from './CombatDock.js';
import { BagColumns, CharacterSheet, CompareStats, SheetLayout } from './CharacterSheet.js';
import { DrawItemIcon } from './ItemIcons.js';

export { DockLayout, SheetLayout };

/** What each vendor stocks: gear by specialty, consumables at the alchemist. */
export const VendorStock = Object.freeze({
    weapon: ['Highland Edge', 'Runed Staff'],
    armor: ['Ranger Leathers', 'Iron Kilt', 'Scout Helm', 'Travel Belt', 'Leather Gloves', 'Trail Boots', 'Oak Shield',
        'Wool Cloak', 'Shadow Cape', 'Amber Amulet', 'Iron Band', 'Focus Ring'],
    consumable: ['Potion', 'Ether', 'Antidote'],
});

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

/** Personalizado toggles, in settings order. */
const CustomOptions = Object.freeze(['autoRadial', 'smartTarget', 'dock', 'largeTargets']);

/** Compact status bars and optional side panels keep the 3D field visible. */
export class TacticalHUD {
    constructor(level) {
        this.level = level;
        this.screen = level.ui.Screen;
        this.frame = new HUDFrame(level.ui.Draw);
        this.help = new InputHelpPanel(new Draw(this.screen), {
            title: 'Highland Tactics / Controls',
            lines: ['Arrows / WASD move across zones and choose battle commands.', 'Click any reachable open tile to walk there; click highlighted tiles in battle.', 'I inventory · E gear · C character · K skills · M map · P party · F vendor · H help', 'Character sheet (E / I): double-click or drag to equip · [ / ] filter · Enter equip/use.', 'Shop: up/down select · left/right buy/sell · Enter trade.', 'PC battle: 1 attack · 2–7 skills · 8–0 items · Space pass turn · click tiles to move or aim · V ring.'],
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
        this.bagCategories = Object.keys(BagFilters).map(category => ({
            ...this.Button(category.toUpperCase(), () => this.SelectBagCategory(category)),
            category,
        }));
        this.stock = Object.values(VendorStock).flat().map(name => ({ name, button: this.Button('', () => level.Buy(name)) }));
        this.sellSlots = EquipmentSlots.map(slot => ({
            slot: slot.id, button: this.Button(`SELL ${slot.label}`, () => level.SellEquipment(slot.id)),
        }));
        this.sellInventory = [...Object.keys(Equipment.weapons), ...Object.keys(Equipment.armor),
            ...Object.keys(ItemInfo).filter(name => ItemInfo[name].sell)].map(name => ({
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
        this.battleItems = BattleConsumables.map(item => ({ ...this.Button(item.toUpperCase(), () => level.actions.UseItem(item)), item }));
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
        this.customDock = this.Button('', () => this.SetCustomOption('dock'));
        this.customLarge = this.Button('', () => this.SetCustomOption('largeTargets'));
        this.dock = new CombatDock(this);
        this.sheet = new CharacterSheet(this);
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
        // E and I open one combined sheet; the other key moves focus between doll and backpack.
        if (['bag', 'gear'].includes(panel) && ['bag', 'gear'].includes(this.panel) && this.panel !== panel) {
            this.panel = panel;
            return;
        }
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
        this.settingsSelection = ControlModes.length + CustomOptions.indexOf(option);
    }

    MoveSettingsSelection(step) {
        const count = ControlModes.length + (this.level.controlSettings.mode === 'Personalizado' ? CustomOptions.length : 0) + 1;
        this.settingsSelection = (this.settingsSelection + step + count) % count;
    }

    ActivateSettingsSelection() {
        const selection = this.settingsSelection, custom = selection - ControlModes.length;
        if (selection < ControlModes.length) this.SetControlMode(ControlModes[selection]);
        else if (this.level.controlSettings.mode === 'Personalizado' && custom < CustomOptions.length)
            this.SetCustomOption(CustomOptions[custom]);
        else this.help.Toggle();
    }

    CloseRing() {
        this.ringOpen = false;
    }

    Update(dt) {
        this.sheet?.Update(dt);
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

    /** Height reserved at the bottom of the screen for battle or exploration controls. */
    BottomInset() {
        const l = this.level;
        if (l.exploring === 'battle' && l.controlSettings?.dock)
            return this.screen.Height - DockLayout(this.screen.Width, this.screen.Height, Boolean(l.controlSettings.largeTargets)).top;
        return 116;
    }

    /** Whether a point is over a HUD panel drawn on top of the battlefield. */
    PointOverHud(point) {
        const rect = this.inspectionRect;
        return Boolean(rect && point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height);
    }

    /** The PC dock's hovered hotbar slot (its range is previewed on the grid), or null. */
    HoveredSlot() {
        return this.level.exploring === 'battle' && this.level.controlSettings?.dock ? this.dock.HoveredSlot() : null;
    }

    StatusText(stats) {
        return [
            stats.burn > 0 ? 'BURN' : null,
            stats.poison > 0 ? 'POISON' : null,
            stats.shield > 0 ? `SHIELD ${stats.shield}` : null,
            stats.haste > 0 ? 'HASTE' : null,
            stats.stunned > 0 ? 'STUN' : null,
            stats.exposed > 0 ? 'EXPOSED' : null,
            stats.slowed > 0 ? 'SLOW' : null,
            stats.guarded ? 'GUARD' : null,
        ].filter(Boolean).join('/');
    }

    BudgetText(stats) {
        return stats.apMax !== undefined ? `AP ${stats.ap ?? stats.apMax}/${stats.apMax} · MP ${stats.mp ?? stats.mpMax}/${stats.mpMax}` : '';
    }

    DrawBattle() {
        const { level: l } = this, t = l.turn;
        this.inspectionRect = null;
        const inspected = l.hoveredPawn ?? (t.phase === 'target' && t.cursor
            ? t.pawns.find(pawn => pawn.stats.col === t.cursor.col && pawn.stats.row === t.cursor.row)
            : null);
        const preview = inspected && t.active && t.phase === 'target' && BattleRules.CanAttack(l.grid, t.active.stats, inspected.stats, t.ability)
            ? BattleRules.Preview(l.grid, t.active.stats, inspected.stats, t.ability)
            : null;
        const statuses = inspected ? this.StatusText(inspected.stats) : '';
        if (l.controlSettings?.dock) this.dock.Draw();
        else this.DrawBattleBar(inspected, preview, statuses);
        if (inspected && !this.ringOpen) this.DrawBattleInspection(inspected, preview, statuses);
        this.DrawBattleOverlays();
    }

    /** The radial-first bottom bar (Console, Mobile): phase buttons, message and turn queue. */
    DrawBattleBar(inspected, preview, statuses) {
        const { level: l, screen: s, frame: f } = this, t = l.turn;
        const y = s.Height - 108, width = s.Width - 20;
        f.Panel({ x: 10, y, width, height: 98 });
        const active = t.active?.stats, tile = t.cursor ? l.grid.Get(t.cursor.col, t.cursor.row) : null;
        const description = active
            ? `${active.name}${active.role ? ` · ${active.role.toUpperCase()}` : ''} · HP ${active.hp}/${active.maxHp} · DEF ${active.defense} · ${this.BudgetText(active)}`
            : `${l.zone.name} patrol · CT advances by speed`;
        f.Text(description, 21, y + 20, { size: 12, weight: 700, maxWidth: width - 22 });
        const inspection = inspected
            ? `${inspected.stats.name} · ${inspected.stats.role ?? inspected.stats.team} · Lv ${inspected.stats.level ?? 1} · HP ${inspected.stats.hp}/${inspected.stats.maxHp}${statuses ? ` · ${statuses}` : ''}${preview ? preview.heal !== undefined ? ` · +${preview.heal} HP` : preview.shield !== undefined ? ` · ${preview.shield} SHIELD` : preview.haste !== undefined ? ` · HASTE ${preview.haste} turns` : ` · ${preview.chance}% / ${preview.damage} dmg` : ''} · ${GetAbilityProfile(inspected.stats, inspected.stats.basicAbility).name}`
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
            ? `${selectedSkill.name} · ${GetAbilityProfile(t.active.stats, selectedSkill.id).ap} AP · ${selectedSkill.description} · Preview: nearest valid target`
            : null;
        f.Text(skillHint ?? inspection ?? (tile ? `Tile ${tile.col},${tile.row} · H ${tile.h} · ${t.message}` : t.message), 21, y + 40, {
            size: 10, color: f.theme.gold, maxWidth: width - 22,
        });
        if (t.phase === 'skill-select') {
            const choices = ActiveSkills(t.active?.stats.archetype, t.active?.stats.unlockedSkills);
            choices.forEach((skill, index) => {
                const item = this.skillChoiceButtons.find(entry => entry.skill.id === skill.id);
                if (item) this.Place(item, 15 + index * (buttonWidth + gap), y + 53, buttonWidth, 34, true, t.skillCursor === index);
            });
        }
        else if (t.phase === 'item') {
            const itemWidth = Math.min(150, (width - 20 - gap * 2) / 3);
            this.battleItems.forEach((entry, index) => {
                entry.label = `${entry.item.toUpperCase()} ×${l.campaign.inventory[entry.item] ?? 0}`;
                this.Place(entry, 15 + index * (itemWidth + gap), y + 53, itemWidth, 34, true);
            });
        }
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
        const queue = this.dock.Order().slice(0, 4);
        queue.forEach((pawn, index) => {
            const cx = 27 + index * Math.min(95, (width - 30) / 4), cy = y - 24, context = s.Context;
            this.DrawUnitPortrait(context, cx, cy, pawn.stats, pawn === t.active);
            f.Text(`${Math.floor(pawn.stats.ct)}`, cx + 17, cy + 3, { size: 8, color: f.theme.gold });
        });
    }

    /** HP bars, the active marker and floating combat text over the battlefield. */
    DrawBattleOverlays() {
        const { level: l, screen: s, frame: f } = this, t = l.turn;
        for (const pawn of t.Alive()) {
            const position = pawn.travel.position;
            const projected = l.camera.Project(new Vector3D(position.x, position.y + 1.25, position.z), s.Width, s.Height);
            if (!projected.visible) continue;
            f.Meter(pawn.stats.hp / pawn.stats.maxHp, { x: projected.x - 18, y: projected.y, width: 36, height: 4 },
                pawn.stats.team === 'ally' ? '#7cddc5' : '#ed9c91');
            if (pawn === t.active)
                f.Text('▼', projected.x, projected.y - 9, { size: 12, align: 'center', color: f.theme.gold });
        }
        for (const feedback of t.feedback) {
            const position = feedback.pawn.travel.position;
            const projected = l.camera.Project(new Vector3D(position.x, position.y + 1.6, position.z), s.Width, s.Height);
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

    DrawUnitPortrait(context, x, y, stats, active, radius = 13) {
        const k = radius / 13;
        context.save();
        context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.clip();
        context.fillStyle = stats.team === 'ally' ? '#365a5b' : '#693e40';
        context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        context.fillStyle = stats.color ?? '#b7c8ca';
        context.beginPath(); context.ellipse(x, y + 13 * k, 10 * k, 9 * k, 0, 0, Math.PI * 2); context.fill();
        context.fillStyle = String(stats.model ?? '').startsWith('skeleton') ? '#e6e1cf' : '#e3b58f';
        context.beginPath(); context.ellipse(x, y - 2 * k, 6 * k, 8 * k, 0, 0, Math.PI * 2); context.fill();
        context.fillStyle = stats.role === 'caster' ? '#a58dc5' : '#37424b';
        context.beginPath(); context.arc(x, y - 6 * k, 7 * k, Math.PI, 0); context.lineTo(x + 7 * k, y - 3 * k); context.lineTo(x - 7 * k, y - 3 * k); context.fill();
        context.restore();
        context.save(); context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2);
        context.strokeStyle = active ? this.frame.theme.gold : '#a8b7b7';
        context.lineWidth = active ? 2 : 1; context.stroke(); context.restore();
    }

    DrawBattleInspection(pawn, preview, statuses) {
        const { frame: f, screen: s } = this, stats = pawn.stats;
        const width = Math.min(250, s.Width - 20), x = s.Width - width - 10, y = this.headerHeight + 8;
        this.inspectionRect = { x, y, width, height: 106 };
        f.Panel({ x, y, width, height: 106 });
        f.Text(`${stats.name} · Lv ${stats.level ?? 1} · ${(stats.role ?? stats.team).toUpperCase()}`, x + 10, y + 18, { size: 10, weight: 700, color: f.theme.gold, maxWidth: width - 20 });
        f.Text(`HP ${stats.hp}/${stats.maxHp} · ${this.BudgetText(stats)}${statuses ? ` · ${statuses}` : ''}`, x + 10, y + 36, { size: 10, maxWidth: width - 20 });
        const ability = GetAbilityProfile(stats, stats.basicAbility);
        f.Text(`${ability.name} · range ${ability.range} · ${ability.ap} AP`, x + 10, y + 54, { size: 10, maxWidth: width - 20 });
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

    /** Backpack contents (not what is worn), narrowed by the active filter. */
    BagItems() {
        const categories = BagFilters[this.inventoryCategory] ?? null;
        return Object.entries(this.level.campaign.inventory)
            .filter(([name, count]) => count > 0 && Object.hasOwn(ItemInfo, name))
            .filter(([name]) => !categories || categories.includes(ItemInfo[name].category))
            .map(([name, count]) => ({ name, count, equipped: false }));
    }

    SelectedBagItem() {
        return this.BagItems()[this.selectedBagIndex] ?? null;
    }

    SelectBagCategory(category) {
        if (!Object.hasOwn(BagFilters, category)) return;
        this.inventoryCategory = category;
        this.selectedBagIndex = 0;
    }

    CycleBagCategory(step) {
        const categories = Object.keys(BagFilters);
        const index = categories.indexOf(this.inventoryCategory);
        this.SelectBagCategory(categories[(index + step + categories.length) % categories.length]);
    }

    MoveBagSelection(direction) {
        const count = this.BagItems().length;
        if (!count) return;
        const current = Math.min(this.selectedBagIndex, count - 1);
        const step = { UP: -BagColumns, RIGHT: 1, DOWN: BagColumns, LEFT: -1 }[direction];
        if (step === undefined) return;
        this.selectedBagIndex = Math.max(0, Math.min(count - 1, current + step));
    }

    /** Uses a Potion, equips gear into its first fitting slot, or explains why neither applies. */
    ActivateBagItem() {
        const item = this.SelectedBagItem();
        if (!item) {
            this.level.turn.message = 'Select an item first.';
            return false;
        }
        const info = ItemInfo[item.name];
        if (info.use) return this.level.UseItem(item.name);
        if (!EquipmentSlot(item.name)) {
            this.level.turn.message = `${item.name} is a resource · sell it to the alchemist.`;
            return false;
        }
        return this.level.EquipItem(item.name);
    }

    /** Paper-doll focus (E): left/right pick a slot, up/down cycle owned items for it. */
    MoveGearSelection(direction) {
        const order = EquipmentSlots.map(slot => slot.id), index = order.indexOf(this.selectedGearSlot);
        if (direction === 'LEFT' || direction === 'RIGHT')
            this.SelectGearSlot(order[(index + (direction === 'RIGHT' ? 1 : -1) + order.length) % order.length]);
        else this.CycleGear(direction === 'DOWN' ? 1 : -1);
    }

    ActivateGearSelection() {
        const candidate = this.GearCandidates()[this.selectedGearIndex];
        if (candidate) return this.level.EquipItem(candidate, this.selectedGearSlot);
        if (this.level.campaign.equipment[this.selectedGearSlot]) return this.level.UnequipItem(this.selectedGearSlot);
        this.level.turn.message = 'No owned item fits that slot.';
        return false;
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
        const entry = name => this.sellInventory.find(item => item.name === name);
        if (this.shopTab === 'sell') {
            if (specialty === 'consumable')
                return Object.entries(campaign.inventory)
                    .filter(([name, count]) => count > 0 && ItemInfo[name]?.sell && !EquipmentStats(name))
                    .map(([name]) => ({ ...entry(name), name, slot: null, source: 'bag', price: ItemInfo[name].sell }));
            if (specialty !== 'weapon' && specialty !== 'armor') return [];
            const equipped = this.sellSlots.filter(item => {
                const name = campaign.equipment[item.slot];
                return name && (item.slot === 'weapon' ? 'weapon' : 'armor') === specialty
                    && (EquipmentStats(name)?.price ?? 0) > 0;
            }).map(item => ({ ...item, name: campaign.equipment[item.slot], source: 'equipped' }));
            const bag = this.sellInventory.filter(item => (campaign.inventory[item.name] ?? 0) > 0
                && (EquipmentStats(item.name)?.price ?? 0) > 0
                && (EquipmentSlot(item.name) === 'weapon' ? 'weapon' : 'armor') === specialty)
                .map(item => ({ ...item, slot: EquipmentSlot(item.name), source: 'bag' }));
            return [...equipped, ...bag].map(offer => ({ ...offer, price: Math.floor(EquipmentStats(offer.name).price / 2) }));
        }
        return (VendorStock[specialty] ?? []).map(name => ({
            name, button: this.stock?.find(item => item.name === name)?.button ?? null,
            slot: ItemInfo[name].category === 'Consumables' ? 'potion' : EquipmentSlot(name),
            price: EquipmentStats(name)?.price ?? ItemInfo[name].price,
        }));
    }

    ActivateShopOffer() {
        const offer = this.ShopOffers()[this.shopSelection];
        if (!offer) {
            if (this.shopTab === 'buy' && this.level.activeVendor?.stats.specialty === 'rest') this.level.Rest();
            else this.level.turn.message = 'There is nothing to trade here.';
            return;
        }
        if (this.shopTab === 'buy') this.level.Buy(offer.name, offer.slot === 'potion' ? 'potion' : null);
        else if (offer.source === 'equipped') this.level.SellEquipment(offer.slot);
        else if (!EquipmentStats(offer.name)) this.level.SellItem(offer.name);
        else this.level.SellOwned(offer.name);
        const count = this.ShopOffers().length;
        this.shopSelection = Math.max(0, Math.min(this.shopSelection, count - 1));
        this.shopPage = Math.floor(this.shopSelection / 2);
    }

    DrawBagIcon(item, rect) {
        DrawItemIcon(this.screen.Context, item.name, rect, { equipped: item.equipped });
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
        if (EquipmentStats(name)) f.Text(`vs equipped: ${this.GearComparison(name)}`, hintX + 10, hintY + 101, { size: 9, color: f.theme.gold, maxWidth: hintWidth - 20 });
    }

    /** Stat changes from equipping `name` into `slot` (default: the slot it would go to). */
    GearComparison(name, slot = null) {
        const next = EquipmentStats(name), equipment = this.level.campaign.equipment;
        const target = slot ?? (EquipmentSlot(name) === 'ring' || !Object.hasOwn(equipment, EquipmentSlot(name) ?? '')
            ? SlotFor(name, equipment) : EquipmentSlot(name));
        if (!target || !next) return 'Not equipment';
        const current = EquipmentStats(equipment[target]) ?? {};
        const changes = CompareStats.map(([key, label]) => {
            const delta = (next[key] ?? 0) - (current[key] ?? 0);
            return delta ? `${label} ${delta > 0 ? '+' : ''}${delta}` : null;
        }).filter(Boolean);
        return changes.join(' · ') || 'No stat change';
    }

    ItemModifiers(name) {
        const item = EquipmentStats(name);
        if (!item) {
            const use = ItemInfo[name]?.use;
            if (!use) return ItemInfo[name]?.sell ? `Sells for ${ItemInfo[name].sell}G` : 'No bonuses';
            return [use.heal ? `+${use.heal} HP` : null, use.restoreAp ? `+${use.restoreAp} AP` : null, use.cleanse ? 'Cures poison/burn/slow' : null]
                .filter(Boolean).join(' · ');
        }
        return CompareStats.filter(([key]) => item[key]).map(([key, label]) => `${label} +${item[key]}`).join(' · ') || 'No bonuses';
    }

    GearCandidates() {
        return Object.entries(this.level.campaign.inventory)
            .filter(([name, count]) => count > 0 && EquipmentSlots.find(slot => slot.id === this.selectedGearSlot)?.accepts === EquipmentSlot(name))
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
        const sheet = panel === 'bag' || panel === 'gear';
        const width = Math.min(panel === 'map' ? 680 : sheet ? 660 : 300, s.Width - 20);
        const x = panel === 'map' || sheet ? (s.Width - width) / 2 : 10;
        const sheetHeight = sheet ? SheetLayout(0, 0, width).height + 8 : 0;
        const y = sheet ? Math.max(10, Math.min(this.headerHeight + 16, s.Height - sheetHeight - 10)) : this.headerHeight + 16;
        const heading = { hero: 'CHARACTER', bag: 'CHARACTER SHEET · BACKPACK', gear: 'CHARACTER SHEET · EQUIPMENT', skills: 'CLASS SKILL TREE', map: 'WORLD MAP', party: 'PARTY ROSTER', shop: 'HEARTHVALE VENDORS', settings: 'CONTROL & HUD MODE' }[panel];
        const height = panel === 'shop' ? 276
            : panel === 'settings' ? (l.controlSettings.mode === 'Personalizado' ? 340 : 212)
            : panel === 'skills' ? 290
                : sheet ? sheetHeight
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
            const custom = settings.mode === 'Personalizado';
            const toggles = [[this.customRadial, 'AUTO RADIAL', 'autoRadial'], [this.customTarget, 'SMART TARGET', 'smartTarget'],
                [this.customDock, 'PC DOCK', 'dock'], [this.customLarge, 'LARGE TARGETS', 'largeTargets']];
            toggles.forEach(([item, label, key], index) => {
                item.label = `${label}: ${settings[key] ? 'ON' : 'OFF'}`;
                this.Place(item, x + 12, y + 136 + index * 32, width - 24, 28, custom, this.settingsSelection === ControlModes.length + index);
            });
            if (!custom)
                f.Text(`Dock ${settings.dock ? 'ON' : 'OFF'} · Radial ${settings.autoRadial ? 'ON' : 'OFF'} · Large ${settings.largeTargets ? 'ON' : 'OFF'}`, x + 14, y + 148, { size: 10, maxWidth: width - 28 });
            this.Place(this.settingsHelp, x + 12, y + (custom ? 266 : 166), width - 24, 30, true,
                this.settingsSelection === ControlModes.length + (custom ? CustomOptions.length : 0));
        }
        else if (panel === 'hero') {
            f.Text(`${hero.className} · Level ${hero.level}`, x + 14, y + 48, { size: 12 });
            f.Text(`HP ${hero.hp}/${hero.maxHp} · ATK ${hero.attack} · MAG ${hero.magic} · DEF ${hero.defense}`, x + 14, y + 68, { size: 10, maxWidth: width - 28 });
            f.Text(`XP ${hero.xp}/${hero.nextXp} · AP ${hero.apMax} · MP ${hero.mpMax} · SPD ${hero.speed}`, x + 14, y + 88, { size: 11, maxWidth: width - 28 });
            this.Place(this.panelButtons.save, x + 12, y + 102, width - 24, 27, true);
            this.Place(this.panelButtons.rest, x + 12, y + 134, width - 24, 32, l.zone.id === 'hearthvale');
        }
        else if (sheet) {
            this.sheet.Draw(x, y, width);
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
        else if (panel === 'skills') {
            const tree = SkillTrees[hero.archetype] ?? [];
            f.Text(`${hero.className} · ${l.campaign.skillPoints} SP`, x + 14, y + 44, { size: 11, color: f.theme.gold });
            tree.forEach((skill, index) => {
                const learned = l.campaign.unlockedSkills.includes(skill.id);
                const ready = skill.requires.every(required => l.campaign.unlockedSkills.includes(required));
                const item = this.skillNodeButtons.find(entry => entry.skill.id === skill.id);
                item.label = learned ? 'LEARNED' : ready && l.campaign.skillPoints > 0 ? 'UNLOCK' : 'LOCKED';
                const nodeY = y + 64 + index * 30, c = s.Context;
                c.save();
                c.strokeStyle = learned ? '#80c6a0' : '#9a906b'; c.lineWidth = 2;
                if (index > 0) { c.beginPath(); c.moveTo(x + 22, nodeY - 25); c.lineTo(x + 22, nodeY - 5); c.stroke(); }
                c.beginPath(); c.arc(x + 22, nodeY, 5, 0, Math.PI * 2);
                c.fillStyle = learned ? '#80c6a0' : this.skillTreeSelection === index ? '#f9cb5b' : '#26343a';
                c.fill(); c.stroke(); c.restore();
                const profile = skill.kind === 'active' ? GetAbilityProfile({}, skill.id) : null;
                f.Text(`${skill.name} · ${profile ? `${profile.ap} AP` : 'PASSIVE'}`, x + 34, y + 63 + index * 30, { size: 10, weight: 700, maxWidth: width - 132 });
                const requirement = skill.requires.map(id => tree.find(node => node.id === id)?.name ?? id).join(', ');
                f.Text(requirement ? `Requires: ${requirement}` : 'Starting skill', x + 34, y + 76 + index * 30, { size: 8, maxWidth: width - 132 });
                if (learned || !ready || l.campaign.skillPoints < 1)
                    f.Text(learned ? 'LEARNED' : ready ? 'NEED 1 SP' : 'LOCKED', x + width - 14, y + 68 + index * 30, {
                        size: 9, align: 'right', color: f.theme.muted,
                    });
                this.Place(item, x + width - 91, y + 52 + index * 30, 78, 24, !learned && ready && l.campaign.skillPoints > 0, this.skillTreeSelection === index);
            });
            if (tree[this.skillTreeSelection])
                f.Text(tree[this.skillTreeSelection].description, x + 14, y + 64 + tree.length * 30 + 8, { size: 9, maxWidth: width - 28 });
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
                    const detail = !EquipmentStats(offer.name) ? this.ItemModifiers(offer.name) : `${this.ItemModifiers(offer.name)} · Δ ${this.GearComparison(offer.name)}`;
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
