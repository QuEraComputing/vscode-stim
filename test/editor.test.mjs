import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { buildSync } from "esbuild";

const require = createRequire(import.meta.url);

test("editor providers expose native non-Clifford gates, aliases, and signatures", async () => {
  const providers = {};
  class MarkdownString {
    constructor(value = "") { this.value = value; }
    appendMarkdown(value) { this.value += value; }
  }
  class Item {
    constructor(label) { this.label = label; }
  }
  const vscode = {
    commands: { registerCommand() {} },
    workspace: { onDidSaveTextDocument() {} },
    languages: {
      registerCompletionItemProvider(_language, provider) { providers.completion = provider; },
      registerHoverProvider(_language, provider) { providers.hover = provider; },
      registerSignatureHelpProvider(_language, provider) { providers.signature = provider; },
    },
    CompletionItem: Item,
    CompletionItemKind: { Keyword: 1, Function: 2 },
    MarkdownString,
    SnippetString: Item,
    ParameterInformation: Item,
    SignatureInformation: Item,
    SignatureHelp: class {},
    Hover: class { constructor(contents) { this.contents = contents; } },
  };
  const bundle = buildSync({
    entryPoints: [fileURLToPath(new URL("../src/extension.ts", import.meta.url))],
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["vscode"],
    write: false,
  }).outputFiles[0].text;
  const module = { exports: {} };
  vm.runInNewContext(bundle, {
    module, exports: module.exports,
    require: name => name === "vscode" ? vscode : require(name),
    __dirname: fileURLToPath(new URL("../dist", import.meta.url)),
  });
  module.exports.activate({ subscriptions: [] });
  const document = text => ({
    lineAt: () => ({ text }),
    getWordRangeAtPosition: () => ({}),
    getText: () => text.split(/[[(\s]/)[0],
  });
  const completions = await providers.completion.provideCompletionItems(document(""), { line: 0, character: 0 });
  for (const name of ["TPP", "TPP_DAG", "R_XX", "R_YY", "R_PAULI", "CS", "CCZ", "CCX", "U"]) {
    const item = completions.find(item => item.label === name);
    assert.ok(item, `missing completion for ${name}`);
    assert.ok(item.documentation.value.length > 0);
  }
  const hover = await providers.hover.provideHover(document("R_Pauli"), { line: 0, character: 2 });
  assert.match(hover.contents.value, /draw-only/);
  for (const [text, count] of [["R_XX(0.25,", 1], ["R_Pauli(0.25", 1], ["u(0.1, 0.2,", 3]]) {
    const help = await providers.signature.provideSignatureHelp(document(text), { line: 0, character: text.length });
    assert.equal(help.signatures[0].parameters.length, count);
    assert.equal(help.activeParameter, Math.min((text.match(/,/g) || []).length, count - 1));
  }
});
