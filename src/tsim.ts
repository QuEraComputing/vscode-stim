// Support for tsim's non-Clifford gates (T, TPP, R_X/Y/Z, R_XX/YY/ZZ, R_PAULI,
// U3, CCZ, CCX). Translated from tsim's utils/program_text.py and
// utils/diagram.py.
//
// Pipeline (visualization only):
//   1. shorthandToStim:  T 0 1            -> S[T] 0 1            (valid stim)
//   2. toPlaceholders:   S[T] 0 1         -> I_ERROR(id) 0 ...   (+ label map)
//                        SPP[T] X0*Y1     -> SPP X0*X0*Y1*Y1     (doubled)
//   3. stim renders the placeholder circuit (boxes with a red id text)
//   4. relabelSvg:       I_ERROR boxes    -> T / R_X / U3 / ... ; doubled SPP -> TPP
//
// Simulation-backed views use the step-1 output, so T behaves as S, R_Z as
// identity, etc. (the documented Clifford approximation).

import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

const FLOAT = "[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?";
const SVG_NS = "http://www.w3.org/2000/svg";

function encodeTTag(userTag: string): string {
  return userTag ? `T:${userTag}` : "T";
}

// --- shorthand -> stim (port of program_text.py:shorthand_to_stim) -----------

function controlledDecomposition(
  gate: "CCZ" | "CCX",
  a: string,
  b: string,
  c: string,
  tag: string
): string[] {
  const t = (name: string) => (tag ? `${name}[${tag}]` : name);
  const ccz = [
    `${t("CNOT")} ${b} ${c}`,
    `${t("T_DAG")} ${c}`,
    `${t("CNOT")} ${a} ${c}`,
    `${t("T")} ${c}`,
    `${t("CNOT")} ${b} ${c}`,
    `${t("T_DAG")} ${c}`,
    `${t("CNOT")} ${a} ${c}`,
    `${t("T")} ${b}`,
    `${t("T")} ${c}`,
    `${t("CNOT")} ${a} ${b}`,
    `${t("T")} ${a}`,
    `${t("T_DAG")} ${b}`,
    `${t("CNOT")} ${a} ${b}`,
  ];
  return gate === "CCZ" ? ccz : [`${t("H")} ${c}`, ...ccz, `${t("H")} ${c}`];
}

function expandControlledGates(text: string): string {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const hashIdx = line.indexOf("#");
    const body = hashIdx >= 0 ? line.slice(0, hashIdx) : line;
    const comment = hashIdx >= 0 ? line.slice(hashIdx) : "";
    const m = /^(\s*)(CCZ|CCX)(?:\[([^\]\n]*)\])?\s+(.+?)\s*$/.exec(body);
    if (!m) {
      out.push(line);
      continue;
    }
    const [, indent, gate, tag, targetsText] = m;
    const targets = targetsText.split(/\s+/);
    if (targets.length % 3 !== 0 || !targets.every((t) => /^\d+$/.test(t))) {
      throw new Error(`${gate} expects bare qubit integer targets in groups of three.`);
    }
    if (comment) {
      out.push(`${indent}${comment}`);
    }
    for (let i = 0; i < targets.length; i += 3) {
      for (const d of controlledDecomposition(
        gate as "CCZ" | "CCX",
        targets[i],
        targets[i + 1],
        targets[i + 2],
        tag || ""
      )) {
        out.push(`${indent}${d}`);
      }
    }
  }
  return out.join("\n");
}

// Convert tsim shorthand to valid stim (tagged Clifford stand-ins).
export function shorthandToStim(text: string): string {
  text = expandControlledGates(text);
  text = text.replace(/(?<!\[)\bTPP_DAG(?:\[([^\]\n]*)\])?(?!\w)/g, (_m, u) => `SPP_DAG[${encodeTTag(u || "")}]`);
  text = text.replace(/(?<!\[)\bTPP(?:\[([^\]\n]*)\])?(?!\w)/g, (_m, u) => `SPP[${encodeTTag(u || "")}]`);
  text = text.replace(/(?<!\[)\bT_DAG(?:\[([^\]\n]*)\])?(?!\w)/g, (_m, u) => `S_DAG[${encodeTTag(u || "")}]`);
  text = text.replace(/(?<!\[)\bT(?:\[([^\]\n]*)\])?(?!\w)/g, (_m, u) => `S[${encodeTTag(u || "")}]`);
  text = text.replace(
    new RegExp(`\\bR_([XYZ])\\1\\((${FLOAT})\\)\\s+(\\d+)\\s+(\\d+)`, "g"),
    (_m, p, a, q0, q1) => {
      if (q0 === q1) throw new Error(`R_${p}${p} target qubits must be distinct, got ${q0} ${q1}.`);
      return `SPP[R_PAULI(theta=${parseFloat(a)}*pi)] ${p}${q0}*${p}${q1}`;
    }
  );
  text = text.replace(
    new RegExp(`\\bR_PAULI\\((${FLOAT})\\)\\s+((?:[XYZ]\\d+)(?:\\*[XYZ]\\d+)*)`, "g"),
    (_m, a, prod) => `SPP[R_PAULI(theta=${parseFloat(a)}*pi)] ${prod}`
  );
  text = text.replace(
    new RegExp(`\\bR_([XYZ])\\((${FLOAT})\\)`, "g"),
    (_m, ax, a) => `I[R_${ax}(theta=${parseFloat(a)}*pi)]`
  );
  text = text.replace(
    new RegExp(`\\bU3\\((${FLOAT})\\s*,\\s*(${FLOAT})\\s*,\\s*(${FLOAT})\\)`, "g"),
    (_m, th, ph, la) =>
      `I[U3(theta=${parseFloat(th)}*pi, phi=${parseFloat(ph)}*pi, lambda=${parseFloat(la)}*pi)]`
  );
  return text;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Lines whose instruction is `gate` (the leading token, ignoring any [tag] and
// arguments). Used to point at the source of stim's "Gate not found" error.
// Returns trimmed text, deduplicated, comments stripped.
export function findGateLines(text: string, gate: string): string[] {
  const head = new RegExp(`^${escapeRegExp(gate)}(?![A-Za-z0-9_])`);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rawLine of text.split("\n")) {
    const hashIdx = rawLine.indexOf("#");
    const trimmed = (hashIdx >= 0 ? rawLine.slice(0, hashIdx) : rawLine).trim();
    if (!head.test(trimmed) || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

// stim has no API to report which line failed to parse, but its error names the
// offending gate (e.g. "Gate not found: 'RJK'"). Quote that line when we can
// find it; otherwise surface stim's reason verbatim. No assumptions about why a
// gate is unknown — any unparseable instruction is reported the same way.
export function explainStimError(text: string, reason: string): string {
  const m = /Gate not found: '([^']+)'/.exec(reason);
  if (m) {
    const lines = findGateLines(text, m[1]);
    if (lines.length > 0) {
      const lead =
        lines.length > 1
          ? `Unknown instruction '${m[1]}' on the following lines`
          : `Unknown instruction '${m[1]}' on the following line`;
      const listed = lines.map((l) => `  ${l}`).join("\n");
      return `Circuit could not be parsed. ${lead}:\n${listed}`;
    }
  }
  return `Circuit could not be parsed: ${reason}`;
}

// --- placeholders + relabel (port of diagram.py) -----------------------------

export interface GateLabel {
  label: string; // may contain SVG markup (tspans)
  annotation?: string;
}

function subscript(text: string): string {
  return `<tspan baseline-shift="sub" font-size="14">${text}</tspan>`;
}
const DAGGER = '<tspan baseline-shift="super" font-size="14">†</tspan>';

// Mirror Python's f"{x:.4g}": 4 significant figures, trailing zeros trimmed.
function format4g(x: number): string {
  return String(parseFloat(x.toPrecision(4)));
}

// Parse a parametric gate tag like "R_Z(theta=0.3*pi)" -> ["R_Z", {theta: 0.3}].
export function parseParametricTag(
  tag: string
): [string, Record<string, number>] | null {
  const m = /^(\w+)\((.*)\)$/.exec(tag);
  if (!m) return null;
  const gateName = m[1];
  const params: Record<string, number> = {};
  for (const raw of m[2].split(",")) {
    const param = raw.trim();
    if (!param) continue;
    const pm = new RegExp(`^(\\w+)=(${FLOAT})\\*pi$`).exec(param);
    if (!pm) return null;
    params[pm[1]] = parseFloat(pm[2]);
  }
  return [gateName, params];
}

export interface Placeholders {
  text: string;
  labels: Map<number, GateLabel>;
}

// Rewrite tagged tsim gates into drawable placeholders. Single-qubit gates
// (T-family, rotations, U3) become I_ERROR(id) markers (one per qubit) with a
// label; Pauli-product TPP doubles its targets so the SVG yields duplicate SPP
// boxes that the de-dup step renames to TPP.
export function toPlaceholders(loweredText: string): Placeholders {
  const labels = new Map<number, GateLabel>();
  let counter = 0;
  const nextId = () => Math.round((0.001 + ++counter * 1e-6) * 1e6) / 1e6;

  const reT = /^(\s*)(S|S_DAG)\[(T(?::[^\]\n]*)?)\]\s+(.+?)\s*$/;
  const reTpp = /^(\s*)(SPP|SPP_DAG)\[(T(?::[^\]\n]*)?)\]\s+(.+?)\s*$/;
  const reRot = new RegExp(`^(\\s*)I\\[R_([XYZ])\\(theta=(${FLOAT})\\*pi\\)\\]\\s+(.+?)\\s*$`);
  const reU3 = /^(\s*)I\[U3\([^\]]*\)\]\s+(.+?)\s*$/;

  const out: string[] = [];
  for (const line of loweredText.split("\n")) {
    let m: RegExpExecArray | null;

    if ((m = reT.exec(line))) {
      const [, indent, name, , targets] = m;
      const label: GateLabel = { label: name === "S_DAG" ? "T" + DAGGER : "T" };
      for (const tgt of targets.split(/\s+/)) {
        const id = nextId();
        labels.set(id, label);
        out.push(`${indent}I_ERROR(${id}) ${tgt}`);
      }
      continue;
    }

    if ((m = reRot.exec(line))) {
      const [, indent, axis, theta, targets] = m;
      const label: GateLabel = {
        label: "R" + subscript(axis),
        annotation: `${format4g(parseFloat(theta))}π`,
      };
      for (const tgt of targets.split(/\s+/)) {
        const id = nextId();
        labels.set(id, label);
        out.push(`${indent}I_ERROR(${id}) ${tgt}`);
      }
      continue;
    }

    if ((m = reU3.exec(line))) {
      const [, indent, targets] = m;
      const label: GateLabel = { label: "U" + subscript("3") };
      for (const tgt of targets.split(/\s+/)) {
        const id = nextId();
        labels.set(id, label);
        out.push(`${indent}I_ERROR(${id}) ${tgt}`);
      }
      continue;
    }

    if ((m = reTpp.exec(line))) {
      // Double each Pauli target so stim draws overlapping boxes the de-dup
      // step collapses and renames SPP -> TPP.
      const [, indent, name, , product] = m;
      const doubled = product
        .split("*")
        .map((p) => `${p}*${p}`)
        .join("*");
      out.push(`${indent}${name} ${doubled}`);
      continue;
    }

    out.push(line);
  }
  return { text: out.join("\n"), labels };
}

// --- tiny DOM helpers over @xmldom/xmldom ------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
function parseSvg(svg: string): any {
  return new DOMParser().parseFromString(svg, "text/xml");
}
function serialize(doc: any): string {
  return new XMLSerializer().serializeToString(doc);
}
function localName(el: any): string {
  return el.localName || el.tagName;
}
function childElements(parent: any): any[] {
  const out: any[] = [];
  for (let n = parent.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1) out.push(n);
  }
  return out;
}
function previousElement(node: any): any {
  for (let n = node.previousSibling; n; n = n.previousSibling) {
    if (n.nodeType === 1) return n;
  }
  return null;
}
function allElements(root: any, tag: string): any[] {
  const list = root.getElementsByTagName(tag);
  const out: any[] = [];
  for (let i = 0; i < list.length; i++) out.push(list.item(i));
  return out;
}
function clearChildren(el: any): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

// An ERR text box is an I_ERROR placeholder: contains <tspan>I</tspan>.
function isErrElement(el: any): boolean {
  if (!el || localName(el) !== "text") return false;
  for (const child of childElements(el)) {
    if (localName(child) === "tspan" && child.textContent === "I") return true;
  }
  return false;
}

// Replace each I_ERROR placeholder box with its gate label, and turn the red id
// text into the annotation (or remove it). Port of diagram.py:placeholders_to_t.
export function placeholdersToT(svg: string, labels: Map<number, GateLabel>): string {
  const doc = parseSvg(svg);
  const redTexts = allElements(doc, "text").filter(
    (el) => el.getAttribute("stroke") === "red" && el.textContent
  );

  const replacements: Array<{ red: any; err: any; gate: GateLabel }> = [];
  for (const [id, gate] of labels) {
    for (const red of redTexts) {
      const val = parseFloat(red.textContent);
      if (Number.isFinite(val) && Math.abs(val - id) < 4e-7) {
        const err = previousElement(red);
        if (isErrElement(err)) {
          replacements.push({ red, err, gate });
        }
        break;
      }
    }
  }

  for (const { red, err, gate } of replacements) {
    err.setAttribute("dominant-baseline", "central");
    err.setAttribute("text-anchor", "middle");
    err.setAttribute("font-family", "monospace");
    err.setAttribute("font-size", "30");
    clearChildren(err);
    if (gate.label.includes("<")) {
      const frag = parseSvg(`<root xmlns="${SVG_NS}">${gate.label}</root>`).documentElement;
      for (let n = frag.firstChild; n; n = n.nextSibling) {
        err.appendChild(err.ownerDocument.importNode(n, true));
      }
    } else {
      err.appendChild(err.ownerDocument.createTextNode(gate.label));
    }
    if (gate.annotation === undefined) {
      if (red.parentNode) red.parentNode.removeChild(red);
    } else {
      clearChildren(red);
      red.appendChild(red.ownerDocument.createTextNode(gate.annotation));
      red.setAttribute("stroke", "black");
    }
  }
  return serialize(doc);
}

// Collapse the doubled SPP boxes from a TPP placeholder and rename SPP -> TPP.
// Port of diagram.py:_deduplicate_doubled_spp.
export function deduplicateDoubledSpp(svg: string): string {
  const doc = parseSvg(svg);
  const root = doc.documentElement;
  const kids = childElements(root);
  const toRemove: any[] = [];
  const toRename: any[] = [];

  let i = 0;
  while (i < kids.length - 3) {
    const [r1, t1, r2, t2] = [kids[i], kids[i + 1], kids[i + 2], kids[i + 3]];
    if (
      localName(r1) === "rect" && r1.getAttribute("fill") === "black" &&
      localName(t1) === "text" && t1.getAttribute("fill") === "white" &&
      localName(r2) === "rect" && r2.getAttribute("fill") === "black" &&
      localName(t2) === "text" && t2.getAttribute("fill") === "white" &&
      r1.getAttribute("x") === r2.getAttribute("x") &&
      r1.getAttribute("y") === r2.getAttribute("y")
    ) {
      toRemove.push(r2, t2);
      toRename.push(t1);
      i += 4;
    } else {
      i += 1;
    }
  }

  for (const el of toRemove) root.removeChild(el);
  for (const t of toRename) {
    const first = t.firstChild;
    if (first && first.nodeType === 3 && first.data) {
      first.data = first.data.replace("SPP", "TPP");
    }
  }
  return serialize(doc);
}

// Full relabel: placeholders -> gate labels, then collapse doubled SPP -> TPP.
export function relabelSvg(svg: string, labels: Map<number, GateLabel>): string {
  return deduplicateDoubledSpp(placeholdersToT(svg, labels));
}
