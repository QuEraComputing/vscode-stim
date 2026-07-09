# Stim for VS Code

Syntax highlighting and interactive circuit visualization for [Stim](https://github.com/quantumlib/Stim) `.stim` and `.dem` files.

Diagrams are produced by Stim's C++ core compiled to WebAssembly, so the output matches Stim exactly and runs entirely inside the editor with no Python or native dependencies.

## Features

- **Syntax highlighting** for `.stim` and `.dem` files.
- **Autocomplete** for gate and annotation names.
- **Circuit visualizer** opened from the editor title bar or the `Stim: Visualize Circuit` command.
- **Diagram types**: `timeline-svg`, `timeline-3d`, `timeslice-svg`, `detslice-svg`, `detslice-with-ops-svg`, `matchgraph-svg`, `matchgraph-3d`.

## Quick Start

Open a `.stim` or `.dem` file. In the editor title bar, click the 📊-button if visible, or in the `...`-menu, select `Stim: Visualize Circuit`.
![Screenshot of the Stim VS Code extension](https://github.com/QuEraComputing/vscode-stim/raw/main/media/screenshot2.png)

Toggle between different visualization types in the visualization panel.
![Screenshot of the Stim VS Code extension](https://github.com/QuEraComputing/vscode-stim/raw/main/media/screenshot1.png)


## Install from source

```bash
npm install
npm run build
```

Then press `F5` in VS Code to launch an Extension Development Host with the extension loaded, and open a `.stim` file.

## Building the WebAssembly engine

The compiled engine (`wasm/out/stim_diagram.{js,wasm}`) is checked in with LFS, so building it is only needed when changing the binding or updating Stim.

Requirements: the [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html) on your `PATH` (`em++`). Stim's source is vendored as a submodule pinned to `v1.16.0`.

```bash
git submodule update --init
source /path/to/emsdk/emsdk_env.sh
npm run build:wasm
```

The build compiles Stim plus a small [Embind](https://emscripten.org/docs/porting/connecting_cpp_and_javascript/embind.html) shim (`wasm/binding.cpp`) that exposes the diagram functions. The extension host loads the module, generates the SVG or 3D HTML, and posts it to the webview, which only renders.

## Development

```bash
npm run watch         # rebuild the extension on change
npm run test:grammar  # TextMate grammar tests
npm run test:wasm     # WebAssembly engine smoke tests
npm run test:engine   # engine wrapper tests
```

## Release

VSIX files are built by GitHub Actions and must not be committed. To publish a release, push a version tag:

```bash
git tag v0.0.1
git push origin v0.0.1
```

The release workflow packages the extension and attaches the generated VSIX to the GitHub release.

## Notes

The interactive 3D viewer loads three.js from a CDN at runtime, so it needs network access. The 2D SVG views work fully offline.

## License

MIT, see [LICENSE](LICENSE). This extension bundles a WebAssembly build of Stim, which is licensed under Apache License 2.0. See [NOTICE](NOTICE) for attribution.
