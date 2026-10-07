import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { execFile } from "child_process";
import {
  renderDiagram,
  renderDiagramFull,
  renderDemDiagram,
  lastSliceTick,
  withoutNoiseText,
  getCircuitStats,
  getDemStats,
  getCircuitDemStats,
  isHtmlDiagram,
  DiagramType,
  DemDiagramType,
} from "./stimEngine";
import { shorthandToStim, toPlaceholders, relabelSvg, explainStimError } from "./tsim";

// Base diagram families shown in the segmented control. The actual stim
// diagram-type string is derived from the base plus its sub-toggles.
type BaseType = "timeline" | "timeslice" | "detslice" | "matchgraph";

const BASE_TYPES: { id: BaseType; label: string; short: string }[] = [
  { id: "timeline", label: "timeline", short: "line" },
  { id: "timeslice", label: "timeslice", short: "slice" },
  { id: "detslice", label: "detslice", short: "det" },
  { id: "matchgraph", label: "matchgraph", short: "m" },
];

// Bases that render a per-tick slice (so they get the tick stepper + full mode).
const TICK_DEPENDENT_BASES: BaseType[] = ["timeslice", "detslice"];

// Bases that also have an interactive 3D form (the 2d|3d toggle).
const DIM_CAPABLE_BASES: BaseType[] = ["timeline", "matchgraph"];

// A titled group of label/value rows in the info tooltip.
interface StatSection {
  title: string;
  rows: [string, string | number][];
}

// Persisted toolbar selections, restored when a new panel opens.
const STATE_KEY = "stim.viewState";

interface PersistedState {
  base: BaseType;
  threeD: boolean;
  withOps: boolean;
  withoutNoise: boolean;
  full: boolean;
  rows: number;
  approxDisjoint: boolean;
  decomposeErrors: boolean;
}

export class StimPanel {
  public static readonly viewType = "stim.visualizer";
  private static panels = new Map<string, StimPanel>();

  // "dem" documents are detector error models: only the match graph applies.
  private readonly kind: "circuit" | "dem";
  private base: BaseType = "timeline";
  private withOps = false; // detslice: include operations overlay
  private withoutNoise = false;
  private full = false;
  private threeD = false; // timeline/matchgraph: interactive 3D viewer
  private approxDisjoint = true; // matchgraph: approximate_disjoint_errors
  private decomposeErrors = false; // matchgraph: split hyperedges into pairs
  private tick = 0; // slice index; stim ticks are 0-based (0 = first layer)
  private rows = 0; // full mode: layout rows (0 = stim auto)
  private refreshSeq = 0; // bumped per refresh; superseded refreshes post nothing
  private disposables: vscode.Disposable[] = [];

  static createOrShow(context: vscode.ExtensionContext, doc: vscode.TextDocument) {
    const key = doc.uri.toString();
    const existing = StimPanel.panels.get(key);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      StimPanel.viewType,
      doc.uri.path.split("/").pop() || "stim",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
      }
    );
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "vscode-stim.svg");
    StimPanel.panels.set(key, new StimPanel(panel, context, doc));
  }

  static refreshForDocument(doc: vscode.TextDocument) {
    StimPanel.panels.get(doc.uri.toString())?.refresh();
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly doc: vscode.TextDocument
  ) {
    this.kind = doc.languageId === "dem" ? "dem" : "circuit";
    this.loadState();
    if (this.kind === "dem") {
      this.base = "matchgraph"; // the only diagram a DEM supports
    }
    this.panel.webview.html = this.getHtml();
    this.panel.webview.onDidReceiveMessage(
      (msg) => this.onMessage(msg),
      null,
      this.disposables
    );
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  // Restore the last-used toolbar selections (if any).
  private loadState() {
    const s = this.context.globalState.get<PersistedState>(STATE_KEY);
    if (!s) {
      return;
    }
    if (BASE_TYPES.some((b) => b.id === s.base)) {
      this.base = s.base;
    }
    this.threeD = !!s.threeD;
    this.withOps = !!s.withOps;
    this.withoutNoise = !!s.withoutNoise;
    this.full = !!s.full;
    this.rows = Number.isInteger(s.rows) && s.rows > 0 ? s.rows : 0;
    // Defaults to on; only a persisted explicit `false` turns it off.
    if (typeof s.approxDisjoint === "boolean") {
      this.approxDisjoint = s.approxDisjoint;
    }
    this.decomposeErrors = !!s.decomposeErrors;
  }

  private saveState() {
    const s: PersistedState = {
      base: this.base,
      threeD: this.threeD,
      withOps: this.withOps,
      withoutNoise: this.withoutNoise,
      full: this.full,
      rows: this.rows,
      approxDisjoint: this.approxDisjoint,
      decomposeErrors: this.decomposeErrors,
    };
    void this.context.globalState.update(STATE_KEY, s);
  }

  private isDimCapable(): boolean {
    return DIM_CAPABLE_BASES.includes(this.base);
  }

  // 3D is only meaningful for bases that have a 3D form; the remembered flag is
  // ignored elsewhere. This keeps the stale flag from leaking into other bases.
  private effectiveThreeD(): boolean {
    return this.threeD && this.isDimCapable();
  }

  // Resolve the current stim diagram-type string from the UI state.
  private currentType(): DiagramType {
    switch (this.base) {
      case "timeline":
        return this.effectiveThreeD() ? "timeline-3d-html" : "timeline-svg";
      case "timeslice":
        return "timeslice-svg";
      case "detslice":
        return this.withOps ? "detslice-with-ops-svg" : "detslice-svg";
      case "matchgraph":
        return this.effectiveThreeD() ? "matchgraph-3d-html" : "matchgraph-svg";
    }
  }

  // Tick-dependent bases (timeslice, detslice) are disjoint from the 3D-capable
  // ones, so this never needs to consult the 3D flag.
  private isTickDependent(): boolean {
    return TICK_DEPENDENT_BASES.includes(this.base);
  }

  private onMessage(msg: any) {
    if (msg.command === "ready") {
      const dem = this.kind === "dem";
      this.panel.webview.postMessage({
        command: "init",
        kind: this.kind,
        // A DEM only supports the match graph; circuits get the full set.
        bases: dem ? BASE_TYPES.filter((b) => b.id === "matchgraph") : BASE_TYPES,
        tickDependentBases: dem ? [] : TICK_DEPENDENT_BASES,
        dimCapableBases: DIM_CAPABLE_BASES,
        base: this.base,
        withOps: this.withOps,
        withoutNoise: this.withoutNoise,
        full: this.full,
        threeD: this.threeD,
        approxDisjoint: this.approxDisjoint,
        decomposeErrors: this.decomposeErrors,
        tick: this.tick,
        rows: this.rows,
      });
      this.refresh();
    } else if (msg.command === "copySvg") {
      void this.copySvgToClipboard(String(msg.svg ?? ""));
    } else if (msg.command === "saveSvg") {
      void this.saveSvgToFile(String(msg.svg ?? ""));
    } else if (msg.command === "setBase") {
      this.base = msg.base;
      this.refresh();
    } else if (msg.command === "setThreeD") {
      this.threeD = !!msg.value;
      this.refresh();
    } else if (msg.command === "setApproxDisjoint") {
      this.approxDisjoint = !!msg.value;
      this.refresh();
    } else if (msg.command === "setDecomposeErrors") {
      this.decomposeErrors = !!msg.value;
      this.refresh();
    } else if (msg.command === "setWithOps") {
      this.withOps = !!msg.value;
      this.refresh();
    } else if (msg.command === "setWithoutNoise") {
      this.withoutNoise = !!msg.value;
      this.refresh();
    } else if (msg.command === "setFull") {
      this.full = !!msg.value;
      this.refresh();
    } else if (msg.command === "setTick") {
      this.tick = msg.tick;
      this.refresh();
    } else if (msg.command === "setRows") {
      // 0 (or invalid) means stim's automatic layout.
      const r = Number(msg.rows);
      this.rows = Number.isInteger(r) && r > 0 ? r : 0;
      this.refresh();
    }

    // Persist toolbar selections (tick is per-circuit, so it's excluded).
    if (typeof msg.command === "string" && msg.command.startsWith("set") && msg.command !== "setTick") {
      this.saveState();
    }
  }

  async refresh() {
    const seq = ++this.refreshSeq;
    if (this.kind === "dem") {
      await this.refreshDem(this.doc.getText(), seq);
      return;
    }
    // Lower tsim shorthand (T, R_X, ...) to tagged stim. Used for every stim
    // call so the circuit parses and simulates as its Clifford stand-in.
    let text: string;
    try {
      text = shorthandToStim(this.doc.getText());
    } catch (e: any) {
      this.postStats(seq, null);
      this.post(seq, { command: "error", message: String(e?.message ?? e) });
      return;
    }
    void this.sendStats(text, seq);
    const type = this.currentType();
    const dependent = this.isTickDependent();
    // tsim gates are relabeled only on the pure-layout op diagrams.
    const relabel = type === "timeline-svg" || type === "timeslice-svg";
    // "without noise" only applies where the toggle is shown: not for the match
    // graph (built from the noise), and for detslice only with the ops overlay.
    const noiseApplies =
      this.base !== "matchgraph" && !(this.base === "detslice" && !this.withOps);
    const wantNoiseStrip = noiseApplies && this.withoutNoise;
    // On the relabel path the placeholders are themselves I_ERROR ops, so we
    // strip noise from the circuit up front instead of during the render.
    const withoutNoise = relabel ? false : wantNoiseStrip;
    try {
      // Check parseability up front so every diagram path reports the offending
      // line(s) instead of stim's opaque error (or a bare "could not parse").
      const parseProblem = await this.parseError(text);
      if (parseProblem) {
        throw new Error(parseProblem);
      }
      // Slice diagrams index by tick. stim ticks are 0-based, so a circuit with
      // N TICKs has slices 0..N (N+1 layers); tick N+1 makes stim divide by
      // zero. Slices closed by trailing TICKs are empty (and stim can't render
      // the final one), so lastSliceTick drops them from the range. Non-slice
      // renders report no range (null).
      let tickMax: number | null = null;
      let tick = this.tick;
      if (dependent) {
        tickMax = await lastSliceTick(text);
        if (tickMax < 0) {
          throw new Error("Circuit could not be parsed.");
        }
        tick = Math.min(Math.max(0, tick), tickMax);
        if (seq === this.refreshSeq) {
          this.tick = tick;
        }
      }

      // For relabeled diagrams, render placeholders then swap them for gate
      // labels; otherwise render the lowered circuit directly. When "without
      // noise" is on, strip noise from the circuit before making placeholders
      // (the placeholders are noise ops themselves).
      const baseText = relabel && wantNoiseStrip ? await withoutNoiseText(text) : text;
      const ph = relabel ? toPlaceholders(baseText) : null;
      const src = ph ? ph.text : text;
      const finish = (svg: string) => (ph ? relabelSvg(svg, ph.labels) : svg);

      if (isHtmlDiagram(type)) {
        // Interactive 3D viewer: a full HTML page rendered in an iframe.
        const html = await renderDiagram(
          text, type, 0, withoutNoise, this.approxDisjoint, this.decomposeErrors
        );
        this.post(seq, { command: "html", html, type });
      } else if (this.full && dependent) {
        // One combined diagram of every tick, laid out in `rows` rows.
        const svg = await renderDiagramFull(
          src, type, this.rows, withoutNoise, this.approxDisjoint, this.decomposeErrors
        );
        this.post(seq, {
          command: "svg",
          svg: finish(svg),
          type,
          tick,
          tickMax,
          tickShown: false,
        });
      } else {
        const svg = await renderDiagram(
          src, type, tick, withoutNoise, this.approxDisjoint, this.decomposeErrors
        );
        this.post(seq, {
          command: "svg",
          svg: finish(svg),
          type,
          tick,
          tickMax,
          tickShown: dependent,
        });
      }
    } catch (e: any) {
      this.post(seq, { command: "error", message: String(e?.message ?? e) });
    }
  }

  // Post a refresh result unless a newer refresh has started since, so a slow
  // render or stats call can't overwrite what a later refresh already showed.
  private post(seq: number, msg: object) {
    if (seq === this.refreshSeq) {
      this.panel.webview.postMessage(msg);
    }
  }

  // A user-facing explanation of why the (lowered) circuit can't be parsed, or
  // null if it parses. Asks stim, then maps its error to the offending line.
  private async parseError(text: string): Promise<string | null> {
    const stats = await getCircuitStats(text);
    return stats.error ? explainStimError(text, stats.error) : null;
  }

  // Render the match graph straight from a detector error model.
  private async refreshDem(text: string, seq: number) {
    void this.sendDemStats(text, seq);
    const type: DemDiagramType = this.effectiveThreeD()
      ? "matchgraph-3d-html"
      : "matchgraph-svg";
    try {
      const out = await renderDemDiagram(text, type);
      if (isHtmlDiagram(type)) {
        this.post(seq, { command: "html", html: out, type });
      } else {
        this.post(seq, { command: "svg", svg: out, type, tickShown: false });
      }
    } catch (e: any) {
      this.post(seq, { command: "error", message: String(e?.message ?? e) });
    }
  }

  // Post titled sections to the info tooltip (null = parse error).
  private postStats(seq: number, sections: StatSection[] | null) {
    this.post(seq, { command: "stats", sections });
  }

  // Format the shortest graphlike error (graphlike distance); -1 means stim
  // could not compute one (e.g. no logical observable).
  private static distanceValue(d: number): string | number {
    return d >= 0 ? d : "n/a";
  }

  // Send circuit summary counts to the webview's info tooltip. When the match
  // graph is selected, add a "Detector Error Model" section with its stats.
  private async sendStats(text: string, seq: number) {
    try {
      const s = await getCircuitStats(text);
      if (s.error) {
        this.postStats(seq, null);
        return;
      }
      const sections: StatSection[] = [
        {
          title: "Circuit",
          rows: [
            ["Qubits", s.qubits],
            ["Measurements", s.measurements],
            ["Detectors", s.detectors],
            ["Observables", s.observables],
            ["Ticks", s.ticks],
            ["Sweep bits", s.sweepBits],
          ],
        },
      ];
      if (this.base === "matchgraph") {
        try {
          const d = await getCircuitDemStats(text, this.approxDisjoint, this.decomposeErrors);
          if (!d.error) {
            sections.push({
              title: "Detector Error Model",
              rows: [
                ["Errors", d.errors],
                ["Shortest graphlike error", StimPanel.distanceValue(d.shortestGraphlikeError)],
              ],
            });
          }
        } catch {
          // Leave the circuit section as-is if the DEM build fails.
        }
      }
      this.postStats(seq, sections);
    } catch {
      // Ignore; the tooltip just keeps its previous content.
    }
  }

  // Send detector-error-model counts to the webview's info tooltip.
  private async sendDemStats(text: string, seq: number) {
    try {
      const s = await getDemStats(text);
      if (s.error) {
        this.postStats(seq, null);
        return;
      }
      this.postStats(seq, [
        {
          title: "Detector Error Model",
          rows: [
            ["Detectors", s.detectors],
            ["Observables", s.observables],
            ["Errors", s.errors],
            ["Shortest graphlike error", StimPanel.distanceValue(s.shortestGraphlikeError)],
          ],
        },
      ]);
    } catch {
      // Ignore; the tooltip just keeps its previous content.
    }
  }

  // Put the SVG on the clipboard as a *file reference* (like copying a .svg in
  // Finder), so PowerPoint pastes it as a vector picture. macOS only, via
  // osascript; elsewhere we fall back to copying the markup as text.
  private async copySvgToClipboard(svg: string) {
    if (process.platform !== "darwin") {
      await vscode.env.clipboard.writeText(svg);
      vscode.window.showInformationMessage(
        "Copied the SVG markup. Pasting as a file is only supported on macOS."
      );
      return;
    }
    try {
      const dir = path.join(os.tmpdir(), "stim-vscode");
      await fs.promises.mkdir(dir, { recursive: true });
      const base = (this.doc.uri.path.split("/").pop() || "diagram").replace(/\.stim$/, "");
      const typeName = this.currentType().replace(/-svg$/, "");
      const file = path.join(dir, `${base}-${typeName}.svg`);
      await fs.promises.writeFile(file, svg, "utf8");
      await new Promise<void>((resolve, reject) => {
        execFile(
          "osascript",
          ["-e", `set the clipboard to POSIX file ${JSON.stringify(file)}`],
          (err) => (err ? reject(err) : resolve())
        );
      });
    } catch (e: any) {
      await vscode.env.clipboard.writeText(svg);
      vscode.window.showWarningMessage(
        `Could not copy the SVG file to the clipboard (${String(
          e?.message ?? e
        )}); copied the markup instead.`
      );
    }
  }

  // Suggest a filename from the document + diagram type, then save the SVG to
  // wherever the user picks in the native save dialog.
  private async saveSvgToFile(svg: string) {
    const base = (this.doc.uri.path.split("/").pop() || "diagram").replace(/\.stim$/, "");
    const typeName = this.currentType().replace(/-svg$/, "");
    const defaultName = `${base}-${typeName}.svg`;
    const defaultUri =
      this.doc.uri.scheme === "file"
        ? vscode.Uri.joinPath(vscode.Uri.file(path.dirname(this.doc.uri.fsPath)), defaultName)
        : vscode.Uri.file(defaultName);
    const target = await vscode.window.showSaveDialog({
      defaultUri,
      saveLabel: "Save diagram",
      filters: { "SVG image": ["svg"] },
    });
    if (!target) return; // dialog cancelled
    try {
      await fs.promises.writeFile(target.fsPath, svg, "utf8");
    } catch (e: any) {
      vscode.window.showErrorMessage(`Could not save the SVG: ${String(e?.message ?? e)}`);
    }
  }

  private dispose() {
    StimPanel.panels.delete(this.doc.uri.toString());
    while (this.disposables.length) this.disposables.pop()?.dispose();
    this.panel.dispose();
  }

  private getHtml(): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "main.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "style.css")
    );
    // The 3D viewers (timeline-3d / matchgraph-3d) are stim-generated HTML that
    // loads THREE.js from unpkg and embeds the model as a data: URI, shown in an
    // iframe. That requires a relaxed CSP (the CDN + inline + data:); the SVG
    // views don't need it but share this policy.
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data: https:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src ${webview.cspSource} 'unsafe-inline' https://unpkg.com`,
      "connect-src https://unpkg.com data:",
      `font-src ${webview.cspSource} data:`,
      "frame-src 'self'",
    ].join("; ");
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp};" />
<link href="${styleUri}" rel="stylesheet" />
</head>
<body>
  <div id="toolbar">
    <div id="type-seg" class="segmented"></div>
    <div id="dim-seg" class="segmented dim-seg">
      <button id="dim-2d" class="seg-btn" data-dim="2d">2d</button>
      <button id="dim-3d" class="seg-btn" data-dim="3d">3d</button>
    </div>
    <button id="toggle-ops" class="switch" aria-pressed="false" title="Overlay operations on the detector slice (detslice-with-ops-svg)">
      <span class="switch-track"><span class="switch-knob"></span></span>
      <span class="switch-label">with ops</span>
    </button>
    <button id="toggle-noise" class="switch" aria-pressed="false" title="Render the circuit with all noise operations removed (stim.Circuit.without_noise)">
      <span class="switch-track"><span class="switch-knob"></span></span>
      <span class="switch-label">without noise</span>
    </button>
    <button id="toggle-approx" class="switch" aria-pressed="true" title="Enable approximate_disjoint_errors when building the match graph (needed for e.g. PAULI_CHANNEL_2)">
      <span class="switch-track"><span class="switch-knob"></span></span>
      <span class="switch-label">approx. disjoint errors</span>
    </button>
    <button id="toggle-decompose" class="switch" aria-pressed="false" title="Decompose errors: split hyperedges into pairs when building the match graph">
      <span class="switch-track"><span class="switch-knob"></span></span>
      <span class="switch-label">decompose errors</span>
    </button>
    <button id="toggle-full" class="switch" aria-pressed="false" title="Show all ticks in one combined diagram (slice diagrams only)">
      <span class="switch-track"><span class="switch-knob"></span></span>
      <span class="switch-label">all ticks</span>
    </button>
    <span id="rows-control">
      <label for="rows-input">rows</label>
      <input id="rows-input" type="number" min="1" step="1" placeholder="auto"
             title="Number of rows in the combined view (blank = automatic)" />
    </span>
    <div id="tick-control">
      <div class="stepper">
        <button id="tick-prev" class="step" title="Previous layer (← or q; shift+q = −5, home = first)">◀</button>
        <input id="tick-value" class="step-value" type="number" min="0" step="1" value="0"
               aria-label="Current layer" title="Layer number (0-based) — type to jump (clamped to range)" />
        <button id="tick-next" class="step" title="Next layer (→ or e; shift+e = +5, end = last)">▶</button>
      </div>
    </div>
    <span id="right-tools">
      <button id="save-btn" aria-label="Save diagram as SVG"></button>
      <button id="copy-btn" aria-label="Copy diagram as SVG"></button>
      <span id="info-wrap">
        <button id="info-btn" aria-label="Circuit info">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        </button>
        <div id="info-tip" role="tooltip"></div>
      </span>
    </span>
  </div>
  <div id="view"></div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
