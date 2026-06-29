import { test } from "node:test";
import assert from "node:assert";
import {
  shorthandToStim,
  toPlaceholders,
  relabelSvg,
  placeholdersToT,
  parseParametricTag,
} from "../dist-test/tsim.js";
import { renderDiagram, renderDiagramFull, withoutNoiseText } from "../dist-test/stimEngine.js";

// --- lowering (shorthand -> tagged stim) ---

test("lowers tsim shorthand to tagged stim", () => {
  assert.match(shorthandToStim("T 0 1"), /S\[T\] 0 1/);
  assert.match(shorthandToStim("T_DAG 1"), /S_DAG\[T\] 1/);
  assert.match(shorthandToStim("TPP X0*Y1"), /SPP\[T\] X0\*Y1/);
  assert.match(shorthandToStim("TPP_DAG Z0*X1"), /SPP_DAG\[T\] Z0\*X1/);
  assert.match(shorthandToStim("R_X(0.5) 0"), /I\[R_X\(theta=0\.5\*pi\)\] 0/);
  assert.match(shorthandToStim("R_ZZ(0.25) 0 1"), /SPP\[R_PAULI\(theta=0\.25\*pi\)\] Z0\*Z1/);
  assert.match(
    shorthandToStim("U3(0.1, 0.2, 0.3) 0"),
    /I\[U3\(theta=0\.1\*pi, phi=0\.2\*pi, lambda=0\.3\*pi\)\]/
  );
  assert.match(shorthandToStim("CCZ 0 1 2"), /S\[T\]/);
  assert.strictEqual(shorthandToStim("H 0\nCX 0 1\nTICK\n"), "H 0\nCX 0 1\nTICK\n");
});

// --- _parse_parametric_tag (port of test_parse_parametric_tag_accepts_scientific_notation) ---

test("parseParametricTag accepts scientific notation", () => {
  assert.deepStrictEqual(parseParametricTag("R_Z(theta=2.5e-1*pi)"), ["R_Z", { theta: 0.25 }]);
  assert.deepStrictEqual(parseParametricTag("R_X(theta=1.5E+0*pi)"), ["R_X", { theta: 1.5 }]);
  assert.deepStrictEqual(parseParametricTag("R_Y(theta=-2.5e-1*pi)"), ["R_Y", { theta: -0.25 }]);
});

// --- placeholders_to_t (port of test_placeholders_replace_err_and_annotation_removed) ---

test("placeholdersToT replaces ERR box and removes the red id", () => {
  const id = 0.123456;
  const svg = `<svg viewBox="0 0 10 10"><text x="5" y="5"><tspan>I</tspan></text><text stroke="red">${id}</text></svg>`;
  const result = placeholdersToT(svg, new Map([[id, { label: "T" }]]));
  assert.ok(result.includes("T"));
  assert.ok(!result.includes('stroke="red"'));
  assert.ok(!result.includes("<tspan>I</tspan>"));
});

// --- toPlaceholders (port of the tagged_gates_to_placeholder tests) ---

test("toPlaceholders maps a parametric gate and emits I_ERROR", () => {
  const ph = toPlaceholders("I[R_Z(theta=0.25*pi)] 0");
  assert.strictEqual(ph.labels.size, 1);
  assert.ok(ph.text.includes("I_ERROR"));
});

test("toPlaceholders passes an unknown parametric gate through unchanged", () => {
  const ph = toPlaceholders("I[XYZ(theta=0.1*pi)] 0 1 2");
  assert.strictEqual(ph.labels.size, 0);
  assert.strictEqual(ph.text, "I[XYZ(theta=0.1*pi)] 0 1 2");
});

test("toPlaceholders handles scientific-notation angle and subscripts the axis", () => {
  const ph = toPlaceholders("I[R_Z(theta=2.5e-1*pi)] 0");
  const label = [...ph.labels.values()][0];
  assert.ok(label.label.includes("Z"));
  assert.strictEqual(label.annotation, "0.25π");
});

// --- integration: full render + relabel (port of the render_svg_* tests) ---

async function render(src, type) {
  const ph = toPlaceholders(shorthandToStim(src));
  const svg =
    type === "timeline-svg"
      ? await renderDiagram(ph.text, type, 0)
      : await renderDiagramFull(ph.text, type, 0); // all ticks, like tsim's default timeslice
  return relabelSvg(svg, ph.labels);
}

for (const type of ["timeline-svg", "timeslice-svg"]) {
  test(`render labels all single-qubit gates (${type})`, async () => {
    const html = await render(
      `
        S[T] 0
        TICK
        S_DAG[T] 1
        TICK
        I[R_Z(theta=0.25*pi)] 0
        I[R_X(theta=0.5*pi)] 1
        I[R_Y(theta=-0.75*pi)] 2
        TICK
        I[U3(theta=0.1*pi, phi=0.2*pi, lambda=0.3*pi)] 0
      `,
      type
    );
    assert.ok(html.includes("T"));
    assert.ok(html.includes('<tspan baseline-shift="super" font-size="14">†</tspan>'));
    assert.ok(html.includes('<tspan baseline-shift="sub" font-size="14">Z</tspan>'));
    assert.ok(html.includes('<tspan baseline-shift="sub" font-size="14">X</tspan>'));
    assert.ok(html.includes('<tspan baseline-shift="sub" font-size="14">Y</tspan>'));
    assert.ok(html.includes("0.25π"));
    assert.ok(html.includes("0.5π"));
    assert.ok(html.includes("-0.75π"));
    assert.ok(html.includes('<tspan baseline-shift="sub" font-size="14">3</tspan>'));
  });

  test(`render TPP labels (${type})`, async () => {
    const html = await render(
      `
        TPP X0*Y1*Z2
        TICK
        TPP_DAG Z0*X1
      `,
      type
    );
    assert.ok(html.includes("TPP"));
    assert.ok(html.includes("TPP†"));
    assert.ok(html.includes('<tspan baseline-shift="sub" font-size="10">X</tspan>'));
    assert.ok(html.includes('<tspan baseline-shift="sub" font-size="10">Y</tspan>'));
    assert.ok(html.includes('<tspan baseline-shift="sub" font-size="10">Z</tspan>'));
    assert.ok(!html.includes("SPP"));
  });
}

test("render keeps a real SPP while relabeling TPP", async () => {
  const html = await render(
    `
      SPP X0*Z1
      TICK
      TPP Y0*Z1
    `,
    "timeline-svg"
  );
  assert.ok(html.includes("SPP"));
  assert.ok(html.includes("TPP"));
});

test("render shows the repeat-block label", async () => {
  const html = await render(
    `
      T 0
      REPEAT 100 {
          T 0
      }
    `,
    "timeline-svg"
  );
  assert.ok(html.includes("REP100"));
});

// --- without-noise interaction ---

test("withoutNoiseText strips noise but keeps tsim gates", async () => {
  const out = await withoutNoiseText(shorthandToStim("T 0\nX_ERROR(0.1) 0\n"));
  assert.match(out, /S\[T\] 0/);
  assert.ok(!out.includes("X_ERROR"));
});
