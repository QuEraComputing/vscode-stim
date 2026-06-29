import * as vscode from "vscode";
import {
  renderDiagram,
  countTicks,
  SVG_DIAGRAM_TYPES,
  TICK_DEPENDENT,
  DiagramType,
} from "./stimEngine";

export class StimPanel {
  public static readonly viewType = "stim.visualizer";
  private static panels = new Map<string, StimPanel>();

  private currentType: DiagramType = "timeline-svg";
  private tick = 1;
  private withoutNoise = false;
  private full = false;
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

  private onMessage(msg: any) {
    if (msg.command === "ready") {
      this.panel.webview.postMessage({
        command: "init",
        types: SVG_DIAGRAM_TYPES,
        tickDependent: [...TICK_DEPENDENT],
        current: this.currentType,
        tick: this.tick,
        withoutNoise: this.withoutNoise,
        full: this.full,
      });
      this.refresh();
    } else if (msg.command === "setType") {
      this.currentType = msg.type;
      this.refresh();
    } else if (msg.command === "setTick") {
      this.tick = msg.tick;
      this.refresh();
    } else if (msg.command === "setWithoutNoise") {
      this.withoutNoise = !!msg.value;
      this.refresh();
    } else if (msg.command === "setFull") {
      this.full = !!msg.value;
      this.refresh();
    }
  }

  async refresh() {
    this.panel.webview.postMessage({ command: "loading" });
    const text = this.doc.getText();
    const useFull = this.full && TICK_DEPENDENT.has(this.currentType);
    try {
      if (useFull) {
        await this.refreshFull(text);
      } else {
        const svg = await renderDiagram(
          text,
          this.currentType,
          this.tick,
          this.withoutNoise
        );
        this.panel.webview.postMessage({
          command: "svg",
          svg,
          type: this.currentType,
          tick: this.tick,
          tickShown: TICK_DEPENDENT.has(this.currentType),
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
  private async refreshFull(text: string) {
    const n = await countTicks(text);
    if (n <= 0) {
      throw new Error("Circuit has no TICK instructions; full mode is unavailable.");
    }
    const items: { tick: number; svg: string }[] = [];
    for (let t = 1; t <= n; t++) {
      try {
        const svg = await renderDiagram(text, this.currentType, t, this.withoutNoise);
        items.push({ tick: t, svg });
      } catch {
        // Skip ticks that cannot be rendered for this diagram type.
      }
    }
    if (items.length === 0) {
      throw new Error("No renderable ticks for this diagram type.");
    }
    this.panel.webview.postMessage({
      command: "svgList",
      type: this.currentType,
      items,
    });
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
    <span class="sep"></span>
    <button id="toggle-noise" class="toggle-btn" title="Render the circuit with all noise operations removed (stim.Circuit.without_noise)">without noise</button>
    <button id="toggle-full" class="toggle-btn" title="Show every tick stacked vertically (slice diagrams only)">full</button>
    <div id="tick-control">
      <button id="tick-prev" title="Previous tick (←)">◀</button>
      <span>tick <span id="tick-value">1</span></span>
      <button id="tick-next" title="Next tick (→)">▶</button>
    </div>
    <span id="status"></span>
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
