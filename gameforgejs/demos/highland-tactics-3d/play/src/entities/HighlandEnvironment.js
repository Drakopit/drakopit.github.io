import { GameObject } from 'gameforgejs/2d';
import { SurfaceAnimator, RainEmitter, RainRenderer, WetSurfaceResponse } from 'gameforgejs/3d';
import { MapScale } from '../data/BattleRules.js';
export class HighlandEnvironment extends GameObject {
    constructor(scene, grid, surfaces = [], water = null) {
        super();
        this.water = water;
        this.AddComponent(new SurfaceAnimator(surfaces));
        this.rain = this.AddComponent(new RainEmitter({ count: 96, bounds: { width: grid.cols * MapScale.tile, depth: grid.rows * MapScale.tile, height: 9 }, heightAt: (x, z) => {
                const tile = grid.Get(Math.round(x / MapScale.tile + (grid.cols - 1) / 2), Math.round(z / MapScale.tile + (grid.rows - 1) / 2));
                return tile ? MapScale.base + tile.h * MapScale.elevation : 0.13;
            }, onImpact: p => { if (p.y < 0.2)
                this.water?.AddRipple(p, 0.3); } }));
        this.AddComponent(new WetSurfaceResponse(this.rain, surfaces));
        this.batch = this.AddComponent(new RainRenderer(scene, this.rain));
        this.ToggleRain();
    }
    ToggleRain() { this.rain.enabled = !this.rain.enabled; this.batch.mesh.visible = this.rain.enabled; }
}
