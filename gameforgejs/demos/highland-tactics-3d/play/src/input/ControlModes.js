export const ControlModes = Object.freeze(['PC', 'Console', 'Mobile', 'Tablet', 'Personalizado']);

/**
 * Per-mode defaults. `dock` shows the PC combat dock (hotbar, Pass Turn, turn order) instead of
 * the radial-first battle bar; `autoRadial` opens the tactical ring on every command turn;
 * `largeTargets` enlarges touch targets. Personalizado takes each toggle from `custom`.
 */
export function ControlSettings(mode = 'PC', custom = {}) {
    if (!ControlModes.includes(mode)) throw new RangeError(`Unknown control mode: ${mode}`);
    if (mode === 'Personalizado') return {
        mode,
        autoRadial: Boolean(custom.autoRadial),
        smartTarget: custom.smartTarget !== false,
        dock: custom.dock !== false,
        largeTargets: Boolean(custom.largeTargets),
    };
    return {
        mode,
        autoRadial: mode === 'Console' || mode === 'Mobile',
        smartTarget: true,
        dock: mode === 'PC' || mode === 'Tablet',
        largeTargets: mode === 'Mobile' || mode === 'Tablet',
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
