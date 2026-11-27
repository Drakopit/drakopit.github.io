# shader/

- `mossy_stone.gfshader`: **Mossy stone**. Stone with moss on its upward faces, for the highland terrain.

A `.gfshader` is one file: its node graph (edited in the editor's Shader view, Graph tab), its exposed properties, and the GLSL the graph generates, which the engine runs. To write the GLSL by hand, use **Edit GLSL** in the same view; the file then runs your GLSL and keeps the graph. Each shader is listed in `config/resources.json` → `shaders` and used by name (`ShaderMaterial.FromAssets("mossy_stone")`, or a scene material `{ "type": "shader", "shader": "mossy_stone" }`).

The engine's built-in programs (standard, unlit, shadow, celestial, skybox) need no files here. To override one, open it in the Shader view's `.glsl files` tab.
