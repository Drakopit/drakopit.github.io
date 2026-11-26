import { ActionManager, MathExt, SoundEffects, SceneDocument, GameViewport } from 'gameforgejs/core';
import { GameObject } from 'gameforgejs/2d';
import { Level3D, OrthographicCamera, HeightGrid, SceneManifest3D } from 'gameforgejs/3d';
import { BattleFromScene } from '../data/BattleScene.js';
import { HighlandCampaign, EquipmentSlot } from '../data/HighlandCampaign.js';
import { FindExplorePath as FindPath } from '../data/ExplorePathfinding.js';
import { GetZone } from '../data/WorldMaps.js';
import { TacticalPawn } from '../entities/TacticalPawn.js';
import { HighlandEnvironment } from '../entities/HighlandEnvironment.js';
import { TerrainView } from '../rendering/TerrainView.js';
import { TurnSystem } from '../components/TurnSystem.js';
import { TacticalControls } from '../input/TacticalControls.js';
import { TacticalHUD } from '../ui/TacticalHUD.js';

/** Scene composition and campaign transitions; combat rules remain in ECS components. */
export class HighlandLevel extends Level3D {
    constructor() {
        super({ width: 1100, height: 760, usePhysics: false, clearColor: [0.09, 0.16, 0.2, 1] });
        this.caption = 'Highland Tactics 3D';
    }

    BuildScene() {
        const document = this.context.assets.jsons.battlefield;
        const sceneDocument = new SceneDocument(document);
        this.battleData = BattleFromScene(document);
        this.battleGrid = new HeightGrid(this.battleData.heights);
        this.battleDocument = sceneDocument;
        this.scene.fog = sceneDocument.settings.fog ?? null;
        if (sceneDocument.settings.backgroundColor) this.scene.backgroundColor = [...sceneDocument.settings.backgroundColor];
        const { position, target } = sceneDocument.settings.camera;
        this.camera = new OrthographicCamera({ position, target, viewHeight: 13, far: 100 });
        this.scene.Add(this.camera);
        for (const light of sceneDocument.Lights()) this.scene.Add(SceneManifest3D.CreateLight(light));

        this.campaign = new HighlandCampaign();
        this.campaign.CreateCharacter('vanguard');
        this.zone = GetZone('hearthvale');
        this.grid = new HeightGrid(this.zone.heights);
        this.exploring = 'creation';
        this.turn = new TurnSystem(this.battleGrid, [], null);
        this.turn.enabled = false;
        this.turn.phase = 'explore';
        this.turn.message = 'Choose a calling to begin your journey.';
        const director = new GameObject();
        this.sound = director.AddComponent(new SoundEffects(this.context.services.get('audio')));
        this.turn.sound = this.sound;
        director.AddComponent(this.turn);
        this.AddEntity(director);

        this.terrain = this.AddEntity(new TerrainView(this.scene, this.grid, null, {
            palette: this.zone.palette,
            markers: this.ZoneMarkers(this.zone),
            structures: this.zone.structures,
        }));
        this.environment = this.AddEntity(new HighlandEnvironment(this.scene, this.grid, this.terrain.stone));
        this.player = this.AddEntity(new TacticalPawn(this.grid, this.scene, this.HeroDefinition()));
        this.pawns = [this.player];
        this.vendors = this.CreateVendors();
        this.shopkeeper = this.vendors[0] ?? null;
        this.groupLeaders = this.CreateGroupLeaders();
        this.groupLeader = this.groupLeaders[0] ?? null;
        this.hoveredEncounter = null;
        this.exploreRoute = null;

        this.hud = new TacticalHUD(this);
        this.controls = new TacticalControls(this);
        this.cameraStep = 0;
        this.cameraAngle = Math.PI / 4;
        this.cameraViewTarget = 13;
        this.releaseViewport = GameViewport.Bind(this.ui.Screen, { maxWidth: 1440, onResize: () => GameViewport.Align(this.ui.Screen, this.screen3D) });
    }

    HeroDefinition() {
        const hero = this.campaign.hero;
        return {
            ...hero,
            name: hero.name,
            hp: hero.hp,
            color: hero.color,
            team: 'ally',
            unlockedSkills: [...this.campaign.unlockedSkills],
        };
    }

    ZoneMarkers(zone) {
        const markers = [];
        if (zone.portal) markers.push({ ...zone.portal, color: [1, 0.77, 0.25, 1] });
        if (zone.returnPortal) markers.push({ ...zone.returnPortal, color: [0.42, 0.82, 1, 1] });
        for (const encounter of zone.encounters ?? [])
            if (!this.campaign.clearedZones.has(encounter.id))
                markers.push({ ...encounter, label: `Lv ${encounter.level} ${encounter.name}`, color: [1, 0.35, 0.24, 1] });
        return markers;
    }

    CreateShopkeeper(vendor = this.zone.vendors?.[0]) {
        if (!vendor) return null;
        return this.AddEntity(new TacticalPawn(this.grid, this.scene, {
            id: `vendor-${vendor.id}`,
            name: vendor.name,
            vendorId: vendor.id,
            specialty: vendor.specialty,
            greeting: vendor.greeting,
            team: 'neutral',
            col: vendor.col,
            row: vendor.row,
            facing: 2,
            hp: 1,
            maxHp: 1,
            speed: 1,
            attack: 0,
            defense: 0,
            color: '#d3a64a',
        }));
    }

    CreateVendors() {
        return (this.zone.vendors ?? []).map(vendor => this.CreateShopkeeper(vendor));
    }

    CreateGroupLeader(encounter = this.zone.encounter) {
        if (!encounter || this.campaign.clearedZones.has(encounter.id)) return null;
        const leader = this.AddEntity(new TacticalPawn(this.grid, this.scene, {
            id: `group-${encounter.id}`,
            name: encounter.name,
            encounterId: encounter.id,
            team: 'neutral',
            col: encounter.col,
            row: encounter.row,
            facing: 2,
            hp: 1,
            maxHp: 1,
            speed: 1,
            attack: 0,
            defense: 0,
            color: { golem: '#b88463', slime: '#82bf81', wolf: '#66758b', wisp: '#c7764e' }[encounter.leaderStyle],
            visualStyle: encounter.leaderStyle,
        }));
        leader.patrolOrigin = { col: encounter.col, row: encounter.row };
        leader.patrolDelay = 2;
        leader.patrolStep = 0;
        return leader;
    }

    CreateGroupLeaders() {
        return (this.zone.encounters ?? [this.zone.encounter].filter(Boolean))
            .map(encounter => this.CreateGroupLeader(encounter)).filter(Boolean);
    }

    GroupLeaders() {
        return this.groupLeaders ?? [this.groupLeader].filter(Boolean);
    }

    GroupAt(tile) {
        return this.GroupLeaders().find(group => tile?.col === group.stats.col && tile?.row === group.stats.row) ?? null;
    }

    GroupNear(tile) {
        return this.GroupLeaders().find(group =>
            Math.abs(tile.col - group.stats.col) + Math.abs(tile.row - group.stats.row) <= 1) ?? null;
    }

    UpdatePatrols(dt) {
        if (this.exploring !== 'explore' || this.hud.panel || this.player.travel.path.length) return;
        const groups = this.GroupLeaders();
        for (const group of groups) {
            if (group.travel.path.length) continue;
            group.patrolDelay -= dt;
            if (group.patrolDelay > 0) continue;
            group.patrolDelay = 2.5;
            const directions = [[0, -1], [1, 0], [0, 1], [-1, 0]];
            const offset = group.patrolStep++;
            for (let attempt = 0; attempt < directions.length; attempt++) {
                const [dx, dy] = directions[(offset + attempt) % directions.length];
                const tile = this.grid.Get(group.stats.col + dx, group.stats.row + dy);
                if (!tile || Math.abs(tile.col - group.patrolOrigin.col) + Math.abs(tile.row - group.patrolOrigin.row) > 2
                    || Math.abs(tile.col - this.player.stats.col) + Math.abs(tile.row - this.player.stats.row) <= 1
                    || groups.some(other => other !== group && (other.stats.col === tile.col && other.stats.row === tile.row
                        || other.travel.path.some(step => step.col === tile.col && step.row === tile.row)))
                    || this.IsShopkeeperTile(tile)
                    || (this.zone.structures ?? []).some(structure => structure.col === tile.col && structure.row === tile.row)
                    || [this.zone.portal, this.zone.returnPortal].some(portal => portal?.col === tile.col && portal?.row === tile.row))
                    continue;
                const path = FindPath(this.grid, group.stats, tile);
                if (path?.length === 1) {
                    group.travel.Follow(path);
                    break;
                }
            }
        }
    }

    GetVendorAtTile(tile) {
        const vendors = this.vendors?.length ? this.vendors : [this.shopkeeper].filter(Boolean);
        return vendors.find(vendor => tile?.col === vendor.stats.col && tile?.row === vendor.stats.row) ?? null;
    }

    IsShopkeeperTile(tile) {
        return Boolean(this.GetVendorAtTile(tile));
    }

    NearestVendor() {
        const vendors = this.vendors?.length ? this.vendors : [this.shopkeeper].filter(Boolean);
        if (!this.player || !vendors.length || this.zone.id !== 'hearthvale') return null;
        return vendors
            .map(vendor => ({
                vendor,
                distance: Math.abs(this.player.stats.col - vendor.stats.col) + Math.abs(this.player.stats.row - vendor.stats.row),
            }))
            .sort((a, b) => a.distance - b.distance)[0];
    }

    CanInteractShopkeeper(vendor = null) {
        return vendor
            ? Math.abs(this.player.stats.col - vendor.stats.col) + Math.abs(this.player.stats.row - vendor.stats.row) <= 1
            : this.NearestVendor()?.distance <= 1;
    }

    InteractShopkeeper(vendor = null) {
        if (this.zone.id !== 'hearthvale' || !(this.vendors?.length || this.shopkeeper)) return false;
        const nearest = this.NearestVendor();
        vendor = vendor ?? (nearest?.distance <= 1 ? nearest.vendor : null);
        if (!vendor || Math.abs(this.player.stats.col - vendor.stats.col) + Math.abs(this.player.stats.row - vendor.stats.row) > 1) {
            this.turn.message = 'Move next to a Hearthvale vendor to trade.';
            return false;
        }
        this.activeVendor = vendor;
        this.hud.shopTab = 'buy';
        this.hud.shopPage = 0;
        this.hud.panel = this.hud.panel === 'shop' ? null : 'shop';
        this.turn.message = this.hud.panel ? `${vendor.stats.name}: ${vendor.stats.greeting}` : 'You leave the vendor.';
        this.sound.Play('select');
        return true;
    }

    ApproachShopkeeper(vendor = this.GetVendorAtTile(this.turn.cursor) ?? this.shopkeeper) {
        if (!vendor) return false;
        if (Math.abs(this.player.stats.col - vendor.stats.col) + Math.abs(this.player.stats.row - vendor.stats.row) <= 1)
            return this.InteractShopkeeper(vendor);
        const trader = vendor.stats;
        const neighbors = [[0, -1], [1, 0], [0, 1], [-1, 0]]
            .map(([dx, dy]) => this.grid.Get(trader.col + dx, trader.row + dy))
            .filter(Boolean)
            .map(tile => ({ tile, path: this.FindExplorePath(tile) }))
            .filter(entry => entry.path?.length)
            .sort((a, b) => a.path.length - b.path.length);
        if (!neighbors.length) {
            this.turn.message = 'There is no clear path to the trader.';
            return false;
        }
        return this.MoveExplore(neighbors[0].tile);
    }

    CreateCharacter(archetype, name) {
        if (this.exploring !== 'creation' || !this.campaign.CreateCharacter(archetype)) return;
        this.campaign.hero.name = String(name ?? '').trim().slice(0, 20) || 'Highland Recruit';
        this.campaign.hero.col = this.zone.spawn.col;
        this.campaign.hero.row = this.zone.spawn.row;
        this.RemoveEntity(this.player);
        this.player = this.AddEntity(new TacticalPawn(this.grid, this.scene, this.HeroDefinition()));
        this.pawns = [this.player];
        this.exploring = 'explore';
        this.turn.phase = 'explore';
        this.turn.message = 'Explore Hearthvale. Follow the gold beacon to Mistfell Pass.';
        this.turn.cursor = { col: this.player.stats.col, row: this.player.stats.row };
        this.hud.panel = null;
        this.hud.nameField.SetActive(false);
        this.controls?.SuppressNextWorldClick();
        this.sound.Play('success');
    }

    LoadZone(zoneId, entry) {
        if (this.terrain) this.RemoveEntity(this.terrain);
        if (this.environment) this.RemoveEntity(this.environment);
        for (const pawn of this.pawns ?? []) this.RemoveEntity(pawn);
        for (const vendor of this.vendors ?? []) this.RemoveEntity(vendor);
        if (this.shopkeeper && !this.vendors?.includes(this.shopkeeper)) this.RemoveEntity(this.shopkeeper);
        for (const group of this.GroupLeaders()) this.RemoveEntity(group);
        this.groupLeaders = [];
        this.groupLeader = null;
        this.vendors = [];
        this.shopkeeper = null;

        const previousZoneId = this.zone?.id;
        this.zone = GetZone(zoneId);
        if (previousZoneId && previousZoneId !== zoneId)
            for (const encounter of this.zone.otherEncounters ?? [])
                this.campaign.clearedZones.delete(encounter.id);
        this.grid = new HeightGrid(this.zone.heights);
        this.terrain = this.AddEntity(new TerrainView(this.scene, this.grid, null, {
            palette: this.zone.palette,
            markers: this.ZoneMarkers(this.zone),
            structures: this.zone.structures,
        }));
        this.environment = this.AddEntity(new HighlandEnvironment(this.scene, this.grid, this.terrain.stone));
        const position = entry ?? this.zone.spawn;
        this.campaign.zoneId = zoneId;
        this.campaign.hero.col = position.col;
        this.campaign.hero.row = position.row;
        this.player = this.AddEntity(new TacticalPawn(this.grid, this.scene, this.HeroDefinition()));
        this.pawns = [this.player];
        this.vendors = this.CreateVendors();
        this.shopkeeper = this.vendors[0] ?? null;
        this.groupLeaders = this.CreateGroupLeaders();
        this.groupLeader = this.groupLeaders[0] ?? null;
        this.hoveredEncounter = null;
        this.turn.grid = this.grid;
        this.turn.pawns = this.pawns;
        this.turn.enabled = false;
        this.turn.phase = 'explore';
        this.turn.active = null;
        this.turn.result = null;
        this.turn.cursor = { ...position };
        this.exploring = 'explore';
        this.cameraViewTarget = 13;
        this.turn.message = `${this.zone.name} · ${this.zone.subtitle}`;
    }

    MoveExplore(tile) {
        if (this.exploring !== 'explore') return false;
        for (const group of this.GroupLeaders())
            if (group.travel?.path.length) group.travel.Snap();
        const group = this.GroupAt(tile);
        if (group) return this.ApproachEncounter(group);
        const moving = this.player.travel.path.length > 0;
        const origin = { col: this.player.stats.col, row: this.player.stats.row };
        const inFlight = moving ? this.player.travel.path[0] : null;
        const continuation = this.FindExplorePath(tile, inFlight ?? origin);
        const path = moving && continuation ? [inFlight, ...continuation] : continuation;
        if (!path?.length) {
            this.turn.message = 'Choose a reachable open trail tile.';
            return false;
        }
        const triggerIndex = path.findIndex(point => this.IsExploreTrigger(point));
        const route = triggerIndex < 0 ? path : path.slice(0, triggerIndex + 1);
        const destination = route[route.length - 1];
        this.exploreRoute = { origin, path: route, destination };
        this.player.travel.Follow(route, () => this.OnExploreArrival(destination));
        this.turn.cursor = { col: destination.col, row: destination.row };
        this.sound.Play('step');
        return true;
    }

    FindExplorePath(tile, start = this.player.stats) {
        const vendors = this.vendors?.length ? this.vendors : [this.shopkeeper].filter(Boolean);
        const blockers = [...vendors, ...this.GroupLeaders()];
        const occupied = new Set(blockers.map(entity => this.grid.Key(entity.stats)));
        for (const structure of this.zone.structures ?? []) occupied.add(this.grid.Key(structure));
        return FindPath(this.grid, start, tile, occupied);
    }

    CancelExploreMove() {
        if (!this.player.travel.path.length) return false;
        this.player.travel.Snap();
        this.exploreRoute = null;
        this.turn.cursor = { col: this.player.stats.col, row: this.player.stats.row };
        this.turn.message = 'Movement cancelled.';
        return true;
    }

    IsExploreTrigger(tile) {
        const points = [this.zone.portal, this.zone.returnPortal];
        return points.some(point => point && point.col === tile.col && point.row === tile.row)
            || Boolean(this.GroupNear(tile));
    }

    ApproachEncounter(group = this.groupLeader) {
        if (!group || this.exploring !== 'explore') return false;
        const leader = group.stats;
        if (Math.abs(this.player.stats.col - leader.col) + Math.abs(this.player.stats.row - leader.row) <= 1) {
            this.StartBattle(leader.encounterId ?? this.zone.id);
            return true;
        }
        const neighbors = [[0, -1], [1, 0], [0, 1], [-1, 0]]
            .map(([dx, dy]) => this.grid.Get(leader.col + dx, leader.row + dy))
            .filter(Boolean)
            .map(tile => ({ tile, path: this.FindExplorePath(tile) }))
            .filter(entry => entry.path?.length)
            .sort((a, b) => a.path.length - b.path.length);
        if (!neighbors.length) return false;
        return this.MoveExplore(neighbors[0].tile);
    }

    StepExplore(direction) {
        const offsets = [[0, -1], [1, 0], [0, 1], [-1, 0]];
        const [dx, dy] = offsets[direction];
        return this.MoveExplore(this.grid.Get(this.player.stats.col + dx, this.player.stats.row + dy) ?? {});
    }

    OnExploreArrival(tile) {
        this.exploreRoute = null;
        this.campaign.SyncHero(this.player.stats);
        const key = `${tile.col},${tile.row}`;
        const pointKey = point => point && `${point.col},${point.row}`;
        const portal = this.zone.portal && pointKey(this.zone.portal) === key ? this.zone.portal : this.zone.returnPortal;
        if (portal && pointKey(portal) === key) {
            if (portal.to === 'ashen-ridge' && !this.campaign.clearedZones.has('mistfell')) {
                this.turn.message = 'Defeat the Mistfell patrol to open the ridge road.';
                return;
            }
            this.LoadZone(portal.to, portal.entry);
            this.sound.Play('success');
            return;
        }
        const group = this.GroupNear(tile);
        if (group) {
            this.StartBattle(group.stats.encounterId ?? this.zone.id);
            return;
        }
        if (this.CanInteractShopkeeper())
            this.turn.message = 'A Hearthvale vendor is nearby. Press F or tap TALK to trade.';
        else
            this.turn.message = `${this.zone.name} · ${this.zone.subtitle}`;
    }

    StartBattle(encounterId) {
        if (!['explore', 'battle'].includes(this.exploring)) return;
        const encounter = this.zone.encounters.find(entry => entry.id === encounterId);
        if (!encounter) throw new RangeError(`Unknown encounter in ${this.zone.id}: ${encounterId}`);
        if (this.exploring === 'explore') {
            this.campaign.SyncHero(this.player.stats);
            this.returnPosition = { zoneId: this.zone.id, col: this.player.stats.col, row: this.player.stats.row };
        }
        this.encounterId = encounterId;
        this.exploreRoute = null;

        this.RemoveEntity(this.terrain);
        this.RemoveEntity(this.environment);
        for (const pawn of this.pawns) this.RemoveEntity(pawn);
        for (const vendor of this.vendors ?? []) this.RemoveEntity(vendor);
        if (this.shopkeeper && !this.vendors?.includes(this.shopkeeper)) this.RemoveEntity(this.shopkeeper);
        for (const group of this.GroupLeaders()) this.RemoveEntity(group);
        this.groupLeaders = [];
        this.groupLeader = null;
        this.vendors = [];
        this.shopkeeper = null;
        this.grid = this.battleGrid;
        this.terrain = this.AddEntity(new TerrainView(this.scene, this.grid, this.battleDocument));
        this.environment = this.AddEntity(new HighlandEnvironment(this.scene, this.grid, this.terrain.stone));

        const allyUnits = this.battleData.units.filter(unit => unit.team === 'ally');
        const enemies = this.battleData.units.filter(unit => unit.team === 'enemy').map(unit => ({
            ...unit,
            role: unit.id === 'scout' ? 'flanker' : 'bruiser',
            basicAbility: unit.id === 'scout' ? 'quick-shot' : 'guard-bash',
        }));
        const party = allyUnits.filter((unit, index) => index === 0 || this.campaign.companionDeployed).map((unit, index) => index === 0
            ? { ...this.HeroDefinition(), col: unit.col, row: unit.row }
            : { ...unit, defense: 4, level: this.campaign.hero.level });
        const extraEnemies = [
            { id: 'hound', name: 'Ash Hound', team: 'enemy', role: 'flanker', basicAbility: 'hound-bite', visualStyle: 'wolf', col: 7, row: 7, facing: 0, hp: 28, speed: 26, attack: 12, defense: 2, color: '#b98b59' },
            { id: 'adept', name: 'Ash Adept', team: 'enemy', role: 'caster', basicAbility: 'ember-flare', visualStyle: 'wisp', col: 4, row: 7, facing: 0, hp: 26, speed: 21, attack: 14, defense: 1, color: '#9676b8' },
        ];
        const templates = [...enemies, ...extraEnemies];
        const spawnPoints = [...enemies, ...extraEnemies].map(({ col, row }) => ({ col, row }));
        const roster = encounter.composition.flatMap(({ name, count }) => {
            const unit = templates.find(template => template.name === name);
            if (!unit) throw new RangeError(`Unknown encounter unit: ${name}`);
            return Array.from({ length: count }, () => unit);
        });
        if (roster.length > spawnPoints.length) throw new RangeError('Encounter exceeds available battle spawn points');
        const difficulty = encounter.level >= 4 ? 1.2 : 1;
        const units = [
            ...party,
            ...roster.map((unit, index) => ({
                ...unit, ...spawnPoints[index], id: `${unit.id}-${index}`, level: encounter.level,
                hp: Math.round(unit.hp * difficulty), attack: Math.round(unit.attack * difficulty),
                defense: unit.defense ?? 2,
            })),
        ];
        this.pawns = units.map(unit => this.AddEntity(new TacticalPawn(this.grid, this.scene, unit)));
        this.player = this.pawns[0];
        this.turn.grid = this.grid;
        this.turn.pawns = this.pawns;
        this.turn.enabled = true;
        this.turn.Reset();
        this.turn.message = `${this.zone.name} patrol · defeat every Ash raider`;
        this.exploring = 'battle';
        this.cameraViewTarget = 16;
        this.resultHandled = false;
        this.sound.Play('warning');
    }

    FinishBattle() {
        if (this.exploring !== 'battle' || this.resultHandled || !this.turn.result) return;
        this.resultHandled = true;
        this.campaign.SyncHero(this.player.stats);
        this.exploring = 'result';
        this.turn.enabled = false;
        if (this.turn.result === 'VICTORY') {
            this.campaign.clearedZones.add(this.encounterId);
            this.campaign.hero.hp = Math.max(1, this.campaign.hero.hp);
            this.campaign.gold += this.encounterId === 'ashen-ridge' ? 45 : 30;
            const levels = this.campaign.AwardExperience(this.encounterId === 'ashen-ridge' ? 90 : 60);
            this.turn.message = levels
                ? `VICTORY · Level ${this.campaign.hero.level}! Return to ${this.zone.name}.`
                : `VICTORY · +${this.encounterId === 'ashen-ridge' ? 90 : 60} XP · Return to ${this.zone.name}.`;
        }
        else {
            this.turn.message = 'DEFEAT · Return to Hearthvale and recover before another patrol.';
        }
    }

    ReturnToExplore() {
        if (this.exploring !== 'result') return;
        if (this.turn.result === 'DEFEAT') {
            this.campaign.hero.hp = Math.max(1, Math.ceil(this.campaign.hero.maxHp * 0.4));
            this.campaign.zoneId = 'hearthvale';
            this.LoadZone('hearthvale', GetZone('hearthvale').spawn);
        }
        else
            this.LoadZone(this.returnPosition.zoneId, { col: this.returnPosition.col, row: this.returnPosition.row });
        this.hud.panel = null;
        this.sound.Play('success');
    }

    Buy(item, slot) {
        const specialty = slot === 'potion' ? 'consumable' : slot === 'weapon' ? 'weapon' : 'armor';
        if (this.zone.id !== 'hearthvale' || !this.activeVendor || !this.CanInteractShopkeeper(this.activeVendor)
            || this.activeVendor.stats.specialty !== specialty) {
            this.turn.message = 'This vendor does not stock that item.';
            return;
        }

        const success = slot === 'potion' ? this.campaign.BuyPotion() : this.campaign.Buy(item, slot);
        this.turn.message = success ? `${item} purchased.` : 'Not enough gold, or you already have this item equipped.';
        if (success) {
            this.SyncEquipmentToPlayer();
            this.sound.Play('select');
        }
    }

    ToggleCompanion() {
        if (this.exploring !== 'explore') return false;
        this.campaign.companionDeployed = !this.campaign.companionDeployed;
        this.turn.message = this.campaign.companionDeployed ? 'Orin will join the next battle.' : 'Orin will remain in reserve.';
        this.sound.Play('select');
        return true;
    }

    Rest() {
        if (this.zone.id !== 'hearthvale' || this.activeVendor?.stats.specialty !== 'rest' || !this.CanInteractShopkeeper(this.activeVendor)) return;
        this.campaign.hero.hp = this.campaign.hero.maxHp;
        if (this.player) this.player.stats.hp = this.campaign.hero.hp;
        this.turn.message = 'Rested at Hearthvale — your party is ready.';
        this.sound.Play('success');
    }

    UsePotion() {
        const used = this.campaign.UsePotion();
        if (used && this.player) this.player.stats.hp = this.campaign.hero.hp;
        this.turn.message = used ? 'Potion used · 24 HP restored.' : 'No potion needed or available.';
    }

    UseItem(item) {
        if (item !== 'Potion') return false;
        const before = this.campaign.hero.hp;
        this.UsePotion();
        return this.campaign.hero.hp > before;
    }

    UseBattlePotion() {
        if (this.exploring !== 'battle' || this.turn.phase !== 'item' || this.turn.active !== this.player || this.turn.acted) {
            this.turn.message = 'Only your active hero can use a potion.';
            return false;
        }
        this.campaign.SyncHero(this.player.stats);
        if (!this.campaign.UsePotion()) {
            this.turn.message = 'No potion needed or available.';
            return false;
        }
        this.player.stats.hp = this.campaign.hero.hp;
        this.turn.acted = true;
        this.turn.phase = 'command';
        this.turn.message = 'Potion used · 24 HP restored.';
        this.sound.Play('success');
        return true;
    }

    EquipItem(item) {
        const slot = EquipmentSlot(item);
        if (!slot || !this.campaign.EquipOwned(item, slot)) return false;
        this.SyncEquipmentToPlayer();
        this.turn.message = `${item} equipped.`;
        this.sound.Play('select');
        return true;
    }

    SyncEquipmentToPlayer() {
        if (!this.player || !this.campaign.hero) return;
        for (const stat of ['attack', 'defense', 'speed', 'maxHp', 'hp', 'energyMax'])
            this.player.stats[stat] = this.campaign.hero[stat];
        this.player.stats.energy = Math.min(this.player.stats.energy, this.player.stats.energyMax);
    }

    ResetBattle() {
        if (this.exploring === 'battle')
            this.StartBattle(this.encounterId);
    }

    SellPotion() {
        if (this.activeVendor?.stats.specialty !== 'consumable' || !this.CanInteractShopkeeper(this.activeVendor)) {
            this.turn.message = 'Take potions to the alchemist.';
            return;
        }
        const sold = this.campaign.SellPotion();
        this.turn.message = sold ? 'Potion sold for 5G.' : 'No potion to sell.';
        if (sold) this.sound.Play('select');
    }

    SellEquipment(slot) {
        const specialty = slot === 'weapon' ? 'weapon' : 'armor';
        if (this.activeVendor?.stats.specialty !== specialty || !this.CanInteractShopkeeper(this.activeVendor)) {
            this.turn.message = 'Take equipment to the matching Hearthvale vendor.';
            return;
        }
        const sold = this.campaign.SellEquipment(slot);
        this.turn.message = sold ? `${slot} sold for half value.` : `The default ${slot} cannot be sold.`;
        if (sold) {
            this.SyncEquipmentToPlayer();
            this.sound.Play('select');
        }
    }

    SellOwned(item) {
        const slot = EquipmentSlot(item);
        const specialty = slot === 'weapon' ? 'weapon' : 'armor';
        if (!slot || this.activeVendor?.stats.specialty !== specialty || !this.CanInteractShopkeeper(this.activeVendor)) {
            this.turn.message = 'Take equipment to the matching Hearthvale vendor.';
            return false;
        }
        const sold = this.campaign.SellOwned(item);
        this.turn.message = sold ? `${item} sold for half value.` : `No sellable ${item} in your bag.`;
        if (sold) this.sound.Play('select');
        return sold;
    }

    LearnSkill(id) {
        const learned = this.campaign.LearnSkill(id);
        if (learned && this.player) {
            this.player.stats.attack = this.campaign.hero.attack;
            this.player.stats.defense = this.campaign.hero.defense;
            this.player.stats.energyMax = this.campaign.hero.energyMax;
            this.player.stats.unlockedSkills = [...this.campaign.unlockedSkills];
            this.turn.message = `${id} learned · ${this.campaign.skillPoints} skill points remain.`;
            this.sound.Play('success');
        }
        else
            this.turn.message = 'Spend a skill point and meet the skill prerequisites.';
        return learned;
    }

    ToggleWeather() {
        this.environment?.ToggleRain();
    }

    UpdateCamera(dt) {
        this.cameraAngle = MathExt.LerpAngle(this.cameraAngle, Math.PI / 4 + this.cameraStep * Math.PI / 2, Math.min(1, dt * 8));
        const focus = this.exploring === 'explore' ? this.player.travel.position : { x: 0, z: 0 };
        const blend = Math.min(1, dt * 6);
        const x = this.camera.target[0] + (focus.x - this.camera.target[0]) * blend;
        const z = this.camera.target[2] + (focus.z - this.camera.target[2]) * blend;
        this.camera.LookAt([x, 0, z]);
        this.camera.SetPosition(x + Math.cos(this.cameraAngle) * 20, 14, z + Math.sin(this.cameraAngle) * 20);
        const viewTarget = Math.max(this.cameraViewTarget, 15 * this.ui.Screen.Height / this.ui.Screen.Width);
        this.camera.viewHeight = MathExt.Lerp(this.camera.viewHeight, viewTarget, Math.min(1, dt * 3));
    }

    OnUpdate(dt) {
        this.hud.Update(dt);
        this.controls.Update(dt);
        this.UpdateCamera(dt);
        if (!this.hud.help.visible)
            super.OnUpdate(dt);
        if (!this.hud.help.visible) this.UpdatePatrols(dt);
        if (this.exploring === 'battle') this.FinishBattle();
        if (this.exploring === 'explore') this.campaign.SyncHero(this.player.stats);
        this.terrain.Highlights(this.turn, this.exploring === 'explore' ? this.exploreRoute : null);
    }

    OnGUI() { this.hud.Draw(); }

    OnExit() {
        this.releaseViewport?.();
        this.hud?.Dispose();
        super.OnExit();
    }
}
