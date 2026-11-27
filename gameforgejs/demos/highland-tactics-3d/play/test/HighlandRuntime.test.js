import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as NodeModule from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SkillTrees } from '../src/data/ClassSkills.js';
import { FindExplorePath } from '../src/data/ExplorePathfinding.js';
import { BattleRules } from '../src/data/BattleRules.js';
import { HighlandActions, HotbarSlots } from '../src/data/HighlandActions.js';
import { ControlSettings } from '../src/input/ControlModes.js';

if (typeof globalThis.Image !== 'function')
    globalThis.Image = class {};

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..', '..', '..');
const config = JSON.parse(readFileSync(path.join(repositoryRoot, 'gameforge.config.json'), 'utf8'));
const battlefield = JSON.parse(readFileSync(path.join(testDirectory, '..', 'scenes', 'battlefield.gfscene.json'), 'utf8'));
const zoneScenes = Object.fromEntries(['hearthvale', 'mistfell', 'ashen-ridge'].map(id => [
    id,
    JSON.parse(readFileSync(path.join(testDirectory, '..', 'scenes', `${id}.gfscene.json`), 'utf8')),
]));
const tilePrefab = JSON.parse(readFileSync(path.join(testDirectory, '..', 'prefabs', 'highland_tile_base.gfprefab.json'), 'utf8'));
const GetZone = id => ReadZone(id, zoneScenes[id]);
const engineRoot = process.env.GAMEFORGEJS_ROOT || path.resolve(repositoryRoot, config.runtimeRoot ?? config.engineRoot);
if (!existsSync(path.join(engineRoot, 'src', 'core', 'index.js')))
    throw new Error(`Set GAMEFORGEJS_ROOT to a GameForgeJS checkout (expected ${engineRoot}).`);

function resolveGameForgeModule(specifier, context, nextResolve) {
    const match = /^gameforgejs(?:\/(core|2d|3d))?$/.exec(specifier);
    if (!match)
        return nextResolve(specifier, context);

    const module = match[1] ?? 'core';
    const entry = path.join(engineRoot, 'src', module, 'index.js');
    return nextResolve(pathToFileURL(entry).href, context);
}

if (typeof NodeModule.registerHooks === 'function')
    NodeModule.registerHooks({ resolve: resolveGameForgeModule });
else
    NodeModule.register(new URL('../../../scripts/highland-runtime-loader.mjs', import.meta.url), import.meta.url, { data: engineRoot });

const [
    { HeightGrid, ModelMeshFactory },
    { GameObject },
    { TerrainView },
    { HighlandLevel },
    { HighlandCampaign },
    { BattleFromScene },
    { GetZone: ReadZone },
    { TurnSystem },
    { TacticalHUD, SheetLayout, DockLayout, ExplorationBarLayout, ItemHintLayout, RadialMenuLayout, RadialMenuHitTest },
    { TacticalControls },
    { UnitVisual },
] = await Promise.all([
    import('gameforgejs/3d'),
    import('gameforgejs/2d'),
    import('../src/rendering/TerrainView.js'),
    import('../src/levels/HighlandLevel.js'),
    import('../src/data/HighlandCampaign.js'),
    import('../src/data/BattleScene.js'),
    import('../src/data/WorldMaps.js'),
    import('../src/components/TurnSystem.js'),
    import('../src/ui/TacticalHUD.js'),
    import('../src/input/TacticalControls.js'),
    import('../src/components/UnitVisual.js'),
]);
const { Input, SceneDocument } = await import('gameforgejs/core');
const { CharacterSheet } = await import('../src/ui/CharacterSheet.js');

function createScene() {
    const objects = new Set();
    return {
        objects,
        Add(object) { objects.add(object); },
        Remove(object) { objects.delete(object); },
    };
}

function installSceneLoader(level) {
    level.actions = new HighlandActions(level);
    level.LoadScene = (id, params) => {
        level.lastSceneRequest = { id, params };
        if (id === 'battlefield') {
            level.sceneParams = params;
            level.zone = GetZone(params.zoneId);
            level.InitializeBattle(params.encounterId);
            return;
        }
        level.zone = GetZone(id);
        level.grid = new HeightGrid(level.zone.heights);
        const position = params.entry ?? level.zone.spawn;
        level.player = { stats: { ...level.campaign.hero, col: position.col, row: position.row }, travel: { path: [] } };
        level.pawns = [level.player];
        level.exploring = 'explore';
        level.vendors = [];
        level.shopkeeper = null;
        level.groupLeaders = level.CreateGroupLeaders();
        level.groupLeader = level.groupLeaders[0] ?? null;
        level.turn.grid = level.grid;
        level.turn.pawns = level.pawns;
        level.turn.phase = 'explore';
        level.turn.message = `${level.zone.name} · ${level.zone.subtitle}`;
    };
}

test('tactical overlays build over authored scene terrain without generating map geometry', () => {
    const grid = new HeightGrid([[0, 1], [1, 0]]);
    const scene = createScene();
    const terrain = new TerrainView(scene, grid);

    assert.equal(terrain.tiles.length, 4);
    assert.equal(scene.objects.size, 4);
});

test('map scenes author every tile and landmark, and the battle scene resolves its external mesh prefab', () => {
    const battleDocument = new SceneDocument(battlefield, { prefabs: { [tilePrefab.id]: tilePrefab } });
    const tileObjects = battleDocument.ToManifest3D().objects.filter(object => object.id.startsWith('tile_'));
    const tileBases = tileObjects.filter(object => object.parts?.length);
    assert.equal(tileBases.length, 76);
    assert.ok(tileBases.every(object => object.parts.length === 1));
    assert.ok(tilePrefab.nodes.every(node => node.type !== 'Node3D'));
    assert.ok(battlefield.nodes.every(node => node.type !== 'Node3D'));
    const workspace = JSON.parse(readFileSync(path.join(testDirectory, '..', 'game.workspace.json'), 'utf8'));
    const resources = JSON.parse(readFileSync(path.join(testDirectory, '..', 'config', 'resources.json'), 'utf8'));
    for (const [id, document] of Object.entries(zoneScenes)) {
        const grid = document.settings.grid;
        const tiles = document.nodes.filter(node => node.layer === 'tiles');
        const sceneDocument = new SceneDocument(document);
        assert.equal(tiles.length, grid.cols * grid.rows, `${id} must be fully authored`);
        assert.ok(document.nodes.some(node => node.layer === 'structures'), `${id} needs authored landmarks`);
        assert.ok(document.nodes.every(node => node.type !== 'Node3D'), `${id} uses Editor-supported node types`);
        assert.equal(GetZone(id).heights.length, grid.rows);
        assert.ok(sceneDocument.ToManifest3D().objects.length >= tiles.length);
        assert.ok(workspace.scenes.some(scene => scene.id === id && scene.path === `scenes/${id}.gfscene.json`));
        assert.ok(resources.jsons.some(resource => resource.name === id && resource.path === `../scenes/${id}.gfscene.json`));
    }
    assert.ok(workspace.scenes.some(scene => scene.id === 'battlefield'));
    assert.ok(resources.jsons.some(resource => resource.name === 'battlefield'));
});

test('workspace, resources, prefab and shader use canonical registered asset formats', () => {
    const exampleRoot = path.join(testDirectory, '..');
    const workspace = JSON.parse(readFileSync(path.join(exampleRoot, 'game.workspace.json'), 'utf8'));
    const resources = JSON.parse(readFileSync(path.join(exampleRoot, 'config', 'resources.json'), 'utf8'));
    const gameScenes = { battlefield, ...zoneScenes };
    for (const [id, document] of Object.entries(gameScenes)) {
        assert.doesNotThrow(() => new SceneDocument(document, {
            prefabs: id === 'battlefield' ? { [tilePrefab.id]: tilePrefab } : {},
        }));
        const scenePath = `scenes/${id}.gfscene.json`;
        assert.ok(workspace.scenes.some(scene => scene.id === id && scene.path === scenePath));
        assert.ok(existsSync(path.resolve(exampleRoot, scenePath)));
    }
    for (const asset of [...resources.jsons, ...resources.shaders, ...resources.models])
        assert.ok(existsSync(path.resolve(exampleRoot, 'config', asset.path)), `Missing resource: ${asset.path}`);
    for (const asset of resources.models) {
        const modelPath = path.resolve(exampleRoot, 'config', asset.path);
        // .glb files carry their JSON in the first chunk and embed buffers; .gltf files name them.
        const bytes = readFileSync(modelPath);
        const binary = bytes.toString('latin1', 0, 4) === 'glTF';
        const gltf = JSON.parse(binary ? bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)) : bytes.toString('utf8'));
        for (const dependency of [...(gltf.buffers ?? []), ...(gltf.images ?? [])].filter(item => item.uri && !item.uri.startsWith('data:')))
            assert.ok(existsSync(path.join(path.dirname(modelPath), dependency.uri)), `Missing model dependency: ${dependency.uri}`);
        assert.ok(asset.path.startsWith('../assets/kaykit-'), `${asset.name} must come from a CC0 KayKit pack`);
        assert.ok(existsSync(path.join(path.dirname(modelPath), 'provenance.json')), `${asset.name} needs provenance.json`);
    }
    assert.doesNotThrow(() => SceneDocument.Validate({ ...tilePrefab, format: SceneDocument.FORMAT }));
    const shader = JSON.parse(readFileSync(path.join(exampleRoot, 'shader', 'mossy_stone.gfshader'), 'utf8'));
    assert.equal(shader.format, 'gameforge.shader');
    assert.equal(shader.version, 1);
    assert.equal(typeof shader.glsl.fragment, 'string');
});

test('hero weapon models follow equipment, health, transform and entity lifecycle', () => {
    const original = ModelMeshFactory.FromAsset, scene = createScene(), made = [];
    ModelMeshFactory.FromAsset = name => {
        const mesh = { name, visible: true };
        const model = {
            meshes: [mesh], transform: {},
            SetPosition(...position) { this.position = position; },
            SetScale(scale) { this.scale = scale; },
            AddTo(target) { target.Add(mesh); },
        };
        made.push(model);
        return model;
    };
    try {
        const visual = new UnitVisual(scene, '#ffffff', null, true);
        visual.owner = { stats: { hp: 20, visualWeapon: 'Training Blade', facing: 1, flash: 0 }, travel: { position: { x: 1, y: 2, z: 3 } } };
        visual.OnStart();
        visual.OnUpdate();
        assert.deepEqual(made.map(model => model.meshes[0].visible), [true, false]);
        assert.equal(made[0].transform.parent, visual.root);
        assert.deepEqual(visual.root.position, [1, 2, 3]);
        visual.owner.stats.visualWeapon = 'Runed Staff';
        visual.OnUpdate();
        assert.deepEqual(made.map(model => model.meshes[0].visible), [false, true]);
        visual.owner.stats.visualWeapon = null;
        visual.OnUpdate();
        assert.deepEqual(made.map(model => model.meshes[0].visible), [false, false]);
        visual.owner.stats.visualWeapon = 'Runed Staff';
        visual.owner.stats.hp = 0;
        visual.OnUpdate();
        assert.deepEqual(made.map(model => model.meshes[0].visible), [false, false]);
        visual.OnDestroy();
        assert.equal(scene.objects.size, 0);
    }
    finally { ModelMeshFactory.FromAsset = original; }
});

test('exploration route markers follow each tile floor across elevations', () => {
    const grid = new HeightGrid([[0, 2], [1, 0]]);
    const terrain = new TerrainView(createScene(), grid, null);
    const route = {
        origin: { col: 0, row: 0 },
        path: [{ col: 1, row: 0 }],
        destination: { col: 1, row: 0 },
    };

    terrain.Highlights({ phase: 'explore' }, route);
    const origin = terrain.tiles.find(({ tile }) => tile.col === 0 && tile.row === 0);
    const destination = terrain.tiles.find(({ tile }) => tile.col === 1 && tile.row === 0);

    assert.equal(origin.overlay.visible, true);
    assert.equal(destination.overlay.visible, true);
    assert.equal(origin.overlay.transform.position[1], terrain.World(origin.tile).y + 0.01);
    assert.equal(destination.overlay.transform.position[1], terrain.World(destination.tile).y + 0.01);
    assert.ok(destination.overlay.transform.position[1] > origin.overlay.transform.position[1]);
});

test('facing arrows follow the active floor and select the projected direction', () => {
    const grid = new HeightGrid([[0, 1], [1, 0]]);
    const scene = createScene();
    const terrain = new TerrainView(scene, grid, null);
    const turn = { phase: 'face', active: { stats: { col: 1, row: 0, facing: 1, team: 'ally' } } };
    terrain.Highlights(turn);
    assert.equal(terrain.facingArrows.length, 4);
    assert.ok(terrain.facingArrows.every(arrow => arrow.visible && arrow.transform.position[1] === terrain.World(grid.Get(1, 0)).y + 0.08));
    const camera = { Project(point) { return { x: point.x * 100, y: point.z * 100, visible: true }; } };
    const east = terrain.FacingPositions(turn)[1];
    assert.equal(terrain.FacingAtPoint({ x: east.x * 100, y: east.z * 100 }, turn, camera, {}), 1);
    turn.phase = 'command';
    terrain.Highlights(turn);
    assert.ok(terrain.facingArrows.every(arrow => !arrow.visible));
});

test('targeting previews the directional line without highlighting friendly units as splash', () => {
    const grid = new HeightGrid([[0, 0, 0, 0, 0]]);
    const terrain = new TerrainView(createScene(), grid, null);
    const hero = { stats: { team: 'ally', hp: 30, col: 0, row: 0, ap: 6 } };
    const enemy = { stats: { team: 'enemy', hp: 30, col: 1, row: 0 } };
    const ally = { stats: { team: 'ally', hp: 30, col: 3, row: 0 } };
    const turn = { phase: 'target', active: hero, ability: 'piercing-arrow', cursor: { col: 1, row: 0 }, Alive: () => [hero, enemy, ally] };
    terrain.Highlights(turn);
    const color = col => terrain.tiles.find(entry => entry.tile.col === col).overlay.material.albedoColor;
    assert.ok(Math.abs(color(2)[1] - 0.48) < 0.01);
    assert.ok(Math.abs(color(3)[1] - 0.48) > 0.01);
});

test('focused skill previews the actual shape around a valid target and clears without one', () => {
    const grid = new HeightGrid([[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
    const terrain = new TerrainView(createScene(), grid);
    const hero = { stats: { id: 'hero', archetype: 'arcanist', unlockedSkills: ['fireball'], team: 'ally', hp: 30, col: 0, row: 1, ap: 6 } };
    const enemy = { stats: { id: 'enemy', team: 'enemy', hp: 30, col: 1, row: 1 } };
    const turn = { phase: 'skill-select', active: hero, skillCursor: 0, Alive: () => [hero, enemy] };
    terrain.Highlights(turn);
    const visible = (col, row) => terrain.tiles.find(entry => entry.tile.col === col && entry.tile.row === row).overlay.visible;
    assert.equal(visible(1, 1), true);
    assert.equal(visible(1, 0), true);
    assert.equal(visible(2, 1), true);
    assert.equal(visible(2, 0), false);
    hero.stats.ap = 2;
    terrain.Highlights(turn);
    assert.ok(terrain.tiles.every(entry => !entry.overlay.visible));
});

test('focused healing area previews allied cross without changing battle state', () => {
    const grid = new HeightGrid([[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
    const terrain = new TerrainView(createScene(), grid);
    const hero = { stats: { id: 'hero', archetype: 'cleric', unlockedSkills: ['healing-light'], team: 'ally', hp: 30, maxHp: 30, col: 0, row: 1, ap: 6 } };
    const ally = { stats: { id: 'ally', team: 'ally', hp: 10, maxHp: 30, col: 1, row: 1 } };
    const turn = { phase: 'skill-select', active: hero, skillCursor: 0, Alive: () => [hero, ally] };
    terrain.Highlights(turn);
    const color = (col, row) => terrain.tiles.find(entry => entry.tile.col === col && entry.tile.row === row).overlay.material.albedoColor;
    assert.ok(Math.abs(color(1, 0)[1] - 0.9) < 0.01);
    assert.equal(ally.stats.hp, 10);
    assert.equal(hero.stats.ap, 6);
    assert.equal(turn.phase, 'skill-select');
});

test('new characters begin at the active zone spawn tile', () => {
    const campaign = new HighlandCampaign();
    const     level = Object.create(HighlandLevel.prototype);
    Object.assign(level, {
        scene: createScene(),
        grid: new HeightGrid(GetZone('hearthvale').heights),
        zone: GetZone('hearthvale'),
        campaign,
        exploring: 'creation',
        player: {},
        pawns: [],
        turn: { phase: 'explore', message: '' },
        hud: { panel: null, nameField: { SetActive() {} } },
        controls: { SuppressNextWorldClick() {} },
        sound: { Play() {} },
        RemoveEntity() {},
        AddEntity(entity) { return entity; },
    });
    level.CreateCharacter('vanguard', 'Trail Warden');
    assert.deepEqual(
        { col: level.player.stats.col, row: level.player.stats.row },
        { col: level.zone.spawn.col, row: level.zone.spawn.row },
    );
});

test('zone transitions load registered authored scenes and keep the hero in exploration', () => {
    const campaign = new HighlandCampaign();
    campaign.CreateCharacter('ranger');
    const level = Object.create(HighlandLevel.prototype);
    Object.assign(level, {
        scene: createScene(),
        context: { assets: { jsons: zoneScenes } },
        campaign,
        pawns: [],
        exploring: 'explore',
        player: { stats: { ...campaign.hero, col: 1, row: 4 } },
        turn: { phase: 'explore' },
        AddEntity(entity) { return entity; },
        RemoveEntity() {},
    });
    installSceneLoader(level);

    test('exploration walks to a clicked destination and treats the trader as blocking', () => {
        const grid = new HeightGrid(GetZone('hearthvale').heights);
        let walked = null;
        const level = Object.create(HighlandLevel.prototype);
        Object.assign(level, {
            grid,
            zone: GetZone('hearthvale'),
            exploring: 'explore',
            turn: { message: '', cursor: null },
            sound: { Play() {} },
            player: {
                stats: { col: 1, row: 4 },
                travel: {
                    path: [],
                    Follow(path) { walked = path; this.path = path; },
                },
            },
            shopkeeper: { stats: { col: 3, row: 2 } },
        });

        const destination = grid.Get(7, 4);
        assert.equal(level.MoveExplore(destination), true);
        assert.ok(walked.length > 1);
        assert.deepEqual(walked.at(-1), destination);
        assert.equal(walked.some(tile => tile.col === 3 && tile.row === 2), false);
        assert.equal(level.FindExplorePath(grid.Get(3, 2)), null);
        assert.equal(level.FindExplorePath(grid.Get(3, 1)), null);
        assert.deepEqual(level.exploreRoute.origin, { col: 1, row: 4 });
        assert.deepEqual(level.exploreRoute.destination, destination);
        const retarget = grid.Get(7, 5);
        assert.equal(level.MoveExplore(retarget), true);
        assert.deepEqual(level.exploreRoute.destination, retarget);
        assert.deepEqual(walked.at(-1), retarget);
    });

    test('A-star finds a shortest walkable route and rejects blocked or unreachable targets', () => {
        const grid = new HeightGrid(Array.from({ length: 3 }, () => [0, 0, 0]));
        const occupied = new Set([grid.Key(grid.Get(1, 1))]);
        const path = FindExplorePath(grid, grid.Get(0, 1), grid.Get(2, 1), occupied);
        assert.equal(path.length, 4);
        assert.equal(path.some(tile => occupied.has(grid.Key(tile))), false);
        assert.deepEqual(FindExplorePath(grid, grid.Get(0, 0), grid.Get(2, 2)).length, 4);

        const wall = new Set([grid.Get(0, 1), grid.Get(1, 1), grid.Get(2, 1)].map(tile => grid.Key(tile)));
        assert.equal(FindExplorePath(grid, grid.Get(0, 0), grid.Get(2, 2), wall), null);
        assert.equal(FindExplorePath(grid, grid.Get(0, 0), grid.Get(1, 0), new Set([grid.Key(grid.Get(1, 0))])), null);
    });

    test('A-star preserves height-aware one-gap exploration jumps', () => {
        const gap = new HeightGrid([[0, null, 2]]);
        assert.deepEqual(FindExplorePath(gap, gap.Get(0, 0), gap.Get(2, 0)), [gap.Get(2, 0)]);
        const steep = new HeightGrid([[0, 2]]);
        assert.equal(FindExplorePath(steep, steep.Get(0, 0), steep.Get(1, 0)), null);
    });

    test('shopkeeper occupies the Hearthvale shop tile and opens trade only at close range', () => {
        const zone = GetZone('hearthvale');
        const level = Object.create(HighlandLevel.prototype);
        let approachPath = null;
        Object.assign(level, {
            scene: createScene(),
            grid: new HeightGrid(zone.heights),
            zone,
            exploring: 'explore',
            player: {
                stats: { col: 1, row: 4 },
                travel: {
                    path: [],
                    Follow(path) { approachPath = path; this.path = path; },
                },
            },
            turn: { message: '' },
            hud: { panel: null },
            sound: { Play() {} },
            AddEntity(entity) { return entity; },
        });

        level.shopkeeper = level.CreateShopkeeper();
        level.vendors = [level.shopkeeper];
        assert.equal(level.shopkeeper.stats.name, 'Mara the Weaponsmith');
        assert.deepEqual(
            { col: level.shopkeeper.stats.col, row: level.shopkeeper.stats.row },
            { col: zone.shop.col, row: zone.shop.row },
        );
        assert.equal(level.InteractShopkeeper(), false);
        assert.equal(level.ApproachShopkeeper(), true);
        const destination = approachPath.at(-1);
        assert.equal(Math.abs(destination.col - zone.shop.col) + Math.abs(destination.row - zone.shop.row), 1);
        level.player.stats.col = destination.col;
        level.player.stats.row = destination.row;
        assert.equal(level.InteractShopkeeper(), true);
        assert.equal(level.hud.panel, 'shop');
    });

    test('Hearthvale specialists gate transactions and display their NPC greetings', () => {
        const zone = GetZone('hearthvale');
        const campaign = new HighlandCampaign();
        campaign.CreateCharacter('vanguard');
        const level = Object.create(HighlandLevel.prototype);
        Object.assign(level, {
            scene: createScene(),
            grid: new HeightGrid(zone.heights),
            zone,
            campaign,
            player: { stats: { col: 3, row: 3 } },
            turn: { message: '' },
            hud: { panel: null, shopTab: 'buy' },
            sound: { Play() {} },
            AddEntity(entity) { return entity; },
        });
        level.vendors = level.CreateVendors();
        level.shopkeeper = level.vendors[0];
        assert.equal(level.vendors.length, 4);
        assert.deepEqual(level.vendors.map(vendor => vendor.stats.specialty), ['weapon', 'armor', 'consumable', 'rest']);

        assert.equal(level.InteractShopkeeper(level.vendors[0]), true);
        assert.match(level.turn.message, /sharper edge/);
        level.Buy('Potion', 'potion');
        assert.equal(campaign.inventory.Potion, 2);
        level.Buy('Highland Edge', 'weapon');
        assert.equal(campaign.equipment.weapon, 'Highland Edge');
        campaign.inventory['Highland Edge'] = 1;
        assert.equal(level.SellOwned('Highland Edge'), true);
        assert.equal(campaign.inventory['Highland Edge'], 0);

        level.player.stats.col = 3;
        level.player.stats.row = 4;
        campaign.gold = 50;
        assert.equal(level.InteractShopkeeper(level.vendors[2]), true);
        campaign.inventory['Highland Edge'] = 1;
        assert.equal(level.SellOwned('Highland Edge'), false);
        assert.equal(campaign.inventory['Highland Edge'], 1);
        level.Buy('Potion', 'potion');
        assert.equal(campaign.inventory.Potion, 3);
    });

    test('exploration camera tracks the hero and resets to the battlefield', () => {
        const level = Object.create(HighlandLevel.prototype);
        const camera = {
            target: [0, 0, 0], viewHeight: 13,
            LookAt(target) { this.target = target; },
            SetPosition(x, y, z) { this.position = [x, y, z]; },
        };
        Object.assign(level, {
            camera, cameraAngle: Math.PI / 4, cameraStep: 0, cameraViewTarget: 13,
            exploring: 'explore', player: { travel: { position: { x: 8, z: -6 } } },
            ui: { Screen: { Width: 1100, Height: 760 } },
        });
        level.UpdateCamera(1);
        assert.deepEqual(camera.target, [8, 0, -6]);
        level.exploring = 'battle';
        level.UpdateCamera(1);
        assert.deepEqual(camera.target, [0, 0, 0]);
    });

    test('group leader approach stops adjacent and starts the matching patrol', () => {
        const zone = GetZone('mistfell');
        const grid = new HeightGrid(zone.heights);
        const campaign = new HighlandCampaign();
        campaign.CreateCharacter('ranger');
        let route = null, engaged = null;
        const level = Object.create(HighlandLevel.prototype);
        Object.assign(level, {
            grid,
            zone,
            campaign,
            exploring: 'explore',
            vendors: [],
            player: {
                stats: { col: zone.spawn.col, row: zone.spawn.row },
                travel: { path: [], Follow(path) { route = path; this.path = path; } },
            },
            groupLeader: { stats: { ...zone.encounters[0] } },
            turn: { message: '', cursor: null },
            sound: { Play() {} },
            StartBattle(id) { engaged = id; },
        });
        assert.equal(level.ApproachEncounter(), true);
        const destination = route.at(-1);
        assert.equal(Math.abs(destination.col - zone.encounters[0].col) + Math.abs(destination.row - zone.encounters[0].row), 1);
        level.player.stats.col = destination.col;
        level.player.stats.row = destination.row;
        level.OnExploreArrival(destination);
        assert.equal(engaged, 'mistfell');
    });

    test('cleared encounters no longer interrupt exploration paths', () => {
        const level = Object.create(HighlandLevel.prototype);
        level.zone = GetZone('mistfell');
        level.groupLeaders = [];
        assert.equal(level.IsExploreTrigger(level.zone.encounters[0]), false);
        level.groupLeaders.push({ stats: { ...level.zone.encounters[0] } });
        assert.equal(level.IsExploreTrigger(level.zone.encounters[0]), true);
    });

    level.LoadZone('mistfell', { col: 2, row: 4 });
    assert.equal(level.zone.id, 'mistfell');
    assert.equal(level.exploring, 'explore');
    assert.equal(level.player.stats.col, 2);
    assert.equal(level.player.stats.row, 4);
    assert.equal(level.pawns.length, 1);
    assert.equal(level.turn.grid, level.grid);
    assert.equal(level.turn.pawns, level.pawns);

    level.LoadZone('ashen-ridge', { col: 3, row: 4 });
    assert.equal(level.zone.id, 'ashen-ridge');
    assert.equal(level.player.stats.col, 3);
    assert.equal(level.player.stats.row, 4);
    assert.equal(level.turn.phase, 'explore');
});

test('multiple patrols roam independently and engage the selected composition', () => {
    const campaign = new HighlandCampaign();
    campaign.CreateCharacter('ranger');
    const zone = GetZone('mistfell'), battleData = BattleFromScene(battlefield);
    const grid = new HeightGrid(zone.heights);
    const level = Object.create(HighlandLevel.prototype);
    Object.assign(level, {
        scene: createScene(), context: { assets: { jsons: zoneScenes } }, grid, zone, campaign, exploring: 'explore',
        battleData, battleGrid: new HeightGrid(battleData.heights),
        turn: new TurnSystem(grid, [], { Play() {} }),
        sound: { Play() {} }, hud: { panel: null }, vendors: [], pawns: [],
        player: { stats: { ...campaign.hero, col: 1, row: 5 }, travel: { path: [] } },
        AddEntity(entity) { return entity; }, RemoveEntity() {},
    });
    installSceneLoader(level);
    level.groupLeaders = level.CreateGroupLeaders();
    level.groupLeader = level.groupLeaders[0];
    assert.equal(level.groupLeaders.length, 2);
    for (const group of level.groupLeaders) group.travel.Snap();
    level.UpdatePatrols(3);
    assert.ok(level.groupLeaders.some(group => group.travel.path.length > 0));
    const selected = zone.encounters[1];
    assert.equal(level.ToggleCompanion(), true);
    level.StartBattle(selected.id);
    assert.deepEqual(level.pawns.filter(pawn => pawn.stats.team === 'ally').map(pawn => pawn.stats.id), ['hero']);
    const names = level.pawns.filter(pawn => pawn.stats.team === 'enemy').map(pawn => pawn.stats.name).sort();
    assert.deepEqual(names, selected.composition.flatMap(item => Array(item.count).fill(item.name)).sort());
    assert.ok(level.pawns.filter(pawn => pawn.stats.name === 'Ash Hound').every(pawn => pawn.stats.basicAbility === 'hound-bite'));
    level.turn.result = 'VICTORY';
    level.FinishBattle();
    assert.equal(campaign.companion.level, 1);
    assert.equal(campaign.clearedZones.has(selected.id), true);
    assert.equal(campaign.clearedZones.has('mistfell'), false);
    level.ReturnToExplore();
    assert.deepEqual(level.groupLeaders.map(group => group.stats.encounterId), ['mistfell']);
    assert.equal(level.ToggleCompanion(), true);
    level.StartBattle('mistfell');
    assert.ok(level.pawns.some(pawn => pawn.stats.name === 'Orin'));
    level.pawns.find(pawn => pawn.stats.id === 'orin').stats.hp = 20;
    level.turn.result = 'VICTORY';
    level.FinishBattle();
    assert.deepEqual(campaign.companion, { level: 2, xp: 0, hp: 26 });
    level.ReturnToExplore();
    assert.equal(level.groupLeaders.length, 0);
    level.StartBattle('mistfell-hounds');
    const orin = level.pawns.find(pawn => pawn.stats.id === 'orin');
    assert.equal(orin.stats.hp, 26);
    assert.equal(orin.stats.maxHp, 50);
    assert.equal(orin.stats.attack, 16);
    level.turn.result = 'DEFEAT';
    level.FinishBattle();
    level.ReturnToExplore();
    assert.equal(campaign.companion.hp, 20);
    level.LoadZone('mistfell');
    assert.equal(campaign.clearedZones.has('mistfell'), true);
    assert.equal(campaign.clearedZones.has(selected.id), false);
    assert.deepEqual(level.groupLeaders.map(group => group.stats.encounterId), [selected.id]);
});

test('expanded maps keep portals, shops and patrol approaches reachable around blockers', () => {
    for (const id of ['hearthvale', 'mistfell', 'ashen-ridge']) {
        const zone = GetZone(id), grid = new HeightGrid(zone.heights);
        const blocked = [...(zone.structures ?? []), ...(zone.vendors ?? []), ...zone.encounters];
        const occupied = new Set(blocked.map(point => grid.Key(point)));
        for (const portal of [zone.portal, zone.returnPortal].filter(Boolean))
            assert.ok(FindExplorePath(grid, zone.spawn, portal, occupied)?.length, `${id}: ${portal.label} unreachable`);
        for (const point of [...(zone.vendors ?? []), ...zone.encounters]) {
            const neighbors = [[0, -1], [1, 0], [0, 1], [-1, 0]]
                .map(([dc, dr]) => grid.Get(point.col + dc, point.row + dr)).filter(Boolean);
            assert.ok(neighbors.some(tile => FindExplorePath(grid, zone.spawn, tile, occupied)?.length),
                `${id}: ${point.name} has no reachable interaction tile`);
        }
    }
});

test('turn system advances through the GameForge component lifecycle', () => {
    const actor = {
        stats: { id: 'hero', team: 'ally', hp: 30, maxHp: 30, ct: 0, speed: 40, energy: 0, exposed: 0, col: 0, row: 0 },
    };
    const turn = new TurnSystem(new HeightGrid([[0]]), [actor], { Play() {} });
    const director = new GameObject();
    director.AddComponent(turn);
    director.OnUpdate(1);

    assert.equal(turn.phase, 'command');
    assert.equal(turn.active, actor);
});

test('battle items spend AP and inventory only for the active hero and only when useful', () => {
    const campaign = new HighlandCampaign();
    campaign.CreateCharacter('vanguard');
    campaign.inventory.Ether = 1;
    const hero = { stats: { ...campaign.hero, hp: 20, ap: 6, mp: 3, casts: {} } };
    const turn = new TurnSystem(new HeightGrid([[0]]), [hero], { Play() {} });
    const level = Object.create(HighlandLevel.prototype);
    Object.assign(level, { campaign, player: hero, turn, exploring: 'battle', sound: { Play() {} } });
    level.actions = new HighlandActions(level);
    turn.active = hero;
    turn.phase = 'command';
    turn.acted = false;
    turn.Choose(3);
    assert.equal(turn.phase, 'item');
    assert.equal(level.UseBattlePotion(), true);
    assert.equal(hero.stats.hp, 44);
    assert.equal(hero.stats.ap, 4);
    assert.equal(campaign.inventory.Potion, 1);
    assert.equal(turn.acted, true);
    assert.equal(turn.phase, 'command');
    // Ether restores AP once per turn; Antidote needs a status to cure and one in the bag.
    assert.equal(level.actions.UseItem('Ether'), true);
    assert.equal(hero.stats.ap, 6);
    assert.equal(campaign.inventory.Ether, 0);
    assert.equal(level.actions.UseItem('Ether'), false);
    assert.equal(level.actions.UseItem('Antidote'), false);
    assert.match(turn.message, /Nothing to cure|No Antidote/);
    hero.stats.ap = 1;
    assert.equal(level.actions.UseItem('Potion'), false);
    assert.match(turn.message, /Not enough AP/);
    assert.equal(campaign.inventory.Potion, 1);
    turn.Choose(4);
    assert.equal(turn.phase, 'face');
});

test('save and continue preserve the exploration position and report invalid storage', () => {
    const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    let value = null;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
        setItem(_key, data) { value = data; }, getItem() { return value; },
    } });
    try {
        const campaign = new HighlandCampaign();
        campaign.CreateCharacter('ranger');
        campaign.zoneId = 'mistfell';
        campaign.clearedZones.add('mistfell-hounds');
        const level = Object.create(HighlandLevel.prototype);
        Object.assign(level, {
            campaign, exploring: 'explore', player: { stats: { ...campaign.hero, col: 7, row: 4 } },
            turn: { message: '' }, hud: { nameField: { SetActive() {} } }, sound: { Play() {} },
            LoadZone(id, position) { this.loaded = { id, position }; this.exploring = 'explore'; },
        });
        assert.equal(level.SaveGame(), true);
        level.exploring = 'creation';
        assert.equal(level.ContinueGame(), true);
        assert.deepEqual(level.loaded, { id: 'mistfell', position: { col: 7, row: 4 } });
        assert.equal(level.campaign.clearedZones.has('mistfell-hounds'), true);
        value = '{bad json';
        level.exploring = 'creation';
        const current = level.campaign;
        assert.equal(level.ContinueGame(), false);
        assert.equal(level.campaign, current);
        assert.match(level.turn.message, /Continue failed/);
    }
    finally {
        if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
        else delete globalThis.localStorage;
    }
});

test('unlocked battle skills select their profile and apply status effects', () => {
    const actor = {
        stats: {
            id: 'hero', name: 'Vanguard', archetype: 'vanguard', team: 'ally', hp: 30, maxHp: 30,
            ct: 100, speed: 40, apMax: 6, mpMax: 3, exposed: 0, col: 0, row: 0,
            attack: 12, defense: 4, facing: 1, basicAbility: 'strike', unlockedSkills: ['shield-bash'],
        },
        travel: { position: { x: 0, y: 0, z: 0 } },
    };
    const target = {
        stats: {
            id: 'enemy', name: 'Ash Guard', team: 'enemy', hp: 30, maxHp: 30, ct: 0, speed: 20,
            energy: 0, exposed: 0, col: 1, row: 0, attack: 8, defense: 2, facing: 1,
        },
        travel: { position: { x: 1, y: 0, z: 0 } },
    };
    const grid = {
        Get: () => ({ h: 0 }),
        CanSee: () => true,
        Key: ({ col, row }) => `${col},${row}`,
    };
    const turn = new TurnSystem(grid, [actor, target], { Play() {} });
    turn.Begin(actor);
    turn.Choose(2);
    assert.equal(turn.phase, 'skill-select');
    assert.equal(turn.SelectSkill('shield-bash'), true);
    assert.equal(turn.phase, 'target');
    assert.equal(turn.Attack(target), true);
    turn.preview = { chance: 100, damage: 5, side: 'BACK' };
    turn.ResolveAttack();
    assert.equal(target.stats.stunned, 1);
    assert.equal(actor.stats.ap, 3);
    assert.equal(actor.stats.cooldowns['shield-bash'], 2);
    // The rest of the turn's AP stays spendable, but the skill waits for its cooldown.
    assert.equal(turn.phase, 'command');
    assert.equal(turn.SelectAbility('shield-bash'), false);
    assert.match(turn.message, /recharges in 2 turns/);
    assert.equal(turn.SelectAbility('strike'), true);
});

test('shield and haste support allies, absorb damage and expire on turns', () => {
    const grid = new HeightGrid(Array.from({ length: 3 }, () => [0, 0, 0]));
    const make = (id, team, col) => ({ stats: {
        id, name: id, team, col, row: 1, facing: 1, hp: 40, maxHp: 40,
        attack: 20, magic: 15, defense: 0, ap: 6, apMax: 6, ct: 0, speed: 10,
    }, travel: { position: { x: 0, y: 0, z: 0 } } });
    const hero = make('hero', 'ally', 0), ally = make('ally', 'ally', 1), enemy = make('enemy', 'enemy', 2);
    const turn = new TurnSystem(grid, [hero, ally, enemy], { Play() {} });
    const cast = (target, ability) => {
        Object.assign(turn, { active: hero, phase: 'target', acted: false, ability });
        assert.equal(turn.Attack(target), true);
        turn.ResolveAttack();
    };
    assert.equal(BattleRules.CanAttack(grid, hero.stats, enemy.stats, 'bulwark'), false);
    cast(ally, 'bulwark');
    assert.equal(ally.stats.shield, 12);
    Object.assign(turn, { active: enemy, phase: 'target', acted: false, ability: 'strike' });
    assert.equal(turn.Attack(ally), true);
    assert.equal(turn.preview.blocked, 12);
    const expected = turn.preview.damage;
    turn.preview.chance = 100;
    turn.ResolveAttack();
    assert.equal(ally.stats.hp, 40 - expected);
    assert.equal(ally.stats.shield, 0);
    hero.stats.ap = 6;
    cast(ally, 'haste');
    assert.equal(ally.stats.haste, 2);
    turn.phase = 'charge';
    turn.OnUpdate(1);
    assert.equal(ally.stats.ct, 45);
    turn.Begin(ally);
    assert.equal(ally.stats.haste, 1);
    turn.Begin(ally);
    assert.equal(ally.stats.haste, 0);
});

test('venom and chain lightning apply their status effects and spend AP', () => {
    const grid = new HeightGrid(Array.from({ length: 4 }, () => [0, 0, 0, 0]));
    const make = (id, team, col, row) => ({ stats: {
        id, name: id, team, col, row, facing: 1, hp: 50, maxHp: 50,
        attack: 15, magic: 15, defense: 0, ap: 6, apMax: 6, ct: 0, speed: 10,
    }, travel: { position: { x: 0, y: 0, z: 0 } } });
    const hero = make('hero', 'ally', 0, 1), target = make('target', 'enemy', 2, 1), neighbor = make('neighbor', 'enemy', 2, 2);
    const turn = new TurnSystem(grid, [hero, target, neighbor], { Play() {} });
    Object.assign(turn, { active: hero, phase: 'target', acted: false, ability: 'venom-shot' });
    assert.equal(turn.Attack(target), true);
    turn.preview.chance = 100;
    turn.ResolveAttack();
    assert.equal(hero.stats.ap, 2);
    assert.equal(target.stats.poison, 2);
    const before = target.stats.hp;
    turn.Begin(target);
    assert.equal(target.stats.hp, before - 3);
    assert.equal(target.stats.poison, 1);
    hero.stats.ap = 6;
    Object.assign(turn, { active: hero, phase: 'target', acted: false, ability: 'chain-lightning' });
    assert.equal(turn.Attack(target), true);
    turn.preview.chance = 100;
    turn.ResolveAttack();
    assert.equal(hero.stats.ap, 1);
    assert.equal(target.stats.stunned, 1);
    assert.equal(neighbor.stats.stunned, 1);
});

test('bruiser knockback respects occupied, missing and steep tiles', () => {
    const grid = new HeightGrid([[0, 0, 0, 3]]);
    const enemy = { stats: { col: 0, row: 0, hp: 30, team: 'enemy' } };
    const hero = { stats: { col: 1, row: 0, hp: 30, team: 'ally' }, travel: { Snap() { this.snapped = true; } } };
    const blocker = { stats: { col: 2, row: 0, hp: 30, team: 'ally' } };
    const turn = new TurnSystem(grid, [enemy, hero, blocker], { Play() {} });
    turn.active = enemy;
    assert.equal(turn.Knockback(hero), false);
    blocker.stats.hp = 0;
    assert.equal(turn.Knockback(hero), true);
    assert.equal(hero.stats.col, 2);
    assert.equal(hero.travel.snapped, true);
    enemy.stats.col = 1;
    assert.equal(turn.Knockback(hero), false);
    hero.stats.col = 0;
    enemy.stats.col = 1;
    assert.equal(turn.Knockback(hero), false);
});

test('a successful guard bash stuns and pushes the target', () => {
    const grid = new HeightGrid([[0, 0, 0]]);
    const enemy = { stats: { id: 'enemy', name: 'Guard', team: 'enemy', col: 0, row: 0,
        hp: 30, maxHp: 30, attack: 10, ap: 6, facing: 1 } };
    const hero = { stats: { id: 'hero', team: 'ally', col: 1, row: 0,
        hp: 30, maxHp: 30, defense: 2, facing: 3 }, travel: { Snap() { this.snapped = true; } } };
    const turn = new TurnSystem(grid, [enemy, hero], { Play() {} });
    Object.assign(turn, { active: enemy, phase: 'ai', acted: false });
    assert.equal(turn.Attack(hero, 'guard-bash'), true);
    turn.preview.chance = 100;
    turn.ResolveAttack();
    assert.equal(hero.stats.col, 2);
    assert.equal(hero.stats.stunned, 1);
    assert.equal(hero.travel.snapped, true);
    assert.equal(enemy.stats.ap, 3);
});

test('item hints avoid the header and fall back to inline details when space is constrained', () => {
    const panel = { x: 10, y: 276, width: 300, height: 276 };
    assert.equal(ItemHintLayout({ Width: 375, Height: 568 }, panel, 260), null);
    assert.equal(ItemHintLayout({ Width: 375, Height: 700 }, panel, 260), null);
    const below = ItemHintLayout({ Width: 494, Height: 697 }, { ...panel, y: 158 }, 142);
    assert.ok(below.y >= 158 + panel.height && below.y + below.height <= 697);
    const beside = ItemHintLayout({ Width: 900, Height: 600 }, { ...panel, y: 158 }, 142);
    assert.ok(beside.x >= panel.x + panel.width && beside.y >= 142);
});

test('shop hints include item description, price and equipment comparison when there is room', () => {
    const campaign = new HighlandCampaign();
    campaign.CreateCharacter('vanguard');
    const text = [], rectangles = [];
    const hud = Object.create(TacticalHUD.prototype);
    Object.assign(hud, {
        level: { campaign }, screen: { Width: 900, Height: 600 }, headerHeight: 142,
        frame: { theme: { gold: '#fff' }, Panel(rect) { rectangles.push(rect); }, Text(value) { text.push(value); } },
        DrawBagIcon() {},
    });
    hud.DrawItemHint('Highland Edge', 0, 'Buy 45G', 10, 158, 300, 276);
    assert.ok(text.some(line => line.includes('Buy 45G')));
    assert.ok(text.some(line => line.includes('keen highland steel')));
    assert.ok(text.some(line => line.includes('ATK +4')));
    assert.ok(rectangles.every(rect => rect.x >= 0 && rect.x + rect.width <= 900 && rect.y >= 142));
});

test('canvas character-name keyboard input edits and submits only when active', () => {
    const hud = Object.create(TacticalHUD.prototype);
    const field = {
        isActive: true,
        text: 'Hero',
        HandleInput(event) { this.text = event.key === 'Backspace' ? this.text.slice(0, -1) : this.text + event.key; },
        SetActive(active) { this.isActive = active; },
    };
    field.onSubmit = () => field.SetActive(false);
    hud.nameField = field;
    const typed = { key: 'X', preventDefault() { this.prevented = true; } };
    assert.equal(hud.HandleNameInput(typed), true);
    assert.equal(typed.prevented, true);
    assert.equal(field.text, 'HeroX');
    const shortcut = { key: 'x', ctrlKey: true, preventDefault() { this.prevented = true; } };
    assert.equal(hud.HandleNameInput(shortcut), false);
    assert.equal(shortcut.prevented, undefined);
    const submit = { key: 'Enter', preventDefault() { this.prevented = true; } };
    assert.equal(hud.HandleNameInput(submit), true);
    assert.equal(submit.prevented, true);
    assert.equal(field.isActive, false);
});

test('inventory focus and category navigation select real equip and use actions', () => {
    const campaign = new HighlandCampaign();
    campaign.CreateCharacter('vanguard');
    campaign.inventory['Highland Edge'] = 1;
    campaign.hero.hp = 10;
    const hud = Object.create(TacticalHUD.prototype);
    Object.assign(hud, {
        level: {
            campaign, turn: { message: '' },
            UseItem(name) { assert.equal(name, 'Potion'); return campaign.UsePotion(); },
            EquipItem(name) { return campaign.EquipOwned(name); },
        },
        inventoryCategory: 'All', selectedBagIndex: 0,
    });
    assert.equal(hud.SelectedBagItem().name, 'Potion');
    assert.equal(hud.ActivateBagItem(), true);
    assert.equal(campaign.hero.hp, 34);
    hud.CycleBagCategory(1);
    assert.equal(hud.inventoryCategory, 'Gear');
    assert.equal(hud.SelectedBagItem().name, 'Highland Edge');
    assert.equal(hud.ActivateBagItem(), true);
    assert.equal(campaign.equipment.weapon, 'Highland Edge');
    // The backpack lists what is carried, not what is worn: the old blade takes the slot.
    assert.deepEqual(hud.BagItems().map(item => item.name), ['Training Blade']);
    assert.equal(hud.ActivateBagItem(), true);
    assert.equal(campaign.equipment.weapon, 'Training Blade');
    campaign.AddLoot([{ item: 'Ash Shard', count: 3 }, { item: 'Focus Ring', count: 1 }]);
    hud.SelectBagCategory('Resources');
    assert.deepEqual(hud.BagItems(), [{ name: 'Ash Shard', count: 3, equipped: false }]);
    assert.equal(hud.ActivateBagItem(), false);
    assert.match(hud.level.turn.message, /resource/);
    hud.SelectBagCategory('Gear');
    hud.MoveBagSelection('RIGHT');
    assert.equal(hud.SelectedBagItem().name, 'Focus Ring');
    hud.MoveBagSelection('DOWN');
    assert.equal(hud.SelectedBagItem().name, 'Focus Ring');
    assert.equal(hud.ActivateBagItem(), true);
    assert.equal(campaign.equipment.ring1, 'Focus Ring');
    hud.SelectBagCategory('Nope');
    assert.equal(hud.inventoryCategory, 'Gear');
});

test('shop focus follows pages and executes the selected buy or sell offer', () => {
    const campaign = new HighlandCampaign();
    campaign.CreateCharacter('vanguard');
    campaign.gold = 200;
    const hud = Object.create(TacticalHUD.prototype);
    const level = {
        campaign, activeVendor: { stats: { specialty: 'weapon' } }, turn: { message: '' },
        Buy(name, slot) { return slot === 'potion' ? campaign.BuyConsumable(name) : campaign.Buy(name); },
        SellEquipment(slot) { return campaign.SellEquipment(slot); },
        SellOwned(name) { return campaign.SellOwned(name); },
        SellItem(name) { return campaign.SellItem(name); },
    };
    const names = ['Highland Edge', 'Runed Staff', 'Ranger Leathers', 'Iron Kilt', 'Scout Helm', 'Potion', 'Ether', 'Antidote', 'Mist Herb'];
    Object.assign(hud, {
        level, shopTab: 'buy', shopPage: 0, shopSelection: 0,
        stock: names.map(name => ({ name, button: {} })),
        sellSlots: [{ slot: 'weapon', button: {} }],
        sellInventory: names.map(name => ({ name, button: {} })),
    });
    hud.MoveShopSelection(1);
    assert.equal(hud.ShopOffers()[hud.shopSelection].name, 'Runed Staff');
    hud.ActivateShopOffer();
    assert.equal(campaign.equipment.weapon, 'Runed Staff');
    hud.SelectShopTab('sell');
    assert.equal(hud.ShopOffers()[hud.shopSelection].source, 'equipped');
    hud.ActivateShopOffer();
    assert.equal(campaign.equipment.weapon, 'Training Blade');
    assert.equal(campaign.gold, 172);
    level.activeVendor.stats.specialty = 'armor';
    hud.SelectShopTab('buy');
    hud.MoveShopSelection(1);
    hud.MoveShopSelection(1);
    assert.equal(hud.shopPage, 1);
    assert.equal(hud.ShopOffers()[hud.shopSelection].name, 'Scout Helm');
    hud.SelectShopPage(0);
    assert.equal(hud.ShopOffers()[hud.shopSelection].name, 'Ranger Leathers');
    // The alchemist sells every consumable and buys consumables and resources.
    level.activeVendor.stats.specialty = 'consumable';
    hud.SelectShopTab('buy');
    assert.deepEqual(hud.ShopOffers().map(offer => [offer.name, offer.price]), [['Potion', 15], ['Ether', 25], ['Antidote', 12]]);
    hud.MoveShopSelection(1);
    hud.ActivateShopOffer();
    assert.equal(campaign.inventory.Ether, 1);
    campaign.inventory['Mist Herb'] = 2;
    hud.SelectShopTab('sell');
    assert.deepEqual(hud.ShopOffers().map(offer => offer.name), ['Potion', 'Ether', 'Mist Herb']);
    hud.MoveShopSelection(2);
    const gold = campaign.gold;
    hud.ActivateShopOffer();
    assert.equal(campaign.gold, gold + 3);
    assert.equal(campaign.inventory['Mist Herb'], 1);
    assert.equal(hud.PointerMoved({ x: 25, y: 30 }), true);
    assert.equal(hud.PointerMoved({ x: 25, y: 30 }), false);
});

test('trainer rest restores wounded companion and hero', () => {
    const campaign = new HighlandCampaign();
    campaign.CreateCharacter('vanguard');
    campaign.hero.hp = 5;
    campaign.companion.hp = 2;
    const level = Object.create(HighlandLevel.prototype);
    Object.assign(level, {
        campaign, zone: { id: 'hearthvale' }, activeVendor: { stats: { specialty: 'rest' } },
        player: { stats: { hp: 5 } }, turn: { message: '' }, sound: { Play() {} },
        CanInteractShopkeeper() { return true; },
    });
    level.Rest();
    assert.equal(campaign.hero.hp, campaign.hero.maxHp);
    assert.equal(level.player.stats.hp, campaign.hero.maxHp);
    assert.equal(campaign.companion.hp, campaign.CompanionStats().maxHp);
});

test('Vanguard Cleave splashes adjacent enemies and Arcanist Fireball burns', () => {
    const sound = { Play() {} };
    const grid = {
        Get: () => ({ h: 0 }),
        CanSee: () => true,
        Key: ({ col, row }) => `${col},${row}`,
    };
    const actor = {
        stats: {
            id: 'hero', team: 'ally', hp: 30, maxHp: 30, ct: 100, speed: 40, energy: 0,
            exposed: 0, col: 0, row: 0, attack: 12, defense: 4, facing: 1, basicAbility: 'cleave',
        },
        travel: { position: { x: 0, y: 0, z: 0 } },
    };
    const target = {
        stats: { id: 'target', team: 'enemy', hp: 30, maxHp: 30, ct: 0, speed: 20, energy: 0, col: 1, row: 0, defense: 2, facing: 1 },
        travel: { position: { x: 1, y: 0, z: 0 } },
    };
    const neighbor = {
        stats: { id: 'neighbor', team: 'enemy', hp: 30, maxHp: 30, ct: 0, speed: 20, energy: 0, col: 1, row: 1, defense: 2, facing: 1 },
        travel: { position: { x: 1, y: 0, z: 1 } },
    };
    const turn = new TurnSystem(grid, [actor, target, neighbor], sound);
    turn.active = actor;
    turn.target = target;
    turn.ability = 'cleave';
    turn.phase = 'resolve';
    turn.preview = { chance: 100, damage: 10 };
    turn.ResolveAttack();
    assert.equal(target.stats.hp, 20);
    assert.equal(neighbor.stats.hp, 25);

    const caster = {
        stats: {
            id: 'mage', archetype: 'arcanist', team: 'ally', hp: 30, maxHp: 30, ct: 100,
            speed: 24, apMax: 6, mpMax: 3, exposed: 0, col: 0, row: 0, attack: 12,
            defense: 2, facing: 1, basicAbility: 'spark', unlockedSkills: ['fireball'],
        },
        travel: { position: { x: 0, y: 0, z: 0 } },
    };
    const burnTarget = {
        stats: { id: 'burn-target', team: 'enemy', hp: 30, maxHp: 30, ct: 0, speed: 20, energy: 0, col: 2, row: 0, defense: 2, facing: 1 },
        travel: { position: { x: 2, y: 0, z: 0 } },
    };
    const adjacent = { stats: { ...burnTarget.stats, id: 'adjacent', col: 2, row: 1 }, travel: burnTarget.travel };
    const fireTurn = new TurnSystem(grid, [caster, burnTarget, adjacent], sound);
    fireTurn.Begin(caster);
    fireTurn.Choose(2);
    assert.equal(fireTurn.SelectSkill('fireball'), true);
    assert.equal(fireTurn.Attack(burnTarget), true);
    fireTurn.preview = { chance: 100, damage: 5 };
    fireTurn.ResolveAttack();
    assert.equal(burnTarget.stats.burn, 2);
    assert.equal(adjacent.stats.hp, 27);
    assert.equal(adjacent.stats.burn, 2);
    assert.equal(caster.stats.ap, 2);
    assert.equal(fireTurn.phase, 'command');
    assert.equal(fireTurn.SelectAbility('spark'), false);
    assert.match(fireTurn.message, /Not enough AP/);
});

test('Cleric Heal targets wounded allies or self, costs AP and spends the action', () => {
    const grid = new HeightGrid([[0, 0, 0, 0, 0]]);
    const hero = { stats: {
        id: 'hero', name: 'Cleric', archetype: 'cleric', team: 'ally', hp: 30, maxHp: 42,
        col: 0, row: 0, facing: 1, attack: 11, speed: 23, apMax: 6, mpMax: 3,
        ct: 100, exposed: 0, unlockedSkills: ['heal'], basicAbility: 'radiant-bolt',
    } };
    const ally = { stats: { id: 'ally', team: 'ally', hp: 25, maxHp: 30, col: 2, row: 0 } };
    const enemy = { stats: { id: 'enemy', team: 'enemy', hp: 20, maxHp: 30, col: 1, row: 0 } };
    const turn = new TurnSystem(grid, [hero, ally, enemy], { Play() {} });
    turn.Begin(hero);
    turn.Choose(2);
    assert.equal(turn.SelectSkill('heal'), true);
    assert.equal(BattleRules.CanAttack(grid, hero.stats, enemy.stats, 'heal'), false);
    assert.equal(turn.Attack(ally), true);
    assert.equal(turn.preview.heal, 5);
    turn.ResolveAttack();
    assert.equal(ally.stats.hp, 30);
    assert.ok(hero.stats.ap < 6);
    assert.equal(turn.acted, true);
    assert.equal(BattleRules.CanAttack(grid, hero.stats, ally.stats, 'heal'), false);
    turn.Begin(hero);
    turn.Choose(2);
    assert.equal(turn.SelectSkill('heal'), true);
    assert.equal(turn.Attack(hero), true);
    turn.ResolveAttack();
    assert.equal(hero.stats.hp, 42);
});

test('advanced skills apply slow for one turn, cross exposure and allied healing', () => {
    const grid = new HeightGrid(Array.from({ length: 4 }, () => [0, 0, 0, 0]));
    const make = (id, team, col, row) => ({ stats: {
        id, team, col, row, hp: 30, maxHp: 30, attack: 12, defense: 2,
        facing: 1, speed: 20, ap: 6, apMax: 6, ct: 100, exposed: 0,
    } });
    const hero = make('hero', 'ally', 0, 0);
    const ally = make('ally', 'ally', 1, 0);
    const enemy = make('enemy', 'enemy', 2, 0);
    const neighbor = make('neighbor', 'enemy', 2, 1);
    const turn = new TurnSystem(grid, [hero, ally, enemy, neighbor], { Play() {} });
    const resolve = ability => {
        turn.active = hero;
        turn.target = enemy;
        turn.ability = ability;
        turn.phase = 'resolve';
        turn.preview = { chance: 100, damage: 5 };
        turn.ResolveAttack();
    };
    resolve('pinning-shot');
    assert.equal(enemy.stats.slowed, 1);
    turn.Begin(enemy);
    assert.ok([...turn.Range().values()].every(tile => tile.cost <= 1));
    turn.phase = 'ai';
    turn.EndTurn();
    assert.equal(enemy.stats.slowed, 0);
    hero.stats.ap = 6;
    resolve('arcane-burst');
    assert.equal(enemy.stats.exposed, 2);
    assert.equal(neighbor.stats.exposed, 2);

    hero.stats.hp = 20;
    ally.stats.hp = 20;
    hero.stats.ap = 6;
    turn.active = hero;
    turn.target = ally;
    turn.ability = 'healing-light';
    turn.phase = 'resolve';
    turn.ResolveAttack();
    assert.equal(hero.stats.hp, 30);
    assert.equal(ally.stats.hp, 30);
    assert.equal(enemy.stats.hp, 20);
    assert.equal(hero.stats.ap, 2);
});

test('magic and physical previews use separate stats, with magic-scaled healing and guard', () => {
    const grid = new HeightGrid([[0, 0, 0]]);
    const attacker = { team: 'ally', hp: 40, col: 0, row: 0, attack: 8, magic: 20, energy: 2, facing: 1 };
    const target = { team: 'enemy', hp: 40, maxHp: 40, col: 1, row: 0, defense: 2, facing: 3 };
    const magical = BattleRules.Preview(grid, attacker, target, 'spark').damage;
    assert.equal(BattleRules.Preview(grid, { ...attacker, attack: 30 }, target, 'spark').damage, magical);
    assert.ok(BattleRules.Preview(grid, { ...attacker, magic: 5 }, target, 'spark').damage < magical);
    assert.ok(BattleRules.Preview(grid, attacker, { ...target, guarded: true }, 'spark').damage < magical);
    assert.equal(BattleRules.Preview(grid, attacker, { ...attacker, hp: 1, maxHp: 40 }, 'heal').heal, 24);
});

test('line and cone skills hit only their intended enemy shapes', () => {
    const grid = new HeightGrid(Array.from({ length: 5 }, () => [0, 0, 0, 0, 0]));
    const pawn = (id, team, col, row) => ({ stats: {
        id, team, col, row, hp: 50, maxHp: 50, attack: 12, defense: 2, facing: 3, energy: 2,
    } });
    const hero = pawn('hero', 'ally', 0, 2), target = pawn('target', 'enemy', 1, 2);
    const behind = pawn('behind', 'enemy', 2, 2), side = pawn('side', 'enemy', 1, 1);
    const friend = pawn('friend', 'ally', 3, 2);
    const turn = new TurnSystem(grid, [hero, target, behind, side, friend], { Play() {} });
    assert.equal(BattleRules.CanAttack(grid, hero.stats, side.stats, 'piercing-arrow'), false);
    assert.equal(BattleRules.CanAttack(grid, hero.stats, target.stats, 'piercing-arrow'), true);
    Object.assign(turn, { active: hero, target, ability: 'piercing-arrow', phase: 'resolve', preview: { chance: 100, damage: 10 } });
    turn.ResolveAttack();
    assert.equal(behind.stats.hp, 44);
    assert.equal(side.stats.hp, 50);
    assert.equal(friend.stats.hp, 50);
    hero.stats.energy = 2;
    Object.assign(turn, { active: hero, target, ability: 'sweeping-strike', phase: 'resolve', preview: { chance: 100, damage: 10 } });
    turn.ResolveAttack();
    assert.equal(side.stats.hp, 42);
    assert.equal(behind.stats.hp, 44);
});

test('enemy roles guard, retreat and prioritize clustered targets', () => {
    const grid = new HeightGrid(Array.from({ length: 5 }, () => [0, 0, 0, 0, 0]));
    const pawn = (id, team, col, row, role) => ({ stats: {
        id, team, col, row, role, hp: 40, maxHp: 40, attack: 10, defense: 2,
        facing: 1, speed: 20, energy: 2, energyMax: 2, ct: 100,
    }, travel: { Follow(path) { this.path = path; } } });
    const hero = pawn('hero', 'ally', 0, 0), friend = pawn('friend', 'ally', 2, 1);
    const third = pawn('third', 'ally', 2, 2);
    const caster = pawn('caster', 'enemy', 0, 1, 'caster');
    caster.stats.basicAbility = 'ember-flare';
    const turn = new TurnSystem(grid, [caster, hero, friend, third], { Play() {} });
    Object.assign(turn, { active: caster, phase: 'ai', acted: false, moved: false });
    turn.EnemyStep();
    assert.equal(turn.target, friend);
    Object.assign(turn, { active: caster, phase: 'ai', acted: true, moved: false });
    turn.EnemyStep();
    assert.equal(turn.phase, 'travel');
    assert.ok(caster.travel.path.length > 0);

    const hound = pawn('hound', 'enemy', 1, 2, 'flanker');
    const houndTurn = new TurnSystem(grid, [hound, third], { Play() {} });
    Object.assign(houndTurn, { active: hound, phase: 'ai', acted: true, moved: false });
    houndTurn.EnemyStep();
    assert.equal(houndTurn.phase, 'travel');
    assert.ok(hound.travel.path.length > 0);

    const guard = pawn('guard', 'enemy', 4, 4, 'bruiser');
    const blockedGrid = { ...grid, Key: grid.Key.bind(grid), Get: grid.Get.bind(grid), CanSee: grid.CanSee.bind(grid), Reachable: () => new Map() };
    const guardTurn = new TurnSystem(blockedGrid, [guard, hero], { Play() {} });
    Object.assign(guardTurn, { active: guard, phase: 'ai', acted: false, moved: false });
    guardTurn.EnemyStep();
    assert.equal(guard.stats.guarded, true);
    guardTurn.Begin(guard);
    assert.equal(guard.stats.guarded, false);
});

test('caster enemy roles use their ranged attack profile', () => {
    const caster = {
        stats: {
            id: 'adept', name: 'Ash Adept', team: 'enemy', role: 'caster', hp: 24, maxHp: 24,
            ct: 100, speed: 20, energy: 2, exposed: 0, col: 0, row: 0, attack: 10,
            defense: 1, facing: 1, basicAbility: 'spark',
        },
        travel: { position: { x: 0, y: 0, z: 0 }, Follow() {} },
    };
    const hero = {
        stats: {
            id: 'hero', team: 'ally', hp: 30, maxHp: 30, ct: 0, speed: 20, energy: 0,
            exposed: 0, col: 2, row: 0, defense: 2, facing: 1,
        },
        travel: { position: { x: 2, y: 0, z: 0 } },
    };
    const grid = {
        Get: () => ({ h: 0 }),
        CanSee: () => true,
        Key: ({ col, row }) => `${col},${row}`,
    };
    const turn = new TurnSystem(grid, [caster, hero], { Play() {} });
    turn.active = caster;
    turn.phase = 'ai';
    turn.EnemyStep();
    assert.equal(turn.phase, 'resolve');
    assert.equal(turn.target, hero);
    assert.equal(turn.ability, 'spark');
});

test('flankers seek a stronger back attack before striking', () => {
    const grid = new HeightGrid(Array.from({ length: 4 }, () => [0, 0, 0, 0, 0]));
    let path = null;
    const enemy = {
        stats: { id: 'hound', team: 'enemy', role: 'flanker', hp: 30, col: 1, row: 1, facing: 1,
            attack: 12, energy: 0, basicAbility: 'strike' },
        travel: { Follow(steps) { path = steps; } },
    };
    const hero = { stats: { id: 'hero', team: 'ally', hp: 40, col: 2, row: 1, facing: 3, defense: 2 } };
    const turn = new TurnSystem(grid, [enemy, hero], { Play() {} });
    turn.active = enemy;
    turn.phase = 'ai';
    turn.EnemyStep();
    assert.equal(turn.phase, 'travel');
    assert.ok(path?.length);
    const destination = path.at(-1);
    assert.equal(BattleRules.Preview(grid, { ...enemy.stats, ...destination }, hero.stats, 'strike').side, 'BACK');
});

test('responsive HUD panels and controls stay within narrow, compact, and desktop screens', () => {
    for (const [width, height] of [[320, 568], [450, 728], [1100, 760]]) {
        const rectangles = [];
        const hud = Object.create(TacticalHUD.prototype);
        Object.assign(hud, {
            level: {
                campaign: {
                    hero: { name: 'Highland Recruit', level: 1, className: 'Vanguard', hp: 40, maxHp: 48, xp: 20, nextXp: 60 },
                    gold: 50,
                },
                zone: { name: 'Hearthvale', subtitle: 'A quiet hamlet beneath the watchtower' },
                exploring: 'explore',
            },
            screen: {
                Width: width,
                Height: height,
                Context: {
                    save() {}, restore() {}, beginPath() {}, arc() {}, fill() {}, stroke() {}, fillText() {},
                },
            },
            frame: {
                theme: { gold: '#e5c46d' },
                Panel(rect) { rectangles.push(rect); },
                Text() {},
                Meter() {},
            },
            menuTrigger: { button: { SetButton(rect) { rectangles.push(rect); } } },
            tools: [{}, {}, {}, {}],
            panel: null,
        });
        hud.Place = (_item, x, y, itemWidth, itemHeight, enabled = true) => {
            if (enabled) rectangles.push({ x, y, width: itemWidth, height: itemHeight });
        };

        hud.DrawStatus();
        assert.ok(rectangles.length > 4);
        for (const rect of rectangles) {
            assert.ok(rect.x >= 0 && rect.y >= 0, `${width}px HUD has a negative origin`);
            assert.ok(rect.x + rect.width <= width, `${width}px HUD exceeds screen width`);
            assert.ok(rect.y + rect.height <= height, `${height}px HUD exceeds screen height`);
        }
        assert.ok(hud.headerHeight < height - 100, `${height}px HUD leaves too little world view`);
        if (width < 400) {
            hud.level.exploring = 'battle';
            hud.DrawStatus();
            assert.equal(hud.headerHeight, 214);
        }
    }
});

test('class skill tree panel and unlock controls fit narrow and desktop screens', () => {
    const skillEntries = Object.values(SkillTrees).flat();
    for (const [width, height, headerHeight] of [[320, 568, 260], [1100, 760, 142]]) {
        const rectangles = [];
        const hud = Object.create(TacticalHUD.prototype);
        Object.assign(hud, {
            level: {
                campaign: {
                    hero: { archetype: 'vanguard', className: 'Vanguard' },
                    skillPoints: 1,
                    unlockedSkills: [],
                },
            },
            screen: { Width: width, Context: { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {} } },
            frame: {
                theme: { gold: '#e5c46d' },
                Panel(rect) { rectangles.push(rect); },
                Text() {},
            },
            panel: 'skills',
            skillTreeSelection: 0,
            headerHeight,
            panelButtons: { close: {} },
            skillNodeButtons: skillEntries.map(skill => ({ skill, label: '' })),
            Place(_item, x, y, itemWidth, itemHeight) {
                rectangles.push({ x, y, width: itemWidth, height: itemHeight });
            },
        });

        test('skill graph navigation and mobile focus preserve unlock and selection actions', () => {
            const hud = Object.create(TacticalHUD.prototype), learned = [], selected = [];
            Object.assign(hud, {
                level: {
                    campaign: { hero: { archetype: 'vanguard' } },
                    turn: { active: { stats: { archetype: 'vanguard', unlockedSkills: ['shield-bash', 'sweeping-strike'] } }, message: '' },
                    controlSettings: { mode: 'Mobile' },
                    LearnSkill(id) { learned.push(id); },
                    controls: { SelectSkill(id) { selected.push(id); } },
                },
                skillTreeSelection: 0, skillChoiceFocus: null,
            });
            hud.MoveSkillTreeSelection(1);
            hud.ActivateSkillTreeSelection();
            assert.deepEqual(learned, ['iron-vow']);
            hud.FocusOrSelectSkill('sweeping-strike');
            assert.equal(hud.level.turn.skillCursor, 1);
            assert.deepEqual(selected, []);
            hud.FocusOrSelectSkill('sweeping-strike');
            assert.deepEqual(selected, ['sweeping-strike']);
            hud.level.controlSettings.mode = 'PC';
            hud.FocusOrSelectSkill('shield-bash');
            assert.deepEqual(selected, ['sweeping-strike', 'shield-bash']);
            hud.UpdateSkillChoiceHover({ x: 90, y: 160 }, [1, 2], 100, 54, 5);
            assert.equal(hud.level.turn.skillCursor, 1);
            hud.level.turn.skillCursor = 0;
            hud.UpdateSkillChoiceHover({ x: 90, y: 160 }, [1, 2], 100, 54, 5);
            assert.equal(hud.level.turn.skillCursor, 0);
        });

        hud.DrawPanel();
        assert.ok(rectangles.length >= 2);
        for (const rect of rectangles) {
            assert.ok(rect.x >= 0 && rect.y >= 0);
            assert.ok(rect.x + rect.width <= width);
            assert.ok(rect.y + rect.height <= height);
        }
    }
});

test('character sheet keeps the 11-slot doll and the 8 by 5 backpack inside narrow and wide panels', () => {
    for (const [width, screenHeight] of [[300, 568], [355, 568], [660, 760]]) {
        const layout = SheetLayout(10, 10, width);
        const inside = rect => rect.x >= 10 && rect.y >= 10 && rect.x + rect.width <= 10 + width && rect.y + rect.height <= 10 + layout.height;
        assert.equal(new Set(layout.doll.map(rect => rect.slot)).size, 11);
        assert.equal(layout.grid.length, 40);
        assert.equal(new Set(layout.grid.map(rect => rect.x)).size, 8);
        assert.equal(new Set(layout.grid.map(rect => rect.y)).size, 5);
        assert.deepEqual(layout.filters.map(filter => filter.name), ['All', 'Gear', 'Consumables', 'Resources']);
        for (const rect of [...layout.doll, ...layout.grid, ...layout.filters]) assert.ok(inside(rect), `${width}px sheet overflows`);
        assert.ok(layout.height + 28 <= screenHeight, `${width}px sheet is taller than the screen`);
        // No doll slot overlaps a backpack cell.
        for (const slot of layout.doll)
            assert.ok(layout.grid.every(cell => cell.x >= slot.x + slot.width || cell.x + cell.width <= slot.x
                || cell.y >= slot.y + slot.height || cell.y + cell.height <= slot.y));
        assert.equal(layout.wide, width >= 600);
    }
});

test('PC dock fits ten hotbar slots, the medallion and Pass Turn on desktop, tablet and phone widths', () => {
    for (const [width, height, large] of [[1100, 760, false], [1440, 900, false], [768, 1024, true], [375, 812, false], [320, 568, true]]) {
        const layout = DockLayout(width, height, large);
        assert.equal(layout.slots.length, 10);
        const boxes = [...layout.slots.map(slot => ({ x: slot.x, y: slot.y, width: slot.size, height: slot.size })), layout.pass];
        for (const box of boxes) {
            assert.ok(box.x >= 10 && box.x + box.width <= width - 10, `${width}px dock overflows horizontally`);
            assert.ok(box.y >= layout.bar.y && box.y + box.height <= height, `${width}px dock overflows vertically`);
        }
        for (let index = 1; index < boxes.length; index++)
            for (let other = 0; other < index; other++) {
                const a = boxes[index], b = boxes[other];
                assert.ok(a.x >= b.x + b.width || a.x + a.width <= b.x || a.y >= b.y + b.height || a.y + a.height <= b.y, `${width}px dock overlaps`);
            }
        assert.ok(layout.medallion.cx + layout.medallion.r <= layout.slots[0].x || layout.medallion.cy + layout.medallion.r <= layout.slots[0].y);
        if (large) assert.ok(layout.slots[0].size >= Math.min(56, (width - 80) / 10), 'tablet targets stay large');
        assert.ok(layout.top > height / 3, `${width}px dock leaves room for the battlefield`);
    }
});

test('equipment picker cycles every owned candidate and resets when changing slots', () => {
    const hud = Object.create(TacticalHUD.prototype);
    Object.assign(hud, {
        level: { campaign: { inventory: { 'Runed Staff': 1, 'Highland Edge': 1, 'Iron Kilt': 1, 'Training Blade': 0 } } },
        selectedGearSlot: 'weapon',
        selectedGearIndex: 0,
    });
    assert.deepEqual(hud.GearCandidates(), ['Highland Edge', 'Runed Staff']);
    hud.CycleGear(1);
    assert.equal(hud.GearCandidates()[hud.selectedGearIndex], 'Runed Staff');
    hud.CycleGear(1);
    assert.equal(hud.selectedGearIndex, 0);
    hud.CycleGear(-1);
    assert.equal(hud.selectedGearIndex, 1);
    hud.SelectGearSlot('armor');
    assert.equal(hud.selectedGearIndex, 0);
    assert.deepEqual(hud.GearCandidates(), ['Iron Kilt']);
});

test('inventory and shop comparisons distinguish absolute magic bonuses from equipment deltas', () => {
    const hud = Object.create(TacticalHUD.prototype);
    hud.level = { campaign: { equipment: { weapon: 'Highland Edge' } } };
    assert.equal(hud.ItemModifiers('Runed Staff'), 'MAG +5');
    assert.equal(hud.GearComparison('Runed Staff'), 'ATK -4 · MAG +5');
    assert.equal(hud.ItemModifiers('Potion'), '+24 HP');
});

test('world map panel toggles open and closes cleanly', () => {
    const hud = Object.create(TacticalHUD.prototype);
    hud.panel = null;
    hud.level = { zone: { id: 'mistfell' } };
    hud.mapZones = [{}, {}, {}];
    hud.TogglePanel('map');
    assert.equal(hud.panel, 'map');
    assert.equal(hud.mapSelection, 1);
    hud.MoveMapSelection(1);
    assert.equal(hud.mapSelection, 2);
    hud.MoveMapSelection(1);
    assert.equal(hud.mapSelection, 0);
    hud.TogglePanel('map');
    assert.equal(hud.panel, null);
});

test('world map region controls show locked route state and stay inside the map', () => {
    const hud = Object.create(TacticalHUD.prototype), labels = [], rectangles = [];
    const c = { save() {}, restore() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
        fill() {}, stroke() {}, setLineDash() {}, arc() {}, bezierCurveTo() {} };
    Object.assign(hud, {
        level: { zone: { id: 'mistfell' }, campaign: { clearedZones: new Set() } },
        screen: { Context: c },
        frame: { theme: { gold: 'gold' }, Text(text) { labels.push(text); } },
        mapSelection: 2,
        mapZones: Array.from({ length: 3 }, () => ({ button: { SetButton(rect) { rectangles.push(rect); } } })),
    });
    hud.DrawWorldMap(10, 150, 300, 246, { col: 3, row: 4 });
    assert.ok(labels.includes('Road locked: clear the Mistfell patrol.'));
    assert.equal(rectangles.length, 3);
    assert.ok(rectangles.every(rect => rect.x >= 10 && rect.x + rect.width <= 310 && rect.y >= 189 && rect.y + rect.height <= 313));
    hud.level.campaign.clearedZones.add('mistfell');
    labels.length = 0;
    hud.DrawWorldMap(10, 150, 300, 246, { col: 3, row: 4 });
    assert.ok(labels.includes('Follow the roads to travel between regions.'));
});

test('radial menu lays out five angular actions and hit-tests the selected item', () => {
    for (const [width, height] of [[320, 568], [450, 728], [1100, 760]]) {
        const layout = RadialMenuLayout(width, height, 5, 1, { x: 8, y: height - 8 });
        assert.equal(layout.items.length, 5);
        assert.ok(layout.items.every(item =>
            item.x >= 0 && item.x <= width && item.y >= 0 && item.y <= height));
        for (let index = 1; index < layout.items.length; index++) {
            const delta = layout.items[index].angle - layout.items[index - 1].angle;
            assert.ok(Math.abs(delta - Math.PI * 2 / 5) < 1e-10);
        }
        assert.equal(RadialMenuHitTest(layout.items[4], layout), 4);
        assert.equal(RadialMenuHitTest(layout.center, layout), -1);
    }

    const opening = RadialMenuLayout(450, 728, 5, 0.5, { x: 225, y: 364 });
    const closing = RadialMenuLayout(450, 728, 5, 0.25, { x: 225, y: 364 });
    assert.ok(opening.radius > closing.radius);
});

test('exploration action bar fits desktop and narrow screens without overlapping buttons', () => {
    for (const [width, height] of [[320, 568], [450, 728], [1100, 760]]) {
        const layout = ExplorationBarLayout(width, height);
        assert.equal(layout.length, 8);
        assert.equal(new Set(layout.map(rect => rect.y)).size, width < 640 ? 2 : 1);
        for (const rect of layout) {
            assert.ok(rect.x >= 0 && rect.x + rect.width <= width);
            assert.ok(rect.y >= 0 && rect.y + rect.height <= height);
        }
    }
});

test('combat ring chooses available battle actions and never opens in exploration', () => {
    const hud = Object.create(TacticalHUD.prototype);
    const hero = { stats: { team: 'ally', archetype: 'vanguard', unlockedSkills: [], hp: 48, maxHp: 48, ap: 6, mp: 3 } };
    const turn = { phase: 'command', active: hero, acted: false, moved: false, command: 0, Choose(index) { this.chosen = index; this.phase = 'move'; } };
    Object.assign(hud, {
        level: { exploring: 'explore', turn, player: hero, campaign: { inventory: { Potion: 2 } },
            controls: { SelectCommand(index) { turn.Choose(index); } } },
        ringOpen: false,
        ringProgress: 0,
        ringSelected: 0,
        ringItems: ['Move', 'Attack', 'Skills', 'Item', 'Wait'].map(label => ({ label })),
    });

    test('control modes select radial defaults and allow custom settings', () => {
        assert.deepEqual(ControlSettings('PC'), { mode: 'PC', autoRadial: false, smartTarget: true, dock: true, largeTargets: false });
        assert.deepEqual(ControlSettings('Tablet'), { mode: 'Tablet', autoRadial: false, smartTarget: true, dock: true, largeTargets: true });
        for (const mode of ['Console', 'Mobile']) {
            assert.equal(ControlSettings(mode).autoRadial, true);
            assert.equal(ControlSettings(mode).dock, false);
        }
        assert.deepEqual(ControlSettings('Personalizado', { autoRadial: true, smartTarget: false }),
            { mode: 'Personalizado', autoRadial: true, smartTarget: false, dock: true, largeTargets: false });
        assert.equal(ControlSettings('Personalizado', { dock: false }).dock, false);
        assert.throws(() => ControlSettings('invalid'), /Unknown control mode/);
        for (const mode of ['PC', 'Console', 'Mobile', 'Tablet', 'Personalizado']) {
            const hud = Object.create(TacticalHUD.prototype);
            const level = { exploring: 'battle', turn: { phase: 'command', command: 0 },
                controlSettings: ControlSettings(mode, { autoRadial: true }) };
            Object.assign(hud, { level, ringOpen: false, ringProgress: 0 });
            hud.Update(0.1);
            assert.equal(hud.ringOpen, !['PC', 'Tablet'].includes(mode));
            level.exploring = 'explore';
            hud.Update(0.1);
            assert.equal(hud.ringOpen, false);
        }
    });

    test('smart target and facing select valid nearby opponents and preserve cancellation', () => {
        const grid = new HeightGrid([[0, 0, 0, 0, 0]]);
        const pawn = (id, team, col) => ({ stats: { id, name: id, team, col, row: 0, facing: 3,
            hp: 30, maxHp: 30, energy: 2, energyMax: 2, ct: 100, speed: 20,
            exposed: 0, attack: 10, defense: 0, archetype: 'ranger', basicAbility: 'quick-shot', unlockedSkills: [] } });
        const hero = pawn('hero', 'ally', 0), near = pawn('near', 'enemy', 2), far = pawn('far', 'enemy', 4);
        const turn = new TurnSystem(grid, [hero, near, far], { Play() {} });
        turn.Begin(hero);
        const level = { exploring: 'battle', turn, player: hero, campaign: { inventory: {} }, controlSettings: ControlSettings('PC') };
        const controls = new TacticalControls(level);
        assert.equal(controls.SelectCommand(1), true);
        assert.deepEqual(turn.cursor, { col: 2, row: 0 });
        turn.Cancel();
        assert.equal(controls.SelectCommand(4), true);
        assert.equal(hero.stats.facing, 1);
        turn.Cancel();
        assert.equal(hero.stats.facing, 3);
        level.controlSettings = ControlSettings('Personalizado', { smartTarget: false });
        assert.equal(controls.SelectCommand(4), true);
        assert.equal(hero.stats.facing, 3);
    });

    test('state-facing actions reject invalid phases and award victory loot only once', () => {
        const campaign = new HighlandCampaign();
        campaign.CreateCharacter('vanguard');
        const state = { campaign, exploring: 'explore', turn: { result: 'VICTORY' }, encounterId: 'mistfell',
            resultHandled: false, pawns: [], player: { stats: { ...campaign.hero } } };
        const actions = new HighlandActions(state);
        assert.equal(actions.Move({ col: 0, row: 0 }), false);
        assert.equal(actions.UseSkill(null), false);
        assert.equal(actions.EndTurn(), false);
        assert.equal(actions.Loot(), null);
        assert.equal(actions.Equip('not an item'), false);
        state.exploring = 'battle';
        const gold = campaign.gold;
        assert.equal(actions.Loot().experience, 60);
        assert.equal(campaign.gold, gold + 30);
        assert.equal(actions.Loot(), null);
        assert.equal(campaign.gold, gold + 30);
        assert.equal(actions.Equip('Highland Edge'), false);
    });
    hud.ToggleRing();
    assert.equal(hud.ringOpen, false);
    hud.level.exploring = 'battle';
    hud.Update(0.016);
    assert.equal(hud.ringOpen, true);
    assert.equal(hud.CommandAvailable(2), false);
    assert.equal(hud.CommandAvailable(3), false);
    hud.ActivateRing(2);
    assert.equal(turn.chosen, undefined);
    hud.ActivateRing(0);
    assert.equal(hud.ringOpen, false);
    assert.equal(turn.chosen, 0);
    hud.Update(0.016);
    assert.equal(hud.ringProgress, 0);
    turn.phase = 'command';
    hero.stats.mp = 0;
    hud.Update(0.016);
    assert.equal(hud.ringOpen, true);
    assert.equal(hud.CommandAvailable(0), false);
    hud.level.exploring = 'explore';
    hud.Update(0.016);
    assert.equal(hud.ringOpen, false);
    assert.equal(hud.ringProgress, 0);
});

test('exploration bar routes shop to nearby NPC interaction and opens party roster', () => {
    const hud = Object.create(TacticalHUD.prototype);
    let interactions = 0;
    Object.assign(hud, { level: { exploring: 'explore', zone: { id: 'hearthvale' }, InteractShopkeeper() { interactions++; } }, panel: null });
    hud.ActivateBar({ panel: 'map' });
    assert.equal(hud.panel, 'map');
    hud.ActivateBar({ icon: 'shop' });
    assert.equal(interactions, 1);
    hud.ActivateBar({ icon: 'party', panel: 'party' });
    assert.equal(hud.panel, 'party');
    hud.level.exploring = 'battle';
    hud.ActivateBar({ icon: 'shop' });
    assert.equal(interactions, 1);
});

test('PC dock hotbar aims abilities, uses items, passes the turn and reports locked slots', () => {
    const grid = new HeightGrid([[0, 0, 0, 0]]);
    const campaign = new HighlandCampaign();
    campaign.CreateCharacter('vanguard');
    campaign.inventory.Ether = 1;
    const hero = { stats: { id: 'hero', name: 'Hero', team: 'ally', col: 0, row: 0, facing: 1,
        hp: 20, maxHp: 30, apMax: 6, mpMax: 3, ct: 100, speed: 20, exposed: 0,
        attack: 10, defense: 0, archetype: 'vanguard', basicAbility: 'cleave', unlockedSkills: ['shield-bash'] },
        travel: { Follow(path, done) { this.path = path; done?.(); } } };
    const enemy = { stats: { id: 'enemy', team: 'enemy', col: 1, row: 0, facing: 3, hp: 20, maxHp: 20 } };
    const turn = new TurnSystem(grid, [hero, enemy], { Play() {} });
    turn.Begin(hero);
    const level = { exploring: 'battle', turn, player: hero, campaign, sound: { Play() {} },
        controlSettings: ControlSettings('PC'), hud: { CloseRing() {}, ringOpen: false } };
    level.actions = new HighlandActions(level);
    const controls = new TacticalControls(level);
    level.controls = controls;
    const slots = HotbarSlots(turn, hero, campaign);
    assert.deepEqual(slots.map(slot => slot.id), ['cleave', 'shield-bash', 'sweeping-strike', 'bulwark', 'lunge', 'rallying-guard', 'ground-slam', 'Potion', 'Ether', 'Antidote']);
    assert.deepEqual(slots.map(slot => slot.locked), [false, false, true, true, true, true, true, false, false, false]);
    assert.equal(controls.ActivateSlot(1), true);
    assert.equal(turn.phase, 'target');
    assert.equal(turn.ability, 'shield-bash');
    assert.deepEqual(turn.cursor, { col: 1, row: 0 });
    assert.equal(controls.ActivateSlot(1), true);
    assert.equal(turn.phase, 'command');
    assert.equal(controls.ActivateSlot(2), false);
    assert.match(turn.message, /Learn that skill/);
    // Slot 8 (Potion) spends 2 AP right away; slot 0 (Antidote) has nothing to cure.
    assert.equal(controls.ActivateSlot(7), true);
    assert.equal(hero.stats.ap, 4);
    assert.equal(hero.stats.hp, 30);
    assert.equal(controls.ActivateSlot(9), false);
    // Moving spends MP and returns to the command phase; Pass Turn ends the turn.
    assert.equal(level.actions.Move({ col: 3, row: 0 }), false);
    assert.equal(level.actions.Move({ col: 0, row: 0 }), false);
    enemy.stats.hp = 0;
    assert.equal(level.actions.Move({ col: 2, row: 0 }), true);
    assert.equal(hero.stats.mp, 1);
    assert.equal(turn.phase, 'command');
    assert.equal(level.actions.EndTurn(), true);
    assert.equal(turn.phase, 'charge');
    assert.equal(controls.ActivateSlot(0), false);
});

test('legacy number hotkeys select commands and unlocked skills when the dock is off', () => {
    const grid = new HeightGrid([[0, 0, 0]]);
    const hero = { stats: { id: 'hero', name: 'Hero', team: 'ally', col: 0, row: 0, facing: 1,
        hp: 30, maxHp: 30, apMax: 6, mpMax: 3, ct: 100, speed: 20, exposed: 0,
        attack: 10, defense: 0, archetype: 'vanguard', basicAbility: 'cleave', unlockedSkills: ['shield-bash'] } };
    const enemy = { stats: { id: 'enemy', team: 'enemy', col: 1, row: 0, facing: 3, hp: 20, maxHp: 20 } };
    const turn = new TurnSystem(grid, [hero, enemy], { Play() {} });
    turn.Begin(hero);
    const level = { exploring: 'battle', turn, player: hero, campaign: { inventory: {} },
        controlSettings: ControlSettings('Personalizado', { dock: false }), hud: { CloseRing() {} } };
    const controls = new TacticalControls(level);
    assert.equal(controls.SelectHotkey(6), true);
    assert.equal(turn.ability, 'shield-bash');
    assert.deepEqual(turn.cursor, { col: 1, row: 0 });
    turn.Cancel();
    assert.equal(controls.SelectHotkey(9), false);
    assert.equal(turn.phase, 'command');
    assert.match(turn.message, /No unlocked skill/);
    assert.equal(controls.SelectHotkey(5), true);
    assert.equal(turn.phase, 'face');
    turn.Cancel();
    level.controlSettings = ControlSettings('Console');
    assert.equal(controls.SelectHotkey(1), false);
});

test('smart targeting explains when no target is in reach', () => {
    const grid = new HeightGrid([[0, 0, 0, 0, 0, 0]]);
    const hero = { stats: { id: 'hero', name: 'Hero', team: 'ally', col: 0, row: 0, facing: 1,
        hp: 30, maxHp: 30, energy: 2, energyMax: 2, ct: 100, speed: 20, exposed: 0,
        attack: 10, defense: 0, archetype: 'vanguard', basicAbility: 'cleave', unlockedSkills: [] } };
    const enemy = { stats: { id: 'enemy', team: 'enemy', col: 5, row: 0, facing: 3, hp: 20, maxHp: 20 } };
    const turn = new TurnSystem(grid, [hero, enemy], { Play() {} });
    turn.Begin(hero);
    const level = { exploring: 'battle', turn, player: hero, campaign: { inventory: {} },
        controlSettings: ControlSettings('PC'), hud: { CloseRing() {} } };
    const controls = new TacticalControls(level);
    assert.equal(controls.SelectHotkey(2), true);
    assert.equal(turn.phase, 'target');
    assert.match(turn.message, /No target in reach/);
});

test('changing the control mode mid-turn re-applies the radial default', async () => {
    const level = Object.create(HighlandLevel.prototype);
    Object.assign(level, { hud: { wasBattleCommand: true }, turn: {} });
    level.SetControlSettings({ mode: 'Console' });
    assert.equal(level.controlSettings.autoRadial, true);
    assert.equal(level.hud.wasBattleCommand, false);
});

test('settings navigate and customize through the same HUD controls used by gamepad', () => {
    const hud = Object.create(TacticalHUD.prototype);
    const level = { controlSettings: ControlSettings('PC'), SetControlSettings(value) { this.controlSettings = value; } };
    Object.assign(hud, { level, settingsSelection: 0, help: { Toggle() { this.visible = true; } } });
    hud.MoveSettingsSelection(-1);
    hud.ActivateSettingsSelection();
    assert.equal(hud.help.visible, true);
    hud.settingsSelection = 3;
    hud.ActivateSettingsSelection();
    assert.equal(level.controlSettings.mode, 'Tablet');
    assert.equal(level.controlSettings.largeTargets, true);
    hud.MoveSettingsSelection(1);
    hud.ActivateSettingsSelection();
    assert.equal(level.controlSettings.mode, 'Personalizado');
    hud.MoveSettingsSelection(1);
    hud.ActivateSettingsSelection();
    assert.equal(level.controlSettings.autoRadial, true);
    hud.MoveSettingsSelection(1);
    hud.ActivateSettingsSelection();
    assert.equal(level.controlSettings.smartTarget, false);
    hud.MoveSettingsSelection(1);
    hud.ActivateSettingsSelection();
    assert.equal(level.controlSettings.dock, false);
    hud.MoveSettingsSelection(1);
    hud.ActivateSettingsSelection();
    assert.equal(level.controlSettings.largeTargets, false);
    hud.MoveSettingsSelection(1);
    hud.help.visible = false;
    hud.ActivateSettingsSelection();
    assert.equal(hud.help.visible, true);
});

test('control settings persist independently and report storage failures', () => {
    const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    let saved;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
        setItem(key, value) { saved = { key, value }; },
    } });
    try {
        const level = Object.create(HighlandLevel.prototype);
        level.turn = { message: '' };
        level.SetControlSettings(ControlSettings('Mobile'));
        assert.equal(saved.key, 'highland-control-settings-v1');
        assert.deepEqual(JSON.parse(saved.value), ControlSettings('Mobile'));
        globalThis.localStorage.setItem = () => { throw new Error('storage blocked'); };
        level.SetControlSettings(ControlSettings('Console'));
        assert.equal(level.controlSettings.mode, 'Console');
        assert.match(level.turn.message, /could not be saved: storage blocked/);
    }
    finally {
        if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
        else delete globalThis.localStorage;
    }
});

test('movement cancellation snaps to the last reached tile and clears the route', () => {
    const level = Object.create(HighlandLevel.prototype);
    Object.assign(level, {
        player: {
            stats: { col: 2, row: 3 },
            travel: {
                path: [{ col: 4, row: 3 }],
                Snap() { this.path = []; },
            },
        },
        turn: { cursor: null, message: '' },
        exploreRoute: { path: [{ col: 3, row: 3 }] },
    });
    assert.equal(level.CancelExploreMove(), true);
    assert.deepEqual(level.turn.cursor, { col: 2, row: 3 });
    assert.equal(level.exploreRoute, null);
    assert.equal(level.CancelExploreMove(), false);
});

test('route preview points to the destination without text labels', () => {
    const vertices = [], labels = [];
    const hud = Object.create(TacticalHUD.prototype);
    const context = {
        save() {}, restore() {}, beginPath() {}, moveTo(x, y) { vertices.push([x, y]); },
        lineTo(x, y) { vertices.push([x, y]); }, closePath() {}, stroke() {}, fill() {},
        fillText(text) { labels.push(text); },
    };
    Object.assign(hud, {
        level: {
            exploreRoute: { origin: { col: 1, row: 2 }, path: [{ col: 2, row: 2 }], destination: { col: 2, row: 2 } },
            terrain: { World(tile) { return { x: tile.col, y: 0, z: tile.row }; } },
            grid: { Get(col, row) { return { col, row }; } },
            camera: { Project(point) { return { x: 100 + point.x * 10, y: 150 + point.z * 10, visible: true }; } },
        },
        screen: { Width: 450, Height: 728, Context: context },
    });
    hud.DrawExploreRoute();
    assert.deepEqual(vertices[0], [120, 165]);
    assert.equal(vertices.length, 7);
    assert.deepEqual(labels, []);
    vertices.length = 0;
    hud.level.camera.Project = () => ({ x: NaN, y: 0, visible: true });
    hud.DrawExploreRoute();
    assert.equal(vertices.length, 0);
    hud.level.exploreRoute = null;
    hud.DrawExploreRoute();
    assert.equal(vertices.length, 0);
});

test('character sheet equips by double-click, drag and slot click, unequips by double-click and compares on hover', () => {
    const previousInput = Input.instance, labels = [];
    const mouse = { position: { x: 0, y: 0 }, buttons: {}, buttonsDown: {}, buttonsUp: {} };
    Input.instance = { mouse };
    try {
        const campaign = new HighlandCampaign();
        campaign.CreateCharacter('ranger');
        campaign.AddLoot([{ item: 'Highland Edge' }, { item: 'Focus Ring' }, { item: 'Iron Band' }, { item: 'Ash Shard', count: 2 }]);
        const context = new Proxy({}, { get: (target, key) => target[key] ?? (() => {}), set: (target, key, value) => { target[key] = value; return true; } });
        const screen = { Width: 900, Height: 760, Context: context, Canvas: { width: 900, height: 760, getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 760 }) } };
        const hud = Object.create(TacticalHUD.prototype);
        Object.assign(hud, {
            screen, panel: 'bag', inventoryCategory: 'Gear', selectedBagIndex: 0, selectedGearSlot: 'weapon', selectedGearIndex: 0,
            frame: { theme: { gold: 'gold', text: 'white', muted: 'grey' }, Panel() {}, Meter() {}, Text(text) { labels.push(String(text)); } },
            level: {
                campaign, turn: { message: '' },
                EquipItem(name, slot = null) { return campaign.EquipOwned(name, slot ?? undefined); },
                UnequipItem(slot) { return campaign.Unequip(slot); },
                UseItem() { return false; },
            },
            Place() {},
        });
        hud.sheet = Object.assign(Object.create(CharacterSheet.prototype), {
            hud, drag: null, lastClick: null, clock: 0, primary: { label: '', button: {} }, secondary: { label: '', button: {} },
        });
        const layout = SheetLayout(10, 10, 660);
        const center = rect => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
        const doll = id => center(layout.doll.find(rect => rect.slot === id));
        const frame = (point, { down = false, held = false, up = false } = {}) => {
            Object.assign(mouse.position, point);
            mouse.buttonsDown = { 0: down };
            mouse.buttons = { 0: down || held };
            mouse.buttonsUp = { 0: up };
            hud.sheet.Update(0.1);
            hud.sheet.Draw(10, 10, 660);
        };
        const click = point => { frame(point, { down: true }); frame(point, { up: true }); };

        assert.deepEqual(hud.BagItems().map(item => item.name), ['Highland Edge', 'Focus Ring', 'Iron Band']);
        click(center(layout.grid[0]));
        assert.equal(campaign.equipment.weapon, 'Training Blade');
        click(center(layout.grid[0]));
        assert.equal(campaign.equipment.weapon, 'Highland Edge');

        // Drag the Focus Ring (now first in the backpack) onto the second ring slot.
        assert.equal(hud.BagItems()[0].name, 'Focus Ring');
        frame(center(layout.grid[0]), { down: true });
        frame(doll('ring2'), { held: true });
        frame(doll('ring2'), { up: true });
        assert.equal(campaign.equipment.ring2, 'Focus Ring');
        assert.equal(campaign.hero.apMax, 7);

        // With a backpack item selected, clicking a slot it fits equips it there.
        hud.selectedBagIndex = hud.BagItems().findIndex(item => item.name === 'Iron Band');
        frame(doll('ring1'), { down: true });
        assert.equal(campaign.equipment.ring1, 'Iron Band');

        // In equipment focus, double-clicking a worn item sends it back to the backpack.
        hud.panel = 'gear';
        frame({ x: 1, y: 1 }, { up: true });
        click(doll('ring2'));
        click(doll('ring2'));
        assert.equal(campaign.equipment.ring2, null);
        assert.equal(campaign.inventory['Focus Ring'], 1);

        // Hovering backpack gear shows its comparison against the slot it would fill.
        hud.panel = 'bag';
        labels.length = 0;
        frame(center(layout.grid[hud.BagItems().findIndex(item => item.name === 'Focus Ring')]));
        assert.ok(labels.some(label => label.startsWith('vs empty slot: AP +1')), labels.join(' | '));
        // The filter tabs are clickable too.
        click(center(layout.filters[3]));
        assert.equal(hud.inventoryCategory, 'Resources');
    }
    finally { Input.instance = previousInput; }
});

test('vendor Talk prompt is anchored above the visible NPC and hidden outside the play area', () => {
    const hud = Object.create(TacticalHUD.prototype), placed = [], labels = [];
    const context = { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {} };
    Object.assign(hud, {
        level: { camera: { Project(point) { assert.equal(point.y, 3.5); return { x: 200, y: 220, visible: true }; } } },
        screen: { Width: 450, Height: 728, Context: context },
        frame: { theme: { gold: 'gold' }, Text(text) { labels.push(text); } },
        headerHeight: 100, talk: {}, Place(...args) { placed.push(args); },
    });
    const vendor = { travel: { position: { x: 1, y: 2, z: 3 } } };
    hud.DrawVendorPrompt(vendor);
    assert.deepEqual(placed[0].slice(1), [164, 192, 72, 28]);
    assert.deepEqual(labels, ['Talk']);
    hud.level.camera.Project = () => ({ x: 200, y: 110, visible: true });
    hud.DrawVendorPrompt(vendor);
    assert.equal(placed.length, 1);
});

test('Mistfell victory unlocks Ashen Ridge and defeat recovers in Hearthvale', () => {
    const campaign = new HighlandCampaign();
    campaign.CreateCharacter('vanguard');
    const scene = createScene();
    const battleData = BattleFromScene(battlefield);
    const grid = new HeightGrid(GetZone('mistfell').heights);
    const sound = { Play() {} };
    const level = Object.create(HighlandLevel.prototype);
    Object.assign(level, {
        scene,
        context: { assets: { jsons: zoneScenes } },
        campaign,
        zone: GetZone('mistfell'),
        grid,
        battleData,
        battleGrid: new HeightGrid(battleData.heights),
        exploring: 'explore',
        turn: new TurnSystem(grid, [], sound),
        sound,
        player: { stats: { ...campaign.hero, col: 5, row: 4 } },
        pawns: [],
        hud: { panel: null },
        AddEntity(entity) { return entity; },
        RemoveEntity() {},
    });
    installSceneLoader(level);

    level.OnExploreArrival(GetZone('mistfell').portal);
    assert.equal(level.zone.id, 'mistfell');
    assert.match(level.turn.message, /Defeat the Mistfell patrol/);

    level.StartBattle('mistfell');
    assert.equal(level.exploring, 'battle');
    assert.equal(level.pawns.length, 5);
    assert.ok(level.pawns.some(pawn => pawn.stats.name === 'Ash Hound'));
    level.turn.result = 'VICTORY';
    level.FinishBattle();
    assert.equal(campaign.hero.level, 2);
    assert.equal(campaign.clearedZones.has('mistfell'), true);
    level.ReturnToExplore();
    assert.deepEqual(level.returnPosition, { zoneId: 'mistfell', col: 5, row: 4 });
    assert.deepEqual(
        { zone: level.zone.id, col: level.player.stats.col, row: level.player.stats.row },
        { zone: 'mistfell', col: 5, row: 4 },
    );

    level.OnExploreArrival(GetZone('mistfell').portal);
    assert.equal(level.zone.id, 'ashen-ridge');
    level.StartBattle('ashen-ridge');
    assert.equal(level.pawns.length, 6);
    assert.ok(level.pawns.some(pawn => pawn.stats.name === 'Ash Adept'));
    level.turn.result = 'DEFEAT';
    level.FinishBattle();
    level.ReturnToExplore();
    assert.equal(level.zone.id, 'hearthvale');
    assert.deepEqual(
        { col: level.player.stats.col, row: level.player.stats.row },
        { col: GetZone('hearthvale').spawn.col, row: GetZone('hearthvale').spawn.row },
    );
    assert.equal(campaign.hero.hp, Math.ceil(campaign.hero.maxHp * 0.4));
});
