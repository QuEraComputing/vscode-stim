(function () {
  const vscode = acquireVsCodeApi();
  const seg = document.getElementById("type-seg");
  const dimSeg = document.getElementById("dim-seg");
  const dim2d = document.getElementById("dim-2d");
  const dim3d = document.getElementById("dim-3d");
  const view = document.getElementById("view");
  const tickControl = document.getElementById("tick-control");
  const tickValue = document.getElementById("tick-value");
  const tickPrev = document.getElementById("tick-prev");
  const tickNext = document.getElementById("tick-next");
  const opsBtn = document.getElementById("toggle-ops");
  const noiseBtn = document.getElementById("toggle-noise");
  const approxBtn = document.getElementById("toggle-approx");
  const decomposeBtn = document.getElementById("toggle-decompose");
  const fullBtn = document.getElementById("toggle-full");
  const rowsControl = document.getElementById("rows-control");
  const rowsInput = document.getElementById("rows-input");
  const infoTip = document.getElementById("info-tip");

  let state = {
    kind: "circuit",
    bases: [],
    tickDependentBases: [],
    dimCapableBases: [],
    base: null,
    dim: "2d",
    withOps: false,
    withoutNoise: false,
    approxDisjoint: true,
    decomposeErrors: false,
    full: false,
    tick: 1,
    tickMax: 0,
    rows: 0,
  };

  function isDimCapable() {
    return state.dimCapableBases.includes(state.base);
  }
  // Tick-dependent bases (timeslice, detslice) are disjoint from the 3D-capable
  // ones (timeline, matchgraph), so this never needs to consult the dim state.
  // The 2d|3d toggle only shows for dim-capable bases, so a remembered "3d" can
  // never suppress the tick/full controls on a slice base.
  function isTickDependent() {
    return state.tickDependentBases.includes(state.base);
  }

  function setPressed(btn, on) {
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  function renderSegmented() {
    seg.replaceChildren();
    for (const b of state.bases) {
      const btn = document.createElement("button");
      btn.className = "seg-btn" + (b.id === state.base ? " active" : "");
      btn.title = b.label;
      // Both labels are present; CSS shows the short one when the panel is narrow.
      const lg = document.createElement("span");
      lg.className = "seg-lg";
      lg.textContent = b.label;
      const sm = document.createElement("span");
      sm.className = "seg-sm";
      sm.textContent = b.short;
      btn.append(lg, sm);
      btn.addEventListener("click", () => {
        if (state.base === b.id) return;
        state.base = b.id;
        updateControls();
        renderSegmented();
        vscode.postMessage({ command: "setBase", base: b.id });
      });
      seg.appendChild(btn);
    }
  }

  function updateControls() {
    const dependent = isTickDependent();
    // 2d|3d toggle only for bases with a 3D form (timeline, matchgraph).
    dimSeg.style.display = isDimCapable() ? "" : "none";
    dim2d.classList.toggle("active", state.dim === "2d");
    dim3d.classList.toggle("active", state.dim === "3d");
    // "with ops" only applies to detslice.
    opsBtn.style.display = state.base === "detslice" ? "" : "none";
    setPressed(opsBtn, state.withOps);
    // "without noise" shows for timeline/timeslice, and for detslice only when
    // operations are overlaid. It's meaningless for the match graph.
    const noiseVisible =
      state.base !== "matchgraph" && !(state.base === "detslice" && !state.withOps);
    noiseBtn.style.display = noiseVisible ? "" : "none";
    setPressed(noiseBtn, state.withoutNoise);
    // "approx. disjoint errors" and "decompose errors" are circuit->DEM build
    // options, so they only apply to the match graph of a circuit (not a .dem,
    // whose error structure is already fixed).
    const matchFromCircuit = state.base === "matchgraph" && state.kind === "circuit";
    approxBtn.style.display = matchFromCircuit ? "" : "none";
    setPressed(approxBtn, state.approxDisjoint);
    decomposeBtn.style.display = matchFromCircuit ? "" : "none";
    setPressed(decomposeBtn, state.decomposeErrors);
    // Full mode only applies to slice (tick-dependent) types.
    fullBtn.style.display = dependent ? "" : "none";
    setPressed(fullBtn, state.full && dependent);
    // The rows input only matters for the combined full view.
    rowsControl.style.display = dependent && state.full ? "" : "none";
    // The single-tick stepper shows for slice types unless full mode is on.
    tickControl.classList.toggle("visible", dependent && !state.full);
    updateTickButtons();
  }

  opsBtn.addEventListener("click", () => {
    state.withOps = !state.withOps;
    updateControls();
    vscode.postMessage({ command: "setWithOps", value: state.withOps });
  });

  function setDim(dim) {
    if (state.dim === dim) return;
    state.dim = dim;
    updateControls();
    vscode.postMessage({ command: "setThreeD", value: dim === "3d" });
  }
  dim2d.addEventListener("click", () => setDim("2d"));
  dim3d.addEventListener("click", () => setDim("3d"));

  noiseBtn.addEventListener("click", () => {
    state.withoutNoise = !state.withoutNoise;
    updateControls();
    vscode.postMessage({ command: "setWithoutNoise", value: state.withoutNoise });
  });

  approxBtn.addEventListener("click", () => {
    state.approxDisjoint = !state.approxDisjoint;
    updateControls();
    vscode.postMessage({ command: "setApproxDisjoint", value: state.approxDisjoint });
  });

  decomposeBtn.addEventListener("click", () => {
    state.decomposeErrors = !state.decomposeErrors;
    updateControls();
    vscode.postMessage({ command: "setDecomposeErrors", value: state.decomposeErrors });
  });

  fullBtn.addEventListener("click", () => {
    state.full = !state.full;
    updateControls();
    vscode.postMessage({ command: "setFull", value: state.full });
  });

  // Rows for the combined full view; blank/<1 means stim's automatic layout.
  // The native number input handles up/down arrows and the spinner.
  rowsInput.addEventListener("change", () => {
    const v = parseInt(rowsInput.value, 10);
    const rows = Number.isInteger(v) && v > 0 ? v : 0;
    if (rows === 0) rowsInput.value = "";
    state.rows = rows;
    vscode.postMessage({ command: "setRows", rows });
  });

  tickPrev.addEventListener("click", () => setTick(state.tick - 1));
  tickNext.addEventListener("click", () => setTick(state.tick + 1));
  function setTick(t) {
    let next = Math.floor(t);
    if (!Number.isFinite(next) || next < 0) next = 0;
    if (state.tickMax > 0) next = Math.min(next, state.tickMax);
    const changed = next !== state.tick;
    state.tick = next;
    tickValue.value = String(next); // mirror the clamped value back into the box
    updateTickButtons();
    if (changed) vscode.postMessage({ command: "setTick", tick: next });
  }

  // Typing a layer number jumps to it; out-of-range values clamp (too large ->
  // last, negative/zero -> first) via setTick.
  function commitTickInput() {
    const v = parseInt(tickValue.value, 10);
    if (Number.isNaN(v)) {
      tickValue.value = String(state.tick);
      return;
    }
    setTick(v);
  }
  tickValue.addEventListener("change", commitTickInput);
  tickValue.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      commitTickInput();
      tickValue.blur();
    }
  });

  function updateTickButtons() {
    tickPrev.disabled = state.tick <= 0;
    tickNext.disabled = state.tickMax > 0 && state.tick >= state.tickMax;
  }

  // Keyboard navigation through the tick/layer stepper. Active only when the
  // single-tick stepper is shown (slice diagram, not full mode) and focus isn't
  // in an input. Keys:
  //   ← / q : previous layer       → / e : next layer
  //   shift+q : back 5             shift+e : forward 5
  //   home : first layer           end : last layer
  function jumpTick(target) {
    setTick(target);
  }
  window.addEventListener("keydown", (e) => {
    if (!isTickDependent() || state.full) return;
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    const last = state.tickMax > 0 ? state.tickMax : 1e6;
    const key = e.key.toLowerCase();
    let handled = true;
    if (e.key === "ArrowRight" || key === "e") {
      setTick(state.tick + (e.shiftKey ? 5 : 1));
    } else if (e.key === "ArrowLeft" || key === "q") {
      setTick(state.tick - (e.shiftKey ? 5 : 1));
    } else if (e.key === "Home") {
      jumpTick(0);
    } else if (e.key === "End") {
      jumpTick(last);
    } else {
      handled = false;
    }
    if (handled) e.preventDefault();
  });

  // Wrap a raw SVG string in a zoomable, scrollable container. Ctrl/Cmd + wheel
  // (and trackpad pinch, which the browser reports as ctrl+wheel) zooms toward
  // the cursor; plain scroll pans. Ported from the tsim wrap_svg_zoomable helper.
  // opts: { fill } to fill the panel (fit the whole SVG into the available
  // area, used for the single view) or { height } for a fixed-height box
  // (used for each item in full mode).
  function makeZoomable(svgString, opts) {
    opts = opts || {};
    const wrap = document.createElement("div");
    wrap.className = "zoom-wrap" + (opts.fill ? " fill" : "");
    if (!opts.fill) wrap.style.height = (opts.height || 700) + "px";

    const sizer = document.createElement("div");
    sizer.className = "zoom-sizer";
    const xform = document.createElement("div");
    xform.className = "zoom-xform";
    xform.innerHTML = svgString;
    sizer.appendChild(xform);
    wrap.appendChild(sizer);

    const svg = xform.querySelector("svg");
    let natW = 800;
    let natH = 200;
    if (svg) {
      const vb = (svg.getAttribute("viewBox") || "").split(/\s+/).map(Number);
      if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
        natW = vb[2];
        natH = vb[3];
      }
      // Stim SVGs only carry a viewBox; give them an explicit pixel size so they
      // don't collapse inside the inline-block transform container.
      svg.setAttribute("width", natW);
      svg.setAttribute("height", natH);
      svg.style.display = "block";
    }
    xform.style.width = natW + "px";
    xform.style.height = natH + "px";

    let scale = 1;

    function apply() {
      xform.style.transform = "scale(" + scale + ")";
      sizer.style.width = natW * scale + "px";
      sizer.style.height = natH * scale + "px";
    }

    // Fit once the container has been laid out: fill mode fits the whole SVG
    // into the available area (so wide diagrams span the full width); fixed
    // mode fits to the given height, capped to the container width.
    function fit() {
      const cw = wrap.clientWidth;
      const ch = wrap.clientHeight;
      if (cw <= 0 || natW <= 0 || natH <= 0) return;
      if (opts.fill) {
        scale = Math.min(cw / natW, ch / natH);
      } else {
        scale = Math.min((opts.height || 700) / natH, cw / natW);
      }
      apply();
    }
    apply();
    requestAnimationFrame(fit);

    wrap.addEventListener(
      "wheel",
      (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        const rect = wrap.getBoundingClientRect();
        const mx = e.clientX - rect.left + wrap.scrollLeft;
        const my = e.clientY - rect.top + wrap.scrollTop;
        const factor = Math.exp(-e.deltaY * 0.01);
        const newScale = Math.min(Math.max(0.02, scale * factor), 40);
        const ratio = newScale / scale;
        scale = newScale;
        apply();
        wrap.scrollLeft = mx * ratio - (e.clientX - rect.left);
        wrap.scrollTop = my * ratio - (e.clientY - rect.top);
      },
      { passive: false }
    );

    return wrap;
  }

  // What the view currently shows, so resize handling knows whether to re-fit.
  let currentKind = null;

  const COPY_ICON =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  const CHECK_ICON =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';

  // Gray copy button pinned to the top-right of the SVG. The host copies the SVG
  // as a file reference so it pastes into PowerPoint as a vector picture.
  function makeCopyButton(svgString) {
    const btn = document.createElement("button");
    btn.className = "copy-btn";
    btn.title = "Copy diagram (paste into PowerPoint as SVG)";
    btn.setAttribute("aria-label", "Copy diagram as SVG");
    btn.innerHTML = COPY_ICON;
    btn.addEventListener("click", () => {
      vscode.postMessage({ command: "copySvg", svg: svgString });
      btn.innerHTML = CHECK_ICON;
      btn.classList.add("copied");
      btn.title = "Copied";
      setTimeout(() => {
        btn.innerHTML = COPY_ICON;
        btn.classList.remove("copied");
        btn.title = "Copy diagram (paste into PowerPoint as SVG)";
      }, 1200);
    });
    return btn;
  }

  function showSingle(svg) {
    currentKind = "svg";
    const stage = document.createElement("div");
    stage.className = "view-stage";
    stage.appendChild(makeZoomable(svg, { fill: true }));
    stage.appendChild(makeCopyButton(svg));
    view.replaceChildren(stage);
  }

  // Interactive 3D viewer: stim's self-contained HTML page in an iframe.
  function showHtml(html) {
    currentKind = "html";
    const frame = document.createElement("iframe");
    frame.className = "viewer-iframe";
    frame.srcdoc = html;
    view.replaceChildren(frame);
  }

  function showError(message) {
    currentKind = "error";
    const pre = document.createElement("pre");
    pre.className = "error";
    pre.textContent = message;
    view.replaceChildren(pre);
  }

  // Fill the info tooltip from titled sections (null sections = parse error).
  function renderStats(msg) {
    if (!msg.sections) {
      infoTip.innerHTML = '<div class="info-error">Cannot parse</div>';
      return;
    }
    infoTip.innerHTML = msg.sections
      .map(
        (sec) =>
          `<div class="info-title">${sec.title}</div>` +
          sec.rows
            .map(
              ([k, v]) =>
                `<div class="info-row"><span class="info-k">${k}</span><span class="info-v">${v}</span></div>`
            )
            .join("")
      )
      .join("");
  }

  // When the panel finishes resizing, re-render the SVG so it re-fits the new
  // size. Skipped for the 3D iframe (re-rendering would reset the orbit camera).
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      if (currentKind === "svg") {
        vscode.postMessage({ command: "refresh" });
      }
    }, 200);
  });

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.command === "init") {
      state.kind = msg.kind || "circuit";
      state.bases = msg.bases;
      state.tickDependentBases = msg.tickDependentBases;
      state.dimCapableBases = msg.dimCapableBases || [];
      state.base = msg.base;
      state.dim = msg.threeD ? "3d" : "2d";
      state.withOps = msg.withOps;
      state.withoutNoise = msg.withoutNoise;
      state.approxDisjoint = msg.approxDisjoint !== false;
      state.decomposeErrors = !!msg.decomposeErrors;
      state.full = msg.full;
      state.tick = msg.tick;
      state.rows = msg.rows || 0;
      tickValue.value = String(state.tick);
      rowsInput.value = state.rows > 0 ? String(state.rows) : "";
      renderSegmented();
      updateControls();
    } else if (msg.command === "html") {
      showHtml(msg.html);
    } else if (msg.command === "svg") {
      // The host clamps the tick to the valid range; mirror its values (unless
      // the user is mid-edit in the box).
      if (typeof msg.tick === "number") {
        state.tick = msg.tick;
        if (document.activeElement !== tickValue) {
          tickValue.value = String(state.tick);
        }
      }
      if (typeof msg.tickMax === "number") state.tickMax = msg.tickMax;
      updateTickButtons();
      showSingle(msg.svg);
    } else if (msg.command === "error") {
      showError(msg.message);
    } else if (msg.command === "stats") {
      renderStats(msg);
    }
  });

  vscode.postMessage({ command: "ready" });
})();
