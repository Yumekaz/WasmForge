import { useEffect, useRef, useState } from "react";
import "../landing.css";

const heroEditorLines = [
  { line: 1, kind: "code", parts: [["kw", "import"], ["nm", " numpy "], ["kw", "as"], ["nm", " np"]] },
  { line: 2, kind: "code", parts: [["kw", "import"], ["nm", " pandas "], ["kw", "as"], ["nm", " pd"]] },
  { line: 3, kind: "blank", parts: [] },
  { line: 4, kind: "comment", parts: [["cmt", "# Your CPU. Your disk. No server."]] },
  { line: 5, kind: "code", parts: [["nm", "size "], ["kw", "="], ["fn", " int"], ["nm", "("], ["fn", "input"], ["nm", "("], ["str", '"Matrix size: "'], ["nm", "))"]] },
  { line: 6, kind: "code", parts: [["nm", "m "], ["kw", "="], ["nm", " np.random.rand(size, size)"]] },
  { line: 7, kind: "blank", parts: [] },
  { line: 8, kind: "code", parts: [["fn", "print"], ["nm", "("], ["str", '"Det: "'], ["kw", ","], ["nm", " np.linalg.det(m)"], ["nm", ")"]] },
  { line: 9, kind: "code", parts: [["fn", "print"], ["nm", "(pd.DataFrame(m).describe())"]] },
];

const outputLines = [
  { tone: "sys", text: "Booting local runtimes..." },
  { tone: "ok", text: "✓ Python, JS/TS, SQLite, PostgreSQL ready" },
  { tone: "sys", text: "$ python main.py" },
  { tone: "prompt", text: "Matrix size: ", trailing: "3" },
  { tone: "data", text: "Det: 0.3128" },
  { tone: "result", text: "SELECT * FROM cache_status;" },
  { tone: "result", text: "offline  persisted  local" },
  { tone: "result", text: "true     true       true" },
  { tone: "time", text: "✓ 847ms · zero network" },
];

const featureCards = [
  {
    tone: "amber",
    icon: "✈",
    title: 'True Offline — Not "Kinda Offline"',
    description:
      "The runtime pack, shell assets, and editor dependencies cache locally on first load. Turn Wi-Fi off. The IDE keeps running.",
    badge: "25MB pre-cached",
  },
  {
    tone: "mint",
    icon: "▣",
    title: "Thread Isolation",
    description:
      "Every runtime stays in its own Web Worker. A loop in Python, JS, or SQL execution cannot freeze the shell. The watchdog recovers it.",
    badge: "worker.terminate()",
  },
  {
    tone: "sky",
    icon: "⎙",
    title: "Crash-Proof Files",
    description:
      "OPFS writes protect workspaces against refreshes, crashes, and tab closes. The browser is the disk.",
  },
  {
    tone: "lav",
    icon: "⌘",
    title: "Five Languages, Zero API Calls",
    description:
      "Python, JavaScript, TypeScript, SQLite, and PostgreSQL all execute locally in the browser. No remote runtime involved.",
  },
  {
    tone: "rose",
    icon: "↻",
    title: "Heartbeat Guard",
    description:
      "Workers pulse every second. If a worker stalls, WasmForge terminates it and restores a healthy runtime without freezing the UI.",
  },
];

const stackGroups = [
  {
    tone: "amber",
    label: "Runtime",
    items: [
      ["Pyodide 0.26", "CPython to Wasm"],
      ["Sucrase", "TS transpiler"],
      ["sql.js", "SQLite in Wasm"],
      ["PGlite", "PostgreSQL in Wasm"],
    ],
  },
  {
    tone: "mint",
    label: "Interface",
    items: [
      ["React 18", "UI layer"],
      ["Monaco", "Editor engine"],
      ["Xterm.js", "Terminal surface"],
    ],
  },
  {
    tone: "sky",
    label: "System",
    items: [
      ["OPFS", "Workspace persistence"],
      ["SharedArrayBuffer", "stdin bridge"],
      ["ServiceWorker", "Offline cache"],
      ["Web Workers", "Runtime isolation"],
    ],
  },
];

const revealSelector = ".wf-rv";
const repositoryUrl = "https://github.com/Yumekaz/WasmForge";
const landingThemeStorageKey = "wasmforge:landing-theme";
const proofSteps = [
  "Open the IDE. Write a Python script, JavaScript file, or SQL query.",
  "Turn Wi-Fi off. Airplane Mode is the real test.",
  "Run the file. The terminal or result panel still responds immediately.",
  "Hard refresh. The shell reloads from cache instead of a server.",
  "The same workspace is still there because files persist locally.",
];

function outputDelay(index) {
  if (index < 3) {
    return 1200 + index * 650;
  }
  return 1200 + 3 * 650 + (index - 3) * 300;
}

export default function LandingPage({ onOpenIde }) {
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") {
      return "default";
    }

    return window.localStorage.getItem(landingThemeStorageKey) === "inverted"
      ? "inverted"
      : "default";
  });
  const [wifiOnline, setWifiOnline] = useState(true);
  const [visibleOutputCount, setVisibleOutputCount] = useState(0);
  const [themeTransition, setThemeTransition] = useState(null);
  const themeTransitionTimersRef = useRef([]);

  const outputBannerVisible = visibleOutputCount >= outputLines.length;
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
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const timers = outputLines.map((_, index) =>
      window.setTimeout(() => {
        setVisibleOutputCount(index + 1);
      }, outputDelay(index)),
    );

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    window.localStorage.setItem(landingThemeStorageKey, theme);
    return undefined;
  }, [theme]);

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
            {theme === "default" ? "◐" : "◑"}
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
            <span className="wf-dim">Code anywhere.</span>
            <br />
            <span className="wf-warm">Need nothing.</span>
          </h1>
          <p className="wf-hero__sub">
            Five languages. Zero servers. One browser tab. Everything compiles to WebAssembly,
            runs on your CPU, and persists to local storage offline after the first load.
          </p>
          <div className="wf-hero__cta">
            <a href="/ide" className="wf-btn wf-btn--hero" onClick={openIde}>
              <span>▶</span>
              Open WasmForge
            </a>
            <a href="#proof" className="wf-btn wf-btn--hero-ghost">
              See the proof
            </a>
          </div>

          <div className="wf-terminal-preview wf-rv">
            <div className="wf-terminal-preview__bar">
              <div className="wf-window-dots" aria-hidden="true">
                <span className="wf-dot wf-dot--red" />
                <span className="wf-dot wf-dot--yellow" />
                <span className="wf-dot wf-dot--green" />
              </div>

              <div className="wf-preview-tabs">
                <div className="wf-preview-tab wf-preview-tab--active">
                  <span className="wf-preview-tab__badge">PY</span>
                  main.py
                </div>
                <div className="wf-preview-tab">
                  <span className="wf-preview-tab__badge">TS</span>
                  worker.ts
                </div>
                <div className="wf-preview-tab">
                  <span className="wf-preview-tab__badge">PG</span>
                  query.pg
                </div>
              </div>

              <div className="wf-preview-status">
                <span className="wf-preview-status__dot" />
                Local runtimes ready
              </div>
            </div>

            <div className="wf-terminal-preview__body">
              <div className="wf-terminal-preview__editor">
                {heroEditorLines.map((line) => (
                  <div className="wf-code-line" key={line.line}>
                    <span className="wf-code-line__number">{line.line}</span>
                    <span className="wf-code-line__content">
                      {line.parts.map(([tone, text], partIndex) => (
                        <span className={`wf-tone wf-tone--${tone}`} key={`${line.line}-${partIndex}`}>
                          {text}
                        </span>
                      ))}
                      {line.line === 10 ? <span className="wf-code-cursor" /> : null}
                    </span>
                  </div>
                ))}
                <div className="wf-code-line">
                  <span className="wf-code-line__number">10</span>
                  <span className="wf-code-line__content">
                    <span className="wf-code-cursor" />
                  </span>
                </div>
              </div>

              <div className="wf-terminal-preview__output">
                <div className="wf-output-header">
                  <span className="wf-preview-status__dot" />
                  Output
                </div>

                {outputLines.map((line, index) => (
                  <div
                    key={line.text}
                    className={`wf-output-line wf-output-line--${line.tone} ${visibleOutputCount > index ? "wf-output-line--visible" : ""}`}
                  >
                    {line.text}
                    {line.trailing ? <span className="wf-output-line__input">{line.trailing}</span> : null}
                  </div>
                ))}
              </div>
            </div>

            <div className={`wf-terminal-banner ${outputBannerVisible ? "wf-terminal-banner--visible" : ""}`}>
              ✈ Offline cache primed. Five runtimes, one browser tab.
            </div>
          </div>
        </div>
      </section>

      <section className="wf-section wf-section--why" id="why">
        <div className="wf-section-head wf-rv">
          <div className="wf-section-tag">Why WasmForge</div>
          <h2 className="wf-section-title">
            Everything runs here.
            <br />
            <span className="wf-dim">Nothing leaves.</span>
          </h2>
        </div>

        <div className="wf-bento wf-rv">
          {featureCards.map((card, index) => (
            <article
              key={card.title}
              className={`wf-bento-card ${index === 0 ? "wf-bento-card--wide" : ""}`}
            >
              <div className={`wf-bento-card__icon wf-bento-card__icon--${card.tone}`}>{card.icon}</div>
              <h3>{card.title}</h3>
              <p>{card.description}</p>
              {card.badge ? <span className="wf-bento-card__badge">{card.badge}</span> : null}
            </article>
          ))}
        </div>
      </section>

      <section className="wf-section wf-section--proof" id="proof">
        <div className="wf-section-head wf-rv">
          <div className="wf-section-tag">The Proof</div>
          <h2 className="wf-section-title">90 seconds. No network.</h2>
          <p className="wf-section-copy">
            Every claim is falsifiable. Turn Wi-Fi off and run the product.
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
            Built to stay responsive.
            <br />
            <span className="wf-dim">Not just for the demo.</span>
          </h2>
        </div>

        <div className="wf-thread-map wf-rv">
          <div className="wf-thread-map__label">Thread model</div>
          <div><span className="wf-tone wf-tone--sky">Main Thread</span> → <span className="wf-tone wf-tone--lav">Execution Router</span> → <span className="wf-tone wf-tone--mint">Python Worker</span> (Pyodide)</div>
          <div className="wf-thread-map__indent">├→ <span className="wf-tone wf-tone--amber">JS/TS Worker</span> (Sucrase)</div>
          <div className="wf-thread-map__indent">├→ <span className="wf-tone wf-tone--sky">SQLite Worker</span> (sql.js)</div>
          <div className="wf-thread-map__indent">└→ <span className="wf-tone wf-tone--sky">PGlite Worker</span> (PostgreSQL)</div>
          <div><span className="wf-tone wf-tone--sky">Main Thread</span> → <span className="wf-tone wf-tone--lav">I/O Worker</span> → <span className="wf-tone wf-tone--amber">OPFS</span></div>
          <div><span className="wf-tone wf-tone--mint">SharedArrayBuffer</span> ↔ <span className="wf-tone wf-tone--mint">Python input()</span> blocks the worker, not the UI.</div>
        </div>
      </section>

      <section className="wf-section wf-section--stack" id="stack">
        <div className="wf-section-head wf-rv">
          <div className="wf-section-tag">Tech Stack</div>
          <h2 className="wf-section-title">
            Minimal surface.
            <br />
            <span className="wf-dim">Maximum depth.</span>
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
          Turn on Airplane Mode.
          <br />
          <span className="wf-warm">Then open the IDE.</span>
        </h2>
        <p className="wf-cta-copy wf-rv">Your CPU. Your disk. Your code. Always.</p>
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
