import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toNativeStim, findGateLines, explainStimError } from "../dist-test/tsim.js";
import {
  getCircuitStats, getCircuitDemStats, getGateData,
  renderDiagram, renderDiagramFull,
} from "../dist-test/stimEngine.js";

test(".tsim files share Stim's language registration and grammar", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const languages = manifest.contributes.languages;
  const stim = languages.find((language) => language.extensions.includes(".stim"));
  const tsim = languages.filter((language) => language.extensions.includes(".tsim"));
  assert.deepStrictEqual(tsim, [stim]);
  assert.strictEqual(stim.id, "stim");
  assert.ok(stim.aliases.includes("Tsim"));
  assert.ok(manifest.activationEvents.includes("onLanguage:stim"));
  assert.ok(manifest.contributes.grammars.some(
    (grammar) => grammar.language === stim.id && grammar.scopeName === "source.stim"
  ));
});

test("native Tsim instructions, user tags and comments pass through unchanged", () => {
  const text = readFileSync(new URL("./fixtures/non_clifford.tsim", import.meta.url), "utf8");
  assert.equal(toNativeStim(text), text);
  const tagged = "R_Z[calibration R_X(0.3)](0.25) 0 # T 1\nH[T] 0\n# TPP X0*Z1";
  assert.equal(toNativeStim(tagged), tagged);
});

test("decodes legacy tagged gates without decompositions or placeholders", () => {
  assert.equal(toNativeStim("S[T] 0\nS_DAG[T:user] 1"), "T 0\nT_DAG[user] 1");
  assert.equal(toNativeStim("SPP[T] X0*Y1\nSPP_DAG[T:user] Z0"), "TPP X0*Y1\nTPP_DAG[user] Z0");
  assert.equal(toNativeStim("I[R_Z(theta=2.5e-1*pi)] 0"), "R_Z(2.5e-1) 0");
  assert.equal(toNativeStim("I[U3(theta=0.1*pi, phi=0.2*pi, lambda=-0.3*pi)] 0"), "U3(0.1, 0.2, -0.3) 0");
  assert.equal(toNativeStim("SPP[R_PAULI(theta=0.25*pi)] X0*Y1"), "R_PAULI(0.25) X0*Y1");
  assert.equal(toNativeStim("I[XYZ(theta=0.1*pi)] 0"), "I[XYZ(theta=0.1*pi)] 0");
});

test("findGateLines matches the instruction token, with or without a tag", () => {
  const text = "H 0\nRJK 0 1\nM 0\nRJK[foo] 2\nRJKX 3";
  assert.deepStrictEqual(findGateLines(text, "RJK"), ["RJK 0 1", "RJK[foo] 2"]);
});

test("explainStimError quotes the line for an unknown gate", () => {
  const msg = explainStimError("H 0\nRJK 0 1\nM 0", "Gate not found: 'RJK'");
  assert.match(msg, /Circuit could not be parsed\./);
  assert.match(msg, /Unknown instruction 'RJK'/);
  assert.match(msg, /RJK 0 1/);
});

test("explainStimError lists every matching line for a repeated unknown gate", () => {
  const msg = explainStimError("R_Z({a}) 0\nH 0\nR_Z({b}) 1", "Gate not found: 'R_Z'");
  assert.match(msg, /following lines/);
  assert.match(msg, /R_Z\(\{a\}\) 0/);
  assert.match(msg, /R_Z\(\{b\}\) 1/);
});

test("explainStimError falls back to stim's reason when no line is found", () => {
  const msg = explainStimError("H 0\nCX 0", "Two qubit gate CX requires an even number of targets but was given (0).");
  assert.match(msg, /Circuit could not be parsed: Two qubit gate CX requires/);
});

test("unresolved parameters still produce a parse error", async () => {
  const text = readFileSync(new URL("./fixtures/parametric_unset.stim", import.meta.url), "utf8");
  const stats = await getCircuitStats(toNativeStim(text));
  assert.ok(stats.error);
  assert.match(explainStimError(text, stats.error), /Circuit could not be parsed/);
});

test("parses and renders all Tsim instructions directly in WASM", async () => {
  const text = readFileSync(new URL("./fixtures/non_clifford.tsim", import.meta.url), "utf8");
  const stats = await getCircuitStats(text);
  assert.equal(stats.error, undefined);
  assert.equal(stats.qubits, 3);
  assert.equal(stats.measurements, 3);
  for (const type of ["timeline-svg", "timeslice-svg"]) {
    const svg = await renderDiagramFull(text, type, 0);
    assert.match(svg, /<svg\b/);
    assert.ok(svg.includes("TPP"));
    assert.ok(svg.includes("TPP†"));
    assert.ok(!svg.includes("ERR"));
    assert.ok(!svg.includes("SPP"));
  }
});

test("renders native non-Clifford gates and preserves them when hiding noise", async () => {
  const text = "H 0 1 2\nT 0\nT_DAG 1\nR_X(0.25) 0\nU3(0.1, 0.2, 0.3) 1\nCS 0 1\nCS_DAG 1 2\nCCZ 0 1 2\nCCX 0 1 2\nX_ERROR(0.125) 0";
  const svg = await renderDiagram(text, "timeline-svg", 0, true);
  assert.match(svg, /<svg/);
  assert.ok(svg.includes("0.25"));
  assert.ok(!svg.includes("ERR"));
  assert.ok(!svg.includes("0.125"));
  const stats = await getCircuitStats(text);
  assert.equal(stats.error, undefined);
});

test("draw-only and native non-Clifford gates are rejected by Clifford-only views", async () => {
  for (const gate of ["T 0", "TPP X0*Y1", "TPP_DAG X0*Y1", "R_XX(0.25) 0 1", "R_YY(0.25) 0 1", "R_PAULI(0.25) X0*Y1"]) {
    const text = `${gate}\nTICK\nM 0\nDETECTOR rec[-1]`;
    for (const type of ["detslice-svg", "detslice-with-ops-svg", "matchgraph-svg"]) {
      await assert.rejects(() => renderDiagram(text, type, 0), /Clifford|draw-only/);
    }
    assert.match((await getCircuitDemStats(text, true, false)).error, /Clifford|draw-only/);
  }
});

test("gate metadata includes the fork's full native gate list and aliases", async () => {
  const gates = await getGateData();
  assert.equal(new Set(gates.map(g => g.name)).size, gates.length);
  assert.ok(!gates.some(g => g.name === "NOT_A_GATE"));
  for (const name of ["T", "T_DAG", "TPP", "TPP_DAG", "CS", "CS_DAG", "CCZ", "CCX", "R_X", "R_Y", "R_Z", "R_XX", "R_YY", "R_ZZ", "RPP", "R_PAULI", "U3", "U", "CNOT"]) {
    const g = gates.find(g => g.name === name);
    assert.ok(g, `missing ${name}`);
    assert.ok(g.help.length > 0, `missing help for ${name}`);
    assert.ok(g.category.length > 0);
  }
  assert.equal(gates.find(g => g.name === "R_XX").args, 1);
  assert.equal(gates.find(g => g.name === "U").args, 3);
  assert.equal(gates.find(g => g.name === "TPP").args, 0);
  assert.match(gates.find(g => g.name === "R_PAULI").help, /draw-only/);
});


test("3D timeline exports native Tsim gates, angles, and controlled endpoints", async () => {
  const text = readFileSync(new URL("./fixtures/non_clifford.tsim", import.meta.url), "utf8");
  const html = await renderDiagram(text + "\nCS 0 1\nCS_DAG 1 2", "timeline-3d-html", 0);
  assert.match(html, /<!DOCTYPE html>/);
  const uri = /data:text\/plain;base64,([A-Za-z0-9+/=]+)/.exec(html);
  assert.ok(uri, "missing embedded glTF export");
  const gltf = JSON.parse(Buffer.from(uri[1], "base64").toString("utf8"));
  assert.equal(gltf.asset.version, "2.0");
  for (const name of ["R_X", "R_Y", "R_Z", "U3", "R_XX", "R_YY", "R_ZZ", "RPP:X", "TPP:X", "TPP_DAG:Z", "S", "S_DAG"]) {
    assert.ok(gltf.meshes.some(mesh => mesh.primitives.some(primitive =>
      gltf.accessors[primitive.attributes.TEXCOORD_0]?.name === `tex_coords_gate_${name}`
    )), `missing native 3D glyph ${name}`);
  }
  assert.ok(gltf.accessors.some(accessor => accessor.name === "label_0.25"));
  assert.equal(new Set(gltf.textures.map(texture => texture.source)).size, 2);
  for (const image of gltf.images) assert.ok(image.uri.startsWith("data:image/png;base64,"));
});
