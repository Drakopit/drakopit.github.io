import { ActionManager, Input, Touch } from 'gameforgejs/core';
import { Commands, Facings } from '../data/BattleRules.js';
import { ActiveSkills } from '../data/ClassSkills.js';
import { DefaultTarget } from './ControlModes.js';
import { CommandAvailable, FaceNearestEnemy, HotbarSlots } from '../data/HighlandActions.js';

/** Phases in which the PC dock's hotbar keys apply. */
const HotbarPhases = new Set(['command', 'move', 'target', 'skill-select', 'item']);

/**
 * Shared command routing for keyboard, gamepad, native buttons, and world picking. With the dock
 * (PC, Tablet) keys 1-0 trigger hotbar slots, Space passes the turn, clicking a reachable tile
 * walks there and clicking a foe aims the basic attack (a second click confirms).
 */
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
        if (l.exploring === 'creation' && l.hud.nameField?.isActive) return;
        if (ActionManager.IsActionDown('HELP'))
            l.hud.help.Toggle();
        if (l.hud.help.visible) return;
        if (l.exploring === 'battle' && t.phase === 'command' && ActionManager.IsActionDown('RADIAL_MENU')) {
            l.hud.ToggleRing();
            return;
        }
        if (this.DockTurn() && HotbarPhases.has(t.phase)) {
            for (let index = 0; index < 10; index++) {
                if (!ActionManager.IsActionDown(`RADIAL_${index + 1}`)) continue;
                this.ActivateSlot(index);
                return;
            }
            if (t.phase === 'command' && ActionManager.IsActionDown('PASS_TURN')) {
                l.actions.EndTurn();
                return;
            }
        }
        if (l.exploring === 'battle' && t.phase === 'command' && !l.controlSettings.dock
            && ['PC', 'Personalizado'].includes(l.controlSettings.mode)) {
            for (let index = 0; index < 9; index++) {
                if (!ActionManager.IsActionDown(`RADIAL_${index + 1}`)) continue;
                this.SelectHotkey(index + 1);
                return;
            }
        }
        if (l.exploring === 'explore') {
            const panelActions = [
                ['INVENTORY', 'bag'],
                ['EQUIPMENT', 'gear'],
                ['CHARACTER', 'hero'],
                ['PARTY', 'party'],
                ['SETTINGS', 'settings'],
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
        if (l.exploring === 'explore' && ['bag', 'gear'].includes(l.hud.panel)) {
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
            else if (l.exploring === 'explore' && l.hud.panel === 'gear')
                l.hud.MoveGearSelection(direction);
            else if (l.exploring === 'explore' && l.hud.panel === 'shop') {
                if (direction === 'UP' || direction === 'DOWN')
                    l.hud.MoveShopSelection(direction === 'UP' ? -1 : 1);
                else
                    l.hud.SelectShopTab(direction === 'LEFT' ? 'buy' : 'sell');
            }
            else if (l.exploring === 'explore' && l.hud.panel === 'settings')
                l.hud.MoveSettingsSelection(index === 0 || index === 3 ? -1 : 1);
            else if (l.exploring === 'explore' && l.hud.panel === 'map')
                l.hud.MoveMapSelection(index === 0 || index === 3 ? -1 : 1);
            else if (l.exploring === 'explore' && l.hud.panel === 'skills')
                l.hud.MoveSkillTreeSelection(index === 0 || index === 3 ? -1 : 1);
            else if (l.exploring === 'explore' && l.hud.panel === 'hero')
                l.hud.MoveAttributeSelection(index === 0 || index === 3 ? -1 : 1);
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
            if (l.hud.panel === 'settings' && ActionManager.IsActionDown('CONFIRM')) {
                l.hud.ActivateSettingsSelection();
                return;
            }
            if (l.hud.panel === 'hero' && ActionManager.IsActionDown('CONFIRM')) {
                l.hud.ActivateAttributeSelection();
                return;
            }
            if (l.hud.panel === 'skills' && ActionManager.IsActionDown('CONFIRM')) {
                l.hud.ActivateSkillTreeSelection();
                return;
            }
            if (l.hud.panel === 'bag' && ActionManager.IsActionDown('CONFIRM')) {
                l.hud.ActivateBagItem();
                return;
            }
            if (l.hud.panel === 'gear' && ActionManager.IsActionDown('CONFIRM')) {
                l.hud.ActivateGearSelection();
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
        if (ActionManager.IsActionDown('CANCEL') || (this.DockTurn() && Input.instance.mouse.buttonsDown[2])) {
            t.Cancel();
            return;
        }
        this.UpdateBattleHover();
        if (this.DockTurn() && t.phase === 'command') {
            this.PickCommandTile();
            if (t.phase !== 'command') return;
        }
        if (t.phase === 'face') {
            const point = Touch.ToScreen(Input.instance.mouse.position, l.ui.Screen);
            if (this.facingPointer && (point.x !== this.facingPointer.x || point.y !== this.facingPointer.y)) {
                const facing = l.terrain.FacingAtPoint(point, t, l.camera, l.ui.Screen);
                if (facing >= 0) t.active.stats.facing = facing;
            }
            this.facingPointer = { x: point.x, y: point.y };
            for (const raw of this.Points()) {
                const facing = l.terrain.FacingAtPoint(Touch.ToScreen(raw, l.ui.Screen), t, l.camera, l.ui.Screen);
                if (facing >= 0) {
                    t.active.stats.facing = facing;
                    l.actions.EndTurn();
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
        const tile = this.InWorld(point) ? l.terrain.Pick(point, l.camera, l.ui.Screen) : null;
        l.hoveredTile = tile;
        l.hoveredPawn = tile ? l.turn.Alive().find(pawn =>
            pawn.stats.col === tile.col && pawn.stats.row === tile.row) ?? null : null;
    }

    PickTile() {
        const l = this.level, t = l.turn;
        for (const raw of this.Points()) {
            const point = Touch.ToScreen(raw, l.ui.Screen);
            if (!this.InWorld(point))
                continue;
            const tile = l.terrain.Pick(point, l.camera, l.ui.Screen);
            if (tile) {
                t.cursor = { col: tile.col, row: tile.row };
                this.Confirm();
                break;
            }
        }
    }

    /** Whether a screen point is over the battlefield rather than the header or the bottom bar. */
    InWorld(point) {
        const l = this.level;
        return point.y >= l.hud.headerHeight && point.y <= l.ui.Screen.Height - (l.hud.BottomInset?.() ?? 116)
            && !l.hud.PointOverHud?.(point);
    }

    /** The dock is up and an ally is acting: hotbar keys, Space and direct clicks apply. */
    DockTurn() {
        const l = this.level, t = l.turn;
        return l.exploring === 'battle' && Boolean(l.controlSettings.dock) && !l.hud.ringOpen
            && t.active?.stats.team === 'ally' && !t.result;
    }

    /** PC command phase: click a reachable tile to walk, or a foe to aim the basic attack at it. */
    PickCommandTile() {
        const l = this.level, t = l.turn;
        for (const raw of this.Points()) {
            const point = Touch.ToScreen(raw, l.ui.Screen);
            if (!this.InWorld(point)) continue;
            const tile = l.terrain.Pick(point, l.camera, l.ui.Screen);
            if (!tile) continue;
            t.cursor = { col: tile.col, row: tile.row };
            const occupant = t.Alive().find(pawn => pawn.stats.col === tile.col && pawn.stats.row === tile.row);
            if (occupant && occupant !== t.active) {
                const basic = t.active.stats.basicAbility ?? 'strike';
                if (t.SelectAbility(basic)) t.cursor = { col: tile.col, row: tile.row };
                return;
            }
            if (!occupant && !l.actions.Move(tile))
                t.message = t.active.stats.mp > 0 ? 'That tile is out of reach' : 'No movement points left';
            return;
        }
    }

    /** Uses hotbar slot `index` (0-9): aims an ability, or uses a consumable right away. */
    ActivateSlot(index) {
        const l = this.level, t = l.turn;
        if (!this.DockTurn()) return false;
        l.hud.CloseRing?.();
        const slot = HotbarSlots(t, l.player, l.campaign)[index];
        if (!slot || slot.kind === 'empty') {
            t.message = 'That hotbar slot is empty.';
            return false;
        }
        if (slot.kind === 'item') {
            if (t.phase !== 'command') t.Cancel();
            return l.actions.UseItem(slot.id);
        }
        if (slot.locked) {
            t.message = 'Learn that skill in the skill tree [K] first.';
            return false;
        }
        // Pressing the slot being aimed again puts it away.
        if (t.phase === 'target' && t.ability === slot.id) {
            t.Cancel();
            return true;
        }
        if (t.phase === 'item' || t.phase === 'face') t.Cancel();
        if (!t.SelectAbility(slot.id)) return false;
        this.SelectDefaultTarget();
        return true;
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
            this.SelectCommand(t.command);
        }
        else if (t.phase === 'move') {
            if (!this.level.actions.Move(t.cursor))
                t.message = 'Choose a blue reachable tile';
        }
        else if (t.phase === 'target') {
            const target = t.Alive().find(p => p.stats.col === t.cursor.col && p.stats.row === t.cursor.row);
            if (!this.level.actions.UseSkill(target))
                t.message = 'Choose a highlighted target in reach and line of sight';
        }
        else if (t.phase === 'face')
            this.level.actions.EndTurn();
        else if (t.phase === 'item')
            this.level.UseBattlePotion();
        else if (t.phase === 'skill-select') {
            const skills = ActiveSkills(t.active.stats.archetype, t.active.stats.unlockedSkills);
            const skill = skills[t.skillCursor ?? 0];
            if (skill) this.SelectSkill(skill.id);
        }
    }

    SelectCommand(index) {
        const l = this.level, t = l.turn;
        if (l.exploring !== 'battle' || !CommandAvailable(t, l.player, l.campaign, index)) {
            t.message = `${Commands[index] ?? 'Command'} is unavailable this turn.`;
            return false;
        }

        t.Choose(index);
        if (l.controlSettings.smartTarget && t.phase === 'face') FaceNearestEnemy(t);
        this.SelectDefaultTarget();
        return true;
    }

    SelectHotkey(number) {
        const l = this.level, t = l.turn;
        if (l.exploring !== 'battle' || t.phase !== 'command'
            || !['PC', 'Personalizado'].includes(l.controlSettings.mode) || number < 1 || number > 9) return false;
        l.hud.CloseRing();
        if (number <= 5) return this.SelectCommand(number - 1);
        const skill = ActiveSkills(t.active?.stats.archetype, t.active?.stats.unlockedSkills)[number - 6];
        if (!skill) {
            t.message = 'No unlocked skill in that slot.';
            return false;
        }
        return this.SelectCommand(2) && this.SelectSkill(skill.id);
    }

    SelectSkill(id) {
        if (!this.level.turn.SelectSkill(id)) return false;
        this.SelectDefaultTarget();
        return true;
    }

    SelectDefaultTarget() {
        if (!this.level.controlSettings.smartTarget) return;
        const turn = this.level.turn;
        const target = DefaultTarget(turn);
        if (target) turn.cursor = { col: target.stats.col, row: target.stats.row };
        else if (turn.phase === 'target') turn.message = 'No target in reach. Move closer first [1].';
    }
}
