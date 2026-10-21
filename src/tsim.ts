const FLOAT = "[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?";

// Decode legacy tagged gates; native Stim and Tsim instructions pass through.
export function toNativeStim(text: string): string {
  return text.split("\n").map((line) => {
    const legacy = /^(\s*)(S|S_DAG|SPP|SPP_DAG)\[T(?::([^\]\n]*))?\](?=\s|$)/;
    line = line.replace(legacy, (_m, indent, name, tag) => {
      const gate = name.replace("SPP", "TPP").replace(/^S/, "T");
      return `${indent}${gate}${tag ? `[${tag}]` : ""}`;
    });
    line = line.replace(/^(\s*)(I|SPP)\[(R_[XYZ]|R_PAULI|U3)\(([^\]\n]*)\)\](?=\s|$)/,
      (match, indent, carrier, gate, params) => {
        if ((gate === "R_PAULI") !== (carrier === "SPP")) return match;
        const names = gate === "U3" ? ["theta", "phi", "lambda"] : ["theta"];
        const values = params.split(",");
        if (values.length !== names.length) return match;
        const angles = values.map((value: string, i: number) =>
          new RegExp(`^\\s*${names[i]}=(${FLOAT})\\*pi\\s*$`).exec(value)?.[1]);
        if (angles.some((angle: string | undefined) => angle === undefined)) return match;
        return `${indent}${gate}(${angles.join(", ")})`;
      });
    return line;
  }).join("\n");
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
