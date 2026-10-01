const path = require("node:path");
const fs = require("node:fs/promises");
const { By, until, VSBrowser, WebView, Workbench, TextEditor } = require("vscode-extension-tester");

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
    await selectBase("timeline");
    await setToggle("#toggle-noise", false);
    await setToggle("#toggle-full", false);
  }
  return view;
}

async function captureFailure(test) {
  const name = test.fullTitle().replace(/[^a-z0-9]+/gi, "-");
  const folder = path.resolve(".ui-tests/diagnostics");
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, `${name}.html`), await driver().getPageSource());
  await VSBrowser.instance.takeScreenshot(name);
}

module.exports = {
  workspace, driver, find, prepareWorkspace, waitForSvg, renderAfter,
  setToggle, selectBase, openVisualizer, captureFailure,
};
