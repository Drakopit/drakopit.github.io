import { ModelMeshFactory, BoxCollider3D } from 'gameforgejs/3d';
import { CreateToonMaterial } from '../rendering/ToonShader.js';

export class SceneryProp {
    constructor(scene, physics, definition) {
        this.scene = scene;
        this.physics = physics;
        this.model = ModelMeshFactory.FromAsset(definition.model, {
            materialFactory: (part, index) => CreateToonMaterial(
                ModelMeshFactory.CreateMaterial(part, index, definition.model)),
        });
        this.model.SetPosition(...definition.position);
        this.model.SetScale(definition.scale);
        this.model.AddTo(scene);
        this.materials = this.model.meshes.map(mesh => mesh.material);
        if (definition.collider) {
            this.body = physics.AddBody({
                object: this.model,
                collider: new BoxCollider3D({ size: definition.collider }),
            });
        }
    }

    OnDestroy() {
        if (this.body) this.physics.RemoveBody(this.body);
        for (const mesh of this.model.meshes) this.scene.Remove(mesh);
    }
}
