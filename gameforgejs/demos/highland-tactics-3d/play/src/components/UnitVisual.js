import { AssetManager, Component, MathExt } from 'gameforgejs/core';
import { Mesh, ModelMeshFactory, PrimitiveMesh, SkeletalAnimator, ToonMaterial, Transform3D } from 'gameforgejs/3d';
import { HeldModels, UnitAnimations, UnitModelScale } from '../data/UnitModels.js';

const Loaded = name => Boolean(name && AssetManager.instance?.models?.[name]);

/**
 * A unit's look: an animated KayKit character when its model is loaded (with held weapons on
 * the rig's hand slots), otherwise original low-poly pawns with a cape, shield and weapon.
 * `options.model` names the character; `options.weapon`/`options.offhand` name fixed held models.
 */
export class UnitVisual extends Component {
    constructor(scene, color, visualStyle = null, heroWeapon = false, options = {}) {
        super();
        this.scene = scene;
        this.root = new Transform3D();
        this.meshes = [];
        this.weapons = [];
        this.heroWeapon = heroWeapon;
        this.yaw = null;
        if (Loaded(options.model) && Loaded(UnitAnimations.idle.library)) {
            this.BuildCharacter(options);
            return;
        }
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
    }
    BuildCharacter({ model, weapon = null, offhand = null }) {
        const toon = name => (part, index) => new ToonMaterial(ModelMeshFactory.CreateMaterial(part, index, name));
        this.character = ModelMeshFactory.FromAsset(model, { materialFactory: toon(model) });
        this.character.transform.parent = this.root;
        this.character.SetScale(UnitModelScale);
        // KayKit characters face +Z; a unit facing NORTH looks down -Z.
        this.character.SetRotation(0, Math.PI, 0);
        this.animator = new SkeletalAnimator(this.character);
        for (const [name, { library, clip }] of Object.entries(UnitAnimations))
            this.animator.AddClip(name, AssetManager.instance.GetModel(library), clip);
        this.animator.Play('idle');
        const nodes = this.animator.pose.nodes.map(node => node.name);
        this.sockets = ['handslot.r', 'handslot.l'].map(name => ({
            index: nodes.indexOf(name),
            transform: new Transform3D({ parent: this.character.transform }),
        }));
        this.deadTime = 0;
        // Held models: every equippable item for a hero (shown by equipment), fixed ones otherwise.
        const held = this.heroWeapon
            ? Object.entries(HeldModels).map(([item, entry]) => ({ item, ...entry }))
            : [{ item: null, model: weapon, hand: 'right' }, { item: null, model: offhand, hand: 'left' }];
        this.held = held.filter(entry => Loaded(entry.model)).map(({ item, model: name, hand }) => {
            const model = ModelMeshFactory.FromAsset(name, { materialFactory: toon(name) });
            model.transform.parent = this.sockets[hand === 'left' ? 1 : 0].transform;
            return { item, model };
        });
    }
    OnStart() {
        if (this.character) {
            this.character.AddTo(this.scene);
            for (const { model } of this.held) model.AddTo(this.scene);
            return;
        }
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
    OnUpdate(dt) {
        const stats = this.owner.stats, p = this.owner.travel.position;
        this.root.SetPosition(p.x, p.y, p.z);
        // Units turn smoothly toward their facing (snapping on the first frame).
        const yaw = -stats.facing * Math.PI / 2;
        this.yaw = this.yaw === null || dt === undefined ? yaw : MathExt.LerpAngle(this.yaw, yaw, Math.min(1, dt * 12));
        this.root.rotation.y = this.yaw;
        if (this.character) {
            this.Animate(stats, dt ?? 0);
            return;
        }
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
    /** Chooses the clip for the unit's state, then moves held models with the hand slots. */
    Animate(stats, dt) {
        const animator = this.animator;
        const timed = (clip, progress) => {
            animator.Play(clip, { loop: false });
            animator.Seek(Math.max(0, Math.min(1, progress)) * animator.current.duration);
        };
        let visible = true;
        if (stats.hp <= 0) {
            this.deadTime += dt;
            timed('death', this.deadTime / 1.1);
            visible = this.deadTime < 1.9;
        }
        else {
            this.deadTime = 0;
            if (stats.action && stats.actionTime > 0) timed(stats.action, 1 - stats.actionTime / 0.9);
            else if (stats.flash > 0) timed('hit', 1 - stats.flash / 0.3);
            else {
                animator.Play(this.owner.travel.path?.length ? 'walk' : stats.guarded ? 'guard' : 'idle');
                animator.Update(dt);
            }
        }
        for (const socket of this.sockets)
            if (socket.index >= 0) socket.transform.matrix = animator.pose.world[socket.index];
        for (const mesh of this.character.meshes) mesh.visible = visible;
        for (const { item, model } of this.held) {
            const shown = visible && (!item || stats.visualWeapon === item || stats.visualOffhand === item);
            for (const mesh of model.meshes) mesh.visible = shown;
        }
    }
    OnDestroy() {
        if (this.character) {
            for (const mesh of this.character.meshes) this.scene.Remove(mesh);
            for (const { model } of this.held)
                for (const mesh of model.meshes) this.scene.Remove(mesh);
            return;
        }
        for (const mesh of this.meshes) this.scene.Remove(mesh);
        for (const model of this.weapons)
            for (const mesh of model.meshes) this.scene.Remove(mesh);
    }
}
