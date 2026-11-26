import { Component } from 'gameforgejs/core';
import { Mesh, PrimitiveMesh, ToonMaterial, Transform3D } from 'gameforgejs/3d';
/** Original low-poly pawns with a cape, shield and forward-pointing weapon. */
export class UnitVisual extends Component {
    constructor(scene, color, visualStyle = null) {
        super();
        this.scene = scene;
        this.root = new Transform3D();
        this.meshes = [];
        const cloth = new ToonMaterial({ albedoColor: color }), skin = new ToonMaterial({ albedoColor: '#f4d7aa' }), steel = new ToonMaterial({ albedoColor: '#c1d4d7' });
        const parts = visualStyle === 'slime' ? [
            { p: [0, 0.28, 0], s: [0.72, 0.42, 0.62], m: cloth },
            { p: [-0.16, 0.38, 0.28], s: [0.07, 0.08, 0.04], m: steel },
            { p: [0.16, 0.38, 0.28], s: [0.07, 0.08, 0.04], m: steel },
            { p: [0, 0.72, 0], s: [0.16, 0.3, 0.16], m: steel },
            { p: [0, 0.94, 0], s: [0.42, 0.1, 0.34], m: steel },
        ] : visualStyle === 'golem' ? [
            { p: [0, 0.42, 0], s: [0.58, 0.62, 0.48], m: cloth },
            { p: [0, 0.86, 0], s: [0.48, 0.42, 0.42], m: steel },
            { p: [-0.38, 0.5, 0], s: [0.22, 0.52, 0.3], m: steel },
            { p: [0.38, 0.5, 0], s: [0.22, 0.52, 0.3], m: steel },
            { p: [-0.2, 0.08, 0], s: [0.24, 0.24, 0.24], m: cloth },
            { p: [0.2, 0.08, 0], s: [0.24, 0.24, 0.24], m: cloth },
            { p: [0, 1.15, 0], s: [0.18, 0.45, 0.18], m: cloth },
        ] : visualStyle === 'wolf' ? [
            { p: [0, 0.35, 0], s: [0.42, 0.35, 0.68], m: cloth },
            { p: [0, 0.54, -0.38], s: [0.34, 0.3, 0.32], m: cloth },
            { p: [-0.12, 0.75, -0.38], s: [0.1, 0.2, 0.1], m: steel },
            { p: [0.12, 0.75, -0.38], s: [0.1, 0.2, 0.1], m: steel },
            { p: [-0.15, 0.11, -0.22], s: [0.1, 0.22, 0.12], m: steel },
            { p: [0.15, 0.11, -0.22], s: [0.1, 0.22, 0.12], m: steel },
            { p: [-0.15, 0.11, 0.22], s: [0.1, 0.22, 0.12], m: steel },
            { p: [0.15, 0.11, 0.22], s: [0.1, 0.22, 0.12], m: steel },
            { p: [0, 0.5, 0.48], s: [0.1, 0.12, 0.36], m: steel },
        ] : visualStyle === 'wisp' ? [
            { p: [0, 0.65, 0], s: [0.45, 0.5, 0.45], m: cloth },
            { p: [0, 1, 0], s: [0.2, 0.4, 0.2], m: steel },
            { p: [-0.28, 0.42, 0], s: [0.15, 0.26, 0.15], m: steel },
            { p: [0.28, 0.42, 0], s: [0.15, 0.26, 0.15], m: steel },
        ] : [
            { p: [0, 0.37, 0], s: [0.35, 0.44, 0.27], m: cloth },
            { p: [0, 0.74, 0], s: [0.3, 0.3, 0.3], m: skin },
            { p: [0, 0.91, 0.02], s: [0.4, 0.12, 0.34], m: cloth },
            { p: [-0.12, 0.08, 0], s: [0.12, 0.18, 0.17], m: steel },
            { p: [0.12, 0.08, 0], s: [0.12, 0.18, 0.17], m: steel },
            { p: [0, 0.38, 0.17], s: [0.43, 0.5, 0.06], m: cloth },
            { p: [-0.26, 0.4, -0.06], s: [0.08, 0.3, 0.27], m: steel },
            { p: [0.25, 0.4, -0.27], s: [0.055, 0.055, 0.55], m: steel },
        ];
        for (const part of parts) {
            const mesh = new Mesh({ geometry: PrimitiveMesh.Cube(1), material: part.m, transform: new Transform3D({ parent: this.root, position: part.p, scale: part.s }) });
            this.meshes.push(mesh);
        }
        this.cloth = cloth;
        this.original = [...cloth.albedoColor];
    }
    OnStart() { for (const mesh of this.meshes)
        this.scene.Add(mesh); }
    OnUpdate() {
        const stats = this.owner.stats, p = this.owner.travel.position;
        this.root.SetPosition(p.x, p.y, p.z);
        this.root.rotation.y = -stats.facing * Math.PI / 2;
        this.cloth.albedoColor = stats.flash > 0 ? [1, 0.8, 0.6, 1] : this.original;
        for (const mesh of this.meshes)
            mesh.visible = stats.hp > 0;
    }
    OnDestroy() { for (const mesh of this.meshes)
        this.scene.Remove(mesh); }
}
