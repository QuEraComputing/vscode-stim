# Stim VS Code Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A VS Code extension that syntax-highlights `.stim` files and opens a webview visualizing the circuit using stim's diagram engine compiled to WASM (SVG diagram types only).

**Architecture:** TypeScript extension (bundled with esbuild). stim's C++ core is compiled to WASM with Emscripten + a tiny embind shim exposing `diagram(text, type, tick) -> string`. The extension **host** loads the WASM, generates the SVG, and posts it to a webview that only renders. Re-render happens on file save, diagram-type change, and tick change.

**Tech Stack:** TypeScript, VS Code Extension API, esbuild, TextMate grammar, Emscripten (emsdk) + embind, C++20, stim source (pinned).

---

## Notes for the implementer

- **stim internal API**: This plan calls stim's *internal* drawing classes (`stim_draw_internal::*`), not the public Python API. These signatures were taken from stim `main`. **Pin stim to a tag and verify the signatures in `wasm/binding.cpp` against the checked-out headers before building** — internal APIs can shift between versions. If a signature differs, adjust the call; the *shape* of the binding stays the same.
- **emsdk**: Tasks assume `em++` is on `PATH`. Task 1 verifies/installs emsdk.
- Run all commands from the repo root `/Users/rafaelhaenel/Documents/apps/stim_vscode` unless stated otherwise.

---

## File structure

```
stim_vscode/
  package.json              # extension manifest + scripts + deps
  tsconfig.json
  esbuild.js                # bundle src/ -> dist/extension.js
  .vscodeignore
  .gitignore
  language-configuration.json
  syntaxes/stim.tmLanguage.json
  src/
    extension.ts            # activate(): register command + save listener
    stimEngine.ts           # load wasm, diagram(text,type,tick)
    panel.ts                # StimPanel: webview lifecycle + messaging
  media/
    main.js                 # webview script: toolbar, tick, render
    style.css               # webview styles (theme vars)
  wasm/
    binding.cpp             # embind shim -> diagram()
    build-wasm.sh           # emsdk build -> out/stim_diagram.{js,wasm}
    harness.mjs             # node test: call diagram() on a sample circuit
    out/                    # committed build artifacts
  third_party/Stim/         # git submodule, pinned tag
  test/
    grammar/                # vscode-tmgrammar-test cases
    engine.test.mjs         # node test for stimEngine via wasm harness
  docs/superpowers/...
```

---

## Task 1: Verify Emscripten toolchain

**Files:** none (environment check).

- [ ] **Step 1: Check for em++**

Run: `em++ --version`
Expected: prints a version (e.g. `emcc (Emscripten ...) 3.x`). If "command not found", continue to Step 2; otherwise skip to Step 3.

- [ ] **Step 2: Install emsdk (only if missing)**

```bash
git clone https://github.com/emscripten-core/emsdk.git "$HOME/emsdk"
cd "$HOME/emsdk" && ./emsdk install latest && ./emsdk activate latest
```
Then in the working shell: `source "$HOME/emsdk/emsdk_env.sh"`

- [ ] **Step 3: Confirm C++20-capable em++**

Run: `em++ --version && echo 'int main(){return 0;}' | em++ -std=c++20 -x c++ - -o /tmp/emtest.js`
Expected: compiles with no error, produces `/tmp/emtest.js`.

---

## Task 2: Scaffold the extension project

**Files:**
- Create: `package.json`, `tsconfig.json`, `esbuild.js`, `.gitignore`, `.vscodeignore`, `src/extension.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "stim-vscode",
  "displayName": "Stim",
  "description": "Syntax highlighting and circuit visualization for stim files",
  "version": "0.0.1",
  "publisher": "local",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["Programming Languages", "Visualization"],
  "main": "./dist/extension.js",
  "contributes": {
    "languages": [
      {
        "id": "stim",
        "aliases": ["Stim", "stim"],
        "extensions": [".stim"],
        "configuration": "./language-configuration.json"
      }
    ],
    "grammars": [
      {
        "language": "stim",
        "scopeName": "source.stim",
        "path": "./syntaxes/stim.tmLanguage.json"
      }
    ],
    "commands": [
      {
        "command": "stim.visualize",
        "title": "Stim: Visualize Circuit",
        "icon": "$(graph)"
      }
    ],
    "menus": {
      "editor/title": [
        {
          "command": "stim.visualize",
          "when": "resourceLangId == stim",
          "group": "navigation"
        }
      ]
    }
  },
  "scripts": {
    "build": "node esbuild.js",
    "watch": "node esbuild.js --watch",
    "build:wasm": "bash wasm/build-wasm.sh",
    "test:wasm": "node wasm/harness.mjs",
    "test:grammar": "vscode-tmgrammar-test \"test/grammar/*.stim\"",
    "test:engine": "node --test test/engine.test.mjs",
    "vscode:prepublish": "node esbuild.js --production"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/vscode": "^1.85.0",
    "esbuild": "^0.20.0",
    "typescript": "^5.4.0",
    "vscode-tmgrammar-test": "^0.1.3"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2021",
    "lib": ["ES2021"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create `esbuild.js`**

```js
const esbuild = require("esbuild");
const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    platform: "node",
    outfile: "dist/extension.js",
    external: ["vscode", "./wasm/out/stim_diagram.js"],
    sourcemap: !production,
    minify: production,
    logLevel: "info",
  });
  if (watch) { await ctx.watch(); } else { await ctx.rebuild(); await ctx.dispose(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
third_party/Stim/build/
*.vsix
```

- [ ] **Step 5: Create `.vscodeignore`**

```
.vscode/**
src/**
test/**
third_party/**
wasm/binding.cpp
wasm/build-wasm.sh
wasm/harness.mjs
esbuild.js
tsconfig.json
docs/**
**/*.map
```

Note: `.vscodeignore` excludes stim source from the packaged `.vsix` but keeps `wasm/out/` (the built artifact).

- [ ] **Step 6: Create minimal `src/extension.ts`**

```ts
import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("stim.visualize", () => {
      vscode.window.showInformationMessage("Stim visualize (stub)");
    })
  );
}

export function deactivate() {}
```

- [ ] **Step 7: Install deps and build**

Run: `npm install && npm run build`
Expected: `dist/extension.js` is produced with no errors.

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json esbuild.js .gitignore .vscodeignore src/extension.ts package-lock.json
git commit -m "chore: scaffold stim vscode extension"
```

---

## Task 3: Language configuration

**Files:**
- Create: `language-configuration.json`

- [ ] **Step 1: Create `language-configuration.json`**

```json
{
  "comments": { "lineComment": "#" },
  "brackets": [["{", "}"], ["(", ")"], ["[", "]"]],
  "autoClosingPairs": [
    { "open": "{", "close": "}" },
    { "open": "(", "close": ")" },
    { "open": "[", "close": "]" }
  ],
  "surroundingPairs": [
    { "open": "{", "close": "}" },
    { "open": "(", "close": ")" },
    { "open": "[", "close": "]" }
  ],
  "folding": {
    "markers": { "start": "\\{\\s*$", "end": "^\\s*\\}" }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add language-configuration.json
git commit -m "feat: add stim language configuration"
```

---

## Task 4: TextMate grammar (TDD with grammar tests)

**Files:**
- Create: `syntaxes/stim.tmLanguage.json`
- Test: `test/grammar/basic.stim`

stim circuit format reference: gate names (`H`, `CX`, `M`, `R`, `MPP`, ...), control instructions (`TICK`, `REPEAT n { }`, `DETECTOR`, `OBSERVABLE_INCLUDE`, `QUBIT_COORDS`, `SHIFT_COORDS`), targets (`0`, `rec[-1]`, `sweep[2]`, `!X3`, combiner `*`), parenthesized args `(0.01)`, comments `#`, tags `[...]`.

- [ ] **Step 1: Write the failing grammar test**

Create `test/grammar/basic.stim`:

```
# SYNTAX TEST "source.stim" "stim basic"

# comment line
# <- comment.line.number-sign.stim

H 0 1
# <- support.function.stim
#   ^ constant.numeric.stim

X_ERROR(0.01) 0
# <- support.function.stim
#      ^^^^ constant.numeric.stim

DETECTOR rec[-1]
# <- keyword.control.stim
#        ^^^^^^^ variable.other.stim

REPEAT 3 {
# <- keyword.control.stim
#      ^ constant.numeric.stim
  M 0
}
```

- [ ] **Step 2: Run the grammar test to verify it fails**

Run: `npm run test:grammar`
Expected: FAIL — grammar file does not exist / scopes not found.

- [ ] **Step 3: Create `syntaxes/stim.tmLanguage.json`**

```json
{
  "$schema": "https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json",
  "name": "Stim",
  "scopeName": "source.stim",
  "patterns": [
    { "include": "#comment" },
    { "include": "#repeat-block" },
    { "include": "#control" },
    { "include": "#instruction" }
  ],
  "repository": {
    "comment": {
      "match": "#.*$",
      "name": "comment.line.number-sign.stim"
    },
    "repeat-block": {
      "begin": "\\b(REPEAT)\\s+(\\d+)\\s*(\\{)",
      "beginCaptures": {
        "1": { "name": "keyword.control.stim" },
        "2": { "name": "constant.numeric.stim" },
        "3": { "name": "punctuation.bracket.stim" }
      },
      "end": "(\\})",
      "endCaptures": { "1": { "name": "punctuation.bracket.stim" } },
      "patterns": [{ "include": "$self" }]
    },
    "control": {
      "begin": "\\b(REPEAT|DETECTOR|OBSERVABLE_INCLUDE|QUBIT_COORDS|SHIFT_COORDS|TICK|MPAD)\\b",
      "beginCaptures": { "1": { "name": "keyword.control.stim" } },
      "end": "(?=#)|$",
      "patterns": [
        { "include": "#args" },
        { "include": "#tag" },
        { "include": "#targets" }
      ]
    },
    "instruction": {
      "begin": "\\b([A-Z][A-Z0-9_]*)\\b",
      "beginCaptures": { "1": { "name": "support.function.stim" } },
      "end": "(?=#)|$",
      "patterns": [
        { "include": "#args" },
        { "include": "#tag" },
        { "include": "#targets" }
      ]
    },
    "args": {
      "begin": "\\(",
      "beginCaptures": { "0": { "name": "punctuation.bracket.stim" } },
      "end": "\\)",
      "endCaptures": { "0": { "name": "punctuation.bracket.stim" } },
      "patterns": [
        { "match": "-?\\d+(?:\\.\\d*)?(?:[eE][+-]?\\d+)?", "name": "constant.numeric.stim" }
      ]
    },
    "tag": { "match": "\\[[^\\]]*\\]", "name": "string.other.stim" },
    "targets": {
      "patterns": [
        { "match": "rec\\[-\\d+\\]", "name": "variable.other.stim" },
        { "match": "sweep\\[\\d+\\]", "name": "variable.other.stim" },
        { "match": "!?[XYZ]\\d+", "name": "storage.type.pauli.stim" },
        { "match": "\\*", "name": "keyword.operator.stim" },
        { "match": "!", "name": "keyword.operator.stim" },
        { "match": "-?\\d+(?:\\.\\d*)?", "name": "constant.numeric.stim" }
      ]
    }
  }
}
```

Note: `rec[-1]` must match before the generic `tag` rule; the `control`/`instruction` patterns include `#tag` after `#args` but `targets` is matched within the instruction body. Because `rec[...]`/`sweep[...]` look like tags, the `targets` rule lists them first and `instruction` includes `#targets` — but `#tag` is included BEFORE `#targets`. Fix ordering: in `control` and `instruction`, list `#targets` BEFORE `#tag` so `rec[-1]`/`sweep[2]` win over the generic `[...]` tag rule.

- [ ] **Step 4: Apply the ordering fix**

In `syntaxes/stim.tmLanguage.json`, in both `control.patterns` and `instruction.patterns`, reorder to:

```json
"patterns": [
  { "include": "#args" },
  { "include": "#targets" },
  { "include": "#tag" }
]
```

- [ ] **Step 5: Run the grammar test to verify it passes**

Run: `npm run test:grammar`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add syntaxes/stim.tmLanguage.json test/grammar/basic.stim
git commit -m "feat: add stim textmate grammar with grammar tests"
```

---

## Task 5: Add stim as a pinned submodule

**Files:**
- Create: `.gitmodules`, `third_party/Stim/` (submodule)

- [ ] **Step 1: Add the submodule pinned to a tag**

```bash
git submodule add https://github.com/quantumlib/Stim.git third_party/Stim
cd third_party/Stim && git checkout v1.14.0 && cd ../..
```
Expected: `third_party/Stim/src/stim` exists. (If `v1.14.0` is unavailable, run `cd third_party/Stim && git tag | sort -V | tail` and pin the latest stable tag; record it in this step.)

- [ ] **Step 2: Verify the internal headers exist and match this plan's signatures**

Run:
```bash
ls third_party/Stim/src/stim/diagram/timeline/timeline_svg_drawer.h \
   third_party/Stim/src/stim/diagram/detector_slice/detector_slice_set.h \
   third_party/Stim/src/stim/diagram/graph/match_graph_svg_drawer.h \
   third_party/Stim/src/stim/simulators/error_analyzer.h
grep -n "make_diagram_write_to" third_party/Stim/src/stim/diagram/timeline/timeline_svg_drawer.h
grep -n "SVG_MODE_TIMELINE\|SVG_MODE_TIME_SLICE\|SVG_MODE_TIME_DETECTOR_SLICE" third_party/Stim/src/stim/diagram/timeline/timeline_svg_drawer.h
grep -n "from_circuit_ticks\|write_svg_diagram_to" third_party/Stim/src/stim/diagram/detector_slice/detector_slice_set.h
grep -n "dem_match_graph_to_svg_diagram_write_to" third_party/Stim/src/stim/diagram/graph/match_graph_svg_drawer.h
grep -n "circuit_to_detector_error_model" third_party/Stim/src/stim/simulators/error_analyzer.h
```
Expected: all files exist and each grep returns at least one line. **If any signature differs from what `binding.cpp` (Task 6) uses, update `binding.cpp` accordingly.** Note the exact `circuit_to_detector_error_model` parameter list — it is used in Task 6.

- [ ] **Step 3: Commit**

```bash
git add .gitmodules third_party/Stim
git commit -m "chore: pin stim source as submodule"
```

---

## Task 6: WASM binding + build (verify with node harness)

**Files:**
- Create: `wasm/binding.cpp`, `wasm/build-wasm.sh`, `wasm/harness.mjs`
- Output: `wasm/out/stim_diagram.{js,wasm}`

- [ ] **Step 1: Create `wasm/binding.cpp`**

```cpp
#include <emscripten/bind.h>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#include "stim/circuit/circuit.h"
#include "stim/dem/detector_error_model.h"
#include "stim/simulators/error_analyzer.h"
#include "stim/diagram/coord.h"
#include "stim/diagram/timeline/timeline_svg_drawer.h"
#include "stim/diagram/detector_slice/detector_slice_set.h"
#include "stim/diagram/graph/match_graph_svg_drawer.h"

using namespace emscripten;
using namespace stim;
using namespace stim_draw_internal;

// Sentinel prefix that cannot appear in valid SVG output (control char 0x01).
static const std::string ERROR_PREFIX = "\x01ERROR\x01";

static std::string diagram(std::string circuit_text, std::string type, int tick) {
    try {
        Circuit circuit(circuit_text.c_str());

        // Match-all coordinate filter (no filtering).
        std::vector<CoordFilter> filters;
        filters.push_back(CoordFilter{});
        SpanRef<const CoordFilter> coord_filter(filters);

        uint64_t tick_start = (uint64_t)(tick < 0 ? 0 : tick);
        uint64_t tick_num = 1;

        std::ostringstream out;
        if (type == "timeline-svg") {
            DiagramTimelineSvgDrawer::make_diagram_write_to(
                circuit, out, 0, UINT64_MAX,
                DiagramTimelineSvgDrawerMode::SVG_MODE_TIMELINE, coord_filter);
        } else if (type == "timeslice-svg") {
            DiagramTimelineSvgDrawer::make_diagram_write_to(
                circuit, out, tick_start, tick_num,
                DiagramTimelineSvgDrawerMode::SVG_MODE_TIME_SLICE, coord_filter);
        } else if (type == "detslice-with-ops-svg") {
            DiagramTimelineSvgDrawer::make_diagram_write_to(
                circuit, out, tick_start, tick_num,
                DiagramTimelineSvgDrawerMode::SVG_MODE_TIME_DETECTOR_SLICE, coord_filter);
        } else if (type == "detslice-svg") {
            DetectorSliceSet::from_circuit_ticks(
                circuit, tick_start, tick_num, coord_filter)
                .write_svg_diagram_to(out);
        } else if (type == "matchgraph-svg") {
            DetectorErrorModel dem = ErrorAnalyzer::circuit_to_detector_error_model(
                circuit,
                /*decompose_errors=*/false,
                /*fold_loops=*/true,
                /*allow_gauge_detectors=*/false,
                /*approximate_disjoint_errors_threshold=*/0,
                /*ignore_decomposition_failures=*/false,
                /*block_decomposition_from_introducing_remnant_edges=*/false);
            dem_match_graph_to_svg_diagram_write_to(dem, out);
        } else {
            throw std::invalid_argument("Unknown diagram type: " + type);
        }
        return out.str();
    } catch (const std::exception &e) {
        return ERROR_PREFIX + e.what();
    } catch (...) {
        return ERROR_PREFIX + std::string("unknown error generating diagram");
    }
}

EMSCRIPTEN_BINDINGS(stim_diagram) {
    function("diagram", &diagram);
}
```

Note: the `circuit_to_detector_error_model` argument list above must match what Task 5 Step 2 found. If the checked-out stim version differs, edit the call here.

- [ ] **Step 2: Create `wasm/build-wasm.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STIM_SRC="$SCRIPT_DIR/../third_party/Stim/src"
OUT="$SCRIPT_DIR/out"
mkdir -p "$OUT"

if ! command -v em++ >/dev/null 2>&1; then
  echo "ERROR: em++ not found. Run: source \$HOME/emsdk/emsdk_env.sh" >&2
  exit 1
fi

# All stim translation units except tests, perf, pybind glue, and CLI mains.
SOURCES=$(find "$STIM_SRC/stim" -name '*.cc' \
  ! -name '*.test.cc' ! -name '*.perf.cc' ! -name '*.pybind.cc' \
  ! -name 'main.cc')

em++ -std=c++20 -O2 -fexceptions \
  -I "$STIM_SRC" \
  "$SCRIPT_DIR/binding.cpp" $SOURCES \
  -lembind \
  -sMODULARIZE=1 \
  -sEXPORT_NAME=createStimModule \
  -sENVIRONMENT=node \
  -sALLOW_MEMORY_GROWTH=1 \
  -o "$OUT/stim_diagram.js"

echo "Built $OUT/stim_diagram.js + stim_diagram.wasm"
```

- [ ] **Step 3: Build the WASM module**

Run: `chmod +x wasm/build-wasm.sh && npm run build:wasm`
Expected: `wasm/out/stim_diagram.js` and `wasm/out/stim_diagram.wasm` produced.
If compilation errors mention missing flags/exceptions, the most common fixes are: add `-sDISABLE_EXCEPTION_CATCHING=0`, or correct an internal-API signature mismatch (re-check Task 5 Step 2). Iterate until it builds.

- [ ] **Step 4: Create `wasm/harness.mjs` (the verification test)**

```js
import { createRequire } from "node:module";
import assert from "node:assert";
const require = createRequire(import.meta.url);
const createStimModule = require("./out/stim_diagram.js");

const SAMPLE = `H 0
CX 0 1
M 0 1
DETECTOR rec[-1] rec[-2]
`;

const ERROR_PREFIX = "ERROR";

const Module = await createStimModule();

function check(type, tick, mustContain) {
  const svg = Module.diagram(SAMPLE, type, tick);
  assert.ok(!svg.startsWith(ERROR_PREFIX), `${type} errored: ${svg}`);
  assert.ok(svg.includes(mustContain), `${type} missing ${mustContain}`);
  console.log(`OK ${type} (${svg.length} bytes)`);
}

check("timeline-svg", 0, "<svg");
check("timeslice-svg", 1, "<svg");
check("detslice-svg", 1, "<svg");
check("detslice-with-ops-svg", 1, "<svg");
check("matchgraph-svg", 0, "<svg");

// Error path
const bad = Module.diagram("NOT_A_GATE 0", "timeline-svg", 0);
assert.ok(bad.startsWith(ERROR_PREFIX), "expected error sentinel for bad circuit");
console.log("OK error path");
console.log("ALL WASM CHECKS PASSED");
```

- [ ] **Step 5: Run the harness to verify the build works**

Run: `npm run test:wasm`
Expected: prints `OK ...` for each type and `ALL WASM CHECKS PASSED`.
If `matchgraph-svg` errors because the sample has no errors to build a match graph, change the SAMPLE in the harness to include a noise op, e.g. add `X_ERROR(0.1) 0` after `H 0`. (Adjust and re-run; the goal is a non-empty match graph.)

- [ ] **Step 6: Commit the binding, build script, harness, and built artifact**

```bash
git add wasm/binding.cpp wasm/build-wasm.sh wasm/harness.mjs wasm/out/stim_diagram.js wasm/out/stim_diagram.wasm
git commit -m "feat: build stim diagram engine to wasm with embind shim"
```

---

## Task 7: Engine wrapper (`stimEngine.ts`) with tests

**Files:**
- Create: `src/stimEngine.ts`
- Test: `test/engine.test.mjs`

The wrapper lazy-loads the WASM module from the bundled artifact and exposes a typed `renderDiagram`. It strips the error sentinel and throws a normal `Error` so callers use try/catch.

- [ ] **Step 1: Write the failing engine test**

Create `test/engine.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert";
import { renderDiagram, SVG_DIAGRAM_TYPES } from "../dist-test/stimEngine.js";

const SAMPLE = "H 0\nCX 0 1\nM 0 1\nDETECTOR rec[-1] rec[-2]\n";

test("exposes the five svg diagram types", () => {
  assert.deepStrictEqual(SVG_DIAGRAM_TYPES, [
    "timeline-svg", "timeslice-svg", "detslice-svg",
    "detslice-with-ops-svg", "matchgraph-svg",
  ]);
});

test("renders timeline svg", async () => {
  const svg = await renderDiagram(SAMPLE, "timeline-svg", 0);
  assert.ok(svg.includes("<svg"));
});

test("throws on invalid circuit", async () => {
  await assert.rejects(
    () => renderDiagram("NOPE 0", "timeline-svg", 0),
    /diagram/i
  );
});
```

Note: the test imports from `dist-test/` — a plain commonjs/ESM transpile of `src/stimEngine.ts` used only for node testing (it does not depend on `vscode`). Step 4 adds the transpile command.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:engine` (after adding it — see Step 5)
Expected: FAIL — `dist-test/stimEngine.js` does not exist.

- [ ] **Step 3: Create `src/stimEngine.ts`**

```ts
import * as path from "path";

export const SVG_DIAGRAM_TYPES = [
  "timeline-svg",
  "timeslice-svg",
  "detslice-svg",
  "detslice-with-ops-svg",
  "matchgraph-svg",
] as const;

export type DiagramType = (typeof SVG_DIAGRAM_TYPES)[number];

export const TICK_DEPENDENT: ReadonlySet<string> = new Set([
  "timeslice-svg",
  "detslice-svg",
  "detslice-with-ops-svg",
]);

const ERROR_PREFIX = "ERROR";

interface StimModule {
  diagram(text: string, type: string, tick: number): string;
}

let modulePromise: Promise<StimModule> | undefined;

// Resolved relative to this file at runtime (dist/extension.js -> ../wasm/out).
function wasmModulePath(): string {
  return path.join(__dirname, "..", "wasm", "out", "stim_diagram.js");
}

async function loadModule(): Promise<StimModule> {
  if (!modulePromise) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const createStimModule = require(wasmModulePath());
    modulePromise = createStimModule() as Promise<StimModule>;
  }
  return modulePromise;
}

export async function renderDiagram(
  circuitText: string,
  type: DiagramType,
  tick: number
): Promise<string> {
  const mod = await loadModule();
  const result = mod.diagram(circuitText, type, tick);
  if (result.startsWith(ERROR_PREFIX)) {
    throw new Error(result.slice(ERROR_PREFIX.length));
  }
  return result;
}
```

Note: `wasmModulePath()` assumes the bundled extension lives at `dist/extension.js`, so `../wasm/out/...` resolves from the repo root in the packaged extension. The harness test uses a separate transpile (Step 4) where `__dirname` is `dist-test/`, so `../wasm/out` still resolves correctly from `dist-test/`.

- [ ] **Step 4: Add the test-transpile script to `package.json`**

In `package.json` `scripts`, add:

```json
"build:test": "tsc src/stimEngine.ts --outDir dist-test --module nodenext --target ES2021 --moduleResolution nodenext --skipLibCheck",
"test:engine": "npm run build:test && node --test test/engine.test.mjs"
```

And add `dist-test/` to `.gitignore`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:engine`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/stimEngine.ts test/engine.test.mjs package.json .gitignore
git commit -m "feat: add stim engine wrapper with node tests"
```

---

## Task 8: Webview assets (`media/`)

**Files:**
- Create: `media/main.js`, `media/style.css`

The webview is a dumb renderer: it builds the toolbar from a list of types sent by the host, shows/hides the tick control, posts `setType`/`setTick`/`ready`, and renders SVG or an error.

- [ ] **Step 1: Create `media/style.css`**

```css
body {
  margin: 0;
  font-family: var(--vscode-font-family);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
}
#toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  padding: 8px;
  border-bottom: 1px solid var(--vscode-panel-border);
  position: sticky;
  top: 0;
  background: var(--vscode-editor-background);
}
button {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  border: none;
  padding: 4px 10px;
  cursor: pointer;
  border-radius: 3px;
}
button.active {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}
#tick-control { display: none; align-items: center; gap: 4px; margin-left: 8px; }
#tick-control.visible { display: flex; }
#tick-value { width: 48px; text-align: center; }
#status { margin-left: auto; opacity: 0.7; font-size: 0.85em; }
#view { padding: 12px; overflow: auto; }
#view svg { max-width: 100%; height: auto; }
.error { color: var(--vscode-errorForeground); white-space: pre-wrap; font-family: var(--vscode-editor-font-family); }
```

- [ ] **Step 2: Create `media/main.js`**

```js
(function () {
  const vscode = acquireVsCodeApi();
  const toolbar = document.getElementById("toolbar");
  const view = document.getElementById("view");
  const status = document.getElementById("status");
  const tickControl = document.getElementById("tick-control");
  const tickValue = document.getElementById("tick-value");

  let state = { types: [], tickDependent: [], current: null, tick: 1 };

  function renderToolbar() {
    for (const btn of [...toolbar.querySelectorAll("button.type-btn")]) btn.remove();
    const anchor = tickControl;
    for (const type of state.types) {
      const btn = document.createElement("button");
      btn.className = "type-btn" + (type === state.current ? " active" : "");
      btn.textContent = type.replace(/-svg$/, "");
      btn.addEventListener("click", () => {
        state.current = type;
        updateTickVisibility();
        renderToolbar();
        vscode.postMessage({ command: "setType", type });
      });
      toolbar.insertBefore(btn, anchor);
    }
  }

  function updateTickVisibility() {
    const dependent = state.tickDependent.includes(state.current);
    tickControl.classList.toggle("visible", dependent);
  }

  document.getElementById("tick-prev").addEventListener("click", () => setTick(state.tick - 1));
  document.getElementById("tick-next").addEventListener("click", () => setTick(state.tick + 1));
  function setTick(t) {
    state.tick = Math.max(0, t);
    tickValue.textContent = String(state.tick);
    vscode.postMessage({ command: "setTick", tick: state.tick });
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.command === "init") {
      state.types = msg.types;
      state.tickDependent = msg.tickDependent;
      state.current = msg.current;
      state.tick = msg.tick;
      tickValue.textContent = String(state.tick);
      renderToolbar();
      updateTickVisibility();
    } else if (msg.command === "svg") {
      status.textContent = `${msg.type}${msg.tickShown ? " · tick " + msg.tick : ""}`;
      view.innerHTML = msg.svg;
    } else if (msg.command === "error") {
      status.textContent = "error";
      const pre = document.createElement("pre");
      pre.className = "error";
      pre.textContent = msg.message;
      view.replaceChildren(pre);
    } else if (msg.command === "loading") {
      status.textContent = "rendering…";
    }
  });

  vscode.postMessage({ command: "ready" });
})();
```

- [ ] **Step 3: Commit**

```bash
git add media/main.js media/style.css
git commit -m "feat: add stim visualizer webview assets"
```

---

## Task 9: Panel manager (`panel.ts`)

**Files:**
- Create: `src/panel.ts`

`StimPanel` owns one webview, is bound to a source document URI, holds current type+tick, builds the HTML with a strict CSP + nonce, handles webview messages, and exposes `refresh()` (called on save).

- [ ] **Step 1: Create `src/panel.ts`**

```ts
import * as vscode from "vscode";
import {
  renderDiagram,
  SVG_DIAGRAM_TYPES,
  TICK_DEPENDENT,
  DiagramType,
} from "./stimEngine";

export class StimPanel {
  public static readonly viewType = "stim.visualizer";
  private static panels = new Map<string, StimPanel>();

  private currentType: DiagramType = "timeline-svg";
  private tick = 1;
  private disposables: vscode.Disposable[] = [];

  static createOrShow(context: vscode.ExtensionContext, doc: vscode.TextDocument) {
    const key = doc.uri.toString();
    const existing = StimPanel.panels.get(key);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      StimPanel.viewType,
      `Stim: ${doc.uri.path.split("/").pop()}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
      }
    );
    StimPanel.panels.set(key, new StimPanel(panel, context, doc));
  }

  static refreshForDocument(doc: vscode.TextDocument) {
    StimPanel.panels.get(doc.uri.toString())?.refresh();
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly doc: vscode.TextDocument
  ) {
    this.panel.webview.html = this.getHtml();
    this.panel.webview.onDidReceiveMessage(
      (msg) => this.onMessage(msg),
      null,
      this.disposables
    );
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private onMessage(msg: any) {
    if (msg.command === "ready") {
      this.panel.webview.postMessage({
        command: "init",
        types: SVG_DIAGRAM_TYPES,
        tickDependent: [...TICK_DEPENDENT],
        current: this.currentType,
        tick: this.tick,
      });
      this.refresh();
    } else if (msg.command === "setType") {
      this.currentType = msg.type;
      this.refresh();
    } else if (msg.command === "setTick") {
      this.tick = msg.tick;
      this.refresh();
    }
  }

  async refresh() {
    this.panel.webview.postMessage({ command: "loading" });
    try {
      const text = this.doc.getText();
      const svg = await renderDiagram(text, this.currentType, this.tick);
      this.panel.webview.postMessage({
        command: "svg",
        svg,
        type: this.currentType,
        tick: this.tick,
        tickShown: TICK_DEPENDENT.has(this.currentType),
      });
    } catch (e: any) {
      this.panel.webview.postMessage({
        command: "error",
        message: String(e?.message ?? e),
      });
    }
  }

  private dispose() {
    StimPanel.panels.delete(this.doc.uri.toString());
    while (this.disposables.length) this.disposables.pop()?.dispose();
    this.panel.dispose();
  }

  private getHtml(): string {
    const webview = this.panel.webview;
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "main.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "style.css")
    );
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<link href="${styleUri}" rel="stylesheet" />
</head>
<body>
  <div id="toolbar">
    <div id="tick-control">
      <button id="tick-prev">◀</button>
      <span>tick <span id="tick-value">1</span></span>
      <button id="tick-next">▶</button>
    </div>
    <span id="status"></span>
  </div>
  <div id="view"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}
```

Note: CSP allows `'unsafe-inline'` for styles only (stim SVGs use inline `style`/`<style>`); scripts are nonce-gated; `img-src data:` covers any embedded raster data in SVGs.

- [ ] **Step 2: Build to typecheck**

Run: `npm run build`
Expected: bundles with no TypeScript errors. (`src/panel.ts` is pulled in once `extension.ts` imports it in Task 10; to typecheck now, temporarily run `npx tsc --noEmit -p tsconfig.json`.)

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/panel.ts
git commit -m "feat: add stim visualizer webview panel manager"
```

---

## Task 10: Wire the command and save-refresh (`extension.ts`)

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: Replace `src/extension.ts`**

```ts
import * as vscode from "vscode";
import { StimPanel } from "./panel";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("stim.visualize", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "stim") {
        vscode.window.showWarningMessage("Open a .stim file to visualize it.");
        return;
      }
      StimPanel.createOrShow(context, editor.document);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.languageId === "stim") {
        StimPanel.refreshForDocument(doc);
      }
    })
  );
}

export function deactivate() {}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: `dist/extension.js` produced, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/extension.ts
git commit -m "feat: wire visualize command and save-triggered refresh"
```

---

## Task 11: End-to-end manual smoke test

**Files:**
- Create: `test/fixtures/surface.stim` (sample for manual testing)

- [ ] **Step 1: Create a sample circuit**

Create `test/fixtures/surface.stim`:

```
QUBIT_COORDS(0, 0) 0
QUBIT_COORDS(1, 0) 1
QUBIT_COORDS(2, 0) 2
R 0 1 2
TICK
H 0
CX 0 1
TICK
CX 2 1
M 1
DETECTOR(1, 0) rec[-1]
X_ERROR(0.05) 0 2
M 0 2
OBSERVABLE_INCLUDE(0) rec[-1] rec[-2]
```

- [ ] **Step 2: Launch the Extension Development Host**

Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"]
    }
  ]
}
```

Then press F5 in VS Code (or run the "Run Extension" config). A new Extension Development Host window opens.

- [ ] **Step 3: Verify syntax highlighting**

In the dev host, open `test/fixtures/surface.stim`.
Expected: gate names, numbers, `rec[-1]`, comments, and `REPEAT` blocks are colorized. Confirm the language indicator (bottom-right) shows "Stim".

- [ ] **Step 4: Verify visualization**

Click the graph icon in the editor title bar (or run "Stim: Visualize Circuit" from the command palette).
Expected: a panel opens beside the editor showing a timeline SVG. Clicking `timeslice`, `detslice`, `detslice-with-ops`, `matchgraph` switches the diagram. The tick control appears only for `timeslice`/`detslice`/`detslice-with-ops`; prev/next changes the slice.

- [ ] **Step 5: Verify save-refresh and error state**

Edit the circuit (e.g. add `H 1`), save (Cmd+S). Expected: the diagram updates. Then type an invalid line like `BOGUS 0`, save. Expected: the panel shows the stim error text. Remove it, save, diagram returns.

- [ ] **Step 6: Commit**

```bash
git add test/fixtures/surface.stim .vscode/launch.json
git commit -m "test: add manual smoke-test fixture and launch config"
```

- [ ] **Step 7: Final full check**

Run: `npm run build && npm run test:grammar && npm run test:wasm && npm run test:engine`
Expected: build succeeds; grammar, wasm, and engine tests all pass.

---

## Self-review notes

- **Spec coverage**: syntax highlighting (Tasks 3–4), editor button (Task 2 manifest + Task 10), webview with per-type buttons (Tasks 8–9), SVG generation by stim-as-WASM (Tasks 5–7), tick control for tick-dependent types (Tasks 8–9), save-refresh (Task 10), error state (Tasks 6–9), host-side WASM execution (Task 7), build script + committed artifact (Task 6), testing (grammar/engine/wasm/manual). All spec sections map to tasks.
- **Type consistency**: `SVG_DIAGRAM_TYPES`, `TICK_DEPENDENT`, `renderDiagram(text, type, tick)`, and the `init`/`svg`/`error`/`loading`/`ready`/`setType`/`setTick` message commands are used identically across `stimEngine.ts`, `panel.ts`, and `media/main.js`.
- **Known risk**: stim's internal drawing API is not a stability-guaranteed public surface. Task 5 Step 2 verifies signatures against the pinned tag before Task 6 builds; mismatches are fixed in `binding.cpp`.
```
