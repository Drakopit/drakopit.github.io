import { GameObject } from 'gameforgejs/2d';
import { SceneDocument, Vector3D } from 'gameforgejs/core';
import { BoxCollider3D, Mesh, PrimitiveMesh, SceneManifest3D, UnlitMaterial, Transform3D } from 'gameforgejs/3d';
import { MeshActor } from './MeshActor.js';
import { OrbitMotion } from '../components/OrbitMotion.js';

/**
 * Builds the observatory from scenes/islands.gfscene.json, so the editor's 3D view and Play show
 * the same world: island parts, structures (walkways, pillars, lamps), the orbiting rings and the
 * horizon. Nodes with Data.solid / Data.islandCollider get box colliders; Data.orbitSpeed nodes spin.
 * Only the drifting light motes are generated here (scenario.json → environment.motes).
 */
export class ObservatoryWorld extends GameObject {
    constructor(level) {
        super(); this.level = level; this.meshes = []; this.solids = [];
        this.moteGeometry = PrimitiveMesh.Sphere(1, {widthSegments: 6, heightSegments: 3});
        this.moteMaterial = new UnlitMaterial({color: '#81f0df'});
    }
    OnStart() {
        const level = this.level;
        const document = new SceneDocument(level.context.assets.jsons.islands);
        const manifest = document.ToManifest3D();
        const layers = new Set(['island-parts', 'structures', 'rings', 'horizon']);
        const built = new Set(document.Nodes().filter(node => layers.has(node.layer)).map(node => node.id));
        const definitions = manifest.objects.filter(object => built.has(object.id));
        const objects = SceneManifest3D.Populate(level.scene, { transforms: manifest.transforms, objects: definitions }).objects;
        definitions.forEach((definition, index) => {
            const mesh = objects[index];
            this.meshes.push(mesh);
            if (definition.islandCollider || definition.solid) {
                // A box the size and place of the node in the world (axis-aligned: the native solver's boxes).
                const node = document.Node(definition.id);
                const matrix = document.WorldMatrix(node);
                const size = [0, 4, 8].map(i => Math.hypot(matrix[i], matrix[i + 1], matrix[i + 2]));
                const anchor = { transform: new Transform3D({ position: document.WorldPosition(node) }) };
                this.solids.push(level.physics.AddBody({ object: anchor, collider: new BoxCollider3D({ size }) }));
            }
            if (definition.orbitSpeed) {
                const actor = new MeshActor(level.scene, mesh);
                level.scene.Remove(mesh); this.meshes.pop();
                const [x, y, z] = document.WorldPosition(document.Node(definition.id));
                actor.AddComponent(new OrbitMotion(mesh, {center: new Vector3D(x, y, z), speed: definition.orbitSpeed}));
                level.AddEntity(actor);
            }
        });
        for (let index = 0; index < level.rules.environment.motes; index++) {
            const mesh = new Mesh({geometry: this.moteGeometry, material: this.moteMaterial, castShadow: false,
                transform: new Transform3D({scale: [0.06, 0.06, 0.06]})});
            const actor = new MeshActor(level.scene, mesh);
            actor.AddComponent(new OrbitMotion(mesh, {center: new Vector3D(0, 2 + index % 8, 0), radius: 8 + index % 20,
                speed: 0.04 + index % 4 * 0.015, phase: index * 2.399, bob: 0.8})); level.AddEntity(actor);
        }
        super.OnStart();
    }
    OnDestroy() {
        for (const mesh of this.meshes) this.level.scene.Remove(mesh);
        for (const solid of this.solids) this.level.physics.RemoveBody(solid);
        this.meshes.length = 0; this.solids.length = 0; super.OnDestroy();
    }
}
