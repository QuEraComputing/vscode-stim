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

// C++ emits this sentinel prefix (0x01 "ERROR" 0x01) for caught errors.
const ERROR_SENTINEL = "\x01ERROR\x01";

interface StimModule {
  diagram(text: string, type: string, tick: number, withoutNoise: boolean): string;
  diagram_full(text: string, type: string, rows: number, withoutNoise: boolean): string;
  count_ticks(text: string): number;
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
  withoutNoise = false
): Promise<string> {
  const mod = await loadModule();
  let result: string;
  try {
    result = mod.diagram(circuitText, type, tick, withoutNoise);
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
  withoutNoise = false
): Promise<string> {
  const mod = await loadModule();
  let result: string;
  try {
    result = mod.diagram_full(circuitText, type, rows, withoutNoise);
  } catch (e: any) {
    modulePromise = undefined;
    throw new Error(`stim failed to render ${type}: ${String(e?.message ?? e)}`);
  }
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
