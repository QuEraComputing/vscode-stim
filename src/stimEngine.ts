import * as path from "path";

export const SVG_DIAGRAM_TYPES = [
  "timeline-svg",
  "timeslice-svg",
  "detslice-svg",
  "detslice-with-ops-svg",
  "matchgraph-svg",
] as const;

// Interactive 3D viewers; diagram() returns a full HTML page (THREE.js + GLTF).
export const HTML_DIAGRAM_TYPES = ["timeline-3d-html", "matchgraph-3d-html"] as const;

export type DiagramType =
  | (typeof SVG_DIAGRAM_TYPES)[number]
  | (typeof HTML_DIAGRAM_TYPES)[number];

export function isHtmlDiagram(type: string): boolean {
  return type.endsWith("-html");
}

export const TICK_DEPENDENT: ReadonlySet<string> = new Set([
  "timeslice-svg",
  "detslice-svg",
  "detslice-with-ops-svg",
]);

// C++ emits this sentinel prefix (0x01 "ERROR" 0x01) for caught errors.
const ERROR_SENTINEL = "\x01ERROR\x01";

interface StimModule {
  diagram(
    text: string,
    type: string,
    tick: number,
    withoutNoise: boolean,
    approxDisjoint: boolean,
    decomposeErrors: boolean
  ): string;
  diagram_full(
    text: string,
    type: string,
    rows: number,
    withoutNoise: boolean,
    approxDisjoint: boolean,
    decomposeErrors: boolean
  ): string;
  count_ticks(text: string): number;
  without_noise_text(text: string): string;
  circuit_stats_json(text: string): string;
  dem_diagram(text: string, type: string): string;
  dem_stats_json(text: string): string;
  circuit_dem_stats_json(text: string, approxDisjoint: boolean, decompose: boolean): string;
  gate_data_json(): string;
}

// Diagram types available for a detector error model (.dem) file.
export type DemDiagramType = "matchgraph-svg" | "matchgraph-3d-html";

export interface DemStats {
  detectors: number;
  observables: number;
  errors: number;
  // Weight of the shortest graphlike undetectable logical error (graphlike code
  // distance), or -1 if it cannot be computed.
  shortestGraphlikeError: number;
  error?: string;
}

export interface CircuitStats {
  qubits: number;
  measurements: number;
  detectors: number;
  observables: number;
  ticks: number;
  sweepBits: number;
  error?: string;
}

export interface GateInfo {
  name: string;
  category: string;
  args: number;
  help: string;
}

let modulePromise: Promise<StimModule> | undefined;

// Resolved relative to this file at runtime (dist/extension.js or dist-test/ -> ../wasm/out).
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
  tick: number,
  withoutNoise = false,
  approxDisjoint = true,
  decomposeErrors = false
): Promise<string> {
  const mod = await loadModule();
  let result: string;
  try {
    result = mod.diagram(circuitText, type, tick, withoutNoise, approxDisjoint, decomposeErrors);
  } catch (e: any) {
    // A wasm trap (e.g. a slice tick on a circuit with no TICKs) poisons the
    // module instance. Drop it so the next render gets a fresh module.
    modulePromise = undefined;
    throw new Error(
      `stim failed to render ${type}: ${String(e?.message ?? e)}`
    );
  }
  if (result.startsWith(ERROR_SENTINEL)) {
    throw new Error(result.slice(ERROR_SENTINEL.length));
  }
  return result;
}

// All of the circuit's ticks in one combined diagram, laid out in `rows` rows
// (0 = stim's automatic layout). Used by "full mode" for slice diagrams.
export async function renderDiagramFull(
  circuitText: string,
  type: DiagramType,
  rows: number,
  withoutNoise = false,
  approxDisjoint = true,
  decomposeErrors = false
): Promise<string> {
  const mod = await loadModule();
  let result: string;
  try {
    result = mod.diagram_full(circuitText, type, rows, withoutNoise, approxDisjoint, decomposeErrors);
  } catch (e: any) {
    modulePromise = undefined;
    throw new Error(`stim failed to render ${type}: ${String(e?.message ?? e)}`);
  }
  if (result.startsWith(ERROR_SENTINEL)) {
    throw new Error(result.slice(ERROR_SENTINEL.length));
  }
  return result;
}

// stim's full gate/annotation table (names, categories, help), loaded once.
// Drives editor autocomplete. Cached because it never changes for a build.
let gateDataPromise: Promise<GateInfo[]> | undefined;

export async function getGateData(): Promise<GateInfo[]> {
  if (!gateDataPromise) {
    gateDataPromise = loadModule()
      .then((mod) => JSON.parse(mod.gate_data_json()) as GateInfo[])
      .catch((e) => {
        gateDataPromise = undefined;
        throw e;
      });
  }
  return gateDataPromise;
}

// Match-graph diagram drawn directly from a detector error model (.dem).
export async function renderDemDiagram(
  demText: string,
  type: DemDiagramType
): Promise<string> {
  const mod = await loadModule();
  let result: string;
  try {
    result = mod.dem_diagram(demText, type);
  } catch (e: any) {
    modulePromise = undefined;
    throw new Error(`stim failed to render ${type}: ${String(e?.message ?? e)}`);
  }
  if (result.startsWith(ERROR_SENTINEL)) {
    throw new Error(result.slice(ERROR_SENTINEL.length));
  }
  return result;
}

// Summary counts for a detector error model, or `error` set if unparsable.
export async function getDemStats(demText: string): Promise<DemStats> {
  const mod = await loadModule();
  try {
    return JSON.parse(mod.dem_stats_json(demText)) as DemStats;
  } catch (e: any) {
    modulePromise = undefined;
    throw new Error(`stim failed to read DEM stats: ${String(e?.message ?? e)}`);
  }
}

// DEM stats derived from a circuit (same build options as the match graph).
export async function getCircuitDemStats(
  circuitText: string,
  approxDisjoint: boolean,
  decompose: boolean
): Promise<DemStats> {
  const mod = await loadModule();
  try {
    return JSON.parse(
      mod.circuit_dem_stats_json(circuitText, approxDisjoint, decompose)
    ) as DemStats;
  } catch (e: any) {
    modulePromise = undefined;
    throw new Error(`stim failed to read circuit DEM stats: ${String(e?.message ?? e)}`);
  }
}

// Summary counts for the circuit (qubits, measurements, detectors, ...), or an
// object with `error` set if it cannot be parsed.
export async function getCircuitStats(circuitText: string): Promise<CircuitStats> {
  const mod = await loadModule();
  try {
    return JSON.parse(mod.circuit_stats_json(circuitText)) as CircuitStats;
  } catch (e: any) {
    modulePromise = undefined;
    throw new Error(`stim failed to read circuit stats: ${String(e?.message ?? e)}`);
  }
}

// The circuit with all noise operations removed (gate tags preserved).
export async function withoutNoiseText(circuitText: string): Promise<string> {
  const mod = await loadModule();
  const result = mod.without_noise_text(circuitText);
  if (result.startsWith(ERROR_SENTINEL)) {
    throw new Error(result.slice(ERROR_SENTINEL.length));
  }
  return result;
}

// Number of TICK instructions in the circuit (-1 if it cannot be parsed).
// Used to guard slice diagrams (a circuit with no ticks cannot be sliced).
export async function countTicks(circuitText: string): Promise<number> {
  const mod = await loadModule();
  try {
    return mod.count_ticks(circuitText);
  } catch (e: any) {
    modulePromise = undefined;
    throw new Error(`stim failed to count ticks: ${String(e?.message ?? e)}`);
  }
}

type TickItem = "tick" | "op" | { reps: number; body: TickItem[] };

// Number of TICKs at the very end of the circuit's instruction stream, with
// REPEAT blocks unrolled. Each one closes an empty trailing slice. Gate names
// are case-insensitive, as in stim. Expects text that stim already parsed.
export function countTrailingTicks(circuitText: string): number {
  const root: TickItem[] = [];
  const stack: TickItem[][] = [root];
  for (const raw of circuitText.split("\n")) {
    // Drop tags before comments: a tag may itself contain '#'.
    const untagged = raw.replace(/\[[^\]\n]*\]/g, "");
    const hash = untagged.indexOf("#");
    const line = (hash >= 0 ? untagged.slice(0, hash) : untagged).trim();
    if (!line) continue;
    const repeat = /^REPEAT\s+(\d+)\s*\{$/i.exec(line);
    if (repeat) {
      const block = { reps: Number(repeat[1]), body: [] as TickItem[] };
      stack[stack.length - 1].push(block);
      stack.push(block.body);
    } else if (line === "}") {
      if (stack.length > 1) stack.pop();
    } else {
      stack[stack.length - 1].push(/^TICK$/i.test(line) ? "tick" : "op");
    }
  }
  // Walk back from the end. A block made only of TICKs contributes every
  // iteration; otherwise only its last iteration's trailing TICKs count.
  const trailing = (items: TickItem[]): { ticks: number; onlyTicks: boolean } => {
    let ticks = 0;
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item === "tick") {
        ticks++;
      } else if (item === "op") {
        return { ticks, onlyTicks: false };
      } else {
        const inner = trailing(item.body);
        if (!inner.onlyTicks) return { ticks: ticks + inner.ticks, onlyTicks: false };
        ticks += inner.ticks * item.reps;
      }
    }
    return { ticks, onlyTicks: true };
  };
  return trailing(root).ticks;
}

// Last slice index worth showing (-1 if the circuit cannot be parsed). stim
// numbers slices 0..count_ticks, but slices closed by trailing TICKs are empty,
// and stim's timeslice renderer traps on a final empty slice, so drop them.
export async function lastSliceTick(circuitText: string): Promise<number> {
  const ticks = await countTicks(circuitText);
  if (ticks < 0) return -1;
  return Math.max(0, ticks - countTrailingTicks(circuitText));
}
