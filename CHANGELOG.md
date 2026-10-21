# Changelog

## 0.2.0

- Tsim circuits in `.tsim` files, sharing the Stim language mode, highlighting, editor features, and visualizer.
- Visualization of all Tsim gates: `T`, `T_DAG`, `TPP`, `TPP_DAG`, `R_X`, `R_Y`, `R_Z`, `R_XX`, `R_YY`, `R_ZZ`, `R_PAULI`, `U3`, `CCZ`, and `CCX`, with rotation angles and controlled-gate connections, in the 2D timeline, time slice, and 3D timeline views.
- Autocomplete, hover documentation, and signature help for the non-Clifford gates and aliases such as `R_PAULI` and `U`.
- Circuits that encode Tsim gates in Stim tags (for example `S[T]` or `I[R_X(theta=0.25*pi)]`) still render; detector slices and match graphs keep showing them as their Clifford stand-ins.
- New `stim.svgZoomMode` setting: choose `scroll` to zoom SVG views with plain scrolling instead of Ctrl/Cmd+scroll. Changes apply to open viewers immediately.
- Viewer fixes: slice navigation no longer lands on empty trailing layers (including after `REPEAT` blocks), and a slow render can no longer replace a newer diagram or error.

## 0.1.0

First release on the VS Code Marketplace under QuEra Computing Inc.

- Syntax highlighting for Stim circuits (`.stim`) and detector error models (`.dem`).
- Autocomplete for Stim gate and annotation names.
- Circuit visualization from the command palette and editor title bar.
- Timeline, time slice, detector slice, detector slice with operations, and match graph views.
- SVG rendering and interactive 3D views for supported diagram types.
- Circuit statistics and SVG save and copy actions.
- Bundled Stim WebAssembly engine with no local Python or native Stim installation required.

Interactive 3D views load three.js from a CDN and require network access. The 2D SVG views work offline.
