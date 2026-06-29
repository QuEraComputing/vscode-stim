import * as vscode from "vscode";
import {
  renderDiagram,
  SVG_DIAGRAM_TYPES,
  TICK_DEPENDENT,
  DiagramType,
} from "./stimEngine";

export class StimPanel {
  public static readonly viewType = "stim.visualizer";
  private static panels = new Map<string, StimPanel>();

  private currentType: DiagramType = "timeline-svg";
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

  private onMessage(msg: any) {
    if (msg.command === "ready") {
      this.panel.webview.postMessage({
        command: "init",
        types: SVG_DIAGRAM_TYPES,
        tickDependent: [...TICK_DEPENDENT],
        current: this.currentType,
        tick: this.tick,
      });
      this.refresh();
    } else if (msg.command === "setType") {
      this.currentType = msg.type;
      this.refresh();
    } else if (msg.command === "setTick") {
      this.tick = msg.tick;
      this.refresh();
    }
  }

  async refresh() {
    this.panel.webview.postMessage({ command: "loading" });
    try {
      const text = this.doc.getText();
      const svg = await renderDiagram(text, this.currentType, this.tick);
      this.panel.webview.postMessage({
        command: "svg",
        svg,
        type: this.currentType,
        tick: this.tick,
        tickShown: TICK_DEPENDENT.has(this.currentType),
      });
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
    <div id="tick-control">
      <button id="tick-prev">◀</button>
      <span>tick <span id="tick-value">1</span></span>
      <button id="tick-next">▶</button>
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
