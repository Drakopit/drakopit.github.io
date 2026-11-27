Place project-owned art, audio, and models here. Highland terrain and landmarks are authored in `scenes/`.

Every `kaykit-*` folder holds unmodified CC0 1.0 models by Kay Lousberg (KayKit),
the pack's license file, and a `provenance.json` listing each file's source path and
SHA-256 hash:

- `kaykit-characters/`: Adventurers heroes (Knight, Ranger, Mage, Rogue, Barbarian).
- `kaykit-skeletons/`: Skeletons enemies (warrior, rogue, mage).
- `kaykit-animations/`: Character Animations rigs (general, movement, melee, ranged).
- `kaykit-weapons/`: Fantasy Weapons Bits held weapons and shields.
- `kaykit-hexagon/`: Medieval Hexagon buildings and props.
- `kaykit-forest/`: Forest Nature trees, bushes and rocks.

Models are registered in `config/resources.json`; scenes reference them by name in
`Data.model`. Equipped weapons change what a hero holds; game stats remain unchanged.
