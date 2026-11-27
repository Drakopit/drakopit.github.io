import { Input } from 'gameforgejs/core';
import { Rectangle, Touch } from 'gameforgejs/2d';
import { GetAbilityProfile } from '../data/BattleRules.js';
import { GetSkill } from '../data/ClassSkills.js';
import { ItemInfo } from '../data/HighlandCampaign.js';
import { HotbarSlots } from '../data/HighlandActions.js';
import { DrawAbilityIcon, DrawItemIcon } from './ItemIcons.js';

/** Hotbar key labels for slots 1-10. */
export const HotbarKeys = Object.freeze(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']);

/**
 * Where the PC combat dock goes on a `width` x `height` canvas. Wide screens get one bar
 * (medallion | hotbar | Pass Turn); narrower ones put the medallion and Pass Turn on a row above
 * a full-width hotbar. `large` (Tablet) enlarges every touch target.
 */
export function DockLayout(width, height, large = false) {
    const margin = 10, gap = large ? 6 : 5, infoWidth = 196, passWidth = large ? 140 : 118;
    const maxSlot = large ? 64 : 52;
    const single = (width - margin * 2 - infoWidth - passWidth - 40 - gap * 9) / 10;
    if (single >= (large ? 56 : 44)) {
        const size = Math.min(maxSlot, single);
        const barHeight = size + 26, y = height - margin - barHeight;
        const hotbarWidth = size * 10 + gap * 9;
        const hotbarX = Math.max(margin + infoWidth + 20, (width - hotbarWidth) / 2);
        return {
            bar: { x: margin, y, width: width - margin * 2, height: barHeight },
            medallion: { cx: margin + 44, cy: y + barHeight / 2 - 4, r: Math.min(38, barHeight / 2 + 2) },
            info: { x: margin + 92, y: y + 18, width: infoWidth - 96 },
            slots: Array.from({ length: 10 }, (_, index) => ({ x: hotbarX + index * (size + gap), y: y + 13, size })),
            pass: { x: width - margin - passWidth - 8, y: y + 13, width: passWidth, height: size },
            message: { x: margin, y: y - 30, width: Math.max(160, width / 2 - margin * 2) },
            timeline: { right: width - margin, y: y - 48 },
            top: y - 52,
        };
    }
    const narrowGap = width < 480 ? 4 : gap;
    const size = Math.min(maxSlot, (width - margin * 2 - 16 - narrowGap * 9) / 10);
    const rowHeight = large ? 64 : 52, barHeight = rowHeight + size + 22, y = height - margin - barHeight;
    const hotbarWidth = size * 10 + narrowGap * 9, hotbarX = (width - hotbarWidth) / 2;
    return {
        bar: { x: margin, y, width: width - margin * 2, height: barHeight },
        medallion: { cx: margin + 34, cy: y + rowHeight / 2 + 2, r: rowHeight / 2 - 2 },
        info: { x: margin + 72, y: y + 16, width: Math.max(80, width - margin * 2 - passWidth - 96) },
        slots: Array.from({ length: 10 }, (_, index) => ({ x: hotbarX + index * (size + narrowGap), y: y + rowHeight + 8, size })),
        pass: { x: width - margin - passWidth - 8, y: y + 8, width: passWidth, height: rowHeight - 14 },
        message: { x: margin, y: y - 30, width: width - margin * 2 },
        timeline: { right: width - margin, y: y - 48 - 26 },
        top: y - 78,
    };
}

function Inside(point, rect) {
    return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

/**
 * The PC/Tablet combat dock, drawn on the HUD canvas: an HP/AP/MP medallion with portrait and turn
 * timer, the ten-slot hotbar, Pass Turn and the turn-order timeline. Every control calls the
 * same action layer as the keyboard and the radial ring.
 */
export class CombatDock {
    constructor(hud) {
        this.hud = hud;
        this.layout = null;
        this.hovered = -1;
        this.slots = HotbarKeys.map((_, index) => hud.Button('', () => hud.level.controls.ActivateSlot(index)));
        this.pass = hud.Button('PASS TURN', () => hud.level.actions.EndTurn());
    }

    Slots() {
        const l = this.hud.level;
        return HotbarSlots(l.turn, l.player, l.campaign);
    }

    /** The hotbar slot under the pointer (for the grid range preview), or null. */
    HoveredSlot() {
        return this.hovered >= 0 ? this.Slots()[this.hovered] ?? null : null;
    }

    /** Whether a screen point is over the dock (so world clicks there are ignored). */
    Contains(point) {
        const layout = this.layout;
        return Boolean(layout && point.y >= layout.bar.y);
    }

    Draw() {
        const { hud } = this, { level: l, screen: s, frame: f } = hud, t = l.turn;
        const layout = this.layout = DockLayout(s.Width, s.Height, Boolean(l.controlSettings?.largeTargets));
        const hero = l.player?.stats, active = t.active?.stats;
        const ours = active?.team === 'ally' && !t.result;
        f.Panel(layout.bar);
        this.DrawMedallion(hero, layout);
        // Hotbar
        const pointer = Touch.ToScreen(Input.instance.mouse.position, s);
        const slots = this.Slots();
        this.hovered = -1;
        layout.slots.forEach((rect, index) => {
            const slot = slots[index], item = this.slots[index];
            const box = { x: rect.x, y: rect.y, width: rect.size, height: rect.size };
            if (Inside(pointer, box)) this.hovered = index;
            const usable = ours && slot && !slot.blocked;
            item.button.enabled = Boolean(ours && slot && slot.kind !== 'empty');
            item.button.SetButton(new Rectangle(box.x, box.y, box.width, box.height));
            this.DrawSlot(slot, box, index, usable, t.phase === 'target' && slot?.id === t.ability);
        });
        // Pass Turn
        const canPass = ours && t.phase === 'command';
        hud.Place(this.pass, layout.pass.x, layout.pass.y, layout.pass.width, layout.pass.height, true, canPass);
        this.pass.button.enabled = canPass;
        f.Text('SPACE', layout.pass.x + layout.pass.width / 2, layout.pass.y + layout.pass.height - 6, {
            size: 8, align: 'center', color: canPass ? f.theme.gold : '#718087',
        });
        // Message and the turn-order timeline sit above the bar.
        f.Panel({ x: layout.message.x, y: layout.message.y, width: layout.message.width, height: 24 });
        f.Text(this.Hint(), layout.message.x + 10, layout.message.y + 16, { size: 10, color: f.theme.gold, maxWidth: layout.message.width - 20 });
        this.DrawTimeline(layout);
        if (this.hovered >= 0 && slots[this.hovered]) this.DrawSlotTooltip(slots[this.hovered], layout.slots[this.hovered], layout);
    }

    Hint() {
        const t = this.hud.level.turn, active = t.active?.stats;
        if (!active || active.team !== 'ally') return t.message;
        if (t.phase === 'target') return `${t.message} · click a highlighted foe · Esc / right-click cancels`;
        if (t.phase === 'command') return `${t.message} · click a blue tile to move · 1-0 hotbar · Space pass`;
        return t.message;
    }

    DrawMedallion(hero, layout) {
        const { hud } = this, { level: l, screen: s, frame: f } = hud, c = s.Context, t = l.turn;
        const { cx, cy, r } = layout.medallion;
        if (!hero) return;
        c.save();
        c.beginPath(); c.arc(cx, cy, r + 4, 0, Math.PI * 2);
        c.fillStyle = 'rgba(7,14,21,.96)'; c.fill();
        // HP ring
        c.lineWidth = 5;
        c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.strokeStyle = '#3a2a2c'; c.stroke();
        c.beginPath(); c.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, hero.hp / hero.maxHp));
        c.strokeStyle = hero.hp / hero.maxHp > 0.35 ? '#72d4b0' : '#e0705f'; c.stroke();
        // Turn timer
        const left = t.TimeLeft?.();
        if (left !== null && left !== undefined && t.turnLimit) {
            c.lineWidth = 2;
            c.beginPath(); c.arc(cx, cy, r + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left / t.turnLimit);
            c.strokeStyle = left < 10 ? '#ff8a6a' : f.theme.gold; c.stroke();
        }
        c.restore();
        hud.DrawUnitPortrait(c, cx, cy, hero, t.active === l.player, r - 7);
        const info = layout.info;
        f.Text(`${hero.name}`, info.x, info.y, { size: 11, weight: 700, maxWidth: info.width });
        f.Text(`HP ${hero.hp}/${hero.maxHp}${left !== null && left !== undefined ? ` · ${Math.ceil(left)}s` : ''}`, info.x, info.y + 15, { size: 10, maxWidth: info.width });
        this.DrawPips(info.x, info.y + 24, hero.ap ?? 0, hero.apMax ?? 0, '#5cb8ff', 'AP', info.width);
        this.DrawPips(info.x, info.y + 38, hero.mp ?? 0, hero.mpMax ?? 0, '#7fdc76', 'MP', info.width);
    }

    DrawPips(x, y, value, max, color, label, width) {
        const { frame: f, screen: s } = this.hud, c = s.Context;
        f.Text(`${label} ${value}`, x, y + 9, { size: 9, weight: 700, color });
        const size = Math.max(4, Math.min(9, (width - 40) / Math.max(1, max) - 2));
        c.save();
        for (let i = 0; i < max; i++) {
            c.beginPath();
            c.rect(x + 38 + i * (size + 2), y + 2, size, size);
            c.fillStyle = i < value ? color : 'rgba(80,92,98,.6)';
            c.fill();
        }
        c.restore();
    }

    DrawSlot(slot, box, index, usable, aimed) {
        const { frame: f, screen: s, level: l } = this.hud, c = s.Context;
        c.save();
        c.fillStyle = aimed ? 'rgba(92,72,26,.95)' : 'rgba(12,22,30,.94)';
        c.fillRect(box.x, box.y, box.width, box.height);
        c.strokeStyle = aimed ? '#fff1be' : index === this.hovered ? '#e5c46d' : 'rgba(160,150,110,.55)';
        c.lineWidth = aimed ? 2.5 : 1.2;
        c.strokeRect(box.x + 0.5, box.y + 0.5, box.width - 1, box.height - 1);
        c.restore();
        const inset = { x: box.x + box.width * 0.18, y: box.y + box.height * 0.16, width: box.width * 0.64, height: box.height * 0.64 };
        const stats = l.turn.active?.stats ?? l.player?.stats;
        if (slot?.kind === 'ability') DrawAbilityIcon(c, GetAbilityProfile(stats, slot.id), inset, { muted: slot.locked || !usable });
        else if (slot?.kind === 'item') {
            c.save(); if (!usable) c.globalAlpha = 0.45;
            DrawItemIcon(c, slot.id, inset, { frame: false });
            c.restore();
        }
        // Cooldown shade
        const cooldown = slot?.kind === 'ability' ? stats?.cooldowns?.[slot.id] ?? 0 : 0;
        if (cooldown > 0 || slot?.locked) {
            c.save(); c.fillStyle = 'rgba(5,10,14,.55)'; c.fillRect(box.x, box.y, box.width, box.height); c.restore();
        }
        if (cooldown > 0) f.Text(`${cooldown}`, box.x + box.width / 2, box.y + box.height / 2 + 6, { size: Math.round(box.width * 0.36), align: 'center', weight: 700, color: '#fff1be' });
        if (slot?.locked && slot.kind === 'ability') this.DrawLock(box);
        // Key, AP cost and stack badges
        f.Text(HotbarKeys[index], box.x + 4, box.y + 10, { size: 8, weight: 700, color: f.theme.gold });
        const cost = slot?.kind === 'ability' ? GetAbilityProfile(stats, slot.id).ap : slot?.kind === 'item' ? ItemInfo[slot.id].use.ap : null;
        if (cost !== null && cost !== undefined) this.Badge(box.x + 2, box.y + box.height - 13, `${cost}`, '#2d6fb0');
        if (slot?.kind === 'item') f.Text(`×${slot.count}`, box.x + box.width - 3, box.y + box.height - 3, { size: 9, align: 'right', weight: 700, color: slot.count ? '#ffffff' : '#a06a63' });
    }

    Badge(x, y, text, color) {
        const { frame: f, screen: s } = this.hud, c = s.Context;
        c.save();
        c.beginPath(); c.arc(x + 6, y + 6, 6.5, 0, Math.PI * 2); c.fillStyle = color; c.fill();
        c.restore();
        f.Text(text, x + 6, y + 9.5, { size: 8, align: 'center', weight: 700, color: '#ffffff' });
    }

    DrawLock(box) {
        const c = this.hud.screen.Context, x = box.x + box.width - 11, y = box.y + 9;
        c.save();
        c.strokeStyle = '#c9c1a4'; c.fillStyle = '#c9c1a4'; c.lineWidth = 1.4;
        c.beginPath(); c.arc(x, y, 3, Math.PI, 0); c.stroke();
        c.fillRect(x - 4, y, 8, 6);
        c.restore();
    }

    DrawSlotTooltip(slot, rect, layout) {
        const { frame: f, screen: s, level: l } = this.hud;
        if (slot.kind === 'empty') return;
        const stats = l.turn.active?.stats ?? l.player?.stats;
        let title, detail, description;
        if (slot.kind === 'ability') {
            const profile = GetAbilityProfile(stats, slot.id), skill = GetSkill(stats.archetype, slot.id);
            title = profile.name;
            detail = `${profile.ap} AP · range ${profile.range}${profile.cooldown ? ` · cooldown ${profile.cooldown}` : ''}${profile.perTurn ? ` · ${profile.perTurn}/turn` : ''}`;
            description = skill?.description ?? 'Your calling\'s basic attack.';
        }
        else {
            const info = ItemInfo[slot.id];
            title = `${slot.id} ×${slot.count}`;
            detail = `${info.use.ap} AP${info.use.perTurn ? ` · ${info.use.perTurn}/turn` : ''}`;
            description = info.description;
        }
        const width = Math.min(260, s.Width - 20), height = slot.blocked ? 78 : 62;
        const x = Math.max(10, Math.min(s.Width - width - 10, rect.x + rect.size / 2 - width / 2));
        const y = Math.max(this.hud.headerHeight, layout.top - height - 4);
        f.Panel({ x, y, width, height });
        f.Text(title, x + 10, y + 18, { size: 11, weight: 700, color: f.theme.gold, maxWidth: width - 20 });
        f.Text(detail, x + 10, y + 34, { size: 9, maxWidth: width - 20 });
        f.Text(description, x + 10, y + 50, { size: 9, color: f.theme.muted, maxWidth: width - 20 });
        if (slot.blocked) f.Text(slot.blocked, x + 10, y + 68, { size: 9, weight: 700, color: '#e38a78', maxWidth: width - 20 });
    }

    /** Turn order: the active unit first, then by time until each reaches full CT. */
    Order() {
        const t = this.hud.level.turn;
        return t.Alive().slice().sort((a, b) => {
            if (a === t.active) return -1;
            if (b === t.active) return 1;
            return (100 - a.stats.ct) / a.stats.speed - (100 - b.stats.ct) / b.stats.speed;
        });
    }

    DrawTimeline(layout) {
        const { frame: f, screen: s, level: l } = this.hud, c = s.Context;
        const order = this.Order().slice(0, Math.max(3, Math.min(8, Math.floor((s.Width / 2 - 20) / 40))));
        const step = 40, width = order.length * step + 12;
        const x = layout.timeline.right - width, y = layout.timeline.y;
        f.Panel({ x, y, width, height: 44 });
        order.forEach((pawn, index) => {
            const cx = x + 12 + index * step + 14, cy = y + 18;
            this.hud.DrawUnitPortrait(c, cx, cy, pawn.stats, pawn === l.turn.active, 13);
            f.Meter(pawn.stats.hp / pawn.stats.maxHp, { x: cx - 14, y: y + 35, width: 28, height: 4 },
                pawn.stats.team === 'ally' ? '#7cddc5' : '#ed9c91');
        });
    }
}
