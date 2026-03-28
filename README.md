<div align="center">
  <img src="./wasmforge-logo.png" alt="WasmForge Logo" width="200" />

  # 🛠️ WasmForge

  **A high-performance, browser-native IDE that works anywhere, even offline.**

  [![Live Demo](https://img.shields.io/badge/Live-Demo-%232EA043?style=for-the-badge&logo=vercel)](https://wasm-forge.vercel.app/)
  [![GitHub](https://img.shields.io/badge/GitHub-Repo-181717?style=for-the-badge&logo=github)](https://github.com/WTC-Group-2/wtc-round-2-group-2-codeinit)
  [![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)

  ---

  WasmForge is a professional-grade, zero-backend WebIDE. It empowers users to write, execute, and store code entirely within the browser—no server required.

</div>

## 🚀 Why WasmForge?

Most online IDEs rely on heavy backends for code execution and file storage. WasmForge flips the script by leveraging **WebAssembly**, **Web Workers**, and **Origin Private File System (OPFS)** to bring the full power of a local machine to a single browser tab.

- **Zero Latency:** Code runs locally in the browser.
- **Persistent Storage:** Files stay in the browser across refreshes.
- **Multithreaded:** UI stays fluid while runtimes are working.
- **Offline First:** Fully functional PWA with optimized asset caching.

## ✨ Key Features

- **Monaco Editor:** Industry-standard code editing experience.
- **Python Runtime:** Integrated Pyodide in a dedicated worker.
- **Interactive Terminal:** Real `input()` support using `SharedArrayBuffer` and `Atomics`.
- **Sandbox Workers:** Safe execution of `.js` and `.ts` files.
- **SQL Powerhouses:** In-browser SQLite and PostgreSQL (PGlite) engines with visual results.
- **Smart Persistence:** Deep integration with OPFS for high-speed file I/O.

## 📦 Supported Languages & Runtimes

| Type | Runtime | Output | Use Case |
| :--- | :--- | :--- | :--- |
| `.py` | **Pyodide** | Terminal | Algorithms, scripting, and data processing. |
| `.js` | **JS Worker** | Terminal | Modern JavaScript logic and prototyping. |
| `.ts` | **Sucrase** | Terminal | TypeScript development with instant transpilation. |
| `.sql` | **SQLite** | Results Panel | Relational database modeling and queries. |
| `.pg` | **PGlite** | Results Panel | Postgre-compatible database exploration. |

## 🛠️ Tech Stack

<details>
<summary>View detailed architecture</summary>

- **Core:** React, Vite, Tailwind CSS
- **Editor:** Monaco Editor
- **Terminal:** Xterm.js
- **Wasm Runtimes:** Pyodide, sql.js, PGlite
- **Storage:** OPFS (Origin Private File System)
- **Tooling:** Sucrase, vite-plugin-pwa, Web Workers
</details>

## 🏃 Local Setup

Getting started with WasmForge locally is simple:

```bash
# Clone the repository
git clone https://github.com/WTC-Group-2/wtc-round-2-group-2-codeinit.git

# Install dependencies
npm install

# Start the dev server
npm run dev
```

To create a production-ready build:
```bash
npm run build
npm run preview
```

## 🧪 Try These Snippets

### 🐍 Python (Interactive)
```python
name = input("Enter your name: ")
print(f"Hello, {name}! This is running entirely in your browser.")
```

### 💾 SQL (SQLite/Postgres)
```sql
CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
INSERT INTO users (name) VALUES ('Ada'), ('Linus');
SELECT * FROM users ORDER BY name;
```

## ⚠️ Important Considerations

- **Cross-Origin Isolation:** Required for terminal interaction. Our `vercel.json` handles this via headers.
- **Browser Compatibility:** Best experienced on Chromium-based browsers for OPFS and WebAssembly support.
- **First Load:** High-quality Wasm binaries are cached on first use for subsequent offline functionality.

---

<div align="center">
  Built by <b>Team Codeinit</b> for <b>Watch The Code 2026</b>.
</div>
