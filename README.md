<div align="center">
  <img src="./wasmforge-logo.png" alt="WasmForge Logo" width="200" />

  # WasmForge

  **Your entire dev environment. One browser tab. Zero servers.**

  [![Live Demo](https://img.shields.io/badge/Live-Demo-%232EA043?style=for-the-badge&logo=vercel)](https://wasm-forge.vercel.app/)
  [![Watch The Code 2026](https://img.shields.io/badge/Watch_The_Code-2026-1a252f?style=for-the-badge)](https://gehu.in/hack)
  ![PS #10 WebIDE](https://img.shields.io/badge/PS_%2310-WebIDE-58a6ff?style=for-the-badge)

</div>

WasmForge is a fully in-browser IDE where Python, JavaScript/TypeScript, SQLite, and PostgreSQL all execute on your local CPU via WebAssembly. No backend server. No cloud execution. No network dependency after first load.

**[→ Open the live demo](https://wasm-forge.vercel.app/)**

Turn on Airplane Mode after it loads. Everything still works.

---

## What Makes This Different

Every existing cloud IDE — Replit, CodeSandbox, GitHub Codespaces — puts the runtime on a server. That single architectural choice creates three structural problems: your code hits a third-party server on every run, one network drop kills your entire environment, and you pay per hour for compute you didn't ask for.

WasmForge eliminates the server entirely. Python runs via Pyodide (CPython compiled to WebAssembly) directly in your browser tab. SQL runs via sql.js and PGLite — both compiled to Wasm. Files persist to your local disk via the Origin Private File System. A ServiceWorker caches every binary on first load so nothing ever fetches from the network again.

The architecture is not an optimization of the cloud model. It is a replacement for it.

---

## How It Works

### Thread Isolation

Browsers are single-threaded by default. Running a Python interpreter on the main thread would freeze the UI permanently on any blocking operation. WasmForge solves this with strict thread isolation — every runtime runs in a dedicated Web Worker, completely separated from the UI:

```
Main Thread (React UI — Monaco Editor, File Tree, Xterm.js)
        │
        │  postMessage (non-blocking)
        ▼
Execution Router — reads file extension, dispatches to correct Worker
        │
        ├── Python Worker  (Pyodide — CPython → Wasm)
        ├── JS/TS Worker   (Sucrase transpiler + sandboxed eval)
        ├── SQLite Worker  (sql.js — SQLite → Wasm)
        └── PGLite Worker  (PostgreSQL → Wasm)
        │
        │  stdout/stderr buffered chunks → Xterm.js terminal
        ▼
I/O Worker — OPFS Synchronous Write API
        — persists every editor change to local disk
        ▼
ServiceWorker Cache
        — serves Pyodide binary, stdlib, numpy/pandas from disk
        — zero network calls on every load after first
```

The main thread never executes user code. A crash or infinite loop in any Worker cannot freeze the UI.

### Infinite Loop Protection — Heartbeat Kill Mechanism

If a Python script enters an infinite loop, the Worker thread is completely blocked and cannot recover on its own. WasmForge handles this with a heartbeat watchdog:

- The Python Worker emits a heartbeat signal every 1 second during execution
- The main thread monitors for this signal
- If no heartbeat arrives within 5 seconds, the main thread calls `worker.terminate()` and automatically spawns a fresh Worker
- The user sees one error line in the terminal. The UI never freezes. No page refresh needed.

```js
// usePyodideWorker.js
watchdogRef.current = setTimeout(() => {
  workerRef.current.terminate()
  spawnWorker() // fresh environment in < 100ms
}, 5000)
```

### Offline-First — ServiceWorker + Local Assets

Pyodide with NumPy and pandas exceeds 25MB. On congested Wi-Fi this means a 45-second blank screen — unacceptable for any real demo.

WasmForge ships the Pyodide runtime and all required wheels as local assets in `public/pyodide/` and `public/pyodide-wheels/`. The Vite PWA plugin generates a ServiceWorker that caches all of these on first load. Every subsequent visit — including in Airplane Mode — loads in under 2 seconds from the local browser cache.

```js
// vite.config.js
workbox: {
  globPatterns: ['**/*.{js,css,html,wasm,zip,whl,json}'],
  maximumFileSizeToCacheInBytes: 50 * 1024 * 1024
}
```

### File Persistence — OPFS I/O Worker

The default Wasm virtual filesystem lives in volatile memory. A tab refresh destroys everything.

WasmForge uses a dedicated I/O Worker that writes every editor change synchronously to the Origin Private File System — the browser's high-speed local storage API. OPFS synchronous access (`createSyncAccessHandle()`) is only available inside Web Workers, which is exactly why a dedicated I/O Worker exists instead of writing from the main thread.

Files survive hard reloads, tab closes, and full browser restarts.

### Interactive stdin — SharedArrayBuffer + Atomics

Python's `input()` is a synchronous blocking call. A Web Worker cannot pause and wait for asynchronous user input without shared memory. WasmForge implements this with `SharedArrayBuffer` and `Atomics.wait()`:

1. A `SharedArrayBuffer` is created on the main thread and passed to the Python Worker
2. When Python calls `input()`, the Worker calls `Atomics.wait()` — blocking the Worker thread only, not the UI
3. Xterm.js displays the prompt and collects keyboard input
4. Main thread writes the value into the shared buffer and calls `Atomics.notify()`
5. Worker unblocks. Python receives the value. Execution continues.

This requires cross-origin isolation headers — configured in `vite.config.js` for development and `vercel.json` for production. Verify it is active:

```js
window.crossOriginIsolated // must return true
```

---

## Supported Languages

| File | Runtime | Output |
|------|---------|--------|
| `.py` | Pyodide (CPython 3.13 → Wasm) | Terminal |
| `.js` | Sandboxed JS Worker | Terminal |
| `.ts` | Sucrase transpiler → JS Worker | Terminal |
| `.sql` | sql.js (SQLite → Wasm) | Results grid + schema inspector |
| `.pg` | PGLite (PostgreSQL → Wasm) | Results grid + schema inspector |

**Pre-loaded packages (offline, zero CDN):** NumPy, pandas, python-dateutil, pytz, six, tzdata

---

## Tech Stack

| Technology | Role |
|-----------|------|
| React 18 | UI orchestration, state management |
| Vite + vite-plugin-pwa | Build tooling, ServiceWorker generation |
| Monaco Editor | VS Code's editing engine for the editor surface |
| Pyodide (bundled locally) | CPython 3.13 compiled to WebAssembly |
| sql.js | SQLite compiled to WebAssembly |
| PGLite | PostgreSQL compiled to WebAssembly with OPFS-backed persistence |
| Xterm.js + xterm-addon-fit | ANSI terminal emulator with auto-resize and 10,000 line scrollback |
| Sucrase | Runtime TypeScript transpilation |
| Web Workers | Isolated execution for Python, JS/TS, SQLite, PostgreSQL, and file I/O |
| OPFS | Persistent local storage for files and SQL state |
| SharedArrayBuffer + Atomics | Blocking `input()` support without freezing the UI |

---

## Local Setup

```bash
git clone https://github.com/WTC-Group-2/wtc-round-2-group-2-codeinit.git
cd wtc-round-2-group-2-codeinit
npm install
npm run dev
```

Open `http://localhost:5173`. Verify in the browser console:

```js
window.crossOriginIsolated // must return true
```

If this returns `false`, the COOP/COEP headers are not applying. `input()` will not work until this is resolved.

**Production build:**

```bash
npm run build
npm run preview
```

After build, open DevTools → Application → Service Workers. Status must show **activated and running**. Check the Network tab — every asset should show **(ServiceWorker)**, not a network request.

---

## The Proof

The architecture makes one claim: WasmForge runs entirely offline after first load, with real Python execution, interactive input, and persistent files.

Here is how to verify that claim in 90 seconds:

1. Open the [live demo](https://wasm-forge.vercel.app/)
2. Write a NumPy script that calls `input()`
3. Turn on Airplane Mode
4. Click Run — terminal prompts for input, type a value, output appears
5. Hard refresh the tab (`Ctrl+Shift+R`)
6. The file is still there

Every step of that sequence is a verifiable claim with a specific technical mechanism behind it. None of it depends on a backend.

---

## Repository Structure

```
src/
├── App.jsx                  — responsive shell, execution router, panel orchestration
├── main.jsx                 — React root, ServiceWorker registration
├── monacoSetup.js           — Monaco local worker config, no CDN dependency
├── constants/
│   └── defaultPython.js     — starter Python template
├── components/
│   ├── Editor.jsx           — Monaco editor integration
│   ├── FileTree.jsx         — file explorer with create/rename/delete
│   ├── SchemaInspector.jsx  — SQL schema tree from runtime metadata
│   ├── SqlResultsPanel.jsx  — SQL results grid and execution summaries
│   ├── Terminal.jsx         — Xterm.js, ANSI colors, 10k line scrollback
│   └── WorkspaceSwitcher.jsx — workspace creation and workspace switching
├── hooks/
│   ├── useIOWorker.js       — OPFS read/write/list abstraction
│   ├── useJsWorker.js       — JS/TS runtime management
│   ├── usePyodideWorker.js  — Python worker lifecycle, watchdog, kill + respawn
│   └── useSqlWorkers.js     — SQLite and PostgreSQL worker lifecycle
├── utils/
│   └── sqlRuntime.js        — SQL runtime routing and database descriptors
└── workers/
    ├── io.worker.js         — OPFS synchronous write API
    ├── js.worker.js         — JS/TS execution sandbox
    ├── pglite.worker.js     — PostgreSQL runtime in Wasm
    ├── pyodide.worker.js    — CPython Wasm, stdout/stderr capture, heartbeat
    └── sqlite.worker.js     — SQLite runtime in Wasm

public/
├── pyodide/                 — local Pyodide runtime, no CDN dependency
│   ├── pyodide.js
│   ├── pyodide.asm.wasm
│   ├── python_stdlib.zip
│   └── pyodide-lock.json
└── pyodide-wheels/          — pre-packaged wheels for offline execution
    ├── numpy-*.whl
    ├── pandas-*.whl
    └── ...
```

---

**Team Codeinit — Watch The Code 2026 — PS #10: WebIDE**
