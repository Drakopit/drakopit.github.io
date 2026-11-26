import { SceneDocument } from 'gameforgejs/core';

/**
 * Reads a Sky Trail course from its scene file (scenes/*.gfscene.json).
 *
 * Gameplay settings are plain `settings`; everything placed in the world is a node:
 * platforms, coins (children of their platform; the offset is the world-space distance from it,
 * since a child inherits its platform's scale),
 * the player spawn, the goal (its beacon, ring and light are children), pole, flag, lights and the
 * scenery (rock undersides, rails and checkpoint rings ride on their platform; clouds).
 * Every visual is the node's own Mesh and Material (`visual`), built with SceneManifest3D like
 * the editor's 3D view builds it, so Play and the editor show the same course.
 * @param {Object} document - Parsed scene JSON.
 * @returns {Object} Course document in the shape `LoadSkyTrailCourse` reads.
 */
export function CourseDocumentFromScene(document) {
    const scene = new SceneDocument(document);
    const { backgroundColor, camera = {}, player = {}, coins = {}, goal = {}, ...settings } = scene.settings;
    const node = id => scene.Node(id);
    const light = id => {
        const { type, ...values } = scene.Component(node(id), 'Light');
        return values;
    };
    const playerNode = node('player');
    const ring = node('goal_ring');
    const offset = item => scene.WorldPosition(item).map((value, i) => value - scene.WorldPosition(node(item.parent))[i]);
    // Mesh, material and shading of a node (as SceneManifest3D objects; code places them).
    const objects = new Map(scene.ToManifest3D().objects.map(({ transform, parent, ...object }) => [object.id, object]));
    const visual = item => objects.get(item.id);
    const part = id => ({ ...scene.Component(node(id), 'GoalPart'), position: scene.WorldPosition(node(id)), scale: [...node(id).transform.scale], visual: visual(node(id)) });
    const sceneryLayers = new Set(['scenery', 'markers', 'clouds']);
    return {
        ...settings,
        name: scene.name,
        backgroundColor,
        skybox: scene.settings.skybox,
        camera,
        platforms: scene.Nodes({ layer: 'platforms' }).map(platform => ({
            id: platform.id,
            ...scene.Component(platform, 'Platform'),
            position: scene.WorldPosition(platform),
            size: [...platform.transform.scale],
            visual: visual(platform),
        })),
        scenery: scene.Nodes().filter(item => sceneryLayers.has(item.layer)).map(item => ({
            id: item.id, layer: item.layer, parent: item.parent ?? null, transform: structuredClone(item.transform), visual: visual(item),
        })),
        coins: {
            ...coins,
            radius: scene.prefabs.coin?.components?.Mesh?.radius,
            items: scene.Nodes({ layer: 'coins' }).map(coin => ({ platformId: coin.parent, offset: offset(coin), visual: visual(coin), ...scene.Component(coin, 'Coin') })),
        },
        player: { ...player, spawn: scene.WorldPosition(playerNode), scale: playerNode.transform.scale[0] },
        goal: {
            ...goal,
            trigger: scene.WorldPosition(node('goal')),
            ring: { offset: offset(ring), visual: visual(ring) },
            beacon: { ...goal.beacon, offset: offset(node('goal_beacon')), visual: visual(node('goal_beacon')) },
            pole: part('goal_pole'),
            flag: part('goal_flag'),
        },
        lighting: {
            ambient: light('light_ambient'),
            hemisphere: light('light_sky'),
            sun: light('light_sun'),
            goalLight: { ...light('light_goal'), offset: scene.LocalPosition(node('light_goal')) },
        },
    };
}
