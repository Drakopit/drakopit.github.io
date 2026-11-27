import { MathExt, SoundEffects, SceneDocument, GameViewport } from 'gameforgejs/core';
import { GameObject } from 'gameforgejs/2d';
import { Level3D, OrthographicCamera, HeightGrid, SceneManifest3D, SurfaceMaterial } from 'gameforgejs/3d';
import { BattleFromScene } from '../data/BattleScene.js';
import { BuildBattleUnits, HeroUnit } from '../data/BattleRoster.js';
import { HighlandCampaign, EquipmentSlot, ItemInfo, Attributes, AttributePointsPerLevel } from '../data/HighlandCampaign.js';
import { FindExplorePath as FindPath } from '../data/ExplorePathfinding.js';
import { GetZone } from '../data/WorldMaps.js';
import { TacticalPawn } from '../entities/TacticalPawn.js';
import { HighlandEnvironment } from '../entities/HighlandEnvironment.js';
import { TerrainView } from '../rendering/TerrainView.js';
import { TurnSystem } from '../components/TurnSystem.js';
import { TacticalControls } from '../input/TacticalControls.js';
import { TacticalHUD } from '../ui/TacticalHUD.js';
import { ControlSettings } from '../input/ControlModes.js';
import { HighlandActions } from '../data/HighlandActions.js';
import { ActiveSession, EndSession, MmoClient, NormalizeServerUrl, StartSession } from '../net/MmoClient.js';
import { CampaignFromServer, RemoteLink } from '../net/RemoteLink.js';
import { RemoteActions } from '../net/RemoteActions.js';

const NetworkStorageKey = 'highland-network-v1';

/** Scene composition and campaign transitions; combat rules remain in ECS components. */
export class HighlandLevel extends Level3D {
    constructor(sceneId = 'hearthvale') {
        super({ width: 1100, height: 760, usePhysics: false, clearColor: [0.09, 0.16, 0.2, 1] });
        this.id = sceneId;
        this.sceneId = sceneId;
        this.caption = 'Highland Tactics 3D';
        this.actions = new HighlandActions(this);
    }

    BuildScene() {
        let settings = this.sceneParams.controlSettings;
        let settingsError = null;
        if (!settings) {
            try {
                const saved = globalThis.localStorage?.getItem('highland-control-settings-v1');
                if (saved) settings = JSON.parse(saved);
                settings = ControlSettings(settings?.mode ?? 'PC', settings);
            }
            catch (error) {
                settings = ControlSettings();
                settingsError = `Control settings could not be loaded: ${error.message}`;
            }
        }
        this.controlSettings = ControlSettings(settings.mode, settings);
        // Single-hero MMORPG mode: companions/party control stay in the code behind this flag
        // (config/game.config.json → gameplay.partyControlEnabled) for future party or mercenary support.
        this.partyControlEnabled = this.context.config?.gameplay?.partyControlEnabled === true;
        const document = this.context.assets.jsons[this.sceneId];
        if (!document) throw new Error(`Highland scene "${this.sceneId}" is missing from resources.json.`);
        const prefabs = SceneDocument.LoadedPrefabs(this.context.assets);
        const sceneDocument = new SceneDocument(document, { prefabs });
        this.sceneDocument = sceneDocument;
        this.isBattleScene = this.sceneId === 'battlefield';
        this.battleData = BattleFromScene(this.context.assets.jsons.battlefield);
        this.battleGrid = new HeightGrid(this.battleData.heights);
        const zoneId = this.isBattleScene ? this.sceneParams.zoneId : this.sceneId;
        if (!zoneId) throw new Error('The battlefield scene needs a zoneId and campaign in sceneParams.');
        const zoneDocument = this.context.assets.jsons[zoneId];
        this.zone = GetZone(zoneId, zoneDocument);
        this.campaign = this.sceneParams.campaign
            ? HighlandCampaign.FromSave(this.sceneParams.campaign)
            : new HighlandCampaign();
        if (!this.sceneParams.campaign) this.campaign.CreateCharacter('vanguard');
        this.campaign.zoneId = zoneId;
        const entry = this.isBattleScene ? null : this.sceneParams.entry ?? this.zone.spawn;
        if (entry) {
            this.campaign.hero.col = entry.col;
            this.campaign.hero.row = entry.row;
        }
        this.grid = this.isBattleScene ? this.battleGrid : new HeightGrid(this.zone.heights);
        this.exploring = this.isBattleScene ? 'battle' : this.sceneParams.campaign ? 'explore' : 'creation';
        this.returnPosition = this.sceneParams.returnPosition ?? null;

        const renderData = this.isBattleScene
            ? { ...document, nodes: document.nodes.filter(node => node.layer !== 'units') }
            : document;
        const renderDocument = new SceneDocument(renderData, { prefabs });
        this.sceneContent = SceneManifest3D.Create(renderDocument.ToManifest3D(), {
            aspect: this.width / this.height,
            assets: this.context.assets,
        });
        this.scene = this.sceneContent.scene;
        this.camera = new OrthographicCamera({
            position: sceneDocument.settings.camera.position,
            target: sceneDocument.settings.camera.target,
            viewHeight: this.isBattleScene ? 16 : 13,
            far: 100,
        });
        this.scene.Remove(this.sceneContent.camera);
        this.scene.Add(this.camera);
        const surfaces = [...new Set([...this.sceneContent.nodes.values()]
            .flatMap(node => node.materials ?? [])
            .filter(material => material instanceof SurfaceMaterial))];
        const waterNode = sceneDocument.Nodes().find(node => sceneDocument.Component(node, 'Data')?.kind === 'water');
        const water = waterNode ? this.sceneContent.nodes.get(waterNode.id)?.materials?.[0] ?? null : null;

        this.turn = new TurnSystem(this.grid, [], null);
        this.turn.enabled = false;
        this.turn.phase = this.isBattleScene ? 'command' : 'explore';
        this.turn.message = this.isBattleScene ? '' : this.exploring === 'creation'
            ? 'Choose a calling to begin your journey.'
            : `${this.zone.name} · ${this.zone.subtitle}`;
        if (settingsError) this.turn.message = settingsError;
        const director = new GameObject();
        this.sound = director.AddComponent(new SoundEffects(this.context.services.get('audio')));
        this.turn.sound = this.sound;
        director.AddComponent(this.turn);
        this.AddEntity(director);

        this.terrain = this.AddEntity(new TerrainView(this.scene, this.grid));
        this.environment = this.AddEntity(new HighlandEnvironment(this.scene, this.grid, surfaces, water));
        this.pawns = [];
        if (this.isBattleScene) {
            this.InitializeBattle(this.sceneParams.encounterId);
        }
        else {
            this.player = this.AddEntity(new TacticalPawn(this.grid, this.scene, this.HeroDefinition()));
            this.pawns = [this.player];
            this.vendors = this.CreateVendors();
            this.shopkeeper = this.vendors[0] ?? null;
            this.groupLeaders = this.CreateGroupLeaders();
            this.groupLeader = this.groupLeaders[0] ?? null;
        }
        this.hoveredEncounter = null;
        this.exploreRoute = null;

        this.hud = new TacticalHUD(this);
        this.controls = new TacticalControls(this);
        this.cameraStep = 0;
        this.cameraAngle = Math.PI / 4;
        this.cameraViewTarget = 13;
        this.releaseViewport = GameViewport.Bind(this.ui.Screen, { maxWidth: 1440, onResize: () => GameViewport.Align(this.ui.Screen, this.screen3D) });
        const session = ActiveSession();
        this.signedIn = Boolean(session);
        if (session && this.exploring !== 'creation') {
            this.remote = new RemoteLink(this, session);
            this.actions = new RemoteActions(this, this.remote);
            // The server has no turn timer, so the browser must not pass turns on its own.
            if (this.exploring === 'battle') this.turn.turnLimit = 0;
            this.remote.Attach();
        }
    }

    // ---------- online / LAN ----------

    /** Last server address and username per mode (never the password). */
    NetworkMemory() {
        try { return JSON.parse(globalThis.localStorage?.getItem(NetworkStorageKey) ?? '{}') ?? {}; }
        catch { return {}; }
    }

    /**
     * Connects to an MMO server and signs in (or registers). A hero saved on the server enters its
     * zone at once; a new account goes on to character creation.
     */
    async SignIn({ mode, address, username, password, register = false }) {
        if (this.exploring !== 'creation' || this.networkBusy) return false;
        let client = null;
        this.networkBusy = true;
        try {
            const url = NormalizeServerUrl(address);
            this.turn.message = `Connecting to ${url}…`;
            client = new MmoClient(url);
            await client.Connect();
            const reply = await client.Request(register ? 'register' : 'login', { username, password });
            StartSession({ client, account: reply.account, token: reply.token, mode });
            try {
                const memory = this.NetworkMemory();
                memory[mode] = { address, username };
                globalThis.localStorage?.setItem(NetworkStorageKey, JSON.stringify(memory));
            }
            catch { /* storage is optional */ }
            this.signedIn = true;
            this.sound.Play('success');
            if (reply.save) {
                this.EnterServerZone(reply.save);
                return true;
            }
            this.turn.message = `Signed in as ${reply.account.username} · name your hero and choose a calling.`;
            return true;
        }
        catch (error) {
            client?.Close();
            this.turn.message = `Sign-in failed: ${error.message}`;
            this.sound.Play('warning');
            return false;
        }
        finally {
            this.networkBusy = false;
        }
    }

    SignOut() {
        EndSession();
        this.signedIn = false;
        if (this.exploring === 'creation') this.turn.message = 'Signed out.';
        else this.LoadScene('hearthvale', { controlSettings: this.controlSettings });
    }

    /** Creates the hero on the server, then enters the world with the server's save. */
    async CreateRemoteCharacter(archetype, name) {
        const session = ActiveSession();
        if (!session || this.networkBusy) return false;
        this.networkBusy = true;
        try {
            const reply = await session.client.Request('character.create', { archetype, name: String(name ?? '').trim().slice(0, 20) || 'Highland Recruit' });
            this.EnterServerZone(reply.save);
            return true;
        }
        catch (error) {
            this.turn.message = `Character creation failed: ${error.message}`;
            return false;
        }
        finally {
            this.networkBusy = false;
        }
    }

    /** Loads the zone a server save stands in, exactly where the server put the hero. */
    EnterServerZone(save) {
        const campaign = CampaignFromServer(save);
        this.campaign = campaign;
        this.hud.panel = null;
        this.hud.nameField.SetActive(false);
        this.LoadScene(campaign.zoneId, {
            campaign: campaign.SaveData(),
            entry: { col: campaign.hero.col, row: campaign.hero.row },
            controlSettings: this.controlSettings,
        });
        return true;
    }

    /** Replaces the local campaign with the server's; the hero keeps walking unless `position`. */
    ApplyServerSave(save, { position = false } = {}) {
        if (this.exploring !== 'explore' || !save) return;
        const stats = this.player?.stats;
        this.campaign = CampaignFromServer(save, position || !stats ? null : { col: stats.col, row: stats.row, facing: stats.facing });
        this.campaign.zoneId = this.zone.id;
        if (position && stats) {
            stats.col = this.campaign.hero.col;
            stats.row = this.campaign.hero.row;
            this.player.travel.Snap();
            this.exploreRoute = null;
        }
        this.SyncEquipmentToPlayer();
        if (stats) stats.unlockedSkills = [...this.campaign.unlockedSkills];
    }

    /** The connection dropped: keep playing locally (nothing is saved to the server any more). */
    OnRemoteLost() {
        this.remote?.Detach();
        this.remote = null;
        this.signedIn = false;
        this.actions = new HighlandActions(this);
    }

    CreateGhost(definition) {
        if (this.exploring !== 'explore') return null;
        return this.AddEntity(new TacticalPawn(this.grid, this.scene, definition));
    }

    RemoveGhost(pawn) {
        this.RemoveEntity(pawn);
    }

    GhostPath(ghost, target) {
        if (ghost.travel.path.length) ghost.travel.Snap();
        const occupied = new Set((this.zone.structures ?? []).map(structure => this.grid.Key(structure)));
        return FindPath(this.grid, ghost.stats, target, occupied);
    }

    HeroDefinition() {
        return HeroUnit(this.campaign);
    }

    SetControlSettings(settings) {
        this.controlSettings = ControlSettings(settings.mode, settings);
        // A mode chosen mid-turn applies now: the ring re-reads autoRadial on the next frame.
        if (this.hud) this.hud.wasBattleCommand = false;
        try {
            if (!globalThis.localStorage) throw new Error('browser storage is unavailable');
            globalThis.localStorage.setItem('highland-control-settings-v1', JSON.stringify(this.controlSettings));
            this.turn.message = `${this.controlSettings.mode} controls selected.`;
        }
        catch (error) {
            this.turn.message = `Control settings apply for this session, but could not be saved: ${error.message}`;
        }
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
            model: vendor.model,
            color: { weapon: '#b95b45', armor: '#718a9f', consumable: '#6aa46f', rest: '#9a72aa' }[vendor.specialty],
            visualStyle: vendor.specialty,
        }));
    }

    CreateVendors() {
        return (this.zone.vendors ?? []).map(vendor => this.CreateShopkeeper(vendor));
    }

    CreateGroupLeader(encounter = this.zone.encounters?.[0]) {
        if (!encounter || this.campaign.clearedZones.has(encounter.id)) return null;
        let spawn = encounter;
        if (this.player.stats.col === encounter.col && this.player.stats.row === encounter.row) {
            const directions = [[0, -1], [1, 0], [0, 1], [-1, 0]];
            spawn = directions.map(([dx, dy]) => this.grid.Get(encounter.col + dx, encounter.row + dy))
                .find(tile => tile && Math.abs(tile.h - this.grid.Get(encounter.col, encounter.row).h) <= 1
                    && !(this.zone.encounters ?? []).some(other => other !== encounter && other.col === tile.col && other.row === tile.row)
                    && !(this.zone.structures ?? []).some(item => item.col === tile.col && item.row === tile.row)) ?? encounter;
        }
        const leader = this.AddEntity(new TacticalPawn(this.grid, this.scene, {
            id: `group-${encounter.id}`,
            name: encounter.name,
            encounterId: encounter.id,
            team: 'neutral',
            col: spawn.col,
            row: spawn.row,
            facing: 2,
            hp: 1,
            maxHp: 1,
            speed: 1,
            attack: 0,
            defense: 0,
            model: encounter.leaderModel,
            weapon: { 'skeleton-warrior': 'highland-sword', 'skeleton-mage': 'highland-wand' }[encounter.leaderModel],
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
        this.hud.shopSelection = 0;
        this.hud.panelPointer = null;
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
        if (this.exploring === 'creation' && this.signedIn) return this.CreateRemoteCharacter(archetype, name);
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

    SaveGame() {
        if (this.exploring !== 'explore') return false;
        if (this.remote) {
            this.turn.message = 'Online heroes are saved on the server after every change.';
            return true;
        }
        this.campaign.SyncHero(this.player.stats);
        try {
            globalThis.localStorage.setItem('highland-tactics-save-v1', JSON.stringify(this.campaign.SaveData()));
            this.turn.message = 'Adventure saved on this browser.';
            return true;
        }
        catch (error) {
            this.turn.message = `Save failed: ${error.message}`;
            return false;
        }
    }

    ContinueGame() {
        if (this.exploring !== 'creation' || this.signedIn) return false;
        let campaign;
        try {
            const saved = globalThis.localStorage.getItem('highland-tactics-save-v1');
            if (!saved) throw new Error('No saved adventure found.');
            campaign = HighlandCampaign.FromSave(JSON.parse(saved));
        }
        catch (error) {
            this.turn.message = `Continue failed: ${error.message}`;
            return false;
        }
        this.campaign = campaign;
        this.LoadZone(campaign.zoneId, { col: campaign.hero.col, row: campaign.hero.row });
        this.hud.panel = null;
        this.hud.nameField.SetActive(false);
        this.controls?.SuppressNextWorldClick();
        this.sound.Play('success');
        this.turn.message = 'Saved adventure restored.';
        return true;
    }

    LoadZone(zoneId, entry) {
        const zone = GetZone(zoneId, this.context.assets.jsons[zoneId]);
        const position = entry ?? zone.spawn;
        if (zone.heights[position.row]?.[position.col] === undefined)
            throw new RangeError(`Entry tile is outside the authored ${zoneId} scene.`);
        if (this.zone?.id && this.zone.id !== zoneId)
            for (const encounter of zone.otherEncounters ?? [])
                this.campaign.clearedZones.delete(encounter.id);
        if (this.player && ['explore', 'battle'].includes(this.exploring))
            this.campaign.SyncHero(this.player.stats);
        this.campaign.zoneId = zoneId;
        this.campaign.hero.col = position.col;
        this.campaign.hero.row = position.row;
        this.LoadScene(zoneId, { campaign: this.campaign.SaveData(), entry: position, controlSettings: this.controlSettings });
        return true;
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
                this.remote?.Moved(this.player.stats);
                return;
            }
            if (this.remote) {
                this.exploring = 'travel';
                this.turn.message = `Travelling to ${portal.to}…`;
                this.remote.Travel(this.player.stats)
                    .then(save => this.EnterServerZone(save))
                    .catch(error => {
                        this.exploring = 'explore';
                        this.turn.message = `Server: ${error.message}`;
                    });
                return;
            }
            this.LoadZone(portal.to, portal.entry);
            this.sound.Play('success');
            return;
        }
        this.remote?.Moved(this.player.stats);
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
        if (!['explore', 'battle'].includes(this.exploring)) return false;
        const encounter = this.zone.encounters.find(entry => entry.id === encounterId);
        if (!encounter) throw new RangeError(`Unknown encounter in ${this.zone.id}: ${encounterId}`);
        if (this.exploring === 'explore') {
            this.campaign.SyncHero(this.player.stats);
            this.returnPosition = { zoneId: this.zone.id, col: this.player.stats.col, row: this.player.stats.row };
        }
        this.campaign.zoneId = this.zone.id;
        this.LoadScene('battlefield', {
            campaign: this.campaign.SaveData(),
            zoneId: this.zone.id,
            encounterId,
            returnPosition: this.returnPosition,
            controlSettings: this.controlSettings,
        });
        return true;
    }

    InitializeBattle(encounterId) {
        const encounter = this.zone.encounters.find(entry => entry.id === encounterId);
        if (!encounter) throw new RangeError(`Unknown encounter in ${this.zone.id}: ${encounterId}`);
        this.encounterId = encounterId;
        const units = BuildBattleUnits(this.battleData, encounter, this.campaign, { partyControlEnabled: this.partyControlEnabled });
        this.pawns = units.map(unit => this.AddEntity(new TacticalPawn(this.grid, this.scene, unit)));
        this.player = this.pawns[0];
        this.turn.grid = this.grid;
        this.turn.pawns = this.pawns;
        this.turn.enabled = true;
        this.turn.turnLimit = this.sceneParams.turnLimit === undefined ? 60 : this.sceneParams.turnLimit;
        this.turn.Reset();
        this.turn.message = `${this.zone.name} patrol · defeat every Ash raider`;
        this.exploring = 'battle';
        this.cameraViewTarget = 16;
        this.resultHandled = false;
        this.lootResult = null;
        this.sound.Play('warning');
    }

    FinishBattle() {
        if (this.exploring !== 'battle' || this.resultHandled || !this.turn.result) return;
        if (this.remote) return this.FinishRemoteBattle();
        if (this.turn.result === 'VICTORY') {
            const { levels } = this.lootResult ?? this.actions.Loot();
            this.resultHandled = true;
            this.turn.message = levels
                ? `VICTORY · Level ${this.campaign.hero.level}! +${levels * AttributePointsPerLevel} attribute points [C] · Return to ${this.zone.name}.`
                : `VICTORY · +${this.encounterId === 'ashen-ridge' ? 90 : 60} XP · Return to ${this.zone.name}.`;
        }
        else {
            this.campaign.SyncHero(this.player.stats);
            const companion = this.pawns.find(pawn => pawn.stats.id === 'orin');
            if (companion) this.campaign.SyncCompanion(companion.stats);
            this.resultHandled = true;
            this.turn.message = 'DEFEAT · Return to Hearthvale and recover before another patrol.';
        }
        this.exploring = 'result';
        this.turn.enabled = false;
    }

    /** Online battles end with the server's verdict: its result, rewards and save replace the local ones. */
    FinishRemoteBattle() {
        const settled = this.remote.Settled();
        if (!settled) {
            this.turn.message = 'Waiting for the server to confirm the result…';
            return;
        }
        this.turn.result = settled.result;
        this.campaign = CampaignFromServer(settled.save);
        this.serverSave = settled.save;
        this.resultHandled = true;
        this.turn.message = settled.result === 'VICTORY'
            ? settled.levels
                ? `VICTORY · Level ${this.campaign.hero.level}! +${settled.levels * AttributePointsPerLevel} attribute points [C] · Return to ${this.zone.name}.`
                : `VICTORY · +${settled.experience ?? 0} XP · Return to ${this.zone.name}.`
            : 'DEFEAT · Return to Hearthvale and recover before another patrol.';
        this.exploring = 'result';
        this.turn.enabled = false;
    }

    ReturnToExplore() {
        if (this.exploring !== 'result') return;
        if (this.remote && this.serverSave) {
            this.hud.panel = null;
            this.sound.Play('success');
            this.EnterServerZone(this.serverSave);
            return;
        }
        if (this.turn.result === 'DEFEAT') {
            this.campaign.hero.hp = Math.max(1, Math.ceil(this.campaign.hero.maxHp * 0.4));
            if (this.partyControlEnabled && this.campaign.companionDeployed)
                this.campaign.companion.hp = Math.max(1, Math.ceil(this.campaign.CompanionStats().maxHp * 0.4));
            this.campaign.zoneId = 'hearthvale';
            this.LoadZone('hearthvale');
        }
        else
            this.LoadZone(this.returnPosition.zoneId, { col: this.returnPosition.col, row: this.returnPosition.row });
        this.hud.panel = null;
        this.sound.Play('success');
    }

    /** Buys from the active vendor: consumables at the alchemist, gear into `slot` (or the first fitting one). */
    Buy(item, slot = null) {
        const consumable = slot === 'potion' || ['Consumables', 'Special'].includes(ItemInfo[item]?.category);
        const kind = consumable ? null : EquipmentSlot(item);
        const specialty = consumable ? 'consumable' : kind === 'weapon' ? 'weapon' : 'armor';
        if (this.zone.id !== 'hearthvale' || !this.activeVendor || !this.CanInteractShopkeeper(this.activeVendor)
            || this.activeVendor.stats.specialty !== specialty) {
            this.turn.message = 'This vendor does not stock that item.';
            return;
        }

        const success = consumable ? this.campaign.BuyConsumable(item)
            : slot && slot !== 'ring' ? this.campaign.Buy(item, slot) : this.campaign.Buy(item);
        this.turn.message = success ? `${item} purchased.` : 'Not enough gold, or you already have this item equipped.';
        if (success) {
            this.SyncEquipmentToPlayer();
            this.sound.Play('select');
            this.remote?.Change('buy', { item });
        }
    }

    ToggleCompanion() {
        if (this.exploring !== 'explore' || !this.partyControlEnabled) return false;
        this.campaign.companionDeployed = !this.campaign.companionDeployed;
        this.turn.message = this.campaign.companionDeployed ? 'Orin will join the next battle.' : 'Orin will remain in reserve.';
        this.sound.Play('select');
        return true;
    }

    Rest() {
        if (this.zone.id !== 'hearthvale' || this.activeVendor?.stats.specialty !== 'rest' || !this.CanInteractShopkeeper(this.activeVendor)) return;
        this.campaign.hero.hp = this.campaign.hero.maxHp;
        this.campaign.companion.hp = this.campaign.CompanionStats().maxHp;
        if (this.player) this.player.stats.hp = this.campaign.hero.hp;
        this.turn.message = this.partyControlEnabled ? 'Rested at Hearthvale — your party is ready.' : 'Rested at Hearthvale — fully restored.';
        this.sound.Play('success');
        this.remote?.Change('rest');
    }

    UsePotion() {
        const used = this.campaign.UsePotion();
        if (used && this.player) this.player.stats.hp = this.campaign.hero.hp;
        if (used && this.exploring === 'explore') this.remote?.Change('use', { item: 'Potion' });
        this.turn.message = used ? 'Potion used · 24 HP restored.' : 'No potion needed or available.';
    }

    /** Uses a backpack item outside battle (only Potions work there; the rest are battle items). */
    /** Spends unspent attribute points (Character panel). */
    AllocateAttribute(id, count = 1) {
        if (this.exploring !== 'explore') {
            this.turn.message = 'Train attributes outside battle.';
            return false;
        }
        if (!this.campaign.AllocateAttribute(id, count)) {
            this.turn.message = this.campaign.attributePoints ? 'That attribute cannot be raised.' : 'No attribute points left — level up to earn more.';
            return false;
        }
        this.SyncEquipmentToPlayer();
        this.remote?.Change('attribute', { id, count });
        this.turn.message = `${Attributes[id].label} raised · ${this.campaign.attributePoints} point(s) left.`;
        this.sound.Play('select');
        return true;
    }

    UseItem(item) {
        if (ItemInfo[item]?.permanent) {
            if (this.exploring !== 'explore') {
                this.turn.message = 'Read scrolls outside battle.';
                return false;
            }
            if (!this.campaign.ReadScroll(item)) {
                this.turn.message = this.campaign.inventory[item] > 0 ? `Your hero already knows the secret of the ${item}.` : `You have no ${item}.`;
                return false;
            }
            this.SyncEquipmentToPlayer();
            this.remote?.Change('use', { item });
            this.turn.message = `${item} read · AP ${this.campaign.hero.apMax} · MP ${this.campaign.hero.mpMax}.`;
            this.sound.Play('success');
            return true;
        }
        if (item !== 'Potion') {
            this.turn.message = ItemInfo[item]?.use ? `${item} can only be used in battle.` : `${item} cannot be used.`;
            return false;
        }
        const before = this.campaign.hero.hp;
        this.UsePotion();
        return this.campaign.hero.hp > before;
    }

    UseBattlePotion() {
        if (this.exploring !== 'battle' || this.turn.active !== this.player) {
            this.turn.message = 'Only your active hero can use a potion.';
            return false;
        }
        return this.actions.UseItem('Potion');
    }

    EquipItem(item, slot = null) {
        if (!this.actions.Equip(item, slot)) {
            this.turn.message = this.exploring === 'explore' ? `${item} does not fit there.` : 'Change equipment outside battle.';
            return false;
        }
        this.SyncEquipmentToPlayer();
        this.turn.message = `${item} equipped.`;
        this.sound.Play('select');
        return true;
    }

    UnequipItem(slot) {
        const item = this.campaign.equipment[slot];
        if (!this.actions.Unequip(slot)) return false;
        this.SyncEquipmentToPlayer();
        this.turn.message = `${item} moved to the backpack.`;
        this.sound.Play('select');
        return true;
    }

    SyncEquipmentToPlayer() {
        if (!this.player || !this.campaign.hero) return;
        for (const stat of ['attack', 'magic', 'defense', 'speed', 'maxHp', 'hp', 'apMax', 'mpMax'])
            this.player.stats[stat] = this.campaign.hero[stat];
        this.player.stats.resist = { ...(this.campaign.hero.resist ?? {}) };
        this.player.stats.visualWeapon = this.campaign.equipment.weapon;
        this.player.stats.visualOffhand = this.campaign.equipment.offhand;
        this.player.stats.ap = Math.min(this.player.stats.ap ?? this.player.stats.apMax, this.player.stats.apMax);
        this.player.stats.mp = Math.min(this.player.stats.mp ?? this.player.stats.mpMax, this.player.stats.mpMax);
    }

    ResetBattle() {
        if (this.exploring === 'battle' && !this.remote)
            this.StartBattle(this.encounterId);
    }

    SellPotion() {
        return this.SellItem('Potion');
    }

    /** Sells one consumable or resource to the alchemist. */
    SellItem(item) {
        if (this.activeVendor?.stats.specialty !== 'consumable' || !this.CanInteractShopkeeper(this.activeVendor)) {
            this.turn.message = 'Take consumables and resources to the alchemist.';
            return false;
        }
        const sold = this.campaign.SellItem(item);
        this.turn.message = sold ? `${item} sold for ${ItemInfo[item].sell}G.` : `No ${item} to sell.`;
        if (sold) {
            this.sound.Play('select');
            this.remote?.Change('sell', { item });
        }
        return sold;
    }

    SellEquipment(slot) {
        const specialty = slot === 'weapon' ? 'weapon' : 'armor';
        if (this.activeVendor?.stats.specialty !== specialty || !this.CanInteractShopkeeper(this.activeVendor)) {
            this.turn.message = 'Take equipment to the matching Hearthvale vendor.';
            return;
        }
        const item = this.campaign.equipment[slot];
        const sold = this.campaign.SellEquipment(slot);
        this.turn.message = sold ? `${slot} sold for half value.` : `The default ${slot} cannot be sold.`;
        if (sold) {
            this.SyncEquipmentToPlayer();
            this.sound.Play('select');
            if (this.remote) this.remote.Change('unequip', { slot }).then(() => this.remote?.Change('sell', { item }));
        }
    }

    SellOwned(item) {
        const slot = EquipmentSlot(item);
        if (!slot && ItemInfo[item]?.sell) return this.SellItem(item);
        const specialty = slot === 'weapon' ? 'weapon' : 'armor';
        if (!slot || this.activeVendor?.stats.specialty !== specialty || !this.CanInteractShopkeeper(this.activeVendor)) {
            this.turn.message = 'Take equipment to the matching Hearthvale vendor.';
            return false;
        }
        const sold = this.campaign.SellOwned(item);
        this.turn.message = sold ? `${item} sold for half value.` : `No sellable ${item} in your bag.`;
        if (sold) {
            this.sound.Play('select');
            this.remote?.Change('sell', { item });
        }
        return sold;
    }

    LearnSkill(id) {
        const learned = this.campaign.LearnSkill(id);
        if (learned && this.player) {
            this.player.stats.attack = this.campaign.hero.attack;
            this.player.stats.defense = this.campaign.hero.defense;
            this.player.stats.apMax = this.campaign.hero.apMax;
            this.player.stats.mpMax = this.campaign.hero.mpMax;
            this.player.stats.unlockedSkills = [...this.campaign.unlockedSkills];
            this.turn.message = `${id} learned · ${this.campaign.skillPoints} skill points remain.`;
            this.remote?.Change('learn', { id });
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
        const focus = ['explore', 'travel'].includes(this.exploring) ? this.player.travel.position : { x: 0, z: 0 };
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
        this.remote?.Update(dt);
        if (this.exploring === 'battle') this.FinishBattle();
        if (this.exploring === 'explore') this.campaign.SyncHero(this.player.stats);
        this.terrain.Highlights(this.turn, this.exploring === 'explore' ? this.exploreRoute : null, this.BattlePreview());
    }

    /**
     * What the PC dock previews on the grid during the hero's command phase: the move range and
     * the path to the hovered tile, or the range and AoE of the hovered hotbar ability.
     */
    BattlePreview() {
        const turn = this.turn, active = turn.active;
        if (this.exploring !== 'battle' || !this.controlSettings.dock || turn.phase !== 'command'
            || active?.stats.team !== 'ally' || this.hud.ringOpen) return null;
        const stats = active.stats, key = `${stats.id}:${stats.col},${stats.row}:${stats.mp}`;
        if (this.previewKey !== key) {
            this.previewKey = key;
            this.previewArea = turn.Range();
        }
        const slot = this.hud.HoveredSlot?.();
        const tile = this.hoveredTile ?? null;
        if (slot?.kind === 'ability' && !slot.locked) return { ability: slot.id, tile };
        const occupied = tile && turn.Alive().some(pawn => pawn.stats.col === tile.col && pawn.stats.row === tile.row && pawn !== active);
        if (occupied) return { ability: stats.basicAbility ?? 'strike', tile };
        const path = tile ? this.previewArea.get(this.grid.Key(tile))?.path ?? null : null;
        return { area: this.previewArea, path };
    }

    OnGUI() { this.hud.Draw(); }

    OnExit() {
        this.releaseViewport?.();
        this.remote?.Detach();
        this.hud?.Dispose();
        super.OnExit();
    }
}
