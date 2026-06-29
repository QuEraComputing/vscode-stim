(function () {
  const vscode = acquireVsCodeApi();
  const seg = document.getElementById("type-seg");
  const view = document.getElementById("view");
  const tickControl = document.getElementById("tick-control");
  const tickValue = document.getElementById("tick-value");
  const tickPrev = document.getElementById("tick-prev");
  const tickNext = document.getElementById("tick-next");
  const opsBtn = document.getElementById("toggle-ops");
  const noiseBtn = document.getElementById("toggle-noise");
  const fullBtn = document.getElementById("toggle-full");

  let state = {
    bases: [],
    tickDependentBases: [],
    base: null,
    withOps: false,
    withoutNoise: false,
    full: false,
    tick: 1,
    tickMax: 0,
  };

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
      btn.textContent = b.label;
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
    // "with ops" only applies to detslice.
    opsBtn.style.display = state.base === "detslice" ? "" : "none";
    setPressed(opsBtn, state.withOps);
    // "without noise" shows for timeline/timeslice, and for detslice only when
    // operations are overlaid. It's meaningless for the match graph.
    const noiseVisible =
      state.base !== "matchgraph" && !(state.base === "detslice" && !state.withOps);
    noiseBtn.style.display = noiseVisible ? "" : "none";
    setPressed(noiseBtn, state.withoutNoise);
    // Full mode only applies to slice (tick-dependent) types.
    fullBtn.style.display = dependent ? "" : "none";
    setPressed(fullBtn, state.full && dependent);
    // The single-tick stepper shows for slice types unless full mode is on.
    tickControl.classList.toggle("visible", dependent && !state.full);
    updateTickButtons();
  }

  opsBtn.addEventListener("click", () => {
    state.withOps = !state.withOps;
    updateControls();
    vscode.postMessage({ command: "setWithOps", value: state.withOps });
  });

  noiseBtn.addEventListener("click", () => {
    state.withoutNoise = !state.withoutNoise;
    updateControls();
    vscode.postMessage({ command: "setWithoutNoise", value: state.withoutNoise });
  });

  fullBtn.addEventListener("click", () => {
    state.full = !state.full;
    updateControls();
    vscode.postMessage({ command: "setFull", value: state.full });
  });

  tickPrev.addEventListener("click", () => setTick(state.tick - 1));
  tickNext.addEventListener("click", () => setTick(state.tick + 1));
  function setTick(t) {
    let next = Math.max(1, t);
    if (state.tickMax > 0) next = Math.min(next, state.tickMax);
    if (next === state.tick) return;
    state.tick = next;
    tickValue.textContent = String(state.tick);
    updateTickButtons();
    vscode.postMessage({ command: "setTick", tick: state.tick });
  }

  function updateTickButtons() {
    tickPrev.disabled = state.tick <= 1;
    tickNext.disabled = state.tickMax > 0 && state.tick >= state.tickMax;
  }

  // Arrow keys step the tick when the single-tick stepper is active.
  window.addEventListener("keydown", (e) => {
    if (!isTickDependent() || state.full) return;
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === "ArrowLeft") {
      setTick(state.tick - 1);
      e.preventDefault();
    } else if (e.key === "ArrowRight") {
      setTick(state.tick + 1);
      e.preventDefault();
    }
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

  function showSingle(svg) {
    view.replaceChildren(makeZoomable(svg, { fill: true }));
  }

  function showList(items) {
    const frag = document.createDocumentFragment();
    for (const item of items) {
      const label = document.createElement("div");
      label.className = "tick-label";
      label.textContent = "tick " + item.tick;
      frag.appendChild(label);
      frag.appendChild(makeZoomable(item.svg, { height: 360 }));
    }
    view.replaceChildren(frag);
  }

  function showError(message) {
    const pre = document.createElement("pre");
    pre.className = "error";
    pre.textContent = message;
    view.replaceChildren(pre);
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.command === "init") {
      state.bases = msg.bases;
      state.tickDependentBases = msg.tickDependentBases;
      state.base = msg.base;
      state.withOps = msg.withOps;
      state.withoutNoise = msg.withoutNoise;
      state.full = msg.full;
      state.tick = msg.tick;
      tickValue.textContent = String(state.tick);
      renderSegmented();
      updateControls();
    } else if (msg.command === "svg") {
      // The host clamps the tick to the valid range; mirror its values.
      if (typeof msg.tick === "number") {
        state.tick = msg.tick;
        tickValue.textContent = String(state.tick);
      }
      if (typeof msg.tickMax === "number") state.tickMax = msg.tickMax;
      updateTickButtons();
      showSingle(msg.svg);
    } else if (msg.command === "svgList") {
      showList(msg.items);
    } else if (msg.command === "error") {
      showError(msg.message);
    }
  });

  vscode.postMessage({ command: "ready" });
})();
