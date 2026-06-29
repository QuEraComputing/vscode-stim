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
  circuit_stats_json(text: string): string;
  dem_diagram(text: string, type: string): string;
  dem_stats_json(text: string): string;
  gate_data_json(): string;
}

// Diagram types available for a detector error model (.dem) file.
export type DemDiagramType = "matchgraph-svg" | "matchgraph-3d-html";

export interface DemStats {
  detectors: number;
  observables: number;
  errors: number;
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
