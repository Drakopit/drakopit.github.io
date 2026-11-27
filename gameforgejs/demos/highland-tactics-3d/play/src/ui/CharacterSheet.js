import { Input } from 'gameforgejs/core';
import { Touch } from 'gameforgejs/2d';
import { BagFilters, EquipmentSlots, EquipmentSlot, EquipmentStats, ItemInfo, SlotAccepts, SlotFor } from '../data/HighlandCampaign.js';
import { DrawEmptySlot, DrawItemIcon, RarityColor } from './ItemIcons.js';

export const BagColumns = 8;
export const BagRows = 5;

/** Paper-doll order: four slots down the left, three down the right, four along the bottom. */
const DollColumns = Object.freeze({ left: ['helm', 'amulet', 'cloak', 'armor'], right: ['gloves', 'belt', 'boots'], bottom: ['weapon', 'ring1', 'ring2', 'offhand'] });

/** Stat rows used by item tooltips and comparisons. */
export const CompareStats = Object.freeze([['attack', 'ATK'], ['defense', 'DEF'], ['magic', 'MAG'], ['ap', 'AP'], ['mp', 'MP'], ['speed', 'SPD'], ['hp', 'HP']]);

/**
 * The combined character sheet's rectangles. Wide panels put the paper doll beside the backpack;
 * narrow ones stack them. Returns the doll slots (all 11), the filter tabs and the 8x5 grid.
 */
export function SheetLayout(x, y, width) {
    const wide = width >= 600;
    const dollWidth = wide ? 236 : width - 24;
    const cell = wide ? 44 : Math.max(26, Math.min(44, (width - 24 - (BagColumns - 1) * 3) / BagColumns));
    const slot = wide ? 46 : Math.max(30, Math.min(42, (width - 24 - 5 * 4) / 6));
    const doll = [];
    if (wide) {
        const left = x + 12, right = x + dollWidth - slot - 4, top = y + 44;
        DollColumns.left.forEach((id, index) => doll.push({ slot: id, x: left, y: top + index * (slot + 6), width: slot, height: slot }));
        DollColumns.right.forEach((id, index) => doll.push({ slot: id, x: right, y: top + 26 + index * (slot + 6), width: slot, height: slot }));
        const rowWidth = 4 * slot + 3 * 6, rowX = x + 12 + (dollWidth - 12 - rowWidth) / 2;
        DollColumns.bottom.forEach((id, index) => doll.push({ slot: id, x: rowX + index * (slot + 6), y: top + 4 * (slot + 6) + 4, width: slot, height: slot }));
    }
    else {
        // Two rows of six (the last cell holds the stats summary).
        const order = [...DollColumns.left, ...DollColumns.right, ...DollColumns.bottom];
        order.forEach((id, index) => doll.push({
            slot: id, x: x + 12 + (index % 6) * (slot + 4), y: y + 40 + Math.floor(index / 6) * (slot + 4), width: slot, height: slot,
        }));
    }
    const dollBottom = Math.max(...doll.map(rect => rect.y + rect.height));
    const bagX = wide ? x + dollWidth + 16 : x + 12;
    const bagWidth = BagColumns * cell + (BagColumns - 1) * 3;
    const filtersY = wide ? y + 40 : dollBottom + (wide ? 0 : 52);
    const filterNames = Object.keys(BagFilters), filterWidth = (bagWidth - 3 * (filterNames.length - 1)) / filterNames.length;
    const filters = filterNames.map((name, index) => ({ name, x: bagX + index * (filterWidth + 3), y: filtersY, width: filterWidth, height: 22 }));
    const gridY = filtersY + 28;
    const grid = Array.from({ length: BagColumns * BagRows }, (_, index) => ({
        x: bagX + (index % BagColumns) * (cell + 3), y: gridY + Math.floor(index / BagColumns) * (cell + 3), width: cell, height: cell,
    }));
    const gridBottom = gridY + BagRows * (cell + 3);
    return {
        wide, doll, filters, grid,
        stats: wide ? { x: x + 12, y: dollBottom + 18, width: dollWidth - 12 } : { x: x + 12, y: dollBottom + 16, width: width - 24 },
        bag: { x: bagX, y: gridY, width: bagWidth, height: BagRows * (cell + 3) },
        actions: { x: bagX, y: gridBottom + 46, width: bagWidth },
        info: { x: bagX, y: gridBottom + 14, width: bagWidth },
        height: Math.max(dollBottom - y + (wide ? 92 : 0), gridBottom + 78 - y),
    };
}

function Inside(point, rect) {
    return Boolean(rect) && point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

/**
 * The character sheet (E / I): an 11-slot paper doll with rarity frames and empty-slot glyphs,
 * the 8x5 backpack with filters and stack counts, and comparison tooltips. Items equip by
 * double-click, by dragging onto a slot, or by clicking a fitting slot while one is selected;
 * double-clicking or dragging an equipped item back to the bag unequips it.
 */
export class CharacterSheet {
    constructor(hud) {
        this.hud = hud;
        this.drag = null;
        this.lastClick = null;
        this.clock = 0;
        this.layout = null;
        this.primary = hud.Button('EQUIP', () => this.Primary());
        this.secondary = hud.Button('UNEQUIP', () => this.Secondary());
    }

    Update(dt) { this.clock += dt ?? 0; }

    /** The selected backpack item's main action: equip gear, use a Potion. */
    Primary() {
        const hud = this.hud, selected = hud.SelectedBagItem();
        if (hud.panel === 'gear') {
            const candidate = hud.GearCandidates()[hud.selectedGearIndex];
            return candidate ? hud.level.EquipItem(candidate, hud.selectedGearSlot) : false;
        }
        return selected ? hud.ActivateBagItem() : false;
    }

    Secondary() {
        const hud = this.hud;
        return hud.level.campaign.equipment[hud.selectedGearSlot] ? hud.level.UnequipItem(hud.selectedGearSlot) : false;
    }

    Draw(x, y, width) {
        const hud = this.hud, { level: l, frame: f, screen: s } = hud, c = s.Context, campaign = l.campaign, hero = campaign.hero;
        const layout = this.layout = SheetLayout(x, y, width);
        const pointer = Touch.ToScreen(Input.instance.mouse.position, s);
        const mouse = Input.instance.mouse;
        const items = hud.BagItems();
        const bagIndex = layout.grid.findIndex(rect => Inside(pointer, rect));
        const dollRect = layout.doll.find(rect => Inside(pointer, rect));
        this.HandlePointer(pointer, mouse, items, bagIndex, dollRect);
        hud.selectedBagIndex = Math.max(0, Math.min(hud.selectedBagIndex, items.length - 1));
        const selected = items[hud.selectedBagIndex] ?? null;

        // Paper doll
        f.Text(`${hero.name} · Lv ${hero.level} ${hero.className}`, x + 14, y + 34, { size: 10, color: f.theme.gold, maxWidth: layout.wide ? 220 : width - 60 });
        if (layout.wide) this.DrawFigure(layout);
        const dragging = this.drag?.moved ? this.drag : null;
        for (const rect of layout.doll) {
            const kind = EquipmentSlots.find(entry => entry.id === rect.slot).accepts, equipped = campaign.equipment[rect.slot];
            const focused = hud.panel === 'gear' && hud.selectedGearSlot === rect.slot;
            const fits = (dragging?.from === 'bag' && SlotAccepts(rect.slot, dragging.item))
                || (!dragging && hud.panel === 'bag' && selected && SlotAccepts(rect.slot, selected.name));
            c.save();
            c.fillStyle = fits ? 'rgba(54,82,52,.95)' : 'rgba(10,18,24,.94)';
            c.fillRect(rect.x, rect.y, rect.width, rect.height);
            c.strokeStyle = focused ? '#fff1be' : equipped ? RarityColor(equipped) : '#4b5a61';
            c.lineWidth = focused ? 2.5 : 1.5;
            c.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
            c.restore();
            const inner = { x: rect.x + 5, y: rect.y + 5, width: rect.width - 10, height: rect.height - 10 };
            if (equipped && !(dragging?.from === rect.slot)) DrawItemIcon(c, equipped, inner, { frame: false });
            else DrawEmptySlot(c, kind, inner);
        }
        this.DrawStats(layout, hero);

        // Backpack
        for (const filter of layout.filters) {
            const active = hud.inventoryCategory === filter.name;
            c.save();
            c.fillStyle = active ? 'rgba(92,72,26,.95)' : 'rgba(14,24,31,.94)';
            c.fillRect(filter.x, filter.y, filter.width, filter.height);
            c.strokeStyle = active ? '#e5c46d' : '#4b5a61';
            c.strokeRect(filter.x + 0.5, filter.y + 0.5, filter.width - 1, filter.height - 1);
            c.restore();
            f.Text(filter.name.toUpperCase(), filter.x + filter.width / 2, filter.y + 15, { size: 9, align: 'center', weight: active ? 700 : 400, color: active ? f.theme.gold : f.theme.text, maxWidth: filter.width - 4 });
        }
        layout.grid.forEach((rect, index) => {
            const item = items[index], chosen = hud.panel === 'bag' && index === hud.selectedBagIndex && item;
            c.save();
            c.fillStyle = 'rgba(10,18,24,.92)';
            c.fillRect(rect.x, rect.y, rect.width, rect.height);
            c.strokeStyle = chosen ? '#fff1be' : '#334249';
            c.lineWidth = chosen ? 2 : 1;
            c.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
            c.restore();
            if (!item || (dragging?.from === 'bag' && dragging.index === index && item.count <= 1)) return;
            DrawItemIcon(c, item.name, { x: rect.x + 3, y: rect.y + 3, width: rect.width - 6, height: rect.height - 6 });
            if (item.count > 1) f.Text(`${item.count}`, rect.x + rect.width - 4, rect.y + rect.height - 4, { size: 9, align: 'right', weight: 700 });
        });
        if (items.length > layout.grid.length)
            f.Text(`+${items.length - layout.grid.length} more · change filter`, layout.info.x, layout.info.y - 2, { size: 8, color: f.theme.muted });

        // Selection line and actions
        const focusItem = hud.panel === 'gear' ? campaign.equipment[hud.selectedGearSlot] : selected?.name;
        f.Text(focusItem ? `${focusItem} · ${this.Summary(focusItem)}` : 'Empty', layout.info.x, layout.info.y + 6, { size: 10, weight: 700, color: f.theme.gold, maxWidth: layout.info.width });
        f.Text('Double-click or drag to equip · drag to the bag to unequip', layout.info.x, layout.info.y + 20, { size: 8, color: f.theme.muted, maxWidth: layout.info.width });
        const half = (layout.actions.width - 6) / 2;
        this.primary.label = hud.panel === 'gear' ? 'EQUIP SELECTED' : selected && ItemInfo[selected.name]?.use ? 'USE' : 'EQUIP';
        const canPrimary = hud.panel === 'gear' ? Boolean(hud.GearCandidates()[hud.selectedGearIndex])
            : Boolean(selected && (EquipmentSlot(selected.name) || selected.name === 'Potion'));
        hud.Place(this.primary, layout.actions.x, layout.actions.y, half, 26, canPrimary);
        hud.Place(this.secondary, layout.actions.x + half + 6, layout.actions.y, half, 26, Boolean(campaign.equipment[hud.selectedGearSlot]));

        // Tooltip and drag ghost
        const hoverName = dollRect ? campaign.equipment[dollRect.slot] : items[bagIndex]?.name;
        if (!dragging && hoverName) this.DrawTooltip(hoverName, pointer, dollRect ? dollRect.slot : null);
        if (dragging) DrawItemIcon(c, dragging.item, { x: pointer.x - 18, y: pointer.y - 18, width: 36, height: 36 });
    }

    /** Mouse and touch: select, double-click, drag-and-drop between the backpack and the doll. */
    HandlePointer(pointer, mouse, items, bagIndex, dollRect) {
        const hud = this.hud, campaign = hud.level.campaign;
        const touch = Input.instance.touch?.GetStartedTouches?.()?.[0];
        const pressed = mouse.buttonsDown?.[0] || Boolean(touch);
        const point = touch ? Touch.ToScreen(touch.startPosition, hud.screen) : pointer;
        if (pressed) {
            const filter = this.layout.filters.find(rect => Inside(point, rect));
            if (filter) { hud.SelectBagCategory(filter.name); return; }
            const index = this.layout.grid.findIndex(rect => Inside(point, rect));
            const doll = this.layout.doll.find(rect => Inside(point, rect));
            const key = index >= 0 ? `bag:${items[index]?.name}` : doll ? `doll:${doll.slot}` : null;
            const double = key && this.lastClick?.key === key && this.clock - this.lastClick.time < 0.4;
            this.lastClick = key ? { key, time: this.clock } : null;
            if (index >= 0 && items[index]) {
                hud.panel = 'bag';
                hud.selectedBagIndex = index;
                if (double) { hud.ActivateBagItem(); this.lastClick = null; return; }
                this.drag = { from: 'bag', index, item: items[index].name, start: { ...point }, moved: false };
            }
            else if (doll) {
                const selected = items[hud.selectedBagIndex];
                // Clicking a fitting slot while a backpack item is selected equips it there.
                if (hud.panel === 'bag' && selected && SlotAccepts(doll.slot, selected.name) && !double) {
                    hud.level.EquipItem(selected.name, doll.slot);
                    hud.SelectGearSlot(doll.slot);
                    return;
                }
                hud.panel = 'gear';
                hud.SelectGearSlot(doll.slot);
                if (double && campaign.equipment[doll.slot]) { hud.level.UnequipItem(doll.slot); this.lastClick = null; return; }
                if (campaign.equipment[doll.slot])
                    this.drag = { from: doll.slot, item: campaign.equipment[doll.slot], start: { ...point }, moved: false };
            }
            return;
        }
        if (this.drag && mouse.buttons?.[0] && Math.hypot(pointer.x - this.drag.start.x, pointer.y - this.drag.start.y) > 6)
            this.drag.moved = true;
        if (this.drag && (mouse.buttonsUp?.[0] || !mouse.buttons?.[0])) {
            const drag = this.drag;
            this.drag = null;
            if (!drag.moved) return;
            if (drag.from === 'bag' && dollRect) hud.level.EquipItem(drag.item, dollRect.slot);
            else if (drag.from !== 'bag' && (bagIndex >= 0 || Inside(pointer, this.layout.bag))) hud.level.UnequipItem(drag.from);
            else if (drag.from !== 'bag' && dollRect && SlotAccepts(dollRect.slot, drag.item) && dollRect.slot !== drag.from) {
                // Ring to ring: swap the two slots.
                hud.level.UnequipItem(drag.from);
                hud.level.EquipItem(drag.item, dollRect.slot);
            }
        }
    }

    DrawFigure(layout) {
        const c = this.hud.screen.Context, doll = layout.doll;
        const left = doll[0], right = doll[4];
        const cx = (left.x + left.width + right.x) / 2, top = left.y + 6;
        c.save();
        c.fillStyle = 'rgba(48,65,74,.55)'; c.strokeStyle = 'rgba(201,174,105,.5)'; c.lineWidth = 1.5;
        c.beginPath(); c.arc(cx, top + 14, 13, 0, Math.PI * 2); c.fill(); c.stroke();
        c.beginPath(); c.moveTo(cx - 20, top + 34); c.lineTo(cx + 20, top + 34); c.lineTo(cx + 26, top + 92);
        c.lineTo(cx + 14, top + 100); c.lineTo(cx + 16, top + 150); c.lineTo(cx + 3, top + 150);
        c.lineTo(cx, top + 108); c.lineTo(cx - 3, top + 150); c.lineTo(cx - 16, top + 150);
        c.lineTo(cx - 14, top + 100); c.lineTo(cx - 26, top + 92); c.closePath(); c.fill(); c.stroke();
        c.restore();
    }

    DrawStats(layout, hero) {
        const { frame: f } = this.hud, { x, y, width } = layout.stats;
        const rows = [`ATK ${hero.attack}  DEF ${hero.defense}  MAG ${hero.magic}`, `AP ${hero.apMax}  MP ${hero.mpMax}  SPD ${hero.speed}  HP ${hero.maxHp}`, `${this.hud.level.campaign.gold}G · ${this.hud.level.campaign.skillPoints} SP`];
        rows.forEach((row, index) => f.Text(row, x, y + index * 15, { size: 10, weight: index === 0 ? 700 : 400, color: index === 2 ? f.theme.gold : f.theme.text, maxWidth: width }));
    }

    Summary(name) {
        const info = ItemInfo[name];
        if (!info) return '';
        return `${info.rarity.toUpperCase()} ${info.category} · ${this.hud.ItemModifiers(name)}`;
    }

    /** Item tooltip with stats and, for gear in the backpack, the change versus the slot it fills. */
    DrawTooltip(name, pointer, equippedSlot) {
        const { frame: f, screen: s, level: l } = this.hud, info = ItemInfo[name];
        if (!info) return;
        const gear = EquipmentStats(name);
        const lines = [
            [`${name}`, { size: 11, weight: 700, color: RarityColor(name) }],
            [`${info.rarity.toUpperCase()} · ${info.category}${info.sell ? ` · sells ${info.sell}G` : ''}`, { size: 9, color: f.theme.muted }],
            [info.description, { size: 9 }],
            [this.hud.ItemModifiers(name), { size: 9 }],
        ];
        if (gear && !equippedSlot) {
            const slot = SlotFor(name, l.campaign.equipment);
            const current = l.campaign.equipment[slot];
            lines.push([`vs ${current ?? 'empty slot'}: ${this.hud.GearComparison(name, slot)}`, { size: 9, weight: 700, color: f.theme.gold }]);
        }
        const width = Math.min(250, s.Width - 20), height = 16 + lines.length * 16;
        const x = Math.max(10, Math.min(s.Width - width - 10, pointer.x + 16));
        const y = Math.max(10, Math.min(s.Height - height - 10, pointer.y + 12));
        f.Panel({ x, y, width, height });
        lines.forEach(([text, options], index) => f.Text(text, x + 10, y + 18 + index * 16, { ...options, maxWidth: width - 20 }));
    }
}
