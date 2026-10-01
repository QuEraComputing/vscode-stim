import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const manifest = JSON.parse(read("../package.json"));
const script = read("../media/main.js");
const panelScript = transformSync(read("../src/panel.ts"), { loader: "ts", format: "cjs" }).code;
const require = createRequire(import.meta.url);

function element() {
  const listeners = new Map();
  const classes = new Set();
  let captured;
  return {
    style: {},
    children: [],
    clientWidth: 400,
    clientHeight: 300,
    scrollLeft: 0,
    scrollTop: 0,
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle: (name, on) => on ? classes.add(name) : classes.delete(name),
    },
    addEventListener(name, callback) { listeners.set(name, callback); },
    emit(name, properties = {}) {
      const event = { preventDefault() { this.defaultPrevented = true; }, ...properties };
      listeners.get(name)?.(event);
      return event;
    },
    setAttribute() {},
    getAttribute: () => "0 0 800 600",
    querySelector: () => element(),
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setPointerCapture(id) { captured = id; },
    hasPointerCapture: (id) => captured === id,
    releasePointerCapture() { captured = undefined; },
  };
}

function viewer(options = {}) {
  const elements = new Map();
  const document = {
    ...element(),
    createElement: element,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
  };
  const window = element();
  const messages = [];
  runInNewContext(script, {
    document,
    window,
    acquireVsCodeApi: () => ({ postMessage: (msg) => messages.push(msg) }),
    requestAnimationFrame: (callback) => callback(),
  });
  const send = (data) => window.emit("message", { data });
  send({
    command: "init", bases: [], tickDependentBases: ["timeslice", "detslice"],
    base: "timeline", full: false, tick: 0, ...options,
  });
  send({ command: "svg", svg: '<svg viewBox="0 0 800 600"/>', tickMax: 10 });
  const wrap = elements.get("view").children[0];
  const xform = wrap.children[0].children[0];
  return {
    wrap, send, messages,
    scale: () => Number(xform.style.transform.match(/scale\((.*)\)/)[1]),
    wheel: (properties = {}) => wrap.emit("wheel", {
      deltaY: -60, deltaMode: 0, clientX: 100, clientY: 100, ...properties,
    }),
  };
}

test("SVG zoom setting defaults to Ctrl+Scroll and supports workspace overrides", () => {
  const setting = manifest.contributes.configuration.properties["stim.svgZoomMode"];
  assert.equal(setting.default, "ctrlScroll");
  assert.deepEqual(setting.enum, ["ctrlScroll", "scroll"]);
  assert.equal(setting.scope, "resource");
});

test("default mode leaves plain wheel panning to the browser", () => {
  const v = viewer();
  const before = v.scale();
  assert.ok(!v.wheel().defaultPrevented);
  assert.equal(v.scale(), before);
  for (const modifier of ["ctrlKey", "metaKey"]) {
    const scale = v.scale();
    assert.ok(v.wheel({ [modifier]: true }).defaultPrevented);
    assert.ok(v.scale() > scale);
  }
});

test("scroll mode zooms toward the cursor and obeys scale limits", () => {
  const v = viewer({ svgZoomMode: "scroll" });
  const before = v.scale();
  assert.ok(v.wheel().defaultPrevented);
  const ratio = v.scale() / before;
  assert.equal(v.wrap.scrollLeft, 100 * ratio - 100);
  assert.equal(v.wrap.scrollTop, 100 * ratio - 100);
  v.wheel({ deltaY: -10000 });
  assert.equal(v.scale(), 40);
  v.wheel({ deltaY: 10000 });
  assert.equal(v.scale(), 0.02);
});

test("settings apply without replacing or resetting the SVG viewport", () => {
  const v = viewer();
  v.wheel({ ctrlKey: true });
  const before = v.scale();
  const left = v.wrap.scrollLeft;
  v.send({ command: "configuration", svgZoomMode: "scroll" });
  assert.equal(v.scale(), before);
  assert.equal(v.wrap.scrollLeft, left);
  assert.ok(v.wheel().defaultPrevented);
  assert.ok(v.scale() > before);
  v.send({ command: "configuration", svgZoomMode: "ctrlScroll" });
  assert.ok(!v.wheel().defaultPrevented);
});

test("slice wheel stepping remains the default but scroll mode zooms instead", () => {
  for (const base of ["timeslice", "detslice"]) {
    const v = viewer({ base });
    const before = v.scale();
    v.wheel({ deltaY: 60 });
    assert.equal(v.scale(), before);
    assert.equal(v.messages.at(-1).command, "setTick");
    assert.equal(v.messages.at(-1).tick, 1);
    v.send({ command: "configuration", svgZoomMode: "scroll" });
    const count = v.messages.length;
    v.wheel();
    assert.ok(v.scale() > before);
    assert.equal(v.messages.length, count);
  }
  assert.ok(!viewer({ base: "timeslice", full: true }).wheel().defaultPrevented);
});

test("left-button dragging pans in both modes and releases pointer capture", () => {
  for (const svgZoomMode of ["ctrlScroll", "scroll"]) {
    const { wrap } = viewer({ svgZoomMode });
    wrap.scrollLeft = 100;
    wrap.scrollTop = 100;
    wrap.emit("pointerdown", { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    assert.ok(wrap.hasPointerCapture(1));
    assert.ok(wrap.classList.contains("dragging"));
    wrap.emit("pointermove", { pointerId: 1, clientX: 120, clientY: 130 });
    assert.equal(wrap.scrollLeft, 80);
    assert.equal(wrap.scrollTop, 70);
    wrap.emit("pointerup", { pointerId: 1 });
    assert.ok(!wrap.hasPointerCapture(1));
    assert.ok(!wrap.classList.contains("dragging"));
    wrap.emit("pointermove", { pointerId: 1, clientX: 150, clientY: 150 });
    assert.equal(wrap.scrollLeft, 80);
  }
});

test("host sends resource-scoped configuration on ready and setting changes", () => {
  const messages = [];
  const resource = { toString: () => "file:///circuit.tsim" };
  let mode;
  let onChange;
  let onMessage;
  let listenerDisposables;
  const vscode = {
    Uri: { joinPath: (...parts) => parts.join("/") },
    workspace: {
      getConfiguration(section, uri) {
        assert.equal(section, "stim");
        assert.equal(uri, resource);
        return { get: (key) => { assert.equal(key, "svgZoomMode"); return mode; } };
      },
      onDidChangeConfiguration(callback, _, disposables) {
        onChange = callback;
        listenerDisposables = disposables;
      },
    },
  };
  const module = { exports: {} };
  runInNewContext(panelScript, {
    module, exports: module.exports,
    require: (name) => name === "vscode" ? vscode : name.startsWith("./") ? {} : require(name),
  });
  const panel = new module.exports.StimPanel({
    webview: {
      asWebviewUri: (uri) => uri,
      onDidReceiveMessage: (callback) => { onMessage = callback; },
      postMessage: (message) => messages.push(message),
    },
    onDidDispose() {},
  }, { globalState: { get() {} }, extensionUri: "extension" }, { uri: resource, languageId: "stim" });
  panel.refresh = () => {};
  onMessage({ command: "ready" });
  assert.equal(messages.at(-1).svgZoomMode, "ctrlScroll");
  assert.equal(listenerDisposables, panel.disposables);
  mode = "scroll";
  onChange({ affectsConfiguration: (key, uri) => key === "stim.svgZoomMode" && uri === resource });
  assert.equal(messages.at(-1).command, "configuration");
  assert.equal(messages.at(-1).svgZoomMode, "scroll");
  onMessage({ command: "ready" });
  assert.equal(messages.at(-1).svgZoomMode, "scroll");
  const count = messages.length;
  onChange({ affectsConfiguration: () => false });
  assert.equal(messages.length, count);
  mode = "invalid";
  onChange({ affectsConfiguration: () => true });
  assert.equal(messages.at(-1).svgZoomMode, "ctrlScroll");
});
