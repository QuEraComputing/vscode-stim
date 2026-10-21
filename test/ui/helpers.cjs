const path = require("node:path");
const fs = require("node:fs/promises");
const { before, beforeEach, afterEach } = require("mocha");
const {
  By, until, VSBrowser, WebView, Workbench, TextEditor, EditorView,
} = require("vscode-extension-tester");

const workspace = path.resolve(".ui-tests/workspace");
const driver = () => VSBrowser.instance.driver;
const find = (selector) => driver().findElement(By.css(selector));

async function prepareWorkspace() {
  await fs.mkdir(workspace, { recursive: true });
  for (const name of ["surface.stim", "non_clifford.tsim", "example.dem"]) {
    await fs.copyFile(path.resolve("test/fixtures", name), path.join(workspace, name));
  }
  await fs.writeFile(path.join(workspace, "editable.stim"), "H 0\nM 0\n");
}

async function waitForSvg() {
  return driver().wait(async () => {
    const errors = await driver().findElements(By.css("#view .error"));
    if (errors.length) throw new Error(await errors[0].getText());
    const svgs = await driver().findElements(By.css("#view .zoom-wrap svg"));
    if (!svgs.length) return false;
    const rect = await svgs[0].getRect();
    return rect.width > 0 && rect.height > 0 ? svgs[0] : false;
  }, 15000, "Expected a visible WASM-rendered SVG");
}

async function renderAfter(action) {
  const previous = await find("#view svg");
  await action();
  await driver().wait(until.stalenessOf(previous), 15000, "The diagram did not rerender");
  return waitForSvg();
}

async function setToggle(selector, value) {
  const button = await find(selector);
  if ((await button.getAttribute("aria-pressed")) !== String(value)) {
    await renderAfter(() => button.click());
  }
}

async function selectBase(base) {
  const button = await find(`#type-seg button[title="${base}"]`);
  if (!(await button.getAttribute("class")).split(" ").includes("active")) {
    await renderAfter(() => button.click());
  }
}

async function openVisualizer(name) {
  await VSBrowser.instance.openResources(path.join(workspace, name));
  await new TextEditor().focus();
  await new Workbench().executeCommand("Stim: Visualize Circuit");
  const view = new WebView();
  await view.switchToFrame(15000);
  await waitForSvg();
  if (!name.endsWith(".dem")) {
    // Toolbar choices persist across panels. The full toggle only shows its
    // state on a slice base, so reset it there before returning to timeline.
    await selectBase("timeslice");
    await setToggle("#toggle-full", false);
    await selectBase("timeline");
    await setToggle("#toggle-noise", false);
  }
  return view;
}

// Replace a workspace file's text in the editor and save it, which refreshes
// the visualizer, then switch back into the webview. Reuses the file's editor
// in the left group: reopening the file would add a second editor beside the
// webview, and the two race for focus.
async function editAndSave(view, name, text) {
  await view.switchBack();
  const editor = await new EditorView().openEditor(name, 0);
  await editor.setText(text);
  await editor.save();
  await view.switchToFrame(15000);
}

// Best effort: a broken driver or detached frame must not fail the afterEach
// hook, which would skip the rest of the suite and hide the real failure.
async function captureFailure(test) {
  const name = test.fullTitle().replace(/[^a-z0-9]+/gi, "-");
  const folder = path.resolve(".ui-tests/diagnostics");
  try {
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, `${name}.html`), await driver().getPageSource());
  } catch (e) {
    console.warn(`Could not save a DOM snapshot for "${test.fullTitle()}": ${e}`);
  }
  try {
    await VSBrowser.instance.takeScreenshot(name);
  } catch (e) {
    console.warn(`Could not take a screenshot for "${test.fullTitle()}": ${e}`);
  }
}

// Start every test from the workbench with no editors open, and keep
// diagnostics for failures. Call inside a describe block.
function useEditorHooks() {
  before(async () => {
    // Monaco only reports editor focus while the page is focused. Emulate that,
    // so a local run doesn't fail when another app takes the foreground.
    await driver().sendDevToolsCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
  });

  beforeEach(async () => {
    await driver().switchTo().defaultContent();
    await new EditorView().closeAllEditors();
  });

  afterEach(async function () {
    try {
      if (this.currentTest.state === "failed") await captureFailure(this.currentTest);
    } finally {
      await driver().switchTo().defaultContent();
    }
  });
}

module.exports = {
  workspace, driver, find, prepareWorkspace, waitForSvg, renderAfter,
  setToggle, selectBase, openVisualizer, editAndSave, useEditorHooks,
};
