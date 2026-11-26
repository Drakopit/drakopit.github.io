const Directions = Object.freeze([
    { col: 0, row: -1 },
    { col: 1, row: 0 },
    { col: 0, row: 1 },
    { col: -1, row: 0 },
]);

export function FindExplorePath(grid, start, destination, occupied = new Set()) {
    const origin = grid.Get(start.col, start.row);
    const target = destination && grid.Get(destination.col, destination.row);
    if (!origin || !target || occupied.has(grid.Key(target))) return null;

    const startKey = grid.Key(origin), targetKey = grid.Key(target);
    if (startKey === targetKey) return [];

    const open = new Set([startKey]);
    const tiles = new Map([[startKey, origin]]);
    const previous = new Map();
    const cost = new Map([[startKey, 0]]);
    const estimate = tile => Math.abs(tile.col - target.col) + Math.abs(tile.row - target.row);

    while (open.size) {
        let currentKey = null, currentEstimate = Infinity;
        for (const key of open) {
            const score = cost.get(key) + estimate(tiles.get(key));
            if (score < currentEstimate) {
                currentEstimate = score;
                currentKey = key;
            }
        }
        if (currentKey === targetKey) {
            const path = [];
            for (let key = targetKey; key !== startKey; key = previous.get(key))
                path.push(tiles.get(key));
            return path.reverse();
        }

        open.delete(currentKey);
        const current = tiles.get(currentKey);
        for (const direction of Directions) {
            const adjacent = grid.Get(current.col + direction.col, current.row + direction.row);
            const length = adjacent ? 1 : 2;
            const next = adjacent ?? grid.Get(current.col + direction.col * 2, current.row + direction.row * 2);
            if (!next || occupied.has(grid.Key(next))) continue;

            const heightDelta = next.h - current.h;
            if (heightDelta > (length === 1 ? 1 : 2) || heightDelta < -2) continue;

            const nextKey = grid.Key(next), nextCost = cost.get(currentKey) + length;
            if (nextCost >= (cost.get(nextKey) ?? Infinity)) continue;
            previous.set(nextKey, currentKey);
            tiles.set(nextKey, next);
            cost.set(nextKey, nextCost);
            open.add(nextKey);
        }
    }
    return null;
}
