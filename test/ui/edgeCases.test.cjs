const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const { describe, it, before } = require("mocha");
const { By, Key, until } = require("vscode-extension-tester");
const {
  workspace, driver, find, prepareWorkspace, openVisualizer,
  selectBase, renderAfter, waitForSvg, editAndSave, useEditorHooks,
} = require("./helpers.cjs");

describe("Visualizer edge-case regressions", () => {
  before(async () => {
    await prepareWorkspace();
    await fs.writeFile(path.join(workspace, "invalid-gates.tsim"), "H 0\nM 0\n");
    await fs.writeFile(path.join(workspace, "single-layer.stim"), "H 0\nM 0\n");
    await fs.writeFile(path.join(workspace, "nested-repeat.stim"),
      "REPEAT 2 {\n REPEAT 2 {\n H 0\n TICK[round-end]\n } # inner\n} # outer\n");
  });

  useEditorHooks();

  it("reports Tsim lowering errors and recovers after correction", async () => {
    const view = await openVisualizer("invalid-gates.tsim");
    const stats = async () => (await find("#info-tip")).getAttribute("textContent");
    for (const [source, message] of [
      ["CCX 0 1\n", /groups of three on the following line:\s+CCX 0 1/],
      ["R_XX(0.25) 0 0\n", /must be distinct on the following line:\s+R_XX\(0\.25\) 0 0/],
    ]) {
      await editAndSave(view, "invalid-gates.tsim", source);
      const error = await driver().wait(until.elementLocated(By.css("#view .error")), 15000);
      assert.match(await error.getText(), message);
      assert.equal((await driver().findElements(By.css("#view svg"))).length, 0);
      assert.equal(await (await find("#save-btn")).isDisplayed(), false);
      assert.match(await stats(), /Cannot parse/);
      await editAndSave(view, "invalid-gates.tsim", "H 0\nM 0\n");
      await driver().wait(until.stalenessOf(error), 15000);
      await waitForSvg();
      assert.ok(await (await find("#save-btn")).isDisplayed());
      await driver().wait(async () => /Qubits/.test(await stats()), 5000, "Statistics were not restored");
    }
  });

  it("bounds single-layer navigation at zero", async () => {
    await openVisualizer("single-layer.stim");
    await selectBase("timeslice");
    assert.equal(await (await find("#tick-next")).isEnabled(), false);
    assert.equal(await (await find("#tick-prev")).isEnabled(), false);
    const tick = await find("#tick-value");
    await tick.clear();
    await tick.sendKeys("999", Key.ENTER);
    assert.equal(await tick.getAttribute("value"), "0");
    await driver().actions().sendKeys(Key.END).perform();
    assert.equal(await tick.getAttribute("value"), "0");
    assert.equal(await (await find("#tick-next")).isEnabled(), false);
    await waitForSvg();
  });

  it("excludes the empty final layer after nested repeats ending in TICK", async () => {
    await openVisualizer("nested-repeat.stim");
    await selectBase("timeslice");
    for (let i = 0; i < 3; i++) {
      await renderAfter(() => find("#tick-next").then((button) => button.click()));
    }
    assert.equal(await (await find("#tick-value")).getAttribute("value"), "3");
    assert.equal(await (await find("#tick-next")).isEnabled(), false);
    await renderAfter(() => find("#tick-prev").then((button) => button.click()));
    assert.equal(await (await find("#tick-value")).getAttribute("value"), "2");
    assert.ok(await (await find("#tick-next")).isEnabled());
  });
});
