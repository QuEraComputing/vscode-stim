# Stim for VS Code

Syntax highlighting and interactive circuit visualization for [Stim](https://github.com/quantumlib/Stim) and [Tsim](https://github.com/QuEraComputing/tsim) circuits in `.stim` and `.tsim` files, plus `.dem` detector error models.

Diagrams are produced by Stim's C++ core compiled to WebAssembly and run entirely inside the editor with no Python or native dependencies. Tsim circuits use the extension's existing non-Clifford gate translation; see [Tsim support](#tsim-support) for its visualization limits.

## Features

- **Syntax highlighting** for `.stim`, `.tsim`, and `.dem` files, including Tsim's non-Clifford instructions.
- **Autocomplete, hover documentation, and signature help** for Stim gate and annotation names in both `.stim` and `.tsim` files.
- **Circuit visualizer** opened from the editor title bar or the `Stim: Visualize Circuit` command.
- **Diagram types**: `timeline-svg`, `timeline-3d`, `timeslice-svg`, `detslice-svg`, `detslice-with-ops-svg`, `matchgraph-svg`, `matchgraph-3d`.

## Install

Install [Stim by QuEra Computing Inc.](https://marketplace.visualstudio.com/items?itemName=QuEraComputing.vscode-stim) from the VS Code Marketplace, or run:

```bash
code --install-extension QuEraComputing.vscode-stim
```

For manual installation, download the VSIX from [GitHub Releases](https://github.com/QuEraComputing/vscode-stim/releases) and use **Extensions: Install from VSIX** in VS Code or Cursor.

## Quick Start

Open a `.stim`, `.tsim`, or `.dem` file. In the editor title bar, click the 📊-button if visible, or in the `...`-menu, select `Stim: Visualize Circuit`.
![Screenshot of the Stim VS Code extension](https://github.com/QuEraComputing/vscode-stim/blob/5dd52a3042384879ef94827b30ad6c78b45894d1/media/screenshot2.png?raw=true)

Toggle between different visualization types in the visualization panel.
![Screenshot of the Stim VS Code extension](https://github.com/QuEraComputing/vscode-stim/blob/5dd52a3042384879ef94827b30ad6c78b45894d1/media/screenshot1.png?raw=true)


## Tsim support

The `.stim` and `.tsim` extensions share the same language mode, syntax highlighting, editor features, and circuit visualizer. No file association setting or Python installation is needed.

The grammar highlights all additional instructions currently documented by [Tsim](https://github.com/QuEraComputing/tsim#supported-instructions): `T`, `T_DAG`, `TPP`, `TPP_DAG`, `R_X`, `R_Y`, `R_Z`, `R_XX`, `R_YY`, `R_ZZ`, `R_PAULI`, `U3`, `CCZ`, and `CCX`. Signed decimal and scientific-notation arguments, Pauli-product targets, and instruction tags are highlighted too.

Visualization is not full non-Clifford simulation. The 2D operation views relabel T-family and single-qubit rotation gates; `CCZ` and `CCX` are expanded into Clifford+T decompositions. Pauli rotations (`R_XX`, `R_YY`, `R_ZZ`, and `R_PAULI`) currently appear as tagged `SPP` operations. Other views, including detector slices and matching graphs, use Clifford stand-ins (for example, `T` becomes `S` and single-qubit rotations become identity), so they do not represent the exact non-Clifford circuit. Autocomplete, hover documentation, and signature help currently cover Stim's gate table, not the additional Tsim instructions.

## Install from source

```bash
npm install
npm run build
```

Then press `F5` in VS Code to launch an Extension Development Host with the extension loaded, and open a `.stim` or `.tsim` file.

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

### UI tests

The UI suite uses [VS Code Extension Tester](https://github.com/redhat-developer/vscode-extension-tester) and Mocha to drive a real VS Code window with Selenium. It packages and installs the extension into an isolated test profile, then exercises `.stim`, `.tsim`, and `.dem` files, SVG controls, zoom/pan, and error recovery on save.

With Node.js 22+ and a graphical desktop, run:

```bash
npm ci
npm run test:ui
```

On headless Linux, use `xvfb-run -a npm run test:ui`. The first run downloads the VS Code and ChromeDriver versions selected in `extester.config.json`; later runs reuse those downloads. Your normal VS Code profile and extensions are not modified. Test files are copied into `.ui-tests/workspace` before editing.

The suite intentionally excludes CDN-dependent 3D views and OS clipboard integration. Failures produce screenshots, DOM snapshots, and VS Code/WebDriver logs under `.ui-tests/`; CI uploads these as the `ui-test-diagnostics` artifact. Runtime downloads and test artifacts are ignored by Git and excluded from the VSIX.

## Release

GitHub Actions tests and packages the extension, attaches the VSIX to a GitHub release, and publishes the same package to Open VSX and the VS Code Marketplace. Complete the [one-time publisher setup](.github/RELEASING.md) first.

Update `package.json` and `package-lock.json` to the next numeric `major.minor.patch` version, commit and push the changes, then push the matching tag. For example, for version `0.1.1`:

```bash
git tag v0.1.1
git push origin v0.1.1
```

The workflow rejects tags that do not match the package version. Registry publishing runs in independent jobs; rerun failed jobs after resolving any authentication errors. Already published versions are skipped. A manual run on a branch only builds a VSIX unless the Marketplace setup check is selected; that check authenticates without publishing. VSIX files must not be committed.

## Notes

The interactive 3D viewer loads three.js from a CDN at runtime, so it needs network access. The 2D SVG views work fully offline.

## License

The extension's own code is MIT-licensed; see [LICENSE](LICENSE). The bundled Stim engine is licensed under Apache License 2.0; see [LICENSE-Stim.txt](LICENSE-Stim.txt). Third-party components retain their respective licenses. See [NOTICE](NOTICE) and the included `LICENSE-*.txt` files for attribution and license terms.
