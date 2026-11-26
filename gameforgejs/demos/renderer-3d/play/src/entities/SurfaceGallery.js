import { SoundEffects } from 'gameforgejs/core';
import { GameObject } from 'gameforgejs/2d';
import { SceneManifest3D, SurfaceAnimator, RainEmitter, RainRenderer, WetSurfaceResponse } from 'gameforgejs/3d';

const basin = { width: 11, depth: 8 };

/**
 * The gallery's basin, quay, breakwater and the four surface samples are nodes of
 * scenes/gallery.gfscene.json (Gallery and Samples layers), so the editor's 3D view shows them
 * exactly as Play does. This adds what only runs in Play: rain, ripples and wet stone and wood.
 */
export class SurfaceGallery extends GameObject {
    constructor(scene, audio, document) {
        super();
        this.scene = scene;
        this.sound = this.AddComponent(new SoundEffects(audio));
        const manifest = document.ToManifest3D();
        const layers = new Set(['gallery', 'samples']);
        const ids = new Set(document.Nodes().filter(node => layers.has(node.layer)).map(node => node.id));
        const definitions = manifest.objects.filter(object => ids.has(object.id));
        this.meshes = SceneManifest3D.Populate(scene, { objects: definitions }).objects;
        const byId = new Map(definitions.map((definition, index) => [definition.id, this.meshes[index]]));
        this.water = byId.get('water').material;
        this.samples = document.Nodes({ layer: 'samples' }).map(node => byId.get(node.id));
        const wet = definitions.filter(definition => definition.wet).map(definition => byId.get(definition.id).material);

        const onWater = (x, z) => Math.abs(x) < basin.width / 2 && Math.abs(z) < basin.depth / 2;
        const heightAt = (x, z) => {
            if (!onWater(x, z)) return 0.55;
            for (const sample of this.samples) {
                const [cx, cy, cz] = sample.transform.position;
                const dx = Math.abs(x - cx), dz = Math.abs(z - cz);
                if (dx >= 0.9 || dz >= 0.9) continue;
                if (sample.name === 'Stone' && dx < 0.58 && dz < 0.58) return cy + 0.58;
                const radiusSquared = 0.75 ** 2 - dx ** 2 - dz ** 2;
                if (sample.name !== 'Stone' && radiusSquared > 0) return cy + Math.sqrt(radiusSquared);
                return 0.88;
            }
            return 0;
        };
        this.AddComponent(new SurfaceAnimator([this.water]));
        this.rain = this.AddComponent(new RainEmitter({
            count: 360, seed: 61, bounds: { width: 14, depth: 11, height: 10 },
            speed: 16,
            heightAt,
            onImpact: point => {
                if (point.y === 0 && this.rain.impacts % 19 === 0) this.water.AddRipple(point, 0.32);
            },
        }));
        this.batch = this.AddComponent(new RainRenderer(scene, this.rain));
        this.batch.mesh.reflect = false;
        this.wet = this.AddComponent(new WetSurfaceResponse(this.rain, wet, { drying: 0.12 }));
        this.SetRain(0.62);
    }

    SetRain(intensity) {
        this.intensity = intensity;
        this.rain.enabled = this.batch.mesh.visible = intensity > 0;
        this.rain.SetIntensity(intensity);
        this.wet.wetting = intensity * 0.25;
    }

    ToggleRain() {
        this.SetRain(this.rain.enabled ? 0 : 0.62);
    }

    OnDestroy() {
        for (const mesh of this.meshes) this.scene.Remove(mesh);
        super.OnDestroy();
    }
}
