# Stim VS Code Extension — Design

Date: 2026-06-29

## Goal

A VS Code extension for the [stim](https://github.com/quantumlib/Stim) quantum
circuit format that provides:

1. Syntax highlighting for `.stim` files.
2. An editor-title button that opens a webview visualizing the circuit, with
   buttons for stim's diagram types (`timeline-svg`, `timeslice-svg`,
   `detslice-svg`, ...). Diagrams are produced by stim's C++ core compiled to
   WASM.

## Decisions (from brainstorming)

- **Language**: stim only. The DEQ grammar in `useful_files/` is inspiration; we
  derive a stim-specific subset. No DEQ support.
- **Engine**: build stim's C++ core to WASM with Emscripten (not Pyodide, not
  shelling out to local Python).
- **Diagram scope (v1)**: SVG types only —
  `timeline-svg`, `timeslice-svg`, `detslice-svg`, `detslice-with-ops-svg`,
  `matchgraph-svg`. Defer 3D / interactive-HTML / ASCII-text variants.
- **WASM build**: local emsdk via a checked-in `build-wasm.sh`. The built
  artifact (`stim_diagram.js` + `stim_diagram.wasm`) is committed and bundled.
- **Refresh**: re-render on file **save** of the source `.stim` document (plus
  on first open, diagram-type change, and tick change). No keystroke debounce.
- **WASM execution location**: in the **extension host (Node)**, which generates
  the SVG and posts it to the webview. The webview is a dumb renderer with a
  tight CSP.

## Architecture

Three parts:

1. **Language contribution** — registers the `stim` language for `.stim` files
   with `syntaxes/stim.tmLanguage.json` (TextMate grammar) and
   `language-configuration.json` (line comment `#`, brackets, auto-closing).
   Grammar covers: gate/instruction names, qubit targets (`0`, `rec[-1]`,
   `sweep[2]`, `!X3`, combiner `*`), parenthesized args / noise probabilities,
   control annotations (`TICK`, `DETECTOR`, `OBSERVABLE_INCLUDE`,
   `QUBIT_COORDS`, `SHIFT_COORDS`, `MPP`), `REPEAT n { ... }` blocks, comments,
   and tags `[...]`.

2. **WASM engine** — stim C++ core + a small embind shim (`wasm/binding.cpp`)
   exposing one function: `diagram(circuitText: string, type: string,
   tick: number) -> string` (SVG). Built via `wasm/build-wasm.sh` (local emsdk)
   to `wasm/out/stim_diagram.{js,wasm}`.

3. **Visualizer** — a command + editor-title button opens a webview panel
   (`ViewColumn.Beside`). The host loads the WASM module (lazy, reused),
   generates the SVG, and posts it to the webview.

## Webview UI

- Panel titled `Stim: <filename>`, opened beside the editor.
- **Toolbar**: one button per SVG diagram type
  (`timeline`, `timeslice`, `detslice`, `detslice-with-ops`, `matchgraph`);
  active type highlighted.
- **Tick control**: number stepper with prev/next, enabled only for
  tick-dependent types (`timeslice`, `detslice`, `detslice-with-ops`); hidden
  otherwise.
- **SVG pane**: scrollable, zoom-to-fit, inline SVG markup. Status line shows
  current type + tick.
- **Error state**: parse/tick errors render as text instead of an SVG.
- Styled with VS Code theme variables (light/dark aware).

## Data flow

```
.stim editor ──(save / type-switch / tick-change)──> extension host
        host: stimModule.diagram(text, type, tick)   [WASM call]
        host ──postMessage({svg | error})──> webview ──> render
```

- Per-panel state (current type, tick, bound document URI) lives in the host.
- Webview → host messages: `{command: 'ready' | 'setType' | 'setTick'}`.
- One WASM module instance, lazy-loaded and reused across panels.

## Repo layout

```
stim_vscode/
  package.json                       # manifest: language, command, menu button
  src/extension.ts                   # activate, command, panel manager
  src/stimEngine.ts                  # loads wasm, diagram() wrapper
  src/panel.ts                       # webview html + messaging
  media/                             # webview css/js
  syntaxes/stim.tmLanguage.json
  language-configuration.json
  wasm/
    binding.cpp                      # embind shim -> diagram()
    build-wasm.sh                    # uses Stim source + local emsdk
    out/stim_diagram.{js,wasm}       # committed build artifact
  third_party/Stim/                  # pinned stim source (submodule or clone)
```

## Error handling

- `diagram()` wrapped so C++ exceptions (parse errors, invalid tick) surface as
  JS errors → posted to webview as the error state.
- Failed/missing WASM load shows an actionable message in the panel.

## Testing

- **Grammar**: tokenization snapshot tests via `vscode-tmgrammar-test`.
- **Engine**: unit tests for `stimEngine.diagram()` against known circuits
  (assert output contains `<svg` and expected markers).
- **WASM build**: a small Node harness calls `diagram()` on a sample circuit to
  verify the build.
- **Manual**: smoke test in the Extension Development Host.

## Out of scope (v1)

- 3D diagrams (`timeline-3d`, `matchgraph-3d`, `-3d-html`).
- Interactive Crumble (`interactive` / `interactive-html`).
- ASCII `-text` variants.
- DEQ language support.
- Live keystroke-debounced refresh.
