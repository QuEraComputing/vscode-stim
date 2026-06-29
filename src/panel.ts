import * as vscode from "vscode";
import {
  renderDiagram,
  renderDiagramFull,
  countTicks,
  isHtmlDiagram,
  DiagramType,
} from "./stimEngine";

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
}

export class StimPanel {
  public static readonly viewType = "stim.visualizer";
  private static panels = new Map<string, StimPanel>();

  private base: BaseType = "timeline";
  private withOps = false; // detslice: include operations overlay
  private withoutNoise = false;
  private full = false;
  private threeD = false; // timeline/matchgraph: interactive 3D viewer
  private approxDisjoint = true; // matchgraph: approximate_disjoint_errors
  private tick = 1;
  private rows = 0; // full mode: layout rows (0 = stim auto)
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
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "stim-logo.svg");
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
    this.loadState();
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
      this.panel.webview.postMessage({
        command: "init",
        bases: BASE_TYPES,
        tickDependentBases: TICK_DEPENDENT_BASES,
        dimCapableBases: DIM_CAPABLE_BASES,
        base: this.base,
        withOps: this.withOps,
        withoutNoise: this.withoutNoise,
        full: this.full,
        threeD: this.threeD,
        approxDisjoint: this.approxDisjoint,
        tick: this.tick,
        rows: this.rows,
      });
      this.refresh();
    } else if (msg.command === "refresh") {
      // Requested by the webview after the panel finishes resizing.
      this.refresh();
    } else if (msg.command === "copySvg") {
      void vscode.env.clipboard.writeText(String(msg.svg ?? ""));
    } else if (msg.command === "setBase") {
      this.base = msg.base;
      this.refresh();
    } else if (msg.command === "setThreeD") {
      this.threeD = !!msg.value;
      this.refresh();
    } else if (msg.command === "setApproxDisjoint") {
      this.approxDisjoint = !!msg.value;
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
    const text = this.doc.getText();
    const type = this.currentType();
    const dependent = this.isTickDependent();
    // "without noise" only applies where the toggle is shown: not for the match
    // graph (built from the noise), and for detslice only with the ops overlay.
    // Force it off elsewhere so a remembered value isn't silently applied.
    const noiseApplies =
      this.base !== "matchgraph" && !(this.base === "detslice" && !this.withOps);
    const withoutNoise = noiseApplies ? this.withoutNoise : false;
    try {
      // Slice diagrams index by tick. Clamp the requested tick to the valid
      // range [1, count_ticks]; out-of-range ticks make stim divide by zero.
      let tickMax = 0;
      if (dependent) {
        tickMax = await countTicks(text);
        if (tickMax <= 0) {
          throw new Error(
            "Circuit has no TICK instructions; slice diagrams are unavailable."
          );
        }
        this.tick = Math.min(Math.max(1, this.tick), tickMax);
      }

      if (isHtmlDiagram(type)) {
        // Interactive 3D viewer: a full HTML page rendered in an iframe.
        const html = await renderDiagram(text, type, 0, withoutNoise, this.approxDisjoint);
        this.panel.webview.postMessage({ command: "html", html, type });
      } else if (this.full && dependent) {
        // One combined diagram of every tick, laid out in `rows` rows.
        const svg = await renderDiagramFull(text, type, this.rows, withoutNoise, this.approxDisjoint);
        this.panel.webview.postMessage({
          command: "svg",
          svg,
          type,
          tick: this.tick,
          tickMax,
          tickShown: false,
        });
      } else {
        const svg = await renderDiagram(text, type, this.tick, withoutNoise, this.approxDisjoint);
        this.panel.webview.postMessage({
          command: "svg",
          svg,
          type,
          tick: this.tick,
          tickMax,
          tickShown: dependent,
        });
      }
    } catch (e: any) {
      this.panel.webview.postMessage({
        command: "error",
        message: String(e?.message ?? e),
      });
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
    <button id="toggle-full" class="switch" aria-pressed="false" title="Show all ticks in one combined diagram (slice diagrams only)">
      <span class="switch-track"><span class="switch-knob"></span></span>
      <span class="switch-label">full</span>
    </button>
    <span id="rows-control">
      <label for="rows-input">rows</label>
      <input id="rows-input" type="number" min="1" step="1" placeholder="auto"
             title="Number of rows in the combined view (blank = automatic)" />
    </span>
    <div id="tick-control">
      <div class="stepper">
        <button id="tick-prev" class="step" title="Previous layer (← or q; shift+q = −5, home = first)">◀</button>
        <input id="tick-value" class="step-value" type="number" min="1" step="1" value="1"
               aria-label="Current layer" title="Layer number — type to jump (clamped to range)" />
        <button id="tick-next" class="step" title="Next layer (→ or e; shift+e = +5, end = last)">▶</button>
      </div>
    </div>
  </div>
  <div id="view"></div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
