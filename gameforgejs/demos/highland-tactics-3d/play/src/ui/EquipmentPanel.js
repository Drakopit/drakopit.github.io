import { Input } from 'gameforgejs/core';
import { Touch } from 'gameforgejs/2d';
import { EquipmentSlots, Resistances, ResistCap, SlotAccepts } from '../data/HighlandCampaign.js';
import { DrawEmptySlot, DrawItemIcon, RarityColor } from './ItemIcons.js';
import { DrawItemTooltip, Inside } from './ItemCard.js';

/** Paper-doll order: four slots down the left, three down the right, four along the bottom. */
const DollColumns = Object.freeze({ left: ['helm', 'amulet', 'cloak', 'armor'], right: ['gloves', 'belt', 'boots'], bottom: ['weapon', 'ring1', 'ring2', 'offhand'] });
/** Rows of the stat breakdown table. */
export const BreakdownRows = Object.freeze([['attack', 'ATK'], ['magic', 'MAG'], ['defense', 'DEF'], ['speed', 'SPD'], ['maxHp', 'HP']]);
const CandidateRows = 4;

/**
 * Equipment panel rectangles: the 11-slot doll, the candidate list for the selected slot and the
 * stats column (breakdown table, AP/MP budget, resistances). Wide panels put stats beside the doll.
 */
export function EquipmentLayout(x, y, width) {
    const wide = width >= 600;
    const dollWidth = wide ? 236 : width - 24;
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
        const order = [...DollColumns.left, ...DollColumns.right, ...DollColumns.bottom];
        order.forEach((id, index) => doll.push({
            slot: id, x: x + 12 + (index % 6) * (slot + 4), y: y + 40 + Math.floor(index / 6) * (slot + 4), width: slot, height: slot,
        }));
    }
    const dollBottom = Math.max(...doll.map(rect => rect.y + rect.height));
    const listY = dollBottom + 40, rowHeight = 26;
    const candidates = Array.from({ length: CandidateRows }, (_, index) => ({ x: x + 12, y: listY + index * (rowHeight + 3), width: dollWidth - 12, height: rowHeight }));
    const listBottom = listY + CandidateRows * (rowHeight + 3);
    const half = (dollWidth - 18) / 2;
    const buttons = { equip: { x: x + 12, y: listBottom + 4, width: half, height: 26 }, unequip: { x: x + 18 + half, y: listBottom + 4, width: half, height: 26 } };
    const stats = wide
        ? { x: x + dollWidth + 20, y: y + 40, width: width - dollWidth - 32 }
        : { x: x + 12, y: listBottom + 40, width: width - 24 };
    const statsHeight = 284;
    return {
        wide, doll, candidates, buttons, stats,
        slotInfo: { x: x + 12, y: dollBottom + 18 },
        height: Math.max(listBottom + 40, stats.y + statsHeight) - y,
    };
}

/**
 * Equipment [E]: the paper doll, owned items that fit the selected slot (with the change each
 * one makes), and the stats column: where every stat comes from, the AP/MP turn budget and the
 * elemental resistances from gear. Arrows pick slots and candidates; Enter equips.
 */
export class EquipmentPanel {
    constructor(hud) {
        this.hud = hud;
        this.lastClick = null;
        this.clock = 0;
        this.layout = null;
        this.drag = null;
        this.equip = hud.Button('EQUIP', () => hud.ActivateGearSelection());
        this.unequip = hud.Button('UNEQUIP', () => hud.level.UnequipItem(hud.selectedGearSlot));
    }

    Update(dt) { this.clock += dt ?? 0; }

    Draw(x, y, width) {
        const hud = this.hud, { level: l, frame: f, screen: s } = hud, c = s.Context, campaign = l.campaign, hero = campaign.hero;
        const layout = this.layout = EquipmentLayout(x, y, width);
        const pointer = Touch.ToScreen(Input.instance.mouse.position, s);
        const candidates = hud.GearCandidates();
        this.HandlePointer(pointer, candidates);
        hud.selectedGearIndex = Math.max(0, Math.min(hud.selectedGearIndex, Math.max(0, candidates.length - 1)));

        if (layout.wide)
            f.Text(`${hero.name} · Lv ${hero.level} ${hero.className}`, x + 14, y + 36, { size: 10, color: f.theme.gold, maxWidth: 220 });
        if (layout.wide) this.DrawFigure(layout);
        const dragging = this.drag?.moved ? this.drag : null;
        for (const rect of layout.doll) {
            const kind = EquipmentSlots.find(entry => entry.id === rect.slot).accepts, equipped = campaign.equipment[rect.slot];
            const focused = hud.selectedGearSlot === rect.slot;
            const fits = dragging && SlotAccepts(rect.slot, dragging.item) && rect.slot !== dragging.from;
            c.save();
            c.fillStyle = fits ? 'rgba(54,82,52,.95)' : 'rgba(10,18,24,.94)';
            c.fillRect(rect.x, rect.y, rect.width, rect.height);
            c.strokeStyle = focused ? '#fff1be' : equipped ? RarityColor(equipped) : '#4b5a61';
            c.lineWidth = focused ? 2.5 : 1.5;
            c.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
            c.restore();
            const inner = { x: rect.x + 5, y: rect.y + 5, width: rect.width - 10, height: rect.height - 10 };
            if (equipped && dragging?.from !== rect.slot) DrawItemIcon(c, equipped, inner, { frame: false });
            else DrawEmptySlot(c, kind, inner);
        }

        // Selected slot and the owned items that fit it.
        const slot = EquipmentSlots.find(entry => entry.id === hud.selectedGearSlot);
        const worn = campaign.equipment[hud.selectedGearSlot];
        f.Text(`${slot?.label ?? ''}: ${worn ?? 'empty'}`, layout.slotInfo.x, layout.slotInfo.y,
            { size: 11, weight: 700, color: worn ? RarityColor(worn) : f.theme.muted, maxWidth: layout.candidates[0].width });
        f.Text(candidates.length ? 'From your backpack:' : 'Nothing in your backpack fits this slot.', layout.slotInfo.x, layout.slotInfo.y + 14,
            { size: 9, color: f.theme.muted, maxWidth: layout.candidates[0].width });
        const first = Math.max(0, Math.min(hud.selectedGearIndex - CandidateRows + 1, candidates.length - CandidateRows));
        layout.candidates.forEach((rect, row) => {
            const name = candidates[first + row];
            if (!name) return;
            const chosen = first + row === hud.selectedGearIndex;
            c.save();
            c.fillStyle = chosen ? 'rgba(92,72,26,.75)' : 'rgba(14,24,31,.9)';
            c.fillRect(rect.x, rect.y, rect.width, rect.height);
            c.strokeStyle = chosen ? '#e5c46d' : '#334249';
            c.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
            c.restore();
            DrawItemIcon(c, name, { x: rect.x + 3, y: rect.y + 3, width: rect.height - 6, height: rect.height - 6 });
            f.Text(name, rect.x + rect.height + 4, rect.y + 11, { size: 9, weight: 700, color: RarityColor(name), maxWidth: rect.width - rect.height - 8 });
            f.Text(hud.GearComparison(name, hud.selectedGearSlot), rect.x + rect.height + 4, rect.y + 22, { size: 8, color: f.theme.muted, maxWidth: rect.width - rect.height - 8 });
        });
        hud.Place(this.equip, layout.buttons.equip.x, layout.buttons.equip.y, layout.buttons.equip.width, 26, candidates.length > 0);
        hud.Place(this.unequip, layout.buttons.unequip.x, layout.buttons.unequip.y, layout.buttons.unequip.width, 26, Boolean(worn));

        this.DrawStats(layout.stats, campaign.StatBreakdown());

        // Hover cards.
        const dollRect = layout.doll.find(rect => Inside(pointer, rect));
        const row = layout.candidates.findIndex(rect => Inside(pointer, rect));
        if (dragging) DrawItemIcon(c, dragging.item, { x: pointer.x - 18, y: pointer.y - 18, width: 36, height: 36 });
        else if (dollRect && campaign.equipment[dollRect.slot]) DrawItemTooltip(hud, campaign.equipment[dollRect.slot], pointer, dollRect.slot);
        else if (row >= 0 && candidates[first + row]) DrawItemTooltip(hud, candidates[first + row], pointer);
    }

    /** Stat breakdown table, AP/MP budget and resistance bars. */
    DrawStats(area, stats) {
        const { frame: f } = this.hud, { x, width } = area;
        let y = area.y;
        const columns = [['BASE', 0.3], ['ATTR', 0.45], ['GEAR', 0.6], ['SKILL', 0.75], ['TOTAL', 0.92]];
        f.Text('STATS', x, y + 12, { size: 11, weight: 700, color: f.theme.gold });
        columns.forEach(([label, at]) => f.Text(label, x + width * at, y + 12, { size: 8, align: 'center', color: f.theme.muted }));
        y += 18;
        for (const [id, label] of BreakdownRows) {
            const entry = stats[id];
            f.Text(label, x, y + 12, { size: 10, weight: 700 });
            [entry.base, entry.trained, entry.gear, entry.passive].forEach((value, index) =>
                f.Text(index && value ? `+${value}` : `${value}`, x + width * columns[index][1], y + 12,
                    { size: 10, align: 'center', color: index && value ? '#9fe0a8' : index ? f.theme.muted : f.theme.text }));
            f.Text(`${entry.total}`, x + width * columns[4][1], y + 12, { size: 11, align: 'center', weight: 700, color: f.theme.gold });
            y += 17;
        }

        y += 8;
        f.Text('TURN BUDGET', x, y + 12, { size: 11, weight: 700, color: f.theme.gold });
        y += 18;
        for (const [id, label, color] of [['ap', 'AP', '#6fb7ff'], ['mp', 'MP', '#7bd88f']]) {
            const entry = stats[id];
            f.Text(`${label} ${entry.total}`, x, y + 12, { size: 11, weight: 700, color });
            f.Text(`base ${entry.base} + gear ${entry.gear} + scrolls ${entry.scrolls} · cap ${entry.cap}`, x + 48, y + 12, { size: 9, maxWidth: width - 50 });
            y += 17;
        }
        f.Text('Levels and attributes never raise AP/MP: find rare gear or scrolls.', x, y + 10, { size: 8, color: f.theme.muted, maxWidth: width });

        y += 22;
        f.Text('RESISTANCES', x, y + 12, { size: 11, weight: 700, color: f.theme.gold });
        y += 18;
        for (const [id, info] of Object.entries(Resistances)) {
            const entry = stats.resist[id];
            f.Text(info.label, x, y + 11, { size: 10, weight: 700, color: info.color });
            f.Meter(entry.total / ResistCap, { x: x + 56, y: y + 3, width: Math.max(40, width - 150), height: 8 }, info.color);
            f.Text(`${entry.total}%`, x + width - 88, y + 11, { size: 10, weight: 700, align: 'right' });
            f.Text(info.description, x + width - 82, y + 11, { size: 8, color: f.theme.muted, maxWidth: 82 });
            y += 17;
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

    /** Click a slot to select it, double-click to unequip; click / double-click candidates; drag ring to ring. */
    HandlePointer(pointer, candidates) {
        const hud = this.hud, campaign = hud.level.campaign, mouse = Input.instance.mouse;
        const touch = Input.instance.touch?.GetStartedTouches?.()?.[0];
        const point = touch ? Touch.ToScreen(touch.startPosition, hud.screen) : pointer;
        const layout = this.layout;
        if (mouse.buttonsDown?.[0] || touch) {
            const doll = layout.doll.find(rect => Inside(point, rect));
            const first = Math.max(0, Math.min(hud.selectedGearIndex - CandidateRows + 1, candidates.length - CandidateRows));
            const row = layout.candidates.findIndex(rect => Inside(point, rect));
            const key = doll ? `doll:${doll.slot}` : row >= 0 && candidates[first + row] ? `item:${candidates[first + row]}` : null;
            const double = key && this.lastClick?.key === key && this.clock - this.lastClick.time < 0.4;
            this.lastClick = key && !double ? { key, time: this.clock } : null;
            if (doll) {
                hud.SelectGearSlot(doll.slot);
                if (double && campaign.equipment[doll.slot]) { hud.level.UnequipItem(doll.slot); return; }
                if (campaign.equipment[doll.slot]) this.drag = { from: doll.slot, item: campaign.equipment[doll.slot], start: { ...point }, moved: false };
            }
            else if (key) {
                hud.selectedGearIndex = first + row;
                if (double) hud.ActivateGearSelection();
            }
            return;
        }
        if (this.drag && mouse.buttons?.[0] && Math.hypot(pointer.x - this.drag.start.x, pointer.y - this.drag.start.y) > 6) this.drag.moved = true;
        if (this.drag && (mouse.buttonsUp?.[0] || !mouse.buttons?.[0])) {
            const drag = this.drag, target = layout.doll.find(rect => Inside(pointer, rect));
            this.drag = null;
            if (!drag.moved || !target || target.slot === drag.from || !SlotAccepts(target.slot, drag.item)) return;
            // Ring to ring: move (or swap) between the two ring slots.
            const other = campaign.equipment[target.slot];
            hud.level.UnequipItem(drag.from);
            if (other) hud.level.UnequipItem(target.slot);
            hud.level.EquipItem(drag.item, target.slot);
            if (other) hud.level.EquipItem(other, drag.from);
            hud.SelectGearSlot(target.slot);
        }
    }
}
