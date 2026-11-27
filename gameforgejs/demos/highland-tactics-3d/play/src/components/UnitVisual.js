import { Component } from 'gameforgejs/core';
import { Mesh, ModelMeshFactory, PrimitiveMesh, ToonMaterial, Transform3D } from 'gameforgejs/3d';
/** Original low-poly pawns with a cape, shield and forward-pointing weapon. */
export class UnitVisual extends Component {
    constructor(scene, color, visualStyle = null, heroWeapon = false) {
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
        if (heroWeapon) parts.pop();
        if (['weapon', 'armor', 'consumable', 'rest'].includes(visualStyle)) {
            parts.splice(-2);
            if (visualStyle === 'weapon') parts.push(
                { p: [0.27, 0.42, -0.18], s: [0.06, 0.54, 0.06], m: steel },
                { p: [0.27, 0.7, -0.18], s: [0.32, 0.16, 0.16], m: steel },
            );
            else if (visualStyle === 'armor') parts.push(
                { p: [-0.28, 0.43, -0.08], s: [0.12, 0.48, 0.34], m: steel },
                { p: [0, 0.96, 0], s: [0.34, 0.15, 0.32], m: steel },
            );
            else if (visualStyle === 'consumable') parts.push(
                { p: [0.28, 0.42, -0.14], s: [0.2, 0.25, 0.2], m: new ToonMaterial({ albedoColor: '#bd5d80' }) },
                { p: [0.28, 0.58, -0.14], s: [0.08, 0.09, 0.08], m: steel },
            );
            else parts.push(
                { p: [0.28, 0.5, -0.13], s: [0.07, 0.95, 0.07], m: steel },
                { p: [0.28, 1.03, -0.13], s: [0.18, 0.18, 0.18], m: cloth },
            );
        }
        for (const part of parts) {
            const mesh = new Mesh({ geometry: PrimitiveMesh.Cube(1), material: part.m, transform: new Transform3D({ parent: this.root, position: part.p, scale: part.s }) });
            this.meshes.push(mesh);
        }
        this.cloth = cloth;
        this.original = [...cloth.albedoColor];
        this.heroWeapon = heroWeapon;
        this.weapons = [];
    }
    OnStart() {
        for (const mesh of this.meshes) this.scene.Add(mesh);
        if (this.heroWeapon) {
            this.weapons = ['highland-sword', 'highland-staff'].map(name => {
                const model = ModelMeshFactory.FromAsset(name);
                model.transform.parent = this.root;
                model.SetPosition(0.27, 0.42, -0.23);
                model.SetScale(0.38);
                model.AddTo(this.scene);
                return model;
            });
        }
    }
    OnUpdate() {
        const stats = this.owner.stats, p = this.owner.travel.position;
        this.root.SetPosition(p.x, p.y, p.z);
        this.root.rotation.y = -stats.facing * Math.PI / 2;
        this.cloth.albedoColor = stats.flash > 0 ? [1, 0.8, 0.6, 1] : this.original;
        for (const mesh of this.meshes)
            mesh.visible = stats.hp > 0;
        const weaponIndex = stats.visualWeapon === 'Runed Staff' ? 1
            : ['Training Blade', 'Highland Edge'].includes(stats.visualWeapon) ? 0 : -1;
        this.weapons.forEach((model, index) => {
            const visible = stats.hp > 0 && index === weaponIndex;
            for (const mesh of model.meshes) mesh.visible = visible;
        });
    }
    OnDestroy() {
        for (const mesh of this.meshes) this.scene.Remove(mesh);
        for (const model of this.weapons)
            for (const mesh of model.meshes) this.scene.Remove(mesh);
    }
}
