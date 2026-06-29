import * as vscode from "vscode";
import { StimPanel } from "./panel";

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
}

export function deactivate() {}
