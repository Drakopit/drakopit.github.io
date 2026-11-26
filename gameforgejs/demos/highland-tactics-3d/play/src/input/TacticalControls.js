import { ActionManager, Input, Touch } from 'gameforgejs/core';
import { Commands, Facings } from '../data/BattleRules.js';
import { ActiveSkills } from '../data/ClassSkills.js';

/** Shared command routing for keyboard, gamepad, native buttons, and world picking. */
export class TacticalControls {
    constructor(level) {
        this.level = level;
        this.repeat = 0;
        this.previous = '';
        this.suppressWorldClick = false;
        this.facingPointer = null;
    }

    SuppressNextWorldClick() {
        this.suppressWorldClick = true;
    }

    Update(dt) {
        const l = this.level, t = l.turn;
        if (typeof document !== 'undefined' && document.activeElement?.closest('.highland-accessibility')) return;
        if (ActionManager.IsActionDown('HELP'))
            l.hud.help.Toggle();
        if (l.hud.help.visible) return;
        if (l.exploring === 'battle' && t.phase === 'command' && ActionManager.IsActionDown('RADIAL_MENU')) {
            l.hud.ToggleRing();
            return;
        }
        if (l.exploring === 'explore') {
            const panelActions = [
                ['INVENTORY', 'bag'],
                ['EQUIPMENT', 'gear'],
                ['CHARACTER', 'hero'],
                ['PARTY', 'party'],
            ];
            for (const [action, panel] of panelActions) {
                if (ActionManager.IsActionDown(action)) {
                    l.hud.TogglePanel(panel);
                    return;
                }
            }
        }
        if (l.exploring === 'explore' && ActionManager.IsActionDown('SKILLS')) {
            l.hud.TogglePanel('skills');
            return;
        }
        if (l.exploring === 'explore' && ActionManager.IsActionDown('WORLD_MAP')) {
            l.hud.TogglePanel('map');
            return;
        }
        if (l.exploring === 'explore' && l.hud.panel === 'bag') {
            if (ActionManager.IsActionDown('PANEL_PREV')) { l.hud.CycleBagCategory(-1); return; }
            if (ActionManager.IsActionDown('PANEL_NEXT')) { l.hud.CycleBagCategory(1); return; }
        }
        if (l.exploring === 'battle' && t.phase === 'command' && l.hud.ringOpen) {
            for (let index = 0; index < l.hud.ringItems.length; index++) {
                if (ActionManager.IsActionDown(`RADIAL_${index + 1}`)) {
                    l.hud.ActivateRing(index);
                    return;
                }
            }
            if (ActionManager.IsActionDown('CANCEL')) {
                l.hud.CloseRing();
                return;
            }
            if (ActionManager.IsActionDown('CONFIRM')) {
                l.hud.ActivateRing();
                return;
            }
            const direction = ['UP', 'RIGHT', 'DOWN', 'LEFT'].find(action => ActionManager.IsActionDown(action));
            if (direction) {
                const step = direction === 'RIGHT' || direction === 'DOWN' ? 1 : -1;
                l.hud.SelectRing(l.hud.ringSelected + step);
                return;
            }
            if (Input.instance.mouse.buttonsDown[0]) {
                const point = Touch.ToScreen(Input.instance.mouse.position, l.ui.Screen);
                if (l.hud.RingItemAt(point) < 0 && !l.hud.RingTriggerAt(point)) l.hud.CloseRing();
            }
            return;
        }
        if (l.exploring === 'battle' && ActionManager.IsActionDown('RESET'))
            l.ResetBattle();
        if (ActionManager.IsActionDown('ORBIT_LEFT'))
            l.cameraStep--;
        if (ActionManager.IsActionDown('ORBIT_RIGHT'))
            l.cameraStep++;
        if (ActionManager.IsActionDown('WEATHER'))
            l.environment?.ToggleRain();
        if (t.result || ['creation', 'result'].includes(l.exploring))
            return;
        if (this.suppressWorldClick) {
            const pointerDown = Input.instance.mouse.buttonsDown[0] || Input.instance.touch.GetStartedTouches().length > 0;
            this.suppressWorldClick = false;
            if (pointerDown) return;
        }
        this.UpdateEncounterHover();

        const direction = ['UP', 'RIGHT', 'DOWN', 'LEFT'].find(action =>
            ActionManager.IsActionDown(action) || ActionManager.IsAction(action));
        this.repeat -= dt;
        if (direction && (ActionManager.IsActionDown(direction) || direction !== this.previous || this.repeat <= 0)) {
            this.repeat = direction === this.previous ? 0.17 : 0.3;
            const index = ['UP', 'RIGHT', 'DOWN', 'LEFT'].indexOf(direction);
            if (l.exploring === 'explore' && !l.hud.panel)
                l.StepExplore(index);
            else if (l.exploring === 'explore' && l.hud.panel === 'bag')
                l.hud.MoveBagSelection(direction);
            else if (l.exploring === 'explore' && l.hud.panel === 'shop') {
                if (direction === 'UP' || direction === 'DOWN')
                    l.hud.MoveShopSelection(direction === 'UP' ? -1 : 1);
                else
                    l.hud.SelectShopTab(direction === 'LEFT' ? 'buy' : 'sell');
            }
            else if (t.phase === 'command')
                t.command = (t.command + (index === 0 || index === 3 ? -1 : 1) + Commands.length) % Commands.length;
            else if (t.phase === 'face')
                t.active.stats.facing = index;
            else if (t.phase === 'skill-select') {
                const skills = ActiveSkills(t.active.stats.archetype, t.active.stats.unlockedSkills);
                t.skillCursor = (t.skillCursor + (index === 0 || index === 3 ? -1 : 1) + skills.length) % Math.max(1, skills.length);
            }
            else if (['move', 'target'].includes(t.phase)) {
                const facing = Facings[index], tile = l.grid.Get(t.cursor.col + facing.col, t.cursor.row + facing.row);
                if (tile)
                    t.cursor = { col: tile.col, row: tile.row };
            }
            l.sound.Play('select');
        }
        this.previous = direction ?? '';
        if (l.exploring === 'explore') {
            if (ActionManager.IsActionDown('CANCEL')) {
                if (l.hud.panel)
                    l.hud.panel = null;
                else
                    l.CancelExploreMove();
                return;
            }
            if (l.hud.panel === 'party' && ActionManager.IsActionDown('CONFIRM')) {
                l.ToggleCompanion();
                return;
            }
            if (l.hud.panel === 'bag' && ActionManager.IsActionDown('CONFIRM')) {
                l.hud.ActivateBagItem();
                return;
            }
            if (l.hud.panel === 'shop' && ActionManager.IsActionDown('CONFIRM')) {
                l.hud.ActivateShopOffer();
                return;
            }
            if (!l.hud.panel && (ActionManager.IsActionDown('INTERACT') || ActionManager.IsActionDown('CONFIRM'))) {
                l.InteractShopkeeper();
                return;
            }
            this.PickExploreTile();
            return;
        }
        if (ActionManager.IsActionDown('CANCEL')) {
            t.Cancel();
            return;
        }
        this.UpdateBattleHover();
        if (t.phase === 'face') {
            const point = Touch.ToScreen(Input.instance.mouse.position, l.ui.Screen);
            if (!this.facingPointer || point.x !== this.facingPointer.x || point.y !== this.facingPointer.y) {
                const facing = l.terrain.FacingAtPoint(point, t, l.camera, l.ui.Screen);
                if (facing >= 0) t.active.stats.facing = facing;
                this.facingPointer = { x: point.x, y: point.y };
            }
            for (const raw of this.Points()) {
                const facing = l.terrain.FacingAtPoint(Touch.ToScreen(raw, l.ui.Screen), t, l.camera, l.ui.Screen);
                if (facing >= 0) {
                    t.active.stats.facing = facing;
                    t.EndTurn();
                    return;
                }
            }
        }
        else this.facingPointer = null;
        if (t.phase === 'move' || t.phase === 'target')
            this.PickTile();
        if (ActionManager.IsActionDown('CONFIRM'))
            this.Confirm();
    }

    Points() {
        const points = Input.instance.touch.GetStartedTouches().map(contact => contact.startPosition);
        if (Input.instance.mouse.buttonsDown[0])
            points.push(Input.instance.mouse.position);
        return points;
    }

    UpdateEncounterHover() {
        const l = this.level;
        l.hoveredEncounter = null;
        if (l.exploring !== 'explore' || !l.GroupLeaders().length || l.hud.panel) return;
        const point = Touch.ToScreen(Input.instance.mouse.position, l.ui.Screen);
        if (point.y < l.hud.headerHeight || point.y > l.ui.Screen.Height - 116) return;
        const tile = l.terrain.Pick(point, l.camera, l.ui.Screen);
        l.hoveredEncounter = l.GroupAt(tile);
    }

    UpdateBattleHover() {
        const l = this.level;
        const point = Touch.ToScreen(Input.instance.mouse.position, l.ui.Screen);
        const tile = point.y >= l.hud.headerHeight && point.y <= l.ui.Screen.Height - 116
            ? l.terrain.Pick(point, l.camera, l.ui.Screen) : null;
        l.hoveredPawn = tile ? l.turn.Alive().find(pawn =>
            pawn.stats.col === tile.col && pawn.stats.row === tile.row) ?? null : null;
    }

    PickTile() {
        const l = this.level, t = l.turn;
        for (const raw of this.Points()) {
            const point = Touch.ToScreen(raw, l.ui.Screen);
            if (point.y < l.hud.headerHeight || point.y > l.ui.Screen.Height - 116)
                continue;
            const tile = l.terrain.Pick(point, l.camera, l.ui.Screen);
            if (tile) {
                t.cursor = { col: tile.col, row: tile.row };
                this.Confirm();
                break;
            }
        }
    }

    PickExploreTile() {
        const l = this.level;
        if (l.hud.panel) return;
        for (const raw of this.Points()) {
            const point = Touch.ToScreen(raw, l.ui.Screen);
            const headerHeight = l.hud.headerHeight;
            const bottomInset = l.ui.Screen.Width < 640 ? 132 : 90;
            if (point.y < headerHeight || point.y > l.ui.Screen.Height - bottomInset)
                continue;
            const tile = l.terrain.Pick(point, l.camera, l.ui.Screen);
            if (tile) {
                l.turn.cursor = { col: tile.col, row: tile.row };
                if (l.IsShopkeeperTile(tile))
                    l.ApproachShopkeeper();
                else
                    l.MoveExplore(tile);
                break;
            }
        }
    }

    Confirm() {
        const t = this.level.turn;
        if (t.phase === 'command') {
            if (this.level.hud.CommandAvailable(t.command)) t.Choose(t.command);
            else t.message = `${Commands[t.command]} is unavailable this turn.`;
        }
        else if (t.phase === 'move') {
            if (!t.Move(t.cursor))
                t.message = 'Choose a blue reachable tile';
        }
        else if (t.phase === 'target') {
            const target = t.Alive().find(p => p.stats.col === t.cursor.col && p.stats.row === t.cursor.row);
            if (!t.Attack(target))
                t.message = 'Choose a highlighted target in reach and line of sight';
        }
        else if (t.phase === 'face')
            t.EndTurn();
        else if (t.phase === 'item')
            this.level.UseBattlePotion();
        else if (t.phase === 'skill-select') {
            const skills = ActiveSkills(t.active.stats.archetype, t.active.stats.unlockedSkills);
            const skill = skills[t.skillCursor ?? 0];
            if (skill) t.SelectSkill(skill.id);
        }
    }
}
