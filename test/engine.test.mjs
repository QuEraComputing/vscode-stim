import { test } from "node:test";
import assert from "node:assert";
import { renderDiagram, renderDiagramFull, countTicks, SVG_DIAGRAM_TYPES, TICK_DEPENDENT } from "../dist-test/stimEngine.js";

const SAMPLE = "H 0\nTICK\nCX 0 1\nM 0 1\nDETECTOR rec[-1] rec[-2]\n";
const NOISY = "H 0\nX_ERROR(0.1) 0\nTICK\nM 0\n";

test("exposes the five svg diagram types in order", () => {
  assert.deepStrictEqual([...SVG_DIAGRAM_TYPES], [
    "timeline-svg", "timeslice-svg", "detslice-svg",
    "detslice-with-ops-svg", "matchgraph-svg",
  ]);
});

test("tick-dependent set is exactly the slice types", () => {
  assert.deepStrictEqual([...TICK_DEPENDENT].sort(), [
    "detslice-svg", "detslice-with-ops-svg", "timeslice-svg",
  ]);
});

test("renders timeline svg", async () => {
  const svg = await renderDiagram(SAMPLE, "timeline-svg", 0);
  assert.ok(svg.includes("<svg"));
});

test("throws on invalid circuit (caught via sentinel)", async () => {
  await assert.rejects(() => renderDiagram("NOT_A_GATE 0", "timeline-svg", 0));
});

test("recovers and still renders after a failure", async () => {
  await assert.rejects(() => renderDiagram("NOT_A_GATE 0", "timeline-svg", 0));
  const svg = await renderDiagram(SAMPLE, "timeline-svg", 0);
  assert.ok(svg.includes("<svg"));
});

test("without_noise removes noise operations", async () => {
  const withNoise = await renderDiagram(NOISY, "timeline-svg", 0, false);
  const noNoise = await renderDiagram(NOISY, "timeline-svg", 0, true);
  assert.ok(!noNoise.includes("X_ERROR"));
  assert.ok(noNoise.length < withNoise.length);
});

test("countTicks counts TICK instructions", async () => {
  assert.strictEqual(await countTicks(SAMPLE), 1);
  assert.strictEqual(await countTicks("H 0\nTICK\nM 0\nTICK\n"), 2);
  assert.strictEqual(await countTicks("NOT_A_GATE 0"), -1);
});

test("renderDiagramFull combines all ticks and respects rows", async () => {
  const multi = "R 0\nTICK\nH 0\nTICK\nM 0\nTICK\n";
  const wide = await renderDiagramFull(multi, "timeslice-svg", 1, false);
  const tall = await renderDiagramFull(multi, "timeslice-svg", 3, false);
  assert.ok(wide.includes("<svg"));
  const vb = (s) => /viewBox="[^"]*\s([\d.]+)\s+([\d.]+)"/.exec(s)[0];
  assert.notStrictEqual(vb(wide), vb(tall));
});
