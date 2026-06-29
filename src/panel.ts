import * as vscode from "vscode";
import { renderDiagram, countTicks, DiagramType } from "./stimEngine";

// Base diagram families shown in the segmented control. The actual stim
// diagram-type string is derived from the base plus its sub-toggles.
type BaseType = "timeline" | "timeslice" | "detslice" | "matchgraph";

const BASE_TYPES: { id: BaseType; label: string }[] = [
  { id: "timeline", label: "timeline" },
  { id: "timeslice", label: "timeslice" },
  { id: "detslice", label: "detslice" },
  { id: "matchgraph", label: "matchgraph" },
];

// Bases that render a per-tick slice (so they get the tick stepper + full mode).
const TICK_DEPENDENT_BASES: BaseType[] = ["timeslice", "detslice"];

export class StimPanel {
  public static readonly viewType = "stim.visualizer";
  private static panels = new Map<string, StimPanel>();

  private base: BaseType = "timeline";
  private withOps = false; // detslice: include operations overlay
  private withoutNoise = false;
  private full = false;
  private tick = 1;
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
      `Stim: ${doc.uri.path.split("/").pop()}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
      }
    );
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
    this.panel.webview.html = this.getHtml();
    this.panel.webview.onDidReceiveMessage(
      (msg) => this.onMessage(msg),
      null,
      this.disposables
    );
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  // Resolve the current stim diagram-type string from the UI state.
  private currentType(): DiagramType {
    switch (this.base) {
      case "timeline":
        return "timeline-svg";
      case "timeslice":
        return "timeslice-svg";
      case "detslice":
        return this.withOps ? "detslice-with-ops-svg" : "detslice-svg";
      case "matchgraph":
        return "matchgraph-svg";
    }
  }

  private isTickDependent(): boolean {
    return TICK_DEPENDENT_BASES.includes(this.base);
  }

  private onMessage(msg: any) {
    if (msg.command === "ready") {
      this.panel.webview.postMessage({
        command: "init",
        bases: BASE_TYPES,
        tickDependentBases: TICK_DEPENDENT_BASES,
        base: this.base,
        withOps: this.withOps,
        withoutNoise: this.withoutNoise,
        full: this.full,
        tick: this.tick,
      });
      this.refresh();
    } else if (msg.command === "setBase") {
      this.base = msg.base;
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
    }
  }

  async refresh() {
    const text = this.doc.getText();
    const type = this.currentType();
    const dependent = this.isTickDependent();
    // The match graph is built from the circuit's noise, so always render it
    // with noise even if the (hidden) "without noise" toggle was left on.
    const withoutNoise = this.base === "matchgraph" ? false : this.withoutNoise;
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

      if (this.full && dependent) {
        await this.refreshFull(text, type, tickMax, withoutNoise);
      } else {
        const svg = await renderDiagram(text, type, this.tick, withoutNoise);
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

  // Full mode: render one slice per tick (1..count_ticks), stacked in the
  // webview. Ticks that fail to render for this diagram type are skipped.
  private async refreshFull(
    text: string,
    type: DiagramType,
    n: number,
    withoutNoise: boolean
  ) {
    const items: { tick: number; svg: string }[] = [];
    for (let t = 1; t <= n; t++) {
      try {
        const svg = await renderDiagram(text, type, t, withoutNoise);
        items.push({ tick: t, svg });
      } catch {
        // Skip ticks that cannot be rendered for this diagram type.
      }
    }
    if (items.length === 0) {
      throw new Error("No renderable ticks for this diagram type.");
    }
    this.panel.webview.postMessage({ command: "svgList", type, items });
  }

  private dispose() {
    StimPanel.panels.delete(this.doc.uri.toString());
    while (this.disposables.length) this.disposables.pop()?.dispose();
    this.panel.dispose();
  }

  private getHtml(): string {
    const webview = this.panel.webview;
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "main.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "style.css")
    );
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<link href="${styleUri}" rel="stylesheet" />
</head>
<body>
  <div id="toolbar">
    <div id="type-seg" class="segmented"></div>
    <button id="toggle-ops" class="switch" aria-pressed="false" title="Overlay operations on the detector slice (detslice-with-ops-svg)">
      <span class="switch-track"><span class="switch-knob"></span></span>
      <span class="switch-label">with ops</span>
    </button>
    <button id="toggle-noise" class="switch" aria-pressed="false" title="Render the circuit with all noise operations removed (stim.Circuit.without_noise)">
      <span class="switch-track"><span class="switch-knob"></span></span>
      <span class="switch-label">without noise</span>
    </button>
    <button id="toggle-full" class="switch" aria-pressed="false" title="Show every tick stacked vertically (slice diagrams only)">
      <span class="switch-track"><span class="switch-knob"></span></span>
      <span class="switch-label">full</span>
    </button>
    <div id="tick-control">
      <div class="stepper">
        <button id="tick-prev" class="step" title="Previous tick (←)">◀</button>
        <span id="tick-value" class="step-value">1</span>
        <button id="tick-next" class="step" title="Next tick (→)">▶</button>
      </div>
    </div>
  </div>
  <div id="view"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}
