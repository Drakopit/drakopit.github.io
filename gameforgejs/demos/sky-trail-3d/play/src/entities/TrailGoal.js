import { Vector3D } from 'gameforgejs/core';
import { SceneManifest3D } from 'gameforgejs/3d';

const BeaconPulse = Object.freeze({ speed: 4, amplitude: 0.09 });
const Unlocked = Object.freeze({
    ring: [0.2, 1, 0.44, 1],
    flag: [0.18, 0.95, 0.42, 1],
    beacon: [0.28, 1, 0.45, 1],
    beaconGlow: [0.08, 0.38, 0.13],
});

/** The goal's pole, flag, ring and beacon, drawn from the scene's nodes (their locked look). */
export class TrailGoal {
    constructor(scene, definition) {
        this.scene = scene;
        this.definition = definition;
        this.meshes = [];
        this.CreateGoal();
    }

    Create(visual, position, scale = [1, 1, 1]) {
        const mesh = SceneManifest3D.CreateObject(visual);
        mesh.transform.SetPosition(...position).SetScale(...scale);
        this.scene.Add(mesh);
        this.meshes.push(mesh);
        return mesh;
    }

    CreateGoal() {
        const goal = this.definition;
        this.Create(goal.pole.visual, goal.pole.position.ToArray(), goal.pole.scale.ToArray());
        this.goalFlag = this.Create(goal.flag.visual, goal.flag.position.ToArray(), goal.flag.scale.ToArray());
        this.goalRing = this.Create(goal.ring.visual, goal.trigger.AddValue(goal.ring.offset).ToArray());
        this.goalBeacon = this.Create(goal.beacon.visual, goal.trigger.AddValue(goal.beacon.offset).ToArray());
        this.locked = {
            ring: [...this.goalRing.material.albedoColor],
            flag: [...this.goalFlag.material.albedoColor],
            beacon: [...this.goalBeacon.material.albedoColor],
            beaconGlow: [...this.goalBeacon.material.emissiveColor],
        };
        this.SetGoalUnlocked(false);
    }

    SetGoalUnlocked(unlocked) {
        this.goalUnlocked = unlocked;
        const colors = unlocked ? Unlocked : this.locked;
        this.goalRing.material.albedoColor = [...colors.ring];
        this.goalFlag.material.albedoColor = [...colors.flag];
        this.goalBeacon.material.albedoColor = [...colors.beacon];
        this.goalBeacon.material.emissiveColor = [...colors.beaconGlow];
    }

    Update(time) {
        const goal = this.definition;
        const pulse = 1 + Math.sin(time * BeaconPulse.speed) * BeaconPulse.amplitude;
        this.goalRing.transform.SetScale(pulse, 1, pulse);
        const position = Vector3D.FromArray(this.goalBeacon.transform.position);
        position.y = goal.trigger.y + goal.beacon.offset.y
            + Math.sin(time * goal.beacon.bobSpeed) * goal.beacon.bobDistance;
        this.goalBeacon.transform.SetPosition(position.x, position.y, position.z);
    }

    OnDestroy() {
        for (const mesh of this.meshes) this.scene.Remove(mesh);
    }
}
