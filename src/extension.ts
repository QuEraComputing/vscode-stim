import * as vscode from "vscode";
import { StimPanel } from "./panel";
import { getGateData } from "./stimEngine";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("stim.visualize", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "stim") {
        vscode.window.showWarningMessage("Open a .stim file to visualize it.");
        return;
      }
      StimPanel.createOrShow(context, editor.document);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.languageId === "stim") {
        StimPanel.refreshForDocument(doc);
      }
    })
  );

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider("stim", new StimCompletionProvider())
  );
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
      // Category strings carry a sort-order prefix like "C_"; drop it.
      item.detail = g.category.replace(/^[A-Z]_/, "");
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

export function deactivate() {}
