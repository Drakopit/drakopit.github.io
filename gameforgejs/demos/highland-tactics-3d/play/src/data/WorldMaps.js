const ZONES = Object.freeze({
    hearthvale: {
        id: 'hearthvale',
        name: 'Hearthvale',
        subtitle: 'A quiet hamlet beneath the watchtower',
        cols: 21,
        rows: 17,
        encounters: [],
        portalTo: 'mistfell',
    },
    mistfell: {
        id: 'mistfell',
        name: 'Mistfell Pass',
        subtitle: 'A fogbound trail watched by Ash scouts',
        cols: 21,
        rows: 17,
        encounters: [{ id: 'mistfell', level: 3 }, { id: 'mistfell-hounds', level: 2 }],
        otherEncounters: [{ id: 'mistfell-hounds' }],
        portalTo: 'ashen-ridge',
        returnTo: 'hearthvale',
    },
    'ashen-ridge': {
        id: 'ashen-ridge',
        name: 'Ashen Ridge',
        subtitle: 'The patrol stronghold — break their hold',
        cols: 21,
        rows: 17,
        encounters: [{ id: 'ashen-ridge', level: 5 }, { id: 'ridge-adepts', level: 4 }],
        otherEncounters: [{ id: 'ridge-adepts' }],
        returnTo: 'mistfell',
    },
});

export function GetZone(id, scene) {
    const catalog = ZONES[id];
    if (!catalog) throw new RangeError(`Unknown Highland zone: ${id}`);
    if (!scene || scene.dimension !== '3d' || scene.settings?.zone?.id !== id)
        throw new TypeError(`The authored ${id} scene is required to load its map data.`);

    const { grid, zone } = scene.settings;
    const cols = grid?.cols, rows = grid?.rows;
    if (!Number.isSafeInteger(cols) || !Number.isSafeInteger(rows) || cols !== catalog.cols || rows !== catalog.rows)
        throw new RangeError(`The authored ${id} scene has invalid grid dimensions.`);
    const heights = Array.from({ length: rows }, () => Array(cols).fill(null));
    const structures = [];
    const vendors = [];
    const encounters = [];
    let portal = null, returnPortal = null;

    for (const node of scene.nodes ?? []) {
        const data = node.components?.Data;
        if (node.layer === 'tiles') {
            const { col, row, height } = data ?? {};
            if (!Number.isSafeInteger(col) || !Number.isSafeInteger(row) || !Number.isSafeInteger(height)
                || col < 0 || col >= cols || row < 0 || row >= rows || heights[row][col] !== null)
                throw new RangeError(`The authored ${id} scene has invalid terrain data on "${node.id}".`);
            heights[row][col] = height;
        }
        if (data?.structure) structures.push(data.structure);
        if (data?.vendor) vendors.push(data.vendor);
        if (data?.encounter) encounters.push(data.encounter);
        if (data?.portal) {
            if (node.id.startsWith('return_portal_')) returnPortal = data.portal;
            else portal = data.portal;
        }
    }

    if (heights.some(row => row.some(height => height === null)))
        throw new RangeError(`The authored ${id} scene does not define every terrain tile.`);
    return {
        ...catalog,
        ...zone,
        cols,
        rows,
        heights,
        structures,
        vendors,
        shop: vendors[0] ?? null,
        encounters,
        portal,
        returnPortal,
    };
}

export function WorldZones() {
    return Object.values(ZONES).map(zone => ({
        ...zone,
        encounters: zone.encounters.map(encounter => ({ ...encounter })),
        otherEncounters: (zone.otherEncounters ?? []).map(encounter => ({ ...encounter })),
    }));
}

export function WorldMapDisplay(currentZoneId, clearedZones = new Set()) {
    const zones = WorldZones();
    const routes = [];
    for (const zone of zones) {
        if (zone.portalTo)
            routes.push({ from: zone.id, to: zone.portalTo, open: zone.portalTo !== 'ashen-ridge' || clearedZones.has('mistfell') });
    }
    return {
        zones: zones.map((zone, index) => ({
            id: zone.id,
            name: zone.name,
            current: zone.id === currentZoneId,
            cleared: clearedZones.has(zone.id),
            position: { x: 0.16 + index * 0.34, y: 0.48 },
        })),
        routes,
    };
}
