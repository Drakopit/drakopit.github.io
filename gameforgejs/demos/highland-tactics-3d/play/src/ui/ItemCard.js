import { EquipmentSlot, EquipmentSlots, EquipmentStats, ItemInfo, ItemWeight, Resistances, SlotFor } from '../data/HighlandCampaign.js';
import { DrawItemIcon, RarityColor } from './ItemIcons.js';

/** Stat rows used by item cards and comparisons. */
export const CompareStats = Object.freeze([['attack', 'ATK'], ['defense', 'DEF'], ['magic', 'MAG'], ['ap', 'AP'], ['mp', 'MP'], ['speed', 'SPD'], ['hp', 'HP']]);

/** Item value for sorting and display: shop price, else the sell price. */
export function ItemValue(name) {
    return EquipmentStats(name)?.price ?? ItemInfo[name]?.price ?? ItemInfo[name]?.sell ?? 0;
}

/** Splits text into lines no wider than `width`, measuring with the canvas when it can. */
export function WrapText(context, text, width, size = 9) {
    const measure = value => context?.measureText?.(value)?.width ?? value.length * size * 0.55;
    const words = String(text ?? '').split(/\s+/).filter(Boolean), lines = [];
    let line = '';
    context?.save?.();
    if (context) context.font = `400 ${size}px Arial`;
    for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (line && measure(next) > width) { lines.push(line); line = word; }
        else line = next;
    }
    context?.restore?.();
    if (line) lines.push(line);
    return lines;
}

/**
 * The rich item card shared by inventory tooltips, the inventory details pane and the equipment
 * panel: rarity name, category and slot, wrapped description, stat bonuses, resistances, an
 * AP/MP badge for budget gear, weight and value, and for gear the change versus what it replaces.
 * Returns the lines as [text, options] so tests can read them without a canvas.
 */
export function ItemCardLines(hud, name, { equippedSlot = null, width = 240 } = {}) {
    const info = ItemInfo[name], f = hud.frame;
    if (!info) return [];
    const gear = EquipmentStats(name), kind = EquipmentSlot(name);
    const slotLabel = kind ? EquipmentSlots.find(slot => slot.accepts === kind)?.label : null;
    const lines = [
        [name, { size: 12, weight: 700, color: RarityColor(name) }],
        [[info.rarity.toUpperCase(), info.category, slotLabel].filter(Boolean).join(' · '), { size: 9, color: f.theme.muted }],
    ];
    for (const row of WrapText(hud.screen?.Context, info.description, width - 20, 9)) lines.push([row, { size: 9 }]);
    lines.push([hud.ItemModifiers(name), { size: 9, weight: 700 }]);
    const resist = Object.entries(gear?.resist ?? {}).filter(([, value]) => value > 0)
        .map(([id, value]) => `${Resistances[id].label} +${value}%`);
    if (resist.length) lines.push([`Resist: ${resist.join(' · ')}`, { size: 9, color: '#f0b27a' }]);
    if ((gear?.ap ?? 0) > 0 || (gear?.mp ?? 0) > 0 || info.permanent)
        lines.push(['★ Raises your AP/MP turn budget', { size: 9, weight: 700, color: '#c58ae0' }]);
    lines.push([`Weight ${ItemWeight(name)} · Value ${ItemValue(name)}G${info.sell ? ` · sells ${info.sell}G` : ''}`, { size: 9, color: f.theme.muted }]);
    if (gear && !equippedSlot) {
        const slot = SlotFor(name, hud.level.campaign.equipment);
        const current = hud.level.campaign.equipment[slot];
        lines.push([`vs ${current ?? 'empty slot'}: ${hud.GearComparison(name, slot)}`, { size: 9, weight: 700, color: f.theme.gold }]);
    }
    else if (equippedSlot) lines.push(['Equipped · double-click to unequip', { size: 9, color: f.theme.muted }]);
    return lines;
}

/** Draws a card at (x, y); returns its height. With `icon`, a large icon sits beside the name. */
export function DrawItemCard(hud, name, x, y, width, { equippedSlot = null, icon = false, panel = true } = {}) {
    const f = hud.frame, c = hud.screen.Context;
    const lines = ItemCardLines(hud, name, { equippedSlot, width: width - (icon ? 52 : 0) });
    if (!lines.length) return 0;
    const height = 16 + lines.length * 15 + (icon ? 6 : 0);
    if (panel) f.Panel({ x, y, width, height });
    const offset = icon ? 52 : 0;
    if (icon) DrawItemIcon(c, name, { x: x + 10, y: y + 10, width: 40, height: 40 });
    lines.forEach(([text, options], index) => {
        const indent = icon && index < 3 ? offset : 0;
        f.Text(text, x + 10 + indent, y + 20 + index * 15, { ...options, maxWidth: width - 20 - indent });
    });
    return height;
}

/** A tooltip card that stays on screen next to the pointer. */
export function DrawItemTooltip(hud, name, pointer, equippedSlot = null) {
    const s = hud.screen, width = Math.min(260, s.Width - 20);
    const lines = ItemCardLines(hud, name, { equippedSlot, width });
    const height = 16 + lines.length * 15;
    const x = Math.max(10, Math.min(s.Width - width - 10, pointer.x + 16));
    const y = Math.max(10, Math.min(s.Height - height - 10, pointer.y + 12));
    return DrawItemCard(hud, name, x, y, width, { equippedSlot });
}

export function Inside(point, rect) {
    return Boolean(rect && point) && point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}
