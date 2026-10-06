const assert = require("node:assert/strict");
const { describe, it, before } = require("mocha");
const { By, Key, until } = require("vscode-extension-tester");
const {
  driver, find, prepareWorkspace, waitForSvg, renderAfter,
  setToggle, selectBase, openVisualizer, editAndSave, useEditorHooks,
} = require("./helpers.cjs");

describe("Stim visualizer UI", () => {
  before(async () => {
    await prepareWorkspace();
  });

  useEditorHooks();

  it("opens .stim files and renders circuit statistics", async () => {
    await openVisualizer("surface.stim");
    assert.equal((await driver().findElements(By.css("#type-seg button"))).length, 4);
    assert.ok(await (await find("#save-btn")).isDisplayed());
    assert.ok(await (await find("#copy-btn")).isDisplayed());
    await driver().actions().move({ origin: await find("#info-btn") }).perform();
    await driver().wait(until.elementIsVisible(await find("#info-tip")), 5000);
    await driver().wait(async () => (await (await find("#info-tip")).getText()).includes("Qubits"), 10000);
    assert.match(await (await find("#info-tip")).getText(), /Qubits\s+5/i);
  });

  it("opens .tsim files with non-Clifford gate labels", async () => {
    await openVisualizer("non_clifford.tsim");
    const labels = await (await find("#view svg")).getText();
    assert.match(labels, /TPP/);
    assert.match(labels, /0\.25/);
  });

  it("opens .dem files with only matching-graph controls", async () => {
    await openVisualizer("example.dem");
    const buttons = await driver().findElements(By.css("#type-seg button"));
    assert.equal(buttons.length, 1);
    assert.equal(await buttons[0].getAttribute("title"), "matchgraph");
    for (const id of ["toggle-ops", "toggle-noise", "toggle-approx", "toggle-decompose", "toggle-full", "tick-control"]) {
      assert.equal(await (await find(`#${id}`)).isDisplayed(), false, id);
    }
  });

  it("removes and restores noise operations", async () => {
    await openVisualizer("surface.stim");
    const original = await (await find("#view svg")).getAttribute("outerHTML");
    assert.match(original, /0\.01/);
    await setToggle("#toggle-noise", true);
    const stripped = await (await find("#view svg")).getAttribute("outerHTML");
    assert.doesNotMatch(stripped, /0\.01/);
    await setToggle("#toggle-noise", false);
    assert.equal(await (await find("#view svg")).getAttribute("outerHTML"), original);
  });

  it("switches slice layers and the all-ticks view", async () => {
    await openVisualizer("surface.stim");
    await selectBase("timeslice");
    assert.ok(await (await find("#tick-control")).isDisplayed());
    const tick = Number(await (await find("#tick-value")).getAttribute("value"));
    await renderAfter(() => find("#tick-next").then((button) => button.click()));
    assert.equal(Number(await (await find("#tick-value")).getAttribute("value")), tick + 1);
    await setToggle("#toggle-full", true);
    assert.equal(await (await find("#tick-control")).isDisplayed(), false);
    assert.ok(await (await find("#rows-control")).isDisplayed());
    await setToggle("#toggle-full", false);
    assert.ok(await (await find("#tick-control")).isDisplayed());
    await selectBase("detslice");
    await setToggle("#toggle-ops", true);
    assert.ok(await (await find("#toggle-noise")).isDisplayed());
    await setToggle("#toggle-ops", false);
  });

  it("zooms with Ctrl+wheel and pans by dragging", async () => {
    await openVisualizer("surface.stim");
    const viewport = await find(".zoom-wrap");
    const transform = () => find(".zoom-xform").then((el) => el.getCssValue("transform"));
    const initial = await transform();
    await driver().actions().keyDown(Key.CONTROL).scroll(0, 0, 0, -180, viewport).keyUp(Key.CONTROL).perform();
    await driver().wait(async () => await transform() !== initial, 5000, "Ctrl+wheel did not zoom");
    const position = () => driver().executeScript("return [arguments[0].scrollLeft, arguments[0].scrollTop]", viewport);
    const start = await position();
    await driver().actions().move({ origin: viewport }).press().move({ origin: viewport, x: -50, y: -35 }).release().perform();
    await driver().wait(async () => (await position()).some((value, i) => value !== start[i]), 5000, "Dragging did not pan");
    assert.doesNotMatch(await viewport.getAttribute("class"), /dragging/);
  });

  it("shows parse errors and recovers when the source is saved", async () => {
    const view = await openVisualizer("editable.stim");
    await editAndSave(view, "editable.stim", "NOT_A_GATE 0\n");
    const error = await driver().wait(until.elementLocated(By.css("#view .error")), 15000);
    assert.match(await error.getText(), /NOT_A_GATE/);
    assert.equal(await (await find("#save-btn")).isDisplayed(), false);
    await editAndSave(view, "editable.stim", "H 0\nCX 0 1\nM 0 1\n");
    await driver().wait(until.stalenessOf(error), 15000, "Saving corrected source did not replace the error");
    await waitForSvg();
    assert.ok(await (await find("#save-btn")).isDisplayed());
    assert.equal((await driver().findElements(By.css("#view .error"))).length, 0);
  });
});
