import { Vector3D } from 'gameforgejs/core';

const Marker = Object.freeze({
    respawnClearance: 0.08,
    activeColor: [0.2, 1, 0.65, 1],
});

export class TrailCheckpoint {
    /** @param {Mesh} mesh - The platform's checkpoint ring (a scene node, see TrailScenery). */
    constructor(mesh, platform, playerDefinition) {
        if (platform.definition.motion || platform.definition.blink) {
            throw new Error(`Checkpoint '${platform.definition.id}' requires a permanent, stationary platform.`);
        }
        this.mesh = mesh;
        this.platform = platform;
        const position = Vector3D.FromArray(platform.mesh.transform.position);
        position.y += platform.definition.size.y / 2;
        this.respawn = position.AddValue(new Vector3D(0,
            playerDefinition.collider.radius - playerDefinition.collider.offset.y + Marker.respawnClearance, 0));
        this.inactiveColor = [...mesh.material.albedoColor];
        this.Reset();
    }

    TryActivate(player) {
        if (this.active || !player.body.grounded || player.body.groundBody !== this.platform.body) return false;
        this.active = true;
        this.mesh.material.albedoColor = [...Marker.activeColor];
        return true;
    }

    Reset() {
        this.active = false;
        this.mesh.material.albedoColor = [...this.inactiveColor];
    }
}
