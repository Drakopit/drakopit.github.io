# shader/

Shader graphs (`.gfshader`), edited in the editor's Shader view. Each one is listed in `config/resources.json` → `shaders` and used by name.

- `toon.gfshader` — the look of the whole game: albedo map × color, lit by the scene's lights in flat bands (`render.toonBands`, 3 by default). Every character, prop, wall, pond and enemy uses it through `CreateToonMaterial` (`src/rendering/ToonShader.js`); the B key changes `material.bands` at runtime. A scene material can use it too: `{ "type": "shader", "shader": "toon", "toonBands": 3 }`.

The engine's built-in programs (standard, unlit, shadow, celestial, skybox) need no files here. To override one, open it in the Shader view's Code tab.
