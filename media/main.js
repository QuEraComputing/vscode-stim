(function () {
  const vscode = acquireVsCodeApi();
  const toolbar = document.getElementById("toolbar");
  const view = document.getElementById("view");
  const status = document.getElementById("status");
  const tickControl = document.getElementById("tick-control");
  const tickValue = document.getElementById("tick-value");

  let state = { types: [], tickDependent: [], current: null, tick: 1 };

  function renderToolbar() {
    for (const btn of [...toolbar.querySelectorAll("button.type-btn")]) btn.remove();
    const anchor = tickControl;
    for (const type of state.types) {
      const btn = document.createElement("button");
      btn.className = "type-btn" + (type === state.current ? " active" : "");
      btn.textContent = type.replace(/-svg$/, "");
      btn.addEventListener("click", () => {
        state.current = type;
        updateTickVisibility();
        renderToolbar();
        vscode.postMessage({ command: "setType", type });
      });
      toolbar.insertBefore(btn, anchor);
    }
  }

  function updateTickVisibility() {
    const dependent = state.tickDependent.includes(state.current);
    tickControl.classList.toggle("visible", dependent);
  }

  document.getElementById("tick-prev").addEventListener("click", () => setTick(state.tick - 1));
  document.getElementById("tick-next").addEventListener("click", () => setTick(state.tick + 1));
  function setTick(t) {
    state.tick = Math.max(0, t);
    tickValue.textContent = String(state.tick);
    vscode.postMessage({ command: "setTick", tick: state.tick });
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.command === "init") {
      state.types = msg.types;
      state.tickDependent = msg.tickDependent;
      state.current = msg.current;
      state.tick = msg.tick;
      tickValue.textContent = String(state.tick);
      renderToolbar();
      updateTickVisibility();
    } else if (msg.command === "svg") {
      status.textContent = `${msg.type}${msg.tickShown ? " · tick " + msg.tick : ""}`;
      view.innerHTML = msg.svg;
    } else if (msg.command === "error") {
      status.textContent = "error";
      const pre = document.createElement("pre");
      pre.className = "error";
      pre.textContent = msg.message;
      view.replaceChildren(pre);
    } else if (msg.command === "loading") {
      status.textContent = "rendering…";
    }
  });

  vscode.postMessage({ command: "ready" });
})();
