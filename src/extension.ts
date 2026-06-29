import * as vscode from "vscode";
import { StimPanel } from "./panel";
import { getGateData, GateInfo } from "./stimEngine";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("stim.visualize", () => {
      const editor = vscode.window.activeTextEditor;
      const lang = editor?.document.languageId;
      if (!editor || (lang !== "stim" && lang !== "dem")) {
        vscode.window.showWarningMessage("Open a .stim or .dem file to visualize it.");
        return;
      }
      StimPanel.createOrShow(context, editor.document);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.languageId === "stim" || doc.languageId === "dem") {
        StimPanel.refreshForDocument(doc);
      }
    })
  );

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider("stim", new StimCompletionProvider()),
    vscode.languages.registerHoverProvider("stim", new StimHoverProvider()),
    vscode.languages.registerSignatureHelpProvider(
      "stim",
      new StimSignatureHelpProvider(),
      "(",
      ","
    )
  );
}

// Gate name -> info, derived once from the compiled stim gate table.
let gateMapPromise: Promise<Map<string, GateInfo>> | undefined;
function gateMap(): Promise<Map<string, GateInfo>> {
  if (!gateMapPromise) {
    gateMapPromise = getGateData()
      .then((gates) => new Map(gates.map((g) => [g.name, g])))
      .catch((e) => {
        gateMapPromise = undefined;
        throw e;
      });
  }
  return gateMapPromise;
}

function categoryLabel(g: GateInfo): string {
  // Category strings carry a sort-order prefix like "C_"; drop it.
  return g.category.replace(/^[A-Z]_/, "");
}

// Completes stim instruction/annotation names at the start of a line, using the
// gate table from the compiled stim build (so it matches the stim version).
class StimCompletionProvider implements vscode.CompletionItemProvider {
  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.CompletionItem[] | undefined> {
    // Instruction names are the first token on a line; only suggest there.
    const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
    if (!/^\s*[A-Za-z0-9_]*$/.test(linePrefix)) {
      return undefined;
    }

    let gates;
    try {
      gates = await getGateData();
    } catch {
      return undefined;
    }

    return gates.map((g) => {
      const isAnnotation = /Annotations|Control Flow/.test(g.category);
      const item = new vscode.CompletionItem(
        g.name,
        isAnnotation
          ? vscode.CompletionItemKind.Keyword
          : vscode.CompletionItemKind.Function
      );
      item.detail = categoryLabel(g);
      if (g.help) {
        item.documentation = new vscode.MarkdownString(g.help);
      }
      // REPEAT opens a block; offer the whole skeleton.
      if (g.name === "REPEAT") {
        item.insertText = new vscode.SnippetString("REPEAT ${1:10} {\n\t$0\n}");
      }
      return item;
    });
  }
}

// Shows the gate's category and help text when hovering its name.
class StimHoverProvider implements vscode.HoverProvider {
  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Hover | undefined> {
    const range = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
    if (!range) {
      return undefined;
    }
    let map: Map<string, GateInfo>;
    try {
      map = await gateMap();
    } catch {
      return undefined;
    }
    const g = map.get(document.getText(range));
    if (!g) {
      return undefined;
    }
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${g.name}** (${categoryLabel(g)})\n\n`);
    if (g.help) {
      md.appendMarkdown(g.help);
    }
    return new vscode.Hover(md, range);
  }
}

// Shows the argument signature while typing inside an instruction's parens.
// `args` from the gate table is the parenthesised argument count; 0 means none
// and the sentinel values (>= 254) mean a variable number.
class StimSignatureHelpProvider implements vscode.SignatureHelpProvider {
  async provideSignatureHelp(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.SignatureHelp | undefined> {
    const line = document.lineAt(position.line).text;
    const prefix = line.slice(0, position.character);
    const open = prefix.lastIndexOf("(");
    // Only inside an unclosed paren group.
    if (open === -1 || prefix.lastIndexOf(")") > open) {
      return undefined;
    }
    const nameMatch = /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(line);
    if (!nameMatch) {
      return undefined;
    }
    let map: Map<string, GateInfo>;
    try {
      map = await gateMap();
    } catch {
      return undefined;
    }
    const g = map.get(nameMatch[1]);
    if (!g || g.args === 0) {
      return undefined;
    }

    const variadic = g.args >= 254;
    const params = variadic
      ? [new vscode.ParameterInformation("args...")]
      : Array.from(
          { length: g.args },
          (_, i) => new vscode.ParameterInformation(`arg${i + 1}`)
        );
    const label = `${g.name}(${params.map((p) => p.label).join(", ")})`;
    const sig = new vscode.SignatureInformation(label);
    if (g.help) {
      sig.documentation = new vscode.MarkdownString(g.help);
    }
    sig.parameters = params;

    const result = new vscode.SignatureHelp();
    result.signatures = [sig];
    result.activeSignature = 0;
    const commas = (prefix.slice(open + 1).match(/,/g) || []).length;
    result.activeParameter = Math.min(commas, params.length - 1);
    return result;
  }
}

export function deactivate() {}
