import { Input } from 'gameforgejs/core';
import { Touch } from 'gameforgejs/2d';
import { BackpackSlots, BagFilters, EquipmentSlot, ItemInfo } from '../data/HighlandCampaign.js';
import { DrawItemIcon, RarityColor } from './ItemIcons.js';
import { DrawItemCard, DrawItemTooltip, Inside } from './ItemCard.js';

export const BagColumns = 8;
export const BagRows = 5;
/** Sort orders the Sort button cycles through. Newest keeps pickup order. */
export const BagSorts = Object.freeze(['Newest', 'Type', 'Rarity', 'Name', 'Value', 'Weight']);

/**
 * Inventory panel rectangles: tab row, search box and sort button, the 8x5 grid and the details
 * pane (beside the grid when wide, below it when narrow).
 */
export function InventoryLayout(x, y, width) {
    const wide = width >= 600;
    const inner = width - 24;
    const tabNames = Object.keys(BagFilters), tabWidth = (inner - 3 * (tabNames.length - 1)) / tabNames.length;
    const tabs = tabNames.map((name, index) => ({ name, x: x + 12 + index * (tabWidth + 3), y: y + 40, width: tabWidth, height: 24 }));
    const toolsY = y + 70;
    const sortWidth = wide ? 128 : 104;
    const search = { x: x + 12, y: toolsY, width: wide ? 230 : inner - sortWidth - 6, height: 24 };
    const sort = { x: search.x + search.width + 6, y: toolsY, width: sortWidth, height: 24 };
    const cell = wide ? 44 : Math.max(26, Math.min(44, (inner - (BagColumns - 1) * 3) / BagColumns));
    const gridX = x + 12, gridY = toolsY + 32;
    const grid = Array.from({ length: BagColumns * BagRows }, (_, index) => ({
        x: gridX + (index % BagColumns) * (cell + 3), y: gridY + Math.floor(index / BagColumns) * (cell + 3), width: cell, height: cell,
    }));
    const gridWidth = BagColumns * cell + (BagColumns - 1) * 3, gridBottom = gridY + BagRows * (cell + 3);
    const details = wide
        ? { x: gridX + gridWidth + 14, y: toolsY, width: x + width - 12 - (gridX + gridWidth + 14), height: gridBottom - toolsY }
        : { x: gridX, y: gridBottom + 8, width: inner, height: 168 };
    const action = { x: details.x, y: details.y + details.height - 30, width: details.width, height: 28 };
    return {
        wide, tabs, search, sort, grid, details, action,
        bag: { x: gridX, y: gridY, width: gridWidth, height: BagRows * (cell + 3) },
        footer: { x: gridX, y: wide ? gridBottom + 14 : details.y + details.height + 14 },
        height: (wide ? gridBottom + 26 : details.y + details.height + 24) - y,
    };
}

/**
 * Inventory [I]: tabs (All, Weapons & Armor, Consumables, Special AP/MP, Materials), a search box
 * ("/" or a click starts typing), a sort order, slot and weight counters and rich item cards.
 * Click selects, double-click (or Enter) uses, equips or reads the selected item.
 */
export class InventoryPanel {
    constructor(hud) {
        this.hud = hud;
        this.lastClick = null;
        this.clock = 0;
        this.layout = null;
        this.primary = hud.Button('USE', () => hud.ActivateBagItem());
    }

    Update(dt) { this.clock += dt ?? 0; }

    PrimaryLabel(name) {
        const info = ItemInfo[name];
        if (!info) return 'SELECT AN ITEM';
        if (info.permanent) return 'READ SCROLL';
        if (info.use) return name === 'Potion' ? 'DRINK' : 'USE IN BATTLE';
        if (EquipmentSlot(name)) return 'EQUIP';
        return 'SELL AT THE ALCHEMIST';
    }

    Draw(x, y, width) {
        const hud = this.hud, { level: l, frame: f, screen: s } = hud, c = s.Context, campaign = l.campaign;
        const layout = this.layout = InventoryLayout(x, y, width);
        const pointer = Touch.ToScreen(Input.instance.mouse.position, s);
        const items = hud.BagItems();
        this.HandlePointer(pointer, items);
        hud.selectedBagIndex = Math.max(0, Math.min(hud.selectedBagIndex, items.length - 1));
        const selected = items[hud.selectedBagIndex] ?? null;

        // Counters beside the heading.
        const weight = campaign.CarryWeight(), capacity = campaign.CarryCapacity(), used = campaign.UsedSlots();
        const heavy = weight > capacity;
        f.Text(`SLOTS ${used}/${BackpackSlots} · WEIGHT ${weight}/${capacity}${heavy ? ' · HEAVY' : ''}`, x + width - 48, y + 23,
            { size: 10, weight: 700, align: 'right', color: heavy ? '#f08a6b' : f.theme.text, maxWidth: width - 220 });

        for (const tab of layout.tabs) {
            const active = hud.inventoryCategory === tab.name;
            const count = Object.keys(campaign.inventory).filter(name => campaign.inventory[name] > 0 && hud.InBagTab(tab.name, name)).length;
            this.Box(tab, active ? 'rgba(92,72,26,.95)' : 'rgba(14,24,31,.94)', active ? '#e5c46d' : '#4b5a61');
            f.Text(`${BagFilters[tab.name].label.toUpperCase()} ${count}`, tab.x + tab.width / 2, tab.y + 16,
                { size: 9, align: 'center', weight: active ? 700 : 400, color: active ? f.theme.gold : f.theme.text, maxWidth: tab.width - 6 });
        }

        // Search box and sort.
        const search = hud.search;
        this.Box(layout.search, 'rgba(8,14,20,.96)', search.active ? '#e5c46d' : '#4b5a61');
        const caret = search.active && Math.floor(this.clock * 2) % 2 === 0 ? '|' : '';
        f.Text(search.text ? `${search.text}${caret}` : search.active ? caret || ' ' : 'Search  (press /)', layout.search.x + 8, layout.search.y + 16,
            { size: 10, color: search.text || search.active ? f.theme.text : f.theme.muted, maxWidth: layout.search.width - 16 });
        this.Box(layout.sort, 'rgba(14,24,31,.94)', '#4b5a61');
        f.Text(`SORT: ${hud.bagSort.toUpperCase()}`, layout.sort.x + layout.sort.width / 2, layout.sort.y + 16,
            { size: 9, align: 'center', weight: 700, color: f.theme.gold, maxWidth: layout.sort.width - 8 });

        // Grid.
        layout.grid.forEach((rect, index) => {
            const item = items[index], chosen = index === hud.selectedBagIndex && item;
            this.Box(rect, 'rgba(10,18,24,.92)', chosen ? '#fff1be' : item ? RarityColor(item.name) + '88' : '#334249', chosen ? 2 : 1);
            if (!item) return;
            DrawItemIcon(c, item.name, { x: rect.x + 3, y: rect.y + 3, width: rect.width - 6, height: rect.height - 6 });
            if (item.count > 1) f.Text(`${item.count}`, rect.x + rect.width - 4, rect.y + rect.height - 4, { size: 9, align: 'right', weight: 700 });
        });
        if (!items.length)
            f.Text(search.text ? `Nothing matches "${search.text}".` : 'Nothing here yet.', layout.bag.x + layout.bag.width / 2, layout.bag.y + layout.bag.height / 2,
                { size: 11, align: 'center', color: f.theme.muted, maxWidth: layout.bag.width - 20 });
        if (items.length > layout.grid.length)
            f.Text(`+${items.length - layout.grid.length} more · use a tab or search`, layout.footer.x, layout.footer.y, { size: 9, color: f.theme.muted });
        else
            f.Text('Click select · double-click / Enter use or equip · [ ] tabs · / search', layout.footer.x, layout.footer.y,
                { size: 9, color: f.theme.muted, maxWidth: layout.wide ? layout.bag.width + layout.details.width : layout.details.width });

        // Details pane with the selected item's full card and its main action.
        this.Box(layout.details, 'rgba(8,14,20,.6)', '#2c3a41');
        if (selected) DrawItemCard(hud, selected.name, layout.details.x, layout.details.y, layout.details.width, { icon: true, panel: false });
        else f.Text('Select an item to see its details.', layout.details.x + 10, layout.details.y + 20, { size: 10, color: f.theme.muted, maxWidth: layout.details.width - 20 });
        this.primary.label = this.PrimaryLabel(selected?.name);
        const info = selected ? ItemInfo[selected.name] : null;
        const usable = Boolean(info && (info.permanent || selected.name === 'Potion' || EquipmentSlot(selected.name)));
        hud.Place(this.primary, layout.action.x + 6, layout.action.y, layout.action.width - 12, layout.action.height, usable);

        // Hover card for items other than the selected one.
        const hovered = layout.grid.findIndex(rect => Inside(pointer, rect));
        if (hovered >= 0 && hovered !== hud.selectedBagIndex && items[hovered]) DrawItemTooltip(hud, items[hovered].name, pointer);
    }

    Box(rect, fill, stroke, lineWidth = 1) {
        const c = this.hud.screen.Context;
        c.save();
        c.fillStyle = fill;
        c.fillRect(rect.x, rect.y, rect.width, rect.height);
        c.strokeStyle = stroke;
        c.lineWidth = lineWidth;
        c.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
        c.restore();
    }

    /** Mouse and touch: tabs, search focus, sort, select and double-click. */
    HandlePointer(pointer, items) {
        const hud = this.hud, mouse = Input.instance.mouse;
        const touch = Input.instance.touch?.GetStartedTouches?.()?.[0];
        if (!(mouse.buttonsDown?.[0] || touch)) return;
        const point = touch ? Touch.ToScreen(touch.startPosition, hud.screen) : pointer;
        const layout = this.layout;
        const tab = layout.tabs.find(rect => Inside(point, rect));
        if (tab) { hud.SelectBagCategory(tab.name); return; }
        if (Inside(point, layout.search)) { hud.SetSearchActive(true); return; }
        hud.SetSearchActive(false);
        if (Inside(point, layout.sort)) { hud.CycleBagSort(1); return; }
        const index = layout.grid.findIndex(rect => Inside(point, rect));
        if (index < 0 || !items[index]) return;
        const key = items[index].name;
        const double = this.lastClick?.key === key && this.clock - this.lastClick.time < 0.4;
        hud.selectedBagIndex = index;
        this.lastClick = double ? null : { key, time: this.clock };
        if (double) hud.ActivateBagItem();
    }
}
