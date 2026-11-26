# shader/

This is a 2D project: it draws with the Canvas 2D API, and `.gfshader` materials are WebGL 3D only, so it has no shaders.

If you add a 3D scene, create one in the editor's Shader view (Graph tab, New ▾). It is saved here as `name.gfshader`, listed in `config/resources.json` → `shaders`, and used by name: a scene material `{ "type": "shader", "shader": "name" }`, or `ShaderMaterial.FromAssets("name")` in code.
