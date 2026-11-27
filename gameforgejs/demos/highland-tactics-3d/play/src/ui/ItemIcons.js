import { ItemInfo } from '../data/HighlandCampaign.js';

/** Frame colours by item rarity (Diablo-style). */
export const RarityColors = Object.freeze({ common: '#8a979c', uncommon: '#67c08f', rare: '#68a6e6', epic: '#c58ae0' });

export function RarityColor(name) {
    return RarityColors[ItemInfo[name]?.rarity] ?? RarityColors.common;
}

const Flasks = Object.freeze({ potion: '#c45a7c', ether: '#5c8fe0', antidote: '#6dbb63' });

/** Draws the outline icon of an item kind (`icon` from ItemInfo, or a slot kind) centred in `rect`. */
export function DrawIconShape(c, icon, rect, { fill = '#7294a3', stroke = '#c8d0d2', alpha = 1 } = {}) {
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    const k = Math.max(0.6, Math.min(rect.width, rect.height) / 26);
    const p = (dx, dy) => [x + dx * k, y + dy * k];
    const path = points => { c.moveTo(...p(...points[0])); for (const point of points.slice(1)) c.lineTo(...p(...point)); c.closePath(); };
    c.save();
    c.globalAlpha = alpha;
    c.lineWidth = Math.max(1.5, 1.6 * k);
    c.strokeStyle = stroke;
    c.fillStyle = Flasks[icon] ?? fill;
    c.beginPath();
    if (Flasks[icon]) {
        path([[-4, -8], [4, -8], [3, -3], [7, 3], [6, 8], [-6, 8], [-7, 3], [-3, -3]]);
        c.fill(); c.stroke();
    }
    else if (icon === 'blade' || icon === 'weapon') {
        c.moveTo(...p(7, -9)); c.lineTo(...p(-3, 5)); c.stroke();
        c.beginPath(); c.moveTo(...p(-7, 1)); c.lineTo(...p(1, 7)); c.stroke();
        c.beginPath(); c.moveTo(...p(-4, 6)); c.lineTo(...p(-7, 9)); c.stroke();
    }
    else if (icon === 'staff') {
        c.moveTo(...p(-5, 9)); c.lineTo(...p(4, -5)); c.stroke();
        c.beginPath(); c.arc(...p(5, -6), 3.2 * k, 0, Math.PI * 2); c.fill(); c.stroke();
    }
    else if (icon === 'ring') {
        c.arc(...p(0, 2), 5.5 * k, 0, Math.PI * 2); c.stroke();
        c.beginPath(); path([[-3, -4], [0, -9], [3, -4]]); c.fill(); c.stroke();
    }
    else if (icon === 'amulet') {
        c.moveTo(...p(-7, -9)); c.quadraticCurveTo(...p(0, 2), ...p(7, -9)); c.stroke();
        c.beginPath(); path([[0, -1], [5, 4], [0, 9], [-5, 4]]); c.fill(); c.stroke();
    }
    else if (icon === 'cloak') {
        path([[-4, -9], [4, -9], [9, 9], [3, 7], [0, 9], [-3, 7], [-9, 9]]); c.fill(); c.stroke();
    }
    else if (icon === 'belt') {
        c.rect(...p(-9, -3), 18 * k, 6 * k); c.fill(); c.stroke();
        c.beginPath(); c.rect(...p(-2.5, -3.5), 5 * k, 7 * k); c.stroke();
    }
    else if (icon === 'boots') {
        path([[-5, -9], [2, -9], [2, 2], [8, 4], [8, 8], [-5, 8]]); c.fill(); c.stroke();
    }
    else if (icon === 'gloves') {
        path([[-5, 9], [-6, -3], [-3, -3], [-3, -9], [3, -9], [4, -2], [7, -3], [5, 4], [3, 9]]); c.fill(); c.stroke();
    }
    else if (icon === 'helm') {
        path([[-8, 7], [-8, -3], [-4, -9], [4, -9], [8, -3], [8, 7], [3, 7], [3, 0], [-3, 0], [-3, 7]]); c.fill(); c.stroke();
    }
    else if (icon === 'shield' || icon === 'offhand') {
        path([[0, -9], [8, -6], [7, 3], [0, 9], [-7, 3], [-8, -6]]); c.fill(); c.stroke();
        c.beginPath(); c.moveTo(...p(0, -7)); c.lineTo(...p(0, 7)); c.stroke();
    }
    else if (icon === 'scroll') {
        c.rect(...p(-7, -7), 14 * k, 14 * k); c.fillStyle = '#e8d6a4'; c.fill(); c.stroke();
        c.beginPath(); c.arc(...p(-7, -7), 2.5 * k, 0, Math.PI * 2); c.arc(...p(-7, 7), 2.5 * k, 0, Math.PI * 2); c.stroke();
        c.beginPath(); c.moveTo(...p(-3, -2)); c.lineTo(...p(4, -2)); c.moveTo(...p(-3, 2)); c.lineTo(...p(4, 2)); c.strokeStyle = '#9b6bd1'; c.stroke();
    }
    else if (icon === 'shard') {
        path([[0, -10], [5, -2], [2, 9], [-3, 9], [-5, -2]]); c.fillStyle = '#e07a4c'; c.fill(); c.stroke();
        c.beginPath(); c.moveTo(...p(0, -10)); c.lineTo(...p(-1, 9)); c.stroke();
    }
    else if (icon === 'pelt') {
        path([[-8, -6], [-3, -9], [3, -9], [8, -6], [6, 2], [8, 8], [0, 6], [-8, 8], [-6, 2]]); c.fillStyle = '#8c6a4c'; c.fill(); c.stroke();
    }
    else if (icon === 'herb') {
        c.moveTo(...p(0, 9)); c.lineTo(...p(0, -2)); c.stroke();
        c.beginPath(); c.ellipse(...p(-4, -4), 4 * k, 6 * k, -0.6, 0, Math.PI * 2); c.fillStyle = '#7fb26b'; c.fill(); c.stroke();
        c.beginPath(); c.ellipse(...p(4, -4), 4 * k, 6 * k, 0.6, 0, Math.PI * 2); c.fill(); c.stroke();
    }
    else {
        // Chest armour (also the fallback shape).
        path([[0, -8], [8, -4], [6, 8], [0, 10], [-6, 8], [-8, -4]]); c.fill(); c.stroke();
    }
    c.restore();
}

/** An item's icon with its rarity frame; `equipped` items glow gold. */
export function DrawItemIcon(c, name, rect, { equipped = false, frame = true } = {}) {
    const info = ItemInfo[name];
    DrawIconShape(c, info?.icon ?? 'armor', rect, {
        stroke: equipped ? '#e5c46d' : '#d4dbdd',
        fill: equipped ? '#b38b4e' : '#7294a3',
    });
    if (!frame) return;
    c.save();
    c.strokeStyle = RarityColor(name);
    c.lineWidth = 1.5;
    c.strokeRect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2);
    c.restore();
}

/** The faded glyph an empty paper-doll slot shows for the kind of item it takes. */
export function DrawEmptySlot(c, kind, rect) {
    DrawIconShape(c, kind === 'armor' ? 'armor' : kind, rect, { fill: 'rgba(0,0,0,0)', stroke: '#5f6f76', alpha: 0.7 });
}

/** A glyph for an ability, picked from its profile: heal, shield, haste, ranged, magic or melee. */
export function DrawAbilityIcon(c, profile, rect, { muted = false } = {}) {
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    const k = Math.min(rect.width, rect.height) / 26;
    const kind = profile.heal ? 'heal' : profile.shield ? 'shield' : profile.haste ? 'haste'
        : profile.magic ? 'magic' : profile.range > 1 ? 'ranged' : 'melee';
    const color = muted ? '#6f7c82' : { heal: '#86e3b5', shield: '#84caff', haste: '#f5dc82', magic: '#c39cff', ranged: '#9fd38a', melee: '#f0b58a' }[kind];
    c.save();
    c.strokeStyle = color;
    c.fillStyle = color;
    c.lineWidth = Math.max(1.5, 2 * k);
    c.beginPath();
    if (kind === 'heal') {
        c.rect(x - 2.5 * k, y - 8 * k, 5 * k, 16 * k); c.rect(x - 8 * k, y - 2.5 * k, 16 * k, 5 * k); c.fill();
    }
    else if (kind === 'shield') {
        c.moveTo(x, y - 9 * k); c.lineTo(x + 8 * k, y - 6 * k); c.lineTo(x + 7 * k, y + 3 * k);
        c.lineTo(x, y + 9 * k); c.lineTo(x - 7 * k, y + 3 * k); c.lineTo(x - 8 * k, y - 6 * k); c.closePath(); c.stroke();
    }
    else if (kind === 'haste') {
        c.moveTo(x + 2 * k, y - 9 * k); c.lineTo(x - 5 * k, y + 1 * k); c.lineTo(x, y + 1 * k);
        c.lineTo(x - 2 * k, y + 9 * k); c.lineTo(x + 6 * k, y - 2 * k); c.lineTo(x + 1 * k, y - 2 * k); c.closePath(); c.fill();
    }
    else if (kind === 'magic') {
        for (let i = 0; i < 10; i++) {
            const angle = -Math.PI / 2 + i * Math.PI / 5, radius = (i % 2 ? 3.5 : 9) * k;
            const px = x + Math.cos(angle) * radius, py = y + Math.sin(angle) * radius;
            if (i) c.lineTo(px, py); else c.moveTo(px, py);
        }
        c.closePath(); c.fill();
    }
    else if (kind === 'ranged') {
        c.moveTo(x - 8 * k, y + 8 * k); c.lineTo(x + 7 * k, y - 7 * k); c.stroke();
        c.beginPath(); c.moveTo(x + 8 * k, y - 8 * k); c.lineTo(x + 1 * k, y - 6 * k); c.lineTo(x + 6 * k, y - 1 * k); c.closePath(); c.fill();
        c.beginPath(); c.moveTo(x - 8 * k, y + 8 * k); c.lineTo(x - 8 * k, y + 3 * k); c.moveTo(x - 8 * k, y + 8 * k); c.lineTo(x - 3 * k, y + 8 * k); c.stroke();
    }
    else {
        c.moveTo(x + 8 * k, y - 8 * k); c.lineTo(x - 4 * k, y + 4 * k); c.stroke();
        c.beginPath(); c.moveTo(x - 7 * k, y); c.lineTo(x, y + 7 * k); c.stroke();
        c.beginPath(); c.moveTo(x - 4 * k, y + 4 * k); c.lineTo(x - 8 * k, y + 8 * k); c.stroke();
    }
    if (profile.splash || profile.healSplash) {
        c.globalAlpha = 0.6;
        c.lineWidth = Math.max(1, k);
        c.beginPath(); c.arc(x, y, 11 * k, 0, Math.PI * 2); c.stroke();
    }
    c.restore();
}
