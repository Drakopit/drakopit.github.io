/**
 * World graph. Each zone's terrain, landmarks, vendors, portals and patrols are authored in its
 * scene (scenes/<id>.gfscene.json); this catalog names the zones, the roads between them
 * (`exits`, first one is `portalTo`), the patrols a save may have cleared, road locks and
 * where each region sits on the world map.
 */
const ZONES = Object.freeze({
    hearthvale: {
        id: 'hearthvale',
        name: 'Hearthvale',
        subtitle: 'A market town beneath the watchtower',
        cols: 31,
        rows: 23,
        encounters: [],
        exits: ['mistfell', 'sunlit-meadow'],
        map: { x: 0.12, y: 0.64 },
    },
    mistfell: {
        id: 'mistfell',
        name: 'Mistfell Pass',
        subtitle: 'A fogbound trail watched by Ash scouts',
        cols: 21,
        rows: 17,
        encounters: [{ id: 'mistfell', level: 3 }, { id: 'mistfell-hounds', level: 2 }],
        otherEncounters: [{ id: 'mistfell-hounds' }],
        exits: ['ashen-ridge'],
        returnTo: 'hearthvale',
        map: { x: 0.36, y: 0.39 },
    },
    'ashen-ridge': {
        id: 'ashen-ridge',
        name: 'Ashen Ridge',
        subtitle: 'The patrol stronghold — break their hold',
        cols: 21,
        rows: 17,
        encounters: [{ id: 'ashen-ridge', level: 5 }, { id: 'ridge-adepts', level: 4 }],
        otherEncounters: [{ id: 'ridge-adepts' }],
        exits: ['highland-citadel'],
        returnTo: 'mistfell',
        unlock: { cleared: 'mistfell', message: 'Defeat the Mistfell patrol to open the ridge road.' },
        map: { x: 0.6, y: 0.55 },
    },
    'highland-citadel': {
        id: 'highland-citadel',
        name: 'Highland Citadel',
        subtitle: "The Ash warlord's arena atop the highland crown",
        cols: 25,
        rows: 19,
        encounters: [{ id: 'highland-citadel', level: 10 }, { id: 'citadel-wardens', level: 9 }, { id: 'citadel-adepts', level: 9 }],
        otherEncounters: [{ id: 'citadel-wardens' }, { id: 'citadel-adepts' }],
        exits: [],
        returnTo: 'ashen-ridge',
        unlock: { cleared: 'ashen-ridge', message: 'Break the Ashen Vanguard to open the citadel road.' },
        map: { x: 0.86, y: 0.3 },
    },
    'sunlit-meadow': {
        id: 'sunlit-meadow',
        name: 'Sunlit Meadow',
        subtitle: 'Golden outskirts where raiders prowl the fields',
        cols: 25,
        rows: 19,
        encounters: [{ id: 'sunlit-meadow', level: 4 }, { id: 'meadow-hounds', level: 3 }],
        otherEncounters: [{ id: 'meadow-hounds' }],
        exits: ['whispering-woods'],
        returnTo: 'hearthvale',
        map: { x: 0.32, y: 0.8 },
    },
    'whispering-woods': {
        id: 'whispering-woods',
        name: 'Whispering Woods',
        subtitle: 'An old forest where lights drift between the trunks',
        cols: 25,
        rows: 19,
        encounters: [{ id: 'whispering-woods', level: 6 }, { id: 'woods-wisps', level: 5 }],
        otherEncounters: [{ id: 'woods-wisps' }],
        exits: ['sunken-ruins'],
        returnTo: 'sunlit-meadow',
        map: { x: 0.56, y: 0.84 },
    },
    'sunken-ruins': {
        id: 'sunken-ruins',
        name: 'Sunken Ruins',
        subtitle: 'Flooded catacombs beneath a forgotten keep',
        cols: 25,
        rows: 19,
        encounters: [{ id: 'sunken-ruins', level: 8 }, { id: 'ruins-crypt', level: 7 }],
        otherEncounters: [{ id: 'ruins-crypt' }],
        exits: [],
        returnTo: 'whispering-woods',
        unlock: { cleared: 'whispering-woods', message: 'Drive off the Thornwood Stalkers to find the ruins stair.' },
        map: { x: 0.82, y: 0.7 },
    },
});

/**
 * Why the road into `zoneId` is still closed, or null when it is open.
 * @param {string} zoneId - Destination zone.
 * @param {Set<string>} [clearedZones] - Cleared encounter ids from the campaign.
 * @returns {string|null}
 */
export function RouteLock(zoneId, clearedZones = new Set()) {
    const unlock = ZONES[zoneId]?.unlock;
    return unlock && !clearedZones.has(unlock.cleared) ? unlock.message : null;
}

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
    const portals = [];

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
            if (!ZONES[data.portal.to])
                throw new RangeError(`The authored ${id} scene has a portal to an unknown zone on "${node.id}".`);
            portals.push({ ...data.portal, back: node.id.startsWith('return_portal_') });
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
        portals,
        portal: portals.find(point => !point.back) ?? null,
        returnPortal: portals.find(point => point.back) ?? null,
    };
}

export function WorldZones() {
    return Object.values(ZONES).map(zone => ({
        ...zone,
        portalTo: zone.exits[0] ?? null,
        exits: [...zone.exits],
        map: { ...zone.map },
        unlock: zone.unlock ? { ...zone.unlock } : null,
        encounters: zone.encounters.map(encounter => ({ ...encounter })),
        otherEncounters: (zone.otherEncounters ?? []).map(encounter => ({ ...encounter })),
    }));
}

export function WorldMapDisplay(currentZoneId, clearedZones = new Set()) {
    const zones = WorldZones();
    const routes = [];
    for (const zone of zones)
        for (const to of zone.exits)
            routes.push({ from: zone.id, to, open: !RouteLock(to, clearedZones) });
    return {
        zones: zones.map(zone => ({
            id: zone.id,
            name: zone.name,
            current: zone.id === currentZoneId,
            cleared: clearedZones.has(zone.id),
            position: { ...zone.map },
        })),
        routes,
    };
}
