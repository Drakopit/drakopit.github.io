import { ShaderMaterial } from 'gameforgejs/3d';

/** The project's toon graph (shader/toon.gfshader, listed in config/resources.json). */
export const TOON_SHADER = 'toon';

/**
 * A material drawn by the toon shader graph: albedo map × color, lit in flat bands.
 * Accepts the same options as ToonMaterial (or a StandardMaterial from ModelMeshFactory),
 * so `material.bands = n` keeps working.
 * @param {{ albedoColor?: number[]|string, albedoMap?: *, name?: string, transparent?: boolean, bands?: number }} [options]
 */
export function CreateToonMaterial({ albedoColor, albedoMap, name, transparent, bands = 3 } = {}) {
    const properties = {};
    if (albedoColor) properties.uColor = albedoColor;
    if (albedoMap) properties.uAlbedoMap = albedoMap;
    return ShaderMaterial.FromAssets(TOON_SHADER, { name, transparent, toonBands: bands, properties });
}
