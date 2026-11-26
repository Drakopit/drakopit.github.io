import { SceneManifest3D, Transform3D } from 'gameforgejs/3d';

/**
 * The course's scenery nodes (Scenery, Checkpoints and Clouds layers of the scene file): rock
 * undersides, rails and checkpoint rings are children of their platform, so they ride on moving
 * platforms and hide with blinking ones; clouds stay where the scene puts them.
 */
export class TrailScenery {
    constructor(scene, platforms, items) {
        this.scene = scene;
        this.meshes = [];
        this.attachments = [];
        this.byId = new Map();
        for (const item of items) {
            const mesh = SceneManifest3D.CreateObject(item.visual);
            const platform = platforms.platformById.get(item.parent) ?? null;
            mesh.transform = new Transform3D({ ...item.transform, parent: platform?.mesh.transform ?? null });
            if (platform) this.attachments.push({ platform, mesh });
            this.byId.set(item.id, mesh);
            this.scene.Add(mesh);
            this.meshes.push(mesh);
        }
        this.Update();
    }

    /** The checkpoint ring scene node of a platform, or null. */
    Marker(platformId) {
        return this.byId.get(`${platformId}_checkpoint`) ?? null;
    }

    Update() {
        for (const { platform, mesh } of this.attachments) mesh.visible = platform.active;
    }

    OnDestroy() {
        for (const mesh of this.meshes) this.scene.Remove(mesh);
    }
}
