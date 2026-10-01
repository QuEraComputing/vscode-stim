# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project Overview

This is a VS Code extension for Stim and Tsim `.stim`, `.tsim`, and `.dem` files. The `.stim` and `.tsim` extensions share the `stim` language ID and editor features. It provides syntax highlighting, autocomplete, and an interactive circuit visualization panel backed by a bundled WebAssembly build of Stim.

## Common Commands

- `npm install` - install dependencies.
- `npm run build` - build the extension bundle into `dist/`.
- `npx tsc --noEmit -p tsconfig.json` - type-check the extension.
- `npm run test:grammar` - run TextMate grammar tests.
- `npm run test:wasm` - run WebAssembly engine smoke tests.
- `npm run test:engine` - run engine and tsim unit tests.
- `npm run test:ui` - run real VS Code UI tests with an isolated profile (Node.js 22+ and a graphical display required; use `xvfb-run -a` on headless Linux).
- `npx vsce package -o vscode-stim.vsix` - package a local VSIX smoke test.

## Release Rules

- Do not commit or push `*.vsix` files.
- VSIX files are produced by `.github/workflows/release.yml` and attached to GitHub releases.
- Screenshots are kept in the GitHub repo for README rendering, but excluded from the packaged extension through `.vscodeignore`.
- The checked-in WebAssembly engine lives under `wasm/out/` and is stored with Git LFS.

## Editing Notes

- Prefer small, focused changes that fit the existing TypeScript and browser-JavaScript style.
- Keep generated build output (`dist/`, `dist-test/`, `node_modules/`) out of commits.
- If changing visualization behavior, run the build, type-check, and engine tests at minimum.
- For editor or webview interactions, also run `npm run test:ui`. Keep downloaded test runtimes, profiles, screenshots, and logs under the ignored `.ui-tests/` directory.
- If changing grammars, run `npm run test:grammar`.
- If changing the WASM binding or Stim engine wrapper, run `npm run test:wasm` and `npm run test:engine`.
