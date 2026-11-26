const ZONES = {
    hearthvale: {
        id: 'hearthvale',
        name: 'Hearthvale',
        subtitle: 'A quiet hamlet beneath the watchtower',
        palette: '#788f77',
        cols: 21,
        rows: 17,
        spawn: { col: 1, row: 6 },
        portal: { col: 20, row: 16, label: 'MISTFELL PASS', to: 'mistfell', entry: { col: 1, row: 8 } },
        vendors: [
            { id: 'weaponsmith', name: 'Mara the Weaponsmith', greeting: 'Steel holds the line. Need a sharper edge?', col: 3, row: 2, specialty: 'weapon' },
            { id: 'armorer', name: 'Bran the Armorer', greeting: 'A good coat is worth more than a brave promise.', col: 6, row: 2, specialty: 'armor' },
            { id: 'alchemist', name: 'Sella the Alchemist', greeting: 'A little tonic can turn a long march around.', col: 3, row: 5, specialty: 'consumable' },
            { id: 'trainer', name: 'Edda the Trainer', greeting: 'Rest here, recruit. The trail will wait.', col: 6, row: 5, specialty: 'rest' },
        ],
        structures: [
            { col: 3, row: 1, name: 'Weaponsmith', roof: '#a4523f', specialty: 'weapon' },
            { col: 6, row: 1, name: 'Armorer', roof: '#5e7786', specialty: 'armor' },
            { col: 3, row: 4, name: 'Alchemist', roof: '#5c8868', specialty: 'consumable' },
            { col: 6, row: 4, name: 'Training hall', roof: '#846995', specialty: 'rest' },
        ],
        shop: { col: 3, row: 2, vendorId: 'weaponsmith' },
    },
    mistfell: {
        id: 'mistfell',
        name: 'Mistfell Pass',
        subtitle: 'A fogbound trail watched by Ash scouts',
        palette: '#718894',
        cols: 21,
        rows: 17,
        spawn: { col: 1, row: 8 },
        portal: { col: 20, row: 16, label: 'ASHEN RIDGE', to: 'ashen-ridge', entry: { col: 1, row: 8 } },
        returnPortal: { col: 0, row: 16, label: 'HEARTHVALE', to: 'hearthvale', entry: { col: 19, row: 8 } },
        structures: [
            { col: 10, row: 3, name: 'Mistfell standing stone', kind: 'stone' },
            { col: 16, row: 11, name: 'Mistfell pine', kind: 'pine' },
        ],
        encounter: {
            col: 13, row: 9, id: 'mistfell', name: 'Mossback Patrol', level: 3, difficulty: 'EVEN',
            composition: [{ name: 'Ash Guard', count: 1 }, { name: 'Ash Scout', count: 1 }, { name: 'Ash Hound', count: 1 }],
            leaderStyle: 'slime',
        },
        otherEncounters: [{
            col: 7, row: 4, id: 'mistfell-hounds', name: 'Shadow Hounds', level: 2, difficulty: 'EVEN',
            composition: [{ name: 'Ash Hound', count: 2 }, { name: 'Ash Scout', count: 1 }],
            leaderStyle: 'wolf',
        }],
    },
    'ashen-ridge': {
        id: 'ashen-ridge',
        name: 'Ashen Ridge',
        subtitle: 'The patrol stronghold — break their hold',
        palette: '#9a7462',
        cols: 21,
        rows: 17,
        spawn: { col: 1, row: 8 },
        returnPortal: { col: 0, row: 16, label: 'MISTFELL PASS', to: 'mistfell', entry: { col: 19, row: 8 } },
        structures: [
            { col: 10, row: 3, name: 'Ridge crystal', kind: 'crystal' },
            { col: 16, row: 11, name: 'Ridge cairn', kind: 'stone' },
        ],
        encounter: {
            col: 13, row: 9, id: 'ashen-ridge', name: 'Ashen Vanguard', level: 5, difficulty: 'DANGEROUS',
            composition: [{ name: 'Ash Guard', count: 1 }, { name: 'Ash Scout', count: 1 }, { name: 'Ash Hound', count: 1 }, { name: 'Ash Adept', count: 1 }],
            leaderStyle: 'golem',
        },
        otherEncounters: [{
            col: 7, row: 4, id: 'ridge-adepts', name: 'Ember Circle', level: 4, difficulty: 'DANGEROUS',
            composition: [{ name: 'Ash Adept', count: 2 }, { name: 'Ash Guard', count: 1 }],
            leaderStyle: 'wisp',
        }],
    },
};

function heightAt(zoneId, col, row) {
    if (zoneId === 'hearthvale')
        return Math.max(0, Math.round((Math.sin(col * 0.65) + Math.cos(row * 0.58)) / 2 + 0.5));
    if (zoneId === 'mistfell')
        return Math.max(0, Math.min(3, Math.round(1 + Math.sin(col * 0.8) * 1.1 + Math.cos(row * 0.55) * 0.8)));
    return Math.max(0, Math.min(4, Math.round(2 + Math.sin((col + row) * 0.6) * 1.2 + Math.cos(col * 0.45) * 0.8)));
}

export function GetZone(id) {
    const zone = ZONES[id];
    if (!zone) throw new RangeError(`Unknown Highland zone: ${id}`);
    const heights = Array.from({ length: zone.rows }, (_, row) =>
        Array.from({ length: zone.cols }, (_, col) => heightAt(zone.id, col, row)));
    return { ...zone, heights, encounters: [zone.encounter, ...(zone.otherEncounters ?? [])].filter(Boolean) };
}

export function WorldZones() {
    return Object.keys(ZONES).map(id => GetZone(id));
}

export function WorldMapDisplay(currentZoneId, clearedZones = new Set()) {
    const zones = WorldZones();
    const routes = [];
    for (const zone of zones) {
        if (zone.portal)
            routes.push({ from: zone.id, to: zone.portal.to, open: zone.portal.to !== 'ashen-ridge' || clearedZones.has('mistfell') });
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
