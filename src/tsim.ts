// Support for tsim's non-Clifford gates (T, TPP, R_X/Y/Z, R_XX/YY/ZZ, R_PAULI,
// U3, CCZ, CCX). Ported from tsim's utils/program_text.py and utils/diagram.py.
//
// Pipeline (visualization only):
//   1. shorthandToStim:  T 0 1            -> S[T] 0 1            (valid stim)
//   2. toPlaceholders:   S[T] 0 1         -> I_ERROR(id) 0 ...   (+ label map)
//   3. stim renders the placeholder circuit (boxes with a red id text)
//   4. relabelSvg (webview): swap the placeholder boxes back to T / R_X / ...
//
// Steps 1-2 run in the extension host; step 4 runs in the webview (it needs a
// DOM). Simulation-backed views still use the step-1 output, so T behaves as S,
// R_Z as identity, etc. (the documented Clifford approximation).

const FLOAT = "[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?";

function encodeTTag(userTag: string): string {
  return userTag ? `T:${userTag}` : "T";
}

// CCZ/CCX -> Clifford+T decomposition (matches tsim's controlled_gate_decomposition_lines).
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
  // TPP before T to avoid partial matches; (?<!\[) avoids matching inside [T].
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

export interface PlaceholderLabel {
  id: number;
  label: string;
  annotation?: string;
}

export interface Placeholders {
  text: string;
  labels: PlaceholderLabel[];
}

// Replace single-qubit tsim gates (T-family, rotations, U3) with I_ERROR(id)
// markers, one per qubit, to be relabeled later. Pauli-product gates
// (TPP/R_XX/R_PAULI, which lower to SPP[...]) pass through and render as their
// SPP box; stim ignores the tag when drawing.
export function toPlaceholders(loweredText: string): Placeholders {
  const labels: PlaceholderLabel[] = [];
  let counter = 0;
  // Distinct 6-decimal ids in [0.001, 0.9), spaced so the rendered probability
  // round-trips back to a unique value when matched numerically.
  const nextId = () => Math.round((0.001 + ++counter * 1e-6) * 1e6) / 1e6;

  const reT = /^(\s*)(S|S_DAG)\[(T(?::[^\]\n]*)?)\]\s+(.+?)\s*$/;
  const reRot = new RegExp(`^(\\s*)I\\[R_([XYZ])\\(theta=(${FLOAT})\\*pi\\)\\]\\s+(.+?)\\s*$`);
  const reU3 = /^(\s*)I\[U3\([^\]]*\)\]\s+(.+?)\s*$/;

  const out: string[] = [];
  for (const line of loweredText.split("\n")) {
    let m: RegExpExecArray | null;

    if ((m = reT.exec(line))) {
      const [, indent, name, , targets] = m;
      const label = name === "S_DAG" ? "T†" : "T"; // T†
      for (const tgt of targets.split(/\s+/)) {
        const id = nextId();
        labels.push({ id, label });
        out.push(`${indent}I_ERROR(${id}) ${tgt}`);
      }
      continue;
    }

    if ((m = reRot.exec(line))) {
      const [, indent, axis, theta, targets] = m;
      const label = `R_${axis}`;
      const annotation = `${parseFloat(theta)}π`; // θπ
      for (const tgt of targets.split(/\s+/)) {
        const id = nextId();
        labels.push({ id, label, annotation });
        out.push(`${indent}I_ERROR(${id}) ${tgt}`);
      }
      continue;
    }

    if ((m = reU3.exec(line))) {
      const [, indent, targets] = m;
      for (const tgt of targets.split(/\s+/)) {
        const id = nextId();
        labels.push({ id, label: "U3" });
        out.push(`${indent}I_ERROR(${id}) ${tgt}`);
      }
      continue;
    }

    out.push(line);
  }
  return { text: out.join("\n"), labels };
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Relabel a rendered SVG: each I_ERROR placeholder draws an "ERR" box followed
// by a red probability text (the id). Swap the box text for the gate label, and
// either turn the red id into the gate's annotation or drop it. Mirrors tsim's
// placeholders_to_t, done with regex on the SVG string.
export function relabelSvg(svg: string, labels: PlaceholderLabel[]): string {
  const used = new Set<PlaceholderLabel>();
  const pair =
    /(<text\b[^>]*>)ERR(?:<tspan[^>]*>[^<]*<\/tspan>)?(<\/text>)\s*(<text\b[^>]*\bstroke="red"[^>]*>)([0-9.eE+-]+)(<\/text>)/g;
  let out = svg.replace(pair, (full, errOpen, errClose, redOpen, idStr, redClose) => {
    const id = parseFloat(idStr);
    const lab = labels.find((l) => !used.has(l) && Math.abs(l.id - id) < 4e-7);
    if (!lab) {
      return full;
    }
    used.add(lab);
    const newErr = `${errOpen}${escapeXml(lab.label)}${errClose}`;
    if (lab.annotation) {
      const open = redOpen.replace(/\s*stroke="red"/, ' fill="black"');
      return `${newErr}${open}${escapeXml(lab.annotation)}${redClose}`;
    }
    return newErr;
  });
  return out;
}
