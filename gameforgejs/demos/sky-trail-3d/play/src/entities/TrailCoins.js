import { Vector3D } from 'gameforgejs/core';
import { SceneManifest3D } from 'gameforgejs/3d';

export class TrailCoins {
    constructor(scene, platforms, config) {
        this.scene = scene;
        this.platforms = platforms;
        this.config = config;
        this.CreateCoins();
    }

    CreateCoins() {
        const coinConfig = this.config;

        this.coins = coinConfig.items.map((definition, index) => {
            // The coin prefab: shader/coin.gfshader, gold flakes under a clear coat.
            const mesh = SceneManifest3D.CreateObject({ ...definition.visual, name: `Coin_${index}` });
            mesh.transform.SetPosition(...this.platforms.GetAttachmentPosition(definition).ToArray());
            this.scene.Add(mesh);
            return {
                definition,
                mesh,
                active: true,
                value: definition.value,
                radius: coinConfig.radius,
            };
        });
    }

    Update(dt, time) {
        const config = this.config;
        this.coins.forEach((coin, index) => {
            if (!coin.active) return;

            const platform = this.platforms.platformById.get(coin.definition.platformId);
            const position = this.platforms.GetAttachmentPosition(coin.definition);
            coin.mesh.visible = platform?.active !== false;
            position.y += Math.sin(time * config.bobSpeed + index) * config.bobDistance;
            coin.mesh.transform.SetPosition(position.x, position.y, position.z);
            coin.mesh.transform.rotation.y += dt * config.spinSpeed;
        });
    }

    Collect(playerCenter) {
        const collected = [];
        for (const coin of this.coins) {
            if (!coin.active || !coin.mesh.visible) continue;
            if (Vector3D.FromArray(coin.mesh.transform.position).DistanceTo(playerCenter) > this.config.pickupDistance) continue;
            coin.active = false;
            coin.mesh.visible = false;
            collected.push(coin);
        }
        return collected;
    }

    Reset() {
        for (const coin of this.coins) coin.active = true;
        this.Update(0, 0);
    }

    OnDestroy() {
        for (const coin of this.coins) this.scene.Remove(coin.mesh);
    }
}
