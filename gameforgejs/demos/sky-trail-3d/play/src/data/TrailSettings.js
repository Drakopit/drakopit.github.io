// Seconds and response rates used by movement; course manifests may override them.
export const MovementDefaults = Object.freeze({
    jumpBufferSeconds: 0.12,
    coyoteSeconds: 0.1,
    braking: 28,
    stopThreshold: 0.01,
    facingThreshold: 0.06,
});

export const MenuSettings = Object.freeze({
    width: 960,
    height: 540,
    directionThreshold: 0.45,
    initialRepeatSeconds: 0.35,
    repeatSeconds: 0.14,
    targetX: -5,
    orbitX: 8,
    orbitHeight: 14,
    orbitDistance: 22,
    orbitSpeed: 0.12,
    orbitAmplitude: 1.5,
});

export const RunRules = Object.freeze({ fallPenalty: 5, finishBonus: 100 });

