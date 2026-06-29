import { createRequire } from "node:module";
import assert from "node:assert";
const require = createRequire(import.meta.url);
const createStimModule = require("./out/stim_diagram.js");

// Time-slice and detector-slice diagrams require TICK markers in the circuit;
// without them stim's coordinate layout divides by zero. The TICKs below give
// the slice diagrams a well-defined tick index 1 to render.
const SAMPLE = `H 0
TICK
X_ERROR(0.1) 0
CX 0 1
TICK
M 0 1
DETECTOR rec[-1] rec[-2]
`;
const ERROR_PREFIX = "ERROR";
const Module = await createStimModule();

function check(type, tick, mustContain) {
  const svg = Module.diagram(SAMPLE, type, tick, false);
  assert.ok(!svg.startsWith("\x01" + ERROR_PREFIX), `${type} errored: ${svg}`);
  assert.ok(svg.includes(mustContain), `${type} missing ${mustContain}`);
  console.log(`OK ${type} (${svg.length} bytes)`);
}
check("timeline-svg", 0, "<svg");
check("timeslice-svg", 1, "<svg");
check("detslice-svg", 1, "<svg");
check("detslice-with-ops-svg", 1, "<svg");
check("matchgraph-svg", 0, "<svg");
const bad = Module.diagram("NOT_A_GATE 0", "timeline-svg", 0, false);
assert.ok(bad.startsWith("\x01" + ERROR_PREFIX), "expected error sentinel for bad circuit");
console.log("OK error path");

// without_noise: drawing the noise-free circuit must drop the X_ERROR op.
const withNoise = Module.diagram(SAMPLE, "timeline-svg", 0, false);
const noNoise = Module.diagram(SAMPLE, "timeline-svg", 0, true);
assert.ok(withNoise.includes("ERR") || withNoise.includes("X_ERROR"), "expected noise marker in noisy diagram");
assert.ok(!noNoise.includes("X_ERROR"), "without_noise should remove X_ERROR");
assert.ok(noNoise.length < withNoise.length, "noise-free diagram should be smaller");
console.log("OK without_noise");

// count_ticks: SAMPLE has 2 TICK instructions; bad circuit returns -1.
assert.strictEqual(Module.count_ticks(SAMPLE), 2, "expected 2 ticks");
assert.strictEqual(Module.count_ticks("NOT_A_GATE 0"), -1, "expected -1 for unparsable circuit");
console.log("OK count_ticks");

console.log("ALL WASM CHECKS PASSED");
