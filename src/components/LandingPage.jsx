import { useEffect, useRef, useState } from "react";
import "../landing.css";
import { persistAppTheme, readStoredAppTheme } from "../constants/theme.js";

const previewTabs = [
  {
    id: "notebook",
    badge: "NB",
    badgeTone: "lav",
    filename: "analysis.wfnb",
    runLabel: "Run notebook",
    outputLabel: "Notebook output",
    statusLabel: "Notebook kernel ready",
    banner: "Notebook cells, plots, share links, and offline reload all from one local runtime shell.",
    editorLines: [
      { line: 1, parts: [["kw", "import"], ["nm", " pandas "], ["kw", "as"], ["nm", " pd"]] },
      { line: 2, parts: [["kw", "import"], ["nm", " matplotlib.pyplot "], ["kw", "as"], ["nm", " plt"]] },
      { line: 3, parts: [] },
      { line: 4, parts: [["cmt", "# Notebook cell 1 -> local state"]] },
      { line: 5, parts: [["nm", "scores "], ["kw", "="], ["nm", " pd.DataFrame("]] },
      { line: 6, parts: [["nm", "    ["], ["str", '{"name": "Ada", "score": 42},'], ["nm", "]"]] },
      { line: 7, parts: [] },
      { line: 8, parts: [["fn", "display"], ["nm", "(scores)"]] },
      { line: 9, parts: [["nm", 'scores.plot(x="name", y="score", kind="bar")']] },
    ],
    outputLines: [
      { tone: "sys", text: "Booting local runtimes..." },
      { tone: "ok", text: "✓ IDE shell + notebook kernel ready" },
      { tone: "result", text: "display(scores) -> DataFrame rendered" },
      { tone: "result", text: "plt.show() -> Figure ready" },
      { tone: "sys", text: "[Share] Copied share link" },
      { tone: "data", text: "helper-import ok 20" },
      { tone: "time", text: "[Local runtime] 118.4ms · zero network" },
      { tone: "result", text: "Hard refresh /ide" },
      { tone: "ok", text: "✓ still running offline" },
    ],
  },
  {
    id: "python",
    badge: "PY",
    badgeTone: "mint",
    filename: "proof.py",
    runLabel: "Run Python",
    outputLabel: "Python output",
    statusLabel: "Python worker ready",
    banner: "Python input(), helper imports, and offline proof all run on the same local worker.",
    editorLines: [
      { line: 1, parts: [["kw", "from"], ["nm", " offline_helper "], ["kw", "import"], ["fn", " compute_total"]] },
      { line: 2, parts: [["nm", "name "], ["kw", "="], ["fn", " input"], ["nm", "("], ["str", '"Offline proof > type any name: "'], ["nm", ")"]] },
      { line: 3, parts: [["nm", "values "], ["kw", "="], ["nm", " [2, 4, 6, 8]"]] },
      { line: 4, parts: [["fn", "print"], ["nm", "(f"], ["str", '"offline-proof ok for {name}"'], ["nm", ")"]] },
      { line: 5, parts: [["fn", "print"], ["nm", "("], ["str", '"helper-import ok"'], ["nm", ", "], ["fn", "compute_total"], ["nm", "(values))"]] },
    ],
    outputLines: [
      { tone: "sys", text: "Python runtime warm" },
      { tone: "prompt", text: "Offline proof > type any name:", trailing: "Ada" },
      { tone: "result", text: "offline-proof ok for Ada" },
      { tone: "data", text: "helper-import ok 20" },
      { tone: "time", text: "[Local runtime] 101.7ms · zero network" },
    ],
  },
  {
    id: "javascript",
    badge: "JS",
    badgeTone: "amber",
    filename: "runtime.js",
    runLabel: "Run JavaScript",
    outputLabel: "JavaScript output",
    statusLabel: "JS worker ready",
    banner: "Async JavaScript stays inside its own worker so the shell keeps responding.",
    editorLines: [
      { line: 1, parts: [["kw", "const"], ["nm", " values "], ["kw", "="], ["nm", " [2, 4, 6]"]] },
      { line: 2, parts: [["kw", "const"], ["nm", " total "], ["kw", "="], ["nm", " values.reduce((sum, value) => sum + value, 0)"]] },
      { line: 3, parts: [] },
      { line: 4, parts: [["nm", "console.log"], ["nm", "("], ["str", '"js-runtime ok"'], ["nm", ", total)"]] },
      { line: 5, parts: [["nm", "setTimeout"], ["nm", "(() => {"]] },
      { line: 6, parts: [["nm", "  console.log"], ["nm", "("], ["str", '"async callback ok"'], ["nm", ")"]] },
      { line: 7, parts: [["nm", "}, 80)"]] },
    ],
    outputLines: [
      { tone: "sys", text: "JavaScript worker warm" },
      { tone: "result", text: "js-runtime ok 12" },
      { tone: "ok", text: "async callback ok" },
      { tone: "time", text: "[Local runtime] 24.9ms · zero network" },
    ],
  },
  {
    id: "typescript",
    badge: "TS",
    badgeTone: "sky",
    filename: "shared-demo.ts",
    runLabel: "Run TypeScript",
    outputLabel: "TypeScript output",
    statusLabel: "TypeScript worker ready",
    banner: "TypeScript transpiles locally, then runs without a server hop or cloud compiler.",
    editorLines: [
      { line: 1, parts: [["kw", "type"], ["nm", " RuntimeBadge "], ["kw", "="], ["nm", " { name: string; score: number }"]] },
      { line: 2, parts: [["kw", "const"], ["nm", " badges: RuntimeBadge[] "], ["kw", "="], ["nm", " ["]] },
      { line: 3, parts: [["nm", "  { name: "], ["str", '"WasmForge"'], ["nm", ", score: "], ["num", "98"], ["nm", " },"]] },
      { line: 4, parts: [["nm", "]"]] },
      { line: 5, parts: [["kw", "const"], ["nm", " leader "], ["kw", "="], ["nm", " badges[0]"]] },
      { line: 6, parts: [["nm", "console.log"], ["nm", "("], ["str", '"ts-runtime ok"'], ["nm", ", leader.name, leader.score)"]] },
    ],
    outputLines: [
      { tone: "sys", text: "Sucrase transpiler warm" },
      { tone: "ok", text: "TypeScript worker ready" },
      { tone: "result", text: "ts-runtime ok WasmForge 98" },
      { tone: "sys", text: "[Share] Copied share link" },
      { tone: "time", text: "[Local runtime] 31.2ms · zero network" },
    ],
  },
];

const heroSignals = [
  {
    label: "Notebook mode",
    detail: "Shared Python cells with inline tables and plots",
  },
  {
    label: "Offline proof",
    detail: "Hard refresh `/ide` after Airplane Mode",
  },
  {
    label: "Share links",
    detail: "Copy the active file into a backend-free URL",
  },
  {
    label: "Local execution",
    detail: "Visible runtime timing from the current device",
  },
];

const capabilityPanels = [
  {
    tone: "amber",
    eyebrow: "Python Notebook",
    title: "Cells, DataFrames, and plots in one local session",
    description:
      "Notebook files run on the same browser-native Python runtime as the IDE. Cells share state, `display(df)` renders inline tables, and `plt.show()` renders figures directly below the code.",
    points: [
      "Run cells individually or run all",
      "Restart the Python session when you want a clean slate",
      "Keep stdout, stderr, tables, and plots close to the code",
    ],
    foot: "Scoped on purpose: real Python notebooks, not a fake Jupyter skin.",
  },
  {
    tone: "mint",
    eyebrow: "Offline Proof",
    title: "Reload the IDE after Airplane Mode and keep working",
    description:
      "The strongest claim is visible in the product itself. Warm the runtime once, click `Offline-ready`, prepare the demo workspace, turn Wi-Fi off, hard refresh `/ide`, and run again.",
    points: [
      "Service Worker caches the runtime pack after first load",
      "OPFS keeps workspaces and notebook files on the device",
      "Synchronous `input()` still works because only the worker blocks",
    ],
    foot: "This is the thing judges can verify live in under a minute.",
  },
  {
    tone: "sky",
    eyebrow: "Share + Imports",
    title: "Share files by URL and import helpers locally",
    description:
      "The active file can be copied into a URL hash with no backend. Open it in a new tab and WasmForge creates a dedicated shared workspace. Python can also import sibling helper files in the same workspace.",
    points: [
      "Single-file sharing with no server execution layer",
      "Dedicated `shared-*` workspaces for imported links",
      "Hardened sibling-file imports for Python projects",
    ],
    foot: "This turns the IDE from a local demo into something judges can actually pass around.",
  },
];

const stackGroups = [
  {
    tone: "amber",
    label: "Product",
    items: [
      ["Offline-ready", "visible proof flow inside the IDE"],
      ["Python Notebook", "shared-session cells with inline output"],
      ["Share links", "copy the active file into a URL"],
      ["Local timing", "execution proof from the current device"],
    ],
  },
  {
    tone: "mint",
    label: "Runtime",
    items: [
      ["Pyodide", "CPython to WebAssembly"],
      ["matplotlib + pandas", "offline plotting and tables"],
      ["sql.js + PGlite", "SQLite and PostgreSQL in-browser"],
      ["Sucrase", "TypeScript to JavaScript"],
    ],
  },
  {
    tone: "sky",
    label: "Reliability",
    items: [
      ["OPFS", "workspace persistence through reloads"],
      ["Service Worker", "cached runtime pack after first load"],
      ["SharedArrayBuffer", "blocking `input()` without freezing the UI"],
      ["Worker watchdog", "infinite-loop recovery for Python"],
    ],
  },
];

const revealSelector = ".wf-rv";
const repositoryUrl = "https://github.com/Yumekaz/WasmForge";
const proofSteps = [
  "Open `/ide` and warm the runtime once.",
  "Click `⚡ Offline-ready` and prepare the demo workspace.",
  "Turn Wi-Fi off. Airplane Mode is the real test.",
  "Hard refresh `/ide`. The shell returns from cache instead of a server.",
  "Run Python again, answer `input()`, and keep the same local files.",
  "Open a notebook or shared link and the local-first story still holds.",
];

function outputDelay(index) {
  if (index < 3) {
    return 1200 + index * 650;
  }
  return 1200 + 3 * 650 + (index - 3) * 300;
}

export default function LandingPage({ onOpenIde }) {
  const [theme, setTheme] = useState(() => readStoredAppTheme());
  const [wifiOnline, setWifiOnline] = useState(true);
  const [activePreviewId, setActivePreviewId] = useState(previewTabs[0].id);
  const [previewRunKey, setPreviewRunKey] = useState(0);
  const [visibleOutputCount, setVisibleOutputCount] = useState(0);
  const [isPreviewRunning, setIsPreviewRunning] = useState(false);
  const [themeTransition, setThemeTransition] = useState(null);
  const themeTransitionTimersRef = useRef([]);
  const previewTimersRef = useRef([]);

  const activePreview = previewTabs.find((tab) => tab.id === activePreviewId) ?? previewTabs[0];
  const outputBannerVisible = visibleOutputCount >= activePreview.outputLines.length;

  const proofStepsVisible = !wifiOnline;

  useEffect(() => {
    document.body.dataset.page = "landing";
    return () => {
      delete document.body.dataset.page;
    };
  }, []);

  useEffect(() => {
    return () => {
      themeTransitionTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      themeTransitionTimersRef.current = [];
      previewTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      previewTimersRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    persistAppTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const syncTheme = (event) => {
      setTheme(event.detail?.theme === "inverted" ? "inverted" : "default");
    };

    const syncThemeFromStorage = (event) => {
      if (event.key && event.key !== "wasmforge:theme" && event.key !== "wasmforge:landing-theme") {
        return;
      }
      setTheme(readStoredAppTheme());
    };

    window.addEventListener("wasmforge-theme-change", syncTheme);
    window.addEventListener("storage", syncThemeFromStorage);
    return () => {
      window.removeEventListener("wasmforge-theme-change", syncTheme);
      window.removeEventListener("storage", syncThemeFromStorage);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") {
      return undefined;
    }

    const nodes = Array.from(document.querySelectorAll(revealSelector));
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            return;
          }
          entry.target.classList.add("wf-vis");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.12 },
    );

    nodes.forEach((node) => observer.observe(node));

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    previewTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    previewTimersRef.current = [];
    setVisibleOutputCount(0);
    setIsPreviewRunning(true);

    const timers = activePreview.outputLines.map((_, index) =>
      window.setTimeout(() => {
        setVisibleOutputCount(index + 1);
        if (index === activePreview.outputLines.length - 1) {
          setIsPreviewRunning(false);
        }
      }, outputDelay(index)),
    );

    previewTimersRef.current = timers;

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [activePreview, previewRunKey]);

  const openIde = (event) => {
    event?.preventDefault?.();

    if (onOpenIde) {
      onOpenIde();
      return;
    }

    window.location.assign("/ide");
  };

  const handleThemeToggle = (event) => {
    if (themeTransition) {
      return;
    }

    const nextTheme = theme === "default" ? "inverted" : "default";
    const rect = event.currentTarget.getBoundingClientRect();
    const revealX = rect.left + rect.width / 2;
    const revealY = rect.top + rect.height / 2;

    themeTransitionTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    themeTransitionTimersRef.current = [];

    setThemeTransition({
      x: revealX,
      y: revealY,
      theme: nextTheme,
      key: Date.now(),
    });

    setTheme(nextTheme);

    const cleanupTimer = window.setTimeout(() => {
      setThemeTransition(null);
      themeTransitionTimersRef.current = [];
    }, 900);

    themeTransitionTimersRef.current = [cleanupTimer];
  };

  return (
    <div className="wf-landing" data-theme={theme}>
      {themeTransition ? (
        <div
          key={themeTransition.key}
          className={`wf-theme-reveal wf-theme-reveal--${themeTransition.theme}`}
          style={{
            "--wf-reveal-x": `${themeTransition.x}px`,
            "--wf-reveal-y": `${themeTransition.y}px`,
          }}
          aria-hidden="true"
        />
      ) : null}

      <nav className="wf-nav">
        <a href="/" className="wf-nav__logo" aria-label="WasmForge home">
          <div className="wf-logo-icon">W</div>
          <div className="wf-logo-word">
            Wasm<span>Forge</span>
          </div>
        </a>

        <ul className="wf-nav__links">
          <li><a href="#why">Features</a></li>
          <li><a href="#proof">Proof</a></li>
          <li><a href="#arch">Architecture</a></li>
          <li><a href="#stack">Stack</a></li>
        </ul>

        <div className="wf-nav__actions">
          <button
            type="button"
            className="wf-btn wf-btn--theme"
            aria-label={theme === "default" ? "Switch to dusk theme" : "Switch to forge theme"}
            title={theme === "default" ? "Switch to dusk theme" : "Switch to forge theme"}
            onClick={handleThemeToggle}
            disabled={Boolean(themeTransition)}
          >
            <span
              className={`wf-theme-toggle wf-theme-toggle--${theme}`}
              aria-hidden="true"
            />
          </button>
          <a href={repositoryUrl} className="wf-btn wf-btn--ghost" target="_blank" rel="noreferrer">
            Source
          </a>
          <a href="/ide" className="wf-btn wf-btn--primary" onClick={openIde}>
            <span>▶</span>
            Open IDE
          </a>
        </div>
      </nav>

      <section className="wf-section wf-hero">
        <div className="wf-hero__glow" aria-hidden="true" />
        <div className="wf-hero__inner">
          <h1 className="wf-hero__title">
            <span className="wf-dim">Code past</span>
            <br />
            <span className="wf-warm">the internet.</span>
          </h1>
          <p className="wf-hero__sub">
            WasmForge now ships as both a local-first IDE and a scoped Python notebook:
            shared notebook cells, inline DataFrames, inline Matplotlib, backend-free share links,
            visible local execution proof, and a demo path that still works after a hard refresh offline.
          </p>
          <div className="wf-hero__cta">
            <a href="/ide" className="wf-btn wf-btn--hero" onClick={openIde}>
              <span>▶</span>
              Open /ide
            </a>
            <a href="#proof" className="wf-btn wf-btn--hero-ghost">
              See offline proof
            </a>
          </div>

          <div className="wf-hero__signals wf-rv">
            {heroSignals.map((signal) => (
              <div className="wf-signal" key={signal.label}>
                <div className="wf-signal__label">{signal.label}</div>
                <div className="wf-signal__detail">{signal.detail}</div>
              </div>
            ))}
          </div>

          <div className="wf-terminal-preview wf-rv">
            <div className="wf-terminal-preview__bar">
              <div className="wf-window-dots" aria-hidden="true">
                <span className="wf-dot wf-dot--red" />
                <span className="wf-dot wf-dot--yellow" />
                <span className="wf-dot wf-dot--green" />
              </div>

              <div className="wf-preview-tabs">
                {previewTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className={`wf-preview-tab ${tab.id === activePreview.id ? "wf-preview-tab--active" : ""}`}
                    onClick={() => setActivePreviewId(tab.id)}
                    aria-pressed={tab.id === activePreview.id}
                  >
                    <span className={`wf-preview-tab__badge wf-preview-tab__badge--${tab.badgeTone}`}>{tab.badge}</span>
                    <span className="wf-preview-tab__name">{tab.filename}</span>
                  </button>
                ))}
              </div>

              <div className="wf-preview-actions">
                <div className="wf-preview-status">
                  <span className="wf-preview-status__dot" />
                  {activePreview.statusLabel}
                </div>
                <button
                  type="button"
                  className={`wf-preview-run ${isPreviewRunning ? "wf-preview-run--running" : ""}`}
                  onClick={() => setPreviewRunKey((current) => current + 1)}
                >
                  <span className="wf-preview-run__icon">▶</span>
                  {isPreviewRunning ? "Running..." : activePreview.runLabel}
                </button>
              </div>
            </div>

            <div className="wf-terminal-preview__body">
              <div className="wf-terminal-preview__editor">
                {activePreview.editorLines.map((line) => (
                  <div className="wf-code-line" key={line.line}>
                    <span className="wf-code-line__number">{line.line}</span>
                    <span className="wf-code-line__content">
                      {line.parts.map(([tone, text], partIndex) => (
                        <span className={`wf-tone wf-tone--${tone}`} key={`${line.line}-${partIndex}`}>
                          {text}
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
                <div className="wf-code-line">
                  <span className="wf-code-line__number">{activePreview.editorLines.length + 1}</span>
                  <span className="wf-code-line__content">
                    <span className="wf-code-cursor" />
                  </span>
                </div>
              </div>

              <div className="wf-terminal-preview__output">
                <div className="wf-output-header">
                  <span className="wf-preview-status__dot" />
                  {activePreview.outputLabel}
                </div>

                {activePreview.outputLines.map((line, index) => (
                  <div
                    key={`${activePreview.id}-${line.text}`}
                    className={`wf-output-line wf-output-line--${line.tone} ${visibleOutputCount > index ? "wf-output-line--visible" : ""}`}
                  >
                    {line.text}
                    {line.trailing ? <span className="wf-output-line__input">{line.trailing}</span> : null}
                  </div>
                ))}
              </div>
            </div>

            <div className={`wf-terminal-banner ${outputBannerVisible ? "wf-terminal-banner--visible" : ""}`}>
              {activePreview.banner}
            </div>
          </div>
        </div>
      </section>

      <section className="wf-section wf-section--why" id="why">
        <div className="wf-section-head wf-rv">
          <div className="wf-section-tag">What Ships Now</div>
          <h2 className="wf-section-title">
            More than an offline IDE.
            <br />
            <span className="wf-dim">A local compute surface judges can actually test.</span>
          </h2>
        </div>

        <div className="wf-capability-grid wf-rv">
          {capabilityPanels.map((panel) => (
            <article key={panel.title} className={`wf-capability-panel wf-capability-panel--${panel.tone}`}>
              <div className="wf-capability-panel__eyebrow">{panel.eyebrow}</div>
              <h3>{panel.title}</h3>
              <p>{panel.description}</p>
              <ul className="wf-capability-list">
                {panel.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
              <div className="wf-capability-foot">{panel.foot}</div>
            </article>
          ))}
        </div>
      </section>

      <section className="wf-section wf-section--proof" id="proof">
        <div className="wf-section-head wf-rv">
          <div className="wf-section-tag">The Proof</div>
          <h2 className="wf-section-title">90 seconds. No network.</h2>
          <p className="wf-section-copy">
            This is the sequence we want judges to try themselves: offline reload, synchronous input,
            persisted files, and a notebook/data workflow that still survives the network drop.
          </p>
        </div>

        <div className="wf-proof wf-rv">
          <div className="wf-proof__top">
            <div className="wf-proof__label">Verification sequence</div>
            <button type="button" className="wf-proof__wifi" onClick={() => setWifiOnline((value) => !value)}>
              <span className={`wf-proof__toggle ${wifiOnline ? "" : "wf-proof__toggle--off"}`}>
                <span className="wf-proof__toggle-knob" />
              </span>
              <span className={`wf-proof__wifi-text ${wifiOnline ? "wf-proof__wifi-text--on" : "wf-proof__wifi-text--off"}`}>
                Wi-Fi: {wifiOnline ? "ON" : "OFF"}
              </span>
            </button>
          </div>

          <div className="wf-proof__steps">
            {proofSteps.map((step, index) => {
              const visible = index < 2 || proofStepsVisible;
              const done = index < 2 || proofStepsVisible;
              return (
                <div key={step} className={`wf-proof-step ${visible ? "wf-proof-step--visible" : ""}`}>
                  <div className={`wf-proof-step__index ${done ? "wf-proof-step__index--done" : ""}`}>{index + 1}</div>
                  <div className="wf-proof-step__text">{step}</div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="wf-section wf-section--arch" id="arch">
        <div className="wf-section-head wf-rv">
          <div className="wf-section-tag">Architecture</div>
          <h2 className="wf-section-title">
            The risky work stays off the UI thread.
            <br />
            <span className="wf-dim">That is why the shell survives loops, reloads, and offline runs.</span>
          </h2>
        </div>

        <div className="wf-diagram wf-rv">
          <div className="wf-diagram__label">Thread model</div>
          <div className="wf-diagram-row">
            <div className="wf-diagram-node wf-diagram-node--sky">Main Thread <span className="wf-node-sub">UI & Shell</span></div>
            <div className="wf-diagram-arrow">→</div>
            <div className="wf-diagram-node wf-diagram-node--lav">Execution Router <span className="wf-node-sub">Task Queue</span></div>
            <div className="wf-diagram-arrow">→</div>
            <div className="wf-diagram-branches">
              <div className="wf-diagram-node wf-diagram-node--mint">Python Worker <span className="wf-node-sub">Pyodide</span></div>
              <div className="wf-diagram-node wf-diagram-node--amber">Web Worker <span className="wf-node-sub">Sucrase JS/TS</span></div>
              <div className="wf-diagram-node wf-diagram-node--sky">Data Workers <span className="wf-node-sub">SQLite + PGlite</span></div>
            </div>
          </div>
          <div className="wf-diagram-row">
            <div className="wf-diagram-node wf-diagram-node--sky">Main Thread <span className="wf-node-sub">OPFS Sync</span></div>
            <div className="wf-diagram-arrow">→</div>
            <div className="wf-diagram-node wf-diagram-node--lav">I/O Worker <span className="wf-node-sub">File Access</span></div>
            <div className="wf-diagram-arrow">→</div>
            <div className="wf-diagram-node wf-diagram-node--amber">OPFS <span className="wf-node-sub">Persistence</span></div>
          </div>
          <div className="wf-diagram-note">
            <span className="wf-tone wf-tone--mint">SharedArrayBuffer</span> ↔ <span className="wf-tone wf-tone--mint">Python input()</span> blocks the worker thread instead of freezing the UI.
          </div>
        </div>
      </section>

      <section className="wf-section wf-section--stack" id="stack">
        <div className="wf-section-head wf-rv">
          <div className="wf-section-tag">Under The Hood</div>
          <h2 className="wf-section-title">
            The implementation is serious.
            <br />
            <span className="wf-dim">The landing page should finally say that clearly.</span>
          </h2>
        </div>

        <div className="wf-stack-grid wf-rv">
          {stackGroups.map((group) => (
            <article className="wf-stack-group" key={group.label}>
              <div className={`wf-stack-group__label wf-stack-group__label--${group.tone}`}>{group.label}</div>
              <div className="wf-stack-group__items">
                {group.items.map(([name, description]) => (
                  <div className="wf-stack-group__item" key={name}>
                    <span>{name}</span> {description}
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="wf-section wf-section--cta">
        <div className="wf-cta-glow" aria-hidden="true" />
        <h2 className="wf-cta-title wf-rv">
          Warm the runtime once.
          <br />
          <span className="wf-warm">Then dare it to fail.</span>
        </h2>
        <p className="wf-cta-copy wf-rv">
          Open the IDE, copy a share link, render a plot, hard refresh offline, and watch the same
          browser tab keep behaving like a real local dev environment.
        </p>
        <div className="wf-cta-actions wf-rv">
          <a href="/ide" className="wf-btn wf-btn--hero" onClick={openIde}>
            <span>▶</span>
            Open WasmForge
          </a>
          <a href={repositoryUrl} className="wf-btn wf-btn--hero-ghost" target="_blank" rel="noreferrer">
            View Source
          </a>
        </div>
      </section>

      <footer className="wf-footer">
        <div className="wf-footer__brand">
          <div className="wf-logo-icon wf-logo-icon--small">W</div>
          WasmForge
        </div>
        <div className="wf-footer__tagline">Zero backend. Maximum impact.</div>
      </footer>
    </div>
  );
}
