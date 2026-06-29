import { test } from "node:test";
import assert from "node:assert";
import { renderDiagram, SVG_DIAGRAM_TYPES, TICK_DEPENDENT } from "../dist-test/stimEngine.js";

const SAMPLE = "H 0\nTICK\nCX 0 1\nM 0 1\nDETECTOR rec[-1] rec[-2]\n";

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
