import { GameObject } from 'gameforgejs/2d';
import { Vector3D } from 'gameforgejs/core';
import { Geometry3D, Mesh, PrimitiveMesh, SceneManifest3D, SurfaceMaterial, UnlitMaterial } from 'gameforgejs/3d';
import { BattleRules, Facings, GetAbilityProfile, MapScale } from '../data/BattleRules.js';
const highlight = PrimitiveMesh.Plane(MapScale.tile * 0.92, MapScale.tile * 0.92);
const facingArrow = new Geometry3D({
    positions: [-0.2, 0, 0.11, 0.2, 0, 0.11, 0, 0, -0.25],
    normals: [0, 1, 0, 0, 1, 0, 0, 1, 0],
    uvs: [0, 0, 1, 0, 0.5, 1], indices: [0, 1, 2],
});

/** Actual 3D terraces and world-space range overlays, not a painted isometric grid. */
export class TerrainView extends GameObject {
    constructor(scene, grid, document, options = {}) {
        super();
        this.scene = scene;
        this.grid = grid;
        this.meshes = [];
        this.tiles = [];
        this.facingArrows = [];
        const stone = new SurfaceMaterial({ preset: 'stone', albedoColor: options.palette ?? '#88775d', scale: 2 });
        this.stone = stone;
        if (document) {
            const manifest = document.ToManifest3D();
            const detailIds = new Set(document.Nodes({ layer: 'terrain-detail' }).map(node => node.id));
            this.meshes.push(...SceneManifest3D.Populate(scene, {
                transforms: manifest.transforms,
                objects: manifest.objects.filter(object => detailIds.has(object.id)),
            }).objects);
        }
        for (let row = 0; row < grid.rows; row++)
            for (let col = 0; col < grid.cols; col++) {
                const tile = grid.Get(col, row);
                if (!tile)
                    continue;
                const p = this.World(tile), height = p.y;
                const ground = new Mesh({ name: `Highland tile ${col},${row}`, geometry: PrimitiveMesh.Cube(1), material: stone, castShadow: true });
                ground.transform.SetPosition(p.x, height / 2, p.z);
                ground.transform.SetScale(MapScale.tile * 0.96, height, MapScale.tile * 0.96);
                scene.Add(ground);
                this.meshes.push(ground);
                const overlay = new Mesh({ geometry: highlight, material: new UnlitMaterial({ color: [0.1, 0.7, 1, 0.4], transparent: true }), castShadow: false });
                overlay.transform.SetPosition(p.x, p.y + 0.01, p.z);
                scene.Add(overlay);
                this.meshes.push(overlay);
                this.tiles.push({ tile, overlay });
            }
        for (const marker of options.markers ?? []) {
            const tile = grid.Get(marker.col, marker.row);
            if (!tile) continue;
            const p = this.World(tile);
            const beacon = new Mesh({
                name: marker.label,
                geometry: PrimitiveMesh.Cube(1),
                material: new UnlitMaterial({ color: marker.color ?? [1, 0.77, 0.25, 1] }),
                castShadow: false,
            });
            beacon.transform.SetPosition(p.x, p.y + 0.48, p.z);
            beacon.transform.SetScale(0.16, 0.88, 0.16);
            scene.Add(beacon);
            this.meshes.push(beacon);
        }
        if (options.structures?.length) {
            const wall = new SurfaceMaterial({ preset: 'stone', albedoColor: '#c4b397', scale: 2 });
            const door = new SurfaceMaterial({ preset: 'stone', albedoColor: '#4d3e35', scale: 2 });
            for (const structure of options.structures) {
                const tile = grid.Get(structure.col, structure.row);
                if (!tile) continue;
                const p = this.World(tile);
                const color = structure.kind === 'pine' ? '#4c7957'
                    : structure.kind === 'crystal' ? '#b884ce' : structure.roof ?? '#858d8a';
                const accent = new SurfaceMaterial({ preset: 'stone', albedoColor: color, scale: 2 });
                const parts = structure.kind === 'pine' ? [
                    { material: door, y: 0.48, z: 0, scale: [0.2, 0.96, 0.2] },
                    { material: accent, y: 1.12, z: 0, scale: [0.75, 0.95, 0.75] },
                    { material: accent, y: 1.68, z: 0, scale: [0.45, 0.55, 0.45] },
                ] : structure.kind === 'stone' || structure.kind === 'crystal' ? [
                    { material: wall, y: 0.13, z: 0, scale: [0.85, 0.26, 0.85] },
                    { material: accent, y: 0.85, z: 0, scale: [0.46, 1.5, 0.46] },
                ] : [
                    { material: wall, y: 0.58, z: 0, scale: [0.92, 1.16, 0.92] },
                    { material: accent, y: 1.25, z: 0, scale: [1.05, 0.2, 1.05] },
                    { material: door, y: 0.3, z: 0.47, scale: [0.27, 0.6, 0.04] },
                ];
                for (const part of parts) {
                    const mesh = new Mesh({ name: structure.name, geometry: PrimitiveMesh.Cube(1), material: part.material, castShadow: true });
                    mesh.transform.SetPosition(p.x, p.y + part.y, p.z + part.z);
                    mesh.transform.SetScale(...part.scale);
                    scene.Add(mesh);
                    this.meshes.push(mesh);
                }
            }
        }
    }
    World(tile) { return new Vector3D((tile.col - (this.grid.cols - 1) / 2) * MapScale.tile, MapScale.base + tile.h * MapScale.elevation, (tile.row - (this.grid.rows - 1) / 2) * MapScale.tile); }
    Highlights(turn, exploreRoute = null) {
        const active = turn.active?.stats;
        const routeKeys = new Set(exploreRoute?.path.map(point => this.grid.Key(point)) ?? []);
        const originKey = exploreRoute ? this.grid.Key(exploreRoute.origin) : null;
        const destinationKey = exploreRoute ? this.grid.Key(exploreRoute.destination) : null;
        for (const entry of this.tiles) {
            const { tile, overlay } = entry;
            overlay.visible = false;
            if (turn.phase === 'move' && turn.area.get(this.grid.Key(tile))?.path.length) {
                overlay.visible = true;
                overlay.material.albedoColor = [0.1, 0.65, 1, 0.45];
            }
            const healing = turn.phase === 'target' && GetAbilityProfile(active, turn.ability).heal;
            const target = healing && turn.Alive().find(p => p.stats.col === tile.col && p.stats.row === tile.row)?.stats;
            if (turn.phase === 'target' && BattleRules.CanAttack(this.grid, active, healing ? target ?? { ...tile, hp: 0 } : { ...tile, hp: 1, team: 'target' }, turn.ability)) {
                overlay.visible = true;
                overlay.material.albedoColor = healing ? [0.2, 0.9, 0.65, 0.65] : [1, 0.35, 0.12, 0.4];
                if (turn.Alive().some(p => p.stats.team !== active.team && p.stats.col === tile.col && p.stats.row === tile.row))
                    overlay.material.albedoColor = [1, 0.75, 0.2, 0.65];
            }
            if (turn.cursor?.col === tile.col && turn.cursor?.row === tile.row) {
                overlay.visible = true;
                overlay.material.albedoColor = turn.phase === 'explore' ? [0.42, 1, 0.61, 0.65] : [1, 0.91, 0.45, 0.65];
            }
            if (turn.phase === 'explore' && exploreRoute) {
                const key = this.grid.Key(tile);
                if (routeKeys.has(key) || key === originKey) {
                    overlay.visible = true;
                    overlay.material.albedoColor = key === originKey
                        ? [0.24, 0.85, 0.82, 0.7]
                        : key === destinationKey ? [1, 0.72, 0.22, 0.75] : [0.95, 0.72, 0.24, 0.42];
                }
            }
        }
        this.ShowFacing(turn);
    }
    FacingPositions(turn) {
        const tile = turn.active && this.grid.Get(turn.active.stats.col, turn.active.stats.row);
        if (!tile) return [];
        const center = this.World(tile);
        return Facings.map(direction => new Vector3D(
            center.x + direction.col * 0.55, center.y + 0.08, center.z + direction.row * 0.55,
        ));
    }
    ShowFacing(turn) {
        const visible = turn.phase === 'face' && turn.active?.stats.team === 'ally';
        if (visible && !this.facingArrows.length) {
            for (let index = 0; index < Facings.length; index++) {
                const mesh = new Mesh({
                    geometry: facingArrow,
                    material: new UnlitMaterial({ color: [0.65, 0.81, 0.84, 1] }),
                    castShadow: false,
                });
                mesh.transform.rotation.y = -index * Math.PI / 2;
                this.scene.Add(mesh);
                this.meshes.push(mesh);
                this.facingArrows.push(mesh);
            }
        }
        const positions = visible ? this.FacingPositions(turn) : [];
        this.facingArrows.forEach((mesh, index) => {
            mesh.visible = Boolean(visible && positions[index]);
            if (!mesh.visible) return;
            const point = positions[index];
            mesh.transform.SetPosition(point.x, point.y, point.z);
            mesh.material.albedoColor = turn.active.stats.facing === index
                ? [1, 0.78, 0.25, 1] : [0.65, 0.81, 0.84, 1];
        });
    }
    FacingAtPoint(point, turn, camera, screen) {
        if (turn.phase !== 'face') return -1;
        const candidates = this.FacingPositions(turn).map((position, index) => {
            const projected = camera.Project(position, screen.Width, screen.Height);
            return { index, distance: projected.visible ? Math.hypot(projected.x - point.x, projected.y - point.y) : Infinity };
        }).filter(candidate => candidate.distance <= 14).sort((a, b) => a.distance - b.distance);
        return candidates[0]?.index ?? -1;
    }
    Pick(point, camera, screen) {
        const candidates = [];
        for (const { tile } of this.tiles) {
            const world = this.World(tile), half = (MapScale.tile - 0.045) / 2;
            const corners = [[-half, -half], [half, -half], [half, half], [-half, half]].map(([x, z]) => camera.Project(new Vector3D(world.x + x, world.y, world.z + z), screen.Width, screen.Height));
            let sign = 0, inside = true;
            for (let i = 0; i < 4; i++) {
                const a = corners[i], b = corners[(i + 1) % 4], cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
                if (cross !== 0) {
                    if (sign && Math.sign(cross) !== sign)
                        inside = false;
                    sign = Math.sign(cross);
                }
            }
            if (inside) {
                // Orthographic depth varies across the tile, including where tiles overlap.
                const [a, b, , d] = corners;
                const bx = b.x - a.x, by = b.y - a.y;
                const dx = d.x - a.x, dy = d.y - a.y;
                const determinant = bx * dy - by * dx;
                if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-6) continue;
                const x = point.x - a.x, y = point.y - a.y;
                const u = (x * dy - y * dx) / determinant;
                const v = (bx * y - by * x) / determinant;
                const depth = a.depth + u * (b.depth - a.depth) + v * (d.depth - a.depth);
                if (Math.abs(depth) <= 1) candidates.push({ tile, depth });
            }
        }
        return candidates.sort((a, b) => a.depth - b.depth)[0]?.tile ?? null;
    }
    OnDestroy() { for (const mesh of this.meshes)
        this.scene.Remove(mesh); super.OnDestroy(); }
}
