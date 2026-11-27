export const ControlModes = Object.freeze(['PC', 'Console', 'Mobile', 'Personalizado']);

export function ControlSettings(mode = 'PC', custom = {}) {
    if (!ControlModes.includes(mode)) throw new RangeError(`Unknown control mode: ${mode}`);
    return {
        mode,
        autoRadial: mode === 'Personalizado' ? Boolean(custom.autoRadial) : mode !== 'PC',
        smartTarget: mode === 'Personalizado' ? custom.smartTarget !== false : true,
    };
}

export function DefaultTarget(turn) {
    if (!turn.active || turn.phase !== 'target') return null;
    const actor = turn.active.stats;
    return turn.Alive()
        .filter(pawn => turn.CanTarget(pawn))
        .sort((a, b) => {
            const distance = pawn => Math.abs(pawn.stats.col - actor.col) + Math.abs(pawn.stats.row - actor.row);
            return distance(a) - distance(b) || String(a.stats.id).localeCompare(String(b.stats.id));
        })[0] ?? null;
}
