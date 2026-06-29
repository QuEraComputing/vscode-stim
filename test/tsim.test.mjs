import { test } from "node:test";
import assert from "node:assert";
import { shorthandToStim, toPlaceholders, relabelSvg } from "../dist-test/tsim.js";
import { renderDiagram, withoutNoiseText } from "../dist-test/stimEngine.js";

test("lowers tsim shorthand to tagged stim", () => {
  assert.match(shorthandToStim("T 0 1"), /S\[T\] 0 1/);
  assert.match(shorthandToStim("T_DAG 1"), /S_DAG\[T\] 1/);
  assert.match(shorthandToStim("TPP X0*Y1"), /SPP\[T\] X0\*Y1/);
  assert.match(shorthandToStim("R_X(0.5) 0"), /I\[R_X\(theta=0\.5\*pi\)\] 0/);
  assert.match(shorthandToStim("R_ZZ(0.25) 0 1"), /SPP\[R_PAULI\(theta=0\.25\*pi\)\] Z0\*Z1/);
  assert.match(
    shorthandToStim("U3(0.1, 0.2, 0.3) 0"),
    /I\[U3\(theta=0\.1\*pi, phi=0\.2\*pi, lambda=0\.3\*pi\)\]/
  );
  // CCZ expands to a Clifford+T decomposition.
  assert.match(shorthandToStim("CCZ 0 1 2"), /S\[T\]/);
  // Leaves plain stim untouched.
  assert.strictEqual(shorthandToStim("H 0\nCX 0 1\nTICK\n"), "H 0\nCX 0 1\nTICK\n");
});

test("placeholders carry gate labels and annotations", () => {
  const ph = toPlaceholders(shorthandToStim("R 0\nTICK\nT 0\nR_X(0.5) 0\n"));
  assert.ok(ph.labels.some((l) => l.label === "T"));
  assert.ok(ph.labels.some((l) => l.label === "R_X" && l.annotation === "0.5π"));
  assert.match(ph.text, /I_ERROR\(/);
});

test("rotation angle is rounded to 4 significant figures", () => {
  const ph = toPlaceholders(shorthandToStim("R_X(0.333333) 0"));
  assert.ok(ph.labels.some((l) => l.annotation === "0.3333π"));
});

test("withoutNoiseText strips noise but keeps tsim gates", async () => {
  const out = await withoutNoiseText(shorthandToStim("T 0\nX_ERROR(0.1) 0\n"));
  assert.match(out, /S\[T\] 0/);
  assert.ok(!out.includes("X_ERROR"));
});

test("relabel restores gate names in the rendered svg", async () => {
  const ph = toPlaceholders(shorthandToStim("R 0\nTICK\nT 0\nT_DAG 0\nR_X(0.5) 0\nTICK\nM 0\n"));
  let svg = await renderDiagram(ph.text, "timeline-svg", 0);
  svg = relabelSvg(svg, ph.labels);
  assert.ok(svg.includes(">T<"), "expected a T label");
  assert.ok(svg.includes("T†"), "expected a T-dagger label");
  assert.ok(svg.includes("0.5π"), "expected the R_X angle annotation");
  assert.ok(!/>ERR</.test(svg), "no placeholder boxes should remain");
});
