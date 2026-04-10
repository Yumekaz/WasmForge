import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Terminal from "./components/Terminal.jsx";
import FileTree from "./components/FileTree.jsx";
import SqlResultsPanel from "./components/SqlResultsPanel.jsx";
import PythonOutputPanel from "./components/PythonOutputPanel.jsx";
import { usePyodideWorker } from "./hooks/usePyodideWorker.js";
import { useIOWorker } from "./hooks/useIOWorker.js";
import { useJsWorker } from "./hooks/useJsWorker.js";
import { useSqlWorkers } from "./hooks/useSqlWorkers.js";
import {
  DEFAULT_PYTHON,
  migrateLegacyDefaultPython,
} from "./constants/defaultPython.js";
import {
  getFileExtension,
  getRuntimeKind,
  getSqlDatabaseDescriptor,
} from "./utils/sqlRuntime.js";
import { persistAppTheme, readStoredAppTheme } from "./constants/theme.js";

const DEFAULT_FILENAME = "main.py";
const DEFAULT_WORKSPACE_NAME = "local-workspace";
const ACTIVE_WORKSPACE_STORAGE_KEY = "wasmforge:active-workspace";
const RECOVERY_STORAGE_KEY_PREFIX = "wasmforge:pending-workspace-writes";
const MOBILE_LAYOUT_BREAKPOINT = 960;
const ACTIVITY_BAR_WIDTH = 40;
const DEFAULT_SIDEBAR_WIDTH = 280;
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 420;
const SIDEBAR_RESIZE_HANDLE_WIDTH = 6;
const TOP_HEADER_HEIGHT = 64;
const STATUS_BAR_HEIGHT = 24;
const BOTTOM_TABBAR_HEIGHT = 38;
const EDITOR_SPLIT_HANDLE_HEIGHT = 6;
const MOBILE_TOPBAR_HEIGHT = 58;
const MOBILE_TABBAR_HEIGHT = 44;
const MOBILE_NAV_HEIGHT = 76;
const MOBILE_STATUS_HEIGHT = 24;
const MOBILE_DOCKED_PANEL_HEIGHT = 228;
const MIN_EDITOR_PANEL_HEIGHT = 96;
const MIN_TERMINAL_PANEL_HEIGHT = 160;
const DEFAULT_EDITOR_RATIO = 0.65;
const SHARE_HASH_PREFIX = "#share=";
const SHARE_PAYLOAD_VERSION = 1;
const MAX_SHARE_URL_LENGTH = 12000;
const SHARE_STATUS_RESET_MS = 2600;
const Editor = lazy(() => import("./components/Editor.jsx"));

const IDE_THEME_PALETTES = {
  default: {
    shellBg: "#09090b",
    shellElevated: "#111114",
    shellSubtle: "#18181c",
    shellPanel: "#222228",
    shellPanelStrong: "#0d141c",
    shellBorder: "#2a2a32",
    shellBorderStrong: "#3a3a44",
    shellText: "#ececef",
    shellTextSoft: "#c4c4cc",
    shellMuted: "#8b8b96",
    shellMutedStrong: "#56565f",
    shellAccent: "#b48aea",
    shellAccentStrong: "#9a6dd4",
    shellAccentSoft: "rgba(180, 138, 234, 0.12)",
    shellAccentContrast: "#ffffff",
    shellSuccess: "#7dd8b0",
    shellWarning: "#e8c872",
    shellDanger: "#f48771",
    shellHover: "#222228",
    shellSelection: "rgba(180, 138, 234, 0.12)",
    shellEditorBg: "#09090b",
    shellOutputBg: "#0d141c",
    shellGradient: "linear-gradient(180deg, #111114 0%, #09090b 100%)",
    activityBg: "#111114",
    filePyAccent: "#7dd8b0",
    filePySurface: "rgba(70, 110, 91, 0.34)",
    fileJsAccent: "#e8c872",
    fileJsSurface: "rgba(91, 73, 33, 0.34)",
    fileTsAccent: "#72b4e8",
    fileTsSurface: "rgba(44, 72, 96, 0.34)",
    fileSqlAccent: "#b48aea",
    fileSqlSurface: "rgba(78, 54, 97, 0.34)",
    filePgAccent: "#a88de8",
    filePgSurface: "rgba(66, 52, 88, 0.34)",
    fileTxtAccent: "#afb7c2",
    fileTxtSurface: "rgba(55, 61, 69, 0.42)",
  },
  inverted: {
    shellBg: "#ebe4da",
    shellElevated: "#e2d9e8",
    shellSubtle: "#ddd3e3",
    shellPanel: "#efe8de",
    shellPanelStrong: "#f2ece2",
    shellBorder: "#d2c8d8",
    shellBorderStrong: "#c3b8cb",
    shellText: "#32283c",
    shellTextSoft: "#5e546c",
    shellMuted: "#8c8298",
    shellMutedStrong: "#a297ab",
    shellAccent: "#7350a7",
    shellAccentStrong: "#624392",
    shellAccentSoft: "rgba(115, 80, 167, 0.10)",
    shellAccentContrast: "#f5efe7",
    shellSuccess: "#61856d",
    shellWarning: "#a7793e",
    shellDanger: "#b5645d",
    shellHover: "#e8eef3",
    shellSelection: "#e5ebf1",
    shellEditorBg: "#f3ede2",
    shellOutputBg: "#f0e9df",
    shellGradient: "linear-gradient(180deg, #f0e9df 0%, #e5dcea 100%)",
    activityBg: "#e9e0eb",
    filePyAccent: "#61856d",
    filePySurface: "rgba(97, 133, 109, 0.14)",
    fileJsAccent: "#a7793e",
    fileJsSurface: "rgba(167, 121, 62, 0.10)",
    fileTsAccent: "#5d79a9",
    fileTsSurface: "rgba(93, 121, 169, 0.10)",
    fileSqlAccent: "#7350a7",
    fileSqlSurface: "rgba(115, 80, 167, 0.10)",
    filePgAccent: "#8b6ab8",
    filePgSurface: "rgba(139, 106, 184, 0.10)",
    fileTxtAccent: "#6d6479",
    fileTxtSurface: "rgba(109, 100, 121, 0.10)",
  },
};

function getIdePalette(theme) {
  return IDE_THEME_PALETTES[theme] || IDE_THEME_PALETTES.default;
}

function getIdeCssVars(palette) {
  return {
    "--ide-shell-bg": palette.shellBg,
    "--ide-shell-elevated": palette.shellElevated,
    "--ide-shell-subtle": palette.shellSubtle,
    "--ide-shell-panel": palette.shellPanel,
    "--ide-shell-panel-strong": palette.shellPanelStrong,
    "--ide-shell-border": palette.shellBorder,
    "--ide-shell-border-strong": palette.shellBorderStrong,
    "--ide-shell-text": palette.shellText,
    "--ide-shell-text-soft": palette.shellTextSoft,
    "--ide-shell-muted": palette.shellMuted,
    "--ide-shell-muted-strong": palette.shellMutedStrong,
    "--ide-shell-accent": palette.shellAccent,
    "--ide-shell-accent-strong": palette.shellAccentStrong,
    "--ide-shell-accent-soft": palette.shellAccentSoft,
    "--ide-shell-accent-contrast": palette.shellAccentContrast,
    "--ide-shell-success": palette.shellSuccess,
    "--ide-shell-warning": palette.shellWarning,
    "--ide-shell-danger": palette.shellDanger,
    "--ide-shell-hover": palette.shellHover,
    "--ide-shell-selection": palette.shellSelection,
    "--ide-shell-editor-bg": palette.shellEditorBg,
    "--ide-shell-output-bg": palette.shellOutputBg,
    "--ide-shell-gradient": palette.shellGradient,
    "--ide-activity-bg": palette.activityBg,
    "--ide-file-py-accent": palette.filePyAccent,
    "--ide-file-py-surface": palette.filePySurface,
    "--ide-file-js-accent": palette.fileJsAccent,
    "--ide-file-js-surface": palette.fileJsSurface,
    "--ide-file-ts-accent": palette.fileTsAccent,
    "--ide-file-ts-surface": palette.fileTsSurface,
    "--ide-file-sql-accent": palette.fileSqlAccent,
    "--ide-file-sql-surface": palette.fileSqlSurface,
    "--ide-file-pg-accent": palette.filePgAccent,
    "--ide-file-pg-surface": palette.filePgSurface,
    "--ide-file-txt-accent": palette.fileTxtAccent,
    "--ide-file-txt-surface": palette.fileTxtSurface,
  };
}

function getLanguage(filename) {
  const ext = getFileExtension(filename);
  switch (ext) {
    case "py":
      return "python";
    case "js":
      return "javascript";
    case "ts":
      return "typescript";
    case "sql":
    case "pg":
      return "sql";
    default:
      return "plaintext";
  }
}

function clamp(value, minimum, maximum) {
  if (maximum < minimum) {
    return minimum;
  }
  return Math.min(Math.max(value, minimum), maximum);
}

function createFileRecord(name, content = "") {
  return { name, content, language: getLanguage(name) };
}

function normalizeWorkspaceFilename(name) {
  const normalized = String(name ?? "").replace(/^\/?workspace\//u, "").trim();
  if (!normalized) {
    throw new Error("File name is required.");
  }
  if (normalized.includes("/") || normalized.includes("\\")) {
    throw new Error("Nested folders are not supported yet. Use a single file name.");
  }
  return normalized;
}

function normalizeWorkspaceName(name) {
  const normalized = String(name ?? "").trim();
  if (!normalized) {
    throw new Error("Workspace name is required.");
  }
  if (normalized.includes("/") || normalized.includes("\\")) {
    throw new Error("Workspace names cannot contain slashes.");
  }
  return normalized;
}

function encodeBase64UrlUtf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}

function decodeBase64UrlUtf8(value) {
  const normalized = String(value ?? "")
    .replace(/-/gu, "+")
    .replace(/_/gu, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function createStableShareHash(value) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

function slugifyShareSegment(value, fallback = "snippet") {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return normalized || fallback;
}

function createSharePayload(filename, code) {
  return {
    v: SHARE_PAYLOAD_VERSION,
    f: filename,
    c: code,
  };
}

function encodeSharePayload(filename, code) {
  return encodeBase64UrlUtf8(JSON.stringify(createSharePayload(filename, code)));
}

function decodeSharePayload(encodedPayload) {
  const decoded = JSON.parse(decodeBase64UrlUtf8(encodedPayload));
  const filename = normalizeWorkspaceFilename(decoded?.f ?? decoded?.filename ?? DEFAULT_FILENAME);
  const code = decoded?.c ?? decoded?.code;

  if (decoded?.v !== SHARE_PAYLOAD_VERSION) {
    throw new Error("Unsupported share link version.");
  }

  if (typeof code !== "string") {
    throw new Error("Shared link is missing file contents.");
  }

  return { filename, code };
}

function readSharedPayloadFromHash(hash) {
  const rawHash = String(hash ?? "");
  if (!rawHash.startsWith(SHARE_HASH_PREFIX)) {
    return null;
  }

  const encodedPayload = rawHash.slice(SHARE_HASH_PREFIX.length);
  if (!encodedPayload) {
    return { error: "Shared link is missing payload data." };
  }

  try {
    return { payload: decodeSharePayload(encodedPayload) };
  } catch (error) {
    return { error: error?.message || "Invalid shared link." };
  }
}

function clearSharedPayloadHash() {
  if (typeof window === "undefined" || !window.location.hash.startsWith(SHARE_HASH_PREFIX)) {
    return;
  }

  const nextUrl = `${window.location.pathname}${window.location.search}`;
  window.history.replaceState(window.history.state, "", nextUrl);
}

function createSharedWorkspaceName(filename, code) {
  const stem = filename.replace(/\.[^.]+$/u, "");
  const suffix = createStableShareHash(`${filename}\n${code}`).slice(0, 8);
  const slug = slugifyShareSegment(stem, "snippet").slice(0, 20);
  return normalizeWorkspaceName(`shared-${slug}-${suffix}`);
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);

  if (!copied) {
    throw new Error("Clipboard access is unavailable.");
  }
}

function chooseActiveFile(filenames, preferredFile) {
  if (preferredFile && filenames.includes(preferredFile)) {
    return preferredFile;
  }
  if (filenames.includes(DEFAULT_FILENAME)) {
    return DEFAULT_FILENAME;
  }
  return filenames[0] ?? "";
}

function sortFileRecords(files) {
  return [...files].sort((left, right) => left.name.localeCompare(right.name));
}

function createEmptySqlExecution() {
  return {
    engine: null,
    engineLabel: "",
    filename: "",
    databaseLabel: "",
    resultSets: [],
    error: "",
    errorMeta: null,
    durationMs: null,
    executedAt: null,
    recoveryMessage: "",
    restoredFromOpfs: false,
    storageRecovered: false,
    schema: null,
  };
}

function createEmptyPythonExecution() {
  return {
    filename: "",
    figures: [],
    error: "",
    durationMs: null,
    executedAt: null,
  };
}

function normalizePythonFigures(figures = []) {
  if (!Array.isArray(figures)) {
    return [];
  }

  return figures.flatMap((figure, index) => {
    const data = typeof figure?.data === "string" ? figure.data.trim() : "";
    if (!data) {
      return [];
    }

    const format = String(figure?.format || "png").trim().toLowerCase() || "png";
    const id = String(figure?.id || `Figure ${index + 1}`).trim() || `Figure ${index + 1}`;

    return [{
      id,
      format,
      dataUrl: `data:image/${format};base64,${data}`,
    }];
  });
}

function isMissingWorkspaceFileError(error) {
  const message = error?.message || String(error);
  return error?.name === "NotFoundError" || /could not be found/i.test(message);
}

function getRecoveryStorageKey(workspaceName) {
  return `${RECOVERY_STORAGE_KEY_PREFIX}:${workspaceName}`;
}

function readPersistedActiveWorkspace() {
  if (typeof window === "undefined") {
    return DEFAULT_WORKSPACE_NAME;
  }

  try {
    const raw = window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY);
    return raw ? normalizeWorkspaceName(raw) : DEFAULT_WORKSPACE_NAME;
  } catch {
    return DEFAULT_WORKSPACE_NAME;
  }
}

function readRecoveryEntries(workspaceName) {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(getRecoveryStorageKey(workspaceName));
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => typeof value === "string"),
    );
  } catch {
    return {};
  }
}

function persistRecoveryEntries(workspaceName, entries) {
  if (typeof window === "undefined") {
    return;
  }

  const storageKey = getRecoveryStorageKey(workspaceName);
  if (Object.keys(entries).length === 0) {
    window.localStorage.removeItem(storageKey);
    return;
  }

  window.localStorage.setItem(storageKey, JSON.stringify(entries));
}

function clampEditorPaneHeight(height, containerHeight) {
  if (!containerHeight) {
    return height;
  }

  return clamp(
    height,
    MIN_EDITOR_PANEL_HEIGHT,
    containerHeight - MIN_TERMINAL_PANEL_HEIGHT - EDITOR_SPLIT_HANDLE_HEIGHT,
  );
}

function getRuntimeLanguageLabel(runtime, filename = "") {
  switch (runtime) {
    case "python":
      return "Python 3.13";
    case "javascript":
      return getFileExtension(filename) === "ts" ? "TypeScript" : "JavaScript";
    case "sqlite":
      return "SQLite";
    case "pglite":
      return "PostgreSQL";
    default:
      return "Plain Text";
  }
}

function getStatusBarTone(activeRuntime, activeStatusMessage, activeRuntimeRunning, activeHasError, activeRuntimeReady, isAwaitingInput) {
  if (activeHasError) {
    return "var(--ide-shell-danger)";
  }
  if (activeRuntime === "python" && isAwaitingInput) {
    return "var(--ide-shell-warning)";
  }
  if (activeRuntimeRunning) {
    return "var(--ide-shell-accent)";
  }
  if (activeRuntimeReady) {
    return "var(--ide-shell-success)";
  }
  if (!activeStatusMessage) {
    return "var(--ide-shell-muted)";
  }
  return "var(--ide-shell-muted)";
}

export default function App({ onNavigateHome }) {
  const [theme, setTheme] = useState(() => readStoredAppTheme());
  const [files, setFiles] = useState([]);
  const [activeFile, setActiveFile] = useState(DEFAULT_FILENAME);
  const [openFiles, setOpenFiles] = useState([]);
  const [status, setStatus] = useState("Loading workspace...");
  const [sqlExecution, setSqlExecution] = useState(createEmptySqlExecution);
  const [pythonExecution, setPythonExecution] = useState(createEmptyPythonExecution);
  const [workspaces, setWorkspaces] = useState([]);
  const [activeWorkspace, setActiveWorkspace] = useState(readPersistedActiveWorkspace);
  const [workspaceBootstrapped, setWorkspaceBootstrapped] = useState(false);
  const [editorPaneHeight, setEditorPaneHeight] = useState(null);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [sidebarMode, setSidebarMode] = useState("explorer");
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  const [bottomPanelMode, setBottomPanelMode] = useState("terminal");
  const [shareStatus, setShareStatus] = useState({ tone: "idle", label: "Share" });
  const [shareHashSignal, setShareHashSignal] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(
    typeof window === "undefined" ? 1280 : window.innerWidth,
  );
  const [mobilePane, setMobilePane] = useState("editor");
  const terminalRef = useRef(null);
  const desktopLayoutRef = useRef(null);
  const shellBodyRef = useRef(null);
  const resizeStateRef = useRef(null);
  const terminalResizeRafRef = useRef(null);
  const submitStdinRef = useRef(() => false);
  const editorRef = useRef(null);
  const editorSubscriptionRef = useRef(null);
  const activeFileRef = useRef(DEFAULT_FILENAME);
  const activeWorkspaceRef = useRef(activeWorkspace);
  const isMountedRef = useRef(true);
  const recoveryWritesRef = useRef(readRecoveryEntries(activeWorkspace));
  const shareStatusTimeoutRef = useRef(null);
  const shareImportKeyRef = useRef("");
  const ideTheme = theme;
  const idePalette = useMemo(() => getIdePalette(ideTheme), [ideTheme]);
  const ideCssVars = useMemo(() => getIdeCssVars(idePalette), [idePalette]);

  useEffect(() => {
    persistAppTheme(theme);
  }, [theme]);

  useEffect(() => {
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
    if (typeof document === "undefined") {
      return undefined;
    }

    document.body.dataset.page = "ide";
    return () => {
      if (document.body.dataset.page === "ide") {
        delete document.body.dataset.page;
      }
    };
  }, []);

  useEffect(() => {
    const syncSharedPayload = () => {
      setShareHashSignal((value) => value + 1);
    };

    window.addEventListener("hashchange", syncSharedPayload);
    return () => {
      window.removeEventListener("hashchange", syncSharedPayload);
    };
  }, []);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (shareStatusTimeoutRef.current !== null) {
        clearTimeout(shareStatusTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    activeFileRef.current = activeFile;
  }, [activeFile]);

  useEffect(() => {
    const availableFileNames = files.map((file) => file.name);
    setOpenFiles((prev) => {
      const next = prev.filter((filename) => availableFileNames.includes(filename));

      if (activeFile && availableFileNames.includes(activeFile) && !next.includes(activeFile)) {
        next.push(activeFile);
      }

      if (next.length === 0 && activeFile && availableFileNames.includes(activeFile)) {
        next.push(activeFile);
      }

      return next;
    });
  }, [activeFile, files]);

  useEffect(() => {
    if (typeof window === "undefined" || !readSharedPayloadFromHash(window.location.hash)) {
      shareImportKeyRef.current = "";
    }
  }, [shareHashSignal]);

  useEffect(() => {
    activeWorkspaceRef.current = activeWorkspace;
    recoveryWritesRef.current = readRecoveryEntries(activeWorkspace);

    if (typeof window !== "undefined") {
      window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, activeWorkspace);
    }
  }, [activeWorkspace]);

  const requestTerminalResize = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (terminalResizeRafRef.current !== null) {
      cancelAnimationFrame(terminalResizeRafRef.current);
    }

    terminalResizeRafRef.current = requestAnimationFrame(() => {
      terminalResizeRafRef.current = null;
      terminalRef.current?.resize?.();
    });
  }, []);

  useEffect(() => {
    return () => {
      if (terminalResizeRafRef.current !== null) {
        cancelAnimationFrame(terminalResizeRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handlePointerMove = (event) => {
      const session = resizeStateRef.current;
      if (!session) {
        return;
      }

      if (session.side === "sidebar") {
        const layout = desktopLayoutRef.current;
        if (!layout) {
          return;
        }

        const bounds = layout.getBoundingClientRect();
        const nextWidth = clamp(
          event.clientX - bounds.left - ACTIVITY_BAR_WIDTH,
          MIN_SIDEBAR_WIDTH,
          Math.min(MAX_SIDEBAR_WIDTH, bounds.width - 320),
        );

        setSidebarWidth(nextWidth);
        editorRef.current?.layout?.();
        requestTerminalResize();
        return;
      }

      const container = shellBodyRef.current;
      if (!container) {
        return;
      }

      const bounds = container.getBoundingClientRect();
      const totalHeight = bounds.height;
      if (!totalHeight) {
        return;
      }

      setEditorPaneHeight(
        clampEditorPaneHeight(event.clientY - bounds.top, totalHeight),
      );

      requestTerminalResize();
    };

    const stopResize = () => {
      if (!resizeStateRef.current) {
        return;
      }

      resizeStateRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      editorRef.current?.layout?.();
      requestTerminalResize();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };
  }, [requestTerminalResize]);

  useEffect(() => {
    const handleWindowResize = () => {
      const height = shellBodyRef.current?.getBoundingClientRect().height ?? 0;
      const layoutWidth = desktopLayoutRef.current?.getBoundingClientRect().width ?? 0;
      if (!height) {
        editorRef.current?.layout?.();
      } else {
        setEditorPaneHeight((prev) => (
          prev === null ? prev : clampEditorPaneHeight(prev, height)
        ));
      }

      if (layoutWidth) {
        setSidebarWidth((prev) => clamp(
          prev,
          MIN_SIDEBAR_WIDTH,
          Math.min(MAX_SIDEBAR_WIDTH, layoutWidth - 320),
        ));
      }

      editorRef.current?.layout?.();
      requestTerminalResize();
    };

    window.addEventListener("resize", handleWindowResize);
    return () => {
      window.removeEventListener("resize", handleWindowResize);
    };
  }, [requestTerminalResize]);

  useEffect(() => {
    const handleViewportResize = () => {
      setViewportWidth(window.innerWidth);
    };

    handleViewportResize();
    window.addEventListener("resize", handleViewportResize);
    return () => {
      window.removeEventListener("resize", handleViewportResize);
    };
  }, []);

  const startResize = useCallback((side) => (event) => {
    event.preventDefault();
    resizeStateRef.current = { side };
    document.body.style.cursor = side === "sidebar" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  }, []);

  const writeStdout = useCallback((data) => {
    terminalRef.current?.write(data);
  }, []);

  const writeStderr = useCallback((data) => {
    terminalRef.current?.write(`\x1b[31m${data}\x1b[0m`);
  }, []);

  const reportWorkspaceError = useCallback(
    (message) => {
      console.error(message);
      writeStderr(`${message}\n`);
    },
    [writeStderr],
  );

  const publishShareStatus = useCallback((label, tone = "idle") => {
    if (shareStatusTimeoutRef.current !== null) {
      clearTimeout(shareStatusTimeoutRef.current);
    }

    setShareStatus({ label, tone });
    shareStatusTimeoutRef.current = window.setTimeout(() => {
      setShareStatus({ label: "Share", tone: "idle" });
      shareStatusTimeoutRef.current = null;
    }, SHARE_STATUS_RESET_MS);
  }, []);

  const stageRecoveryWrite = useCallback((filename, content, workspaceName = activeWorkspaceRef.current) => {
    const scopedWorkspaceName = workspaceName || activeWorkspaceRef.current;
    const currentEntries =
      scopedWorkspaceName === activeWorkspaceRef.current
        ? recoveryWritesRef.current
        : readRecoveryEntries(scopedWorkspaceName);
    const nextEntries = { ...currentEntries, [filename]: content };

    if (scopedWorkspaceName === activeWorkspaceRef.current) {
      recoveryWritesRef.current = nextEntries;
    }

    persistRecoveryEntries(scopedWorkspaceName, nextEntries);
  }, []);

  const clearRecoveryWrite = useCallback((filename, workspaceName = activeWorkspaceRef.current) => {
    const scopedWorkspaceName = workspaceName || activeWorkspaceRef.current;
    const currentEntries =
      scopedWorkspaceName === activeWorkspaceRef.current
        ? recoveryWritesRef.current
        : readRecoveryEntries(scopedWorkspaceName);

    if (!Object.prototype.hasOwnProperty.call(currentEntries, filename)) {
      return;
    }

    const nextEntries = { ...currentEntries };
    delete nextEntries[filename];

    if (scopedWorkspaceName === activeWorkspaceRef.current) {
      recoveryWritesRef.current = nextEntries;
    }

    persistRecoveryEntries(scopedWorkspaceName, nextEntries);
  }, []);
  const getEditorFilename = useCallback((editor) => {
    const modelPath = editor?.getModel?.()?.uri?.path;
    if (typeof modelPath === "string" && modelPath.length > 1) {
      return modelPath.replace(/^\/+/u, "");
    }

    return activeFileRef.current;
  }, []);

  const getActiveEditorSnapshot = useCallback(() => {
    const filename = activeFileRef.current;
    if (!filename) {
      return null;
    }

    const liveEditorValue = editorRef.current?.getValue();
    const fallbackFile = files.find((file) => file.name === filename);
    return {
      filename,
      content: liveEditorValue ?? fallbackFile?.content ?? "",
    };
  }, [files]);

  const {
    isReady: isIOWorkerReady,
    listFiles,
    readFile,
    writeFile,
    deleteFile: deleteWorkspaceFile,
    renameFile: renameWorkspaceFile,
    fileExists,
    readBinaryFile,
    writeBinaryFile,
    scheduleWrite,
    flushAllWrites,
    listWorkspaces,
    createWorkspace,
  } = useIOWorker({
    workspaceName: activeWorkspace,
    onError: (error) => {
      reportWorkspaceError(
        `[WasmForge] Workspace I/O failed: ${error.message || error}`,
      );
    },
    onWriteFlushed: (filename, workspaceName) => {
      clearRecoveryWrite(filename, workspaceName);
    },
  });

  const {
    sqliteReady,
    pgliteReady,
    sqliteStatus,
    pgliteStatus,
    isRunning: isSqlRunning,
    runningEngine,
    runSqliteQuery,
    runPgliteQuery,
    killSqlWorker,
  } = useSqlWorkers({
    onError: (error, engine) => {
      reportWorkspaceError(
        `[WasmForge] ${engine === "sqlite" ? "SQLite" : "PostgreSQL"} worker failed: ${error.message || error}`,
      );
    },
  });

  const upsertFileContent = useCallback((filename, content) => {
    setFiles((prev) => {
      let found = false;
      const next = prev.map((file) => {
        if (file.name !== filename) {
          return file;
        }
        found = true;
        return { ...file, content, language: getLanguage(filename) };
      });

      return found
        ? next
        : sortFileRecords([...next, createFileRecord(filename, content)]);
    });
  }, []);

  const replaceFileList = useCallback((filenames) => {
    setFiles((prev) => {
      const previousFiles = new Map(prev.map((file) => [file.name, file]));
      return filenames
        .map((filename) => createFileRecord(filename, previousFiles.get(filename)?.content ?? ""))
        .sort((left, right) => left.name.localeCompare(right.name));
    });
  }, []);

  const recoverPendingWrites = useCallback(async (workspaceName = activeWorkspaceRef.current) => {
    const entries = Object.entries(readRecoveryEntries(workspaceName));

    for (const [filename, content] of entries) {
      await writeFile(filename, content, "workspace", workspaceName);
      clearRecoveryWrite(filename, workspaceName);
    }
  }, [clearRecoveryWrite, writeFile]);

  const refreshWorkspaceFiles = useCallback(
    async (preferredFile = activeFileRef.current, options = {}) => {
      const {
        createDefaultIfEmpty = false,
        workspaceName = activeWorkspaceRef.current,
      } = options;
      const filenames = await listFiles(workspaceName);

      if (workspaceName !== activeWorkspaceRef.current) {
        return;
      }

      if (filenames.length === 0) {
        if (createDefaultIfEmpty) {
          await writeFile(DEFAULT_FILENAME, DEFAULT_PYTHON, "workspace", workspaceName);
          if (workspaceName !== activeWorkspaceRef.current) {
            return;
          }

          setFiles([createFileRecord(DEFAULT_FILENAME, DEFAULT_PYTHON)]);
          setActiveFile(DEFAULT_FILENAME);
        } else {
          setFiles([]);
          setActiveFile("");
        }
        return;
      }

      replaceFileList(filenames);
      const nextActiveFile = chooseActiveFile(filenames, preferredFile);
      setActiveFile(nextActiveFile);
      let content = "";

      try {
        content = await readFile(nextActiveFile, "workspace", workspaceName);
      } catch (error) {
        if (workspaceName !== activeWorkspaceRef.current || isMissingWorkspaceFileError(error)) {
          return;
        }
        throw error;
      }

      if (nextActiveFile === DEFAULT_FILENAME) {
        const migratedDefaultPython = migrateLegacyDefaultPython(content);
        if (migratedDefaultPython) {
          await writeFile(DEFAULT_FILENAME, migratedDefaultPython, "workspace", workspaceName);
          content = migratedDefaultPython;
        }
      }

      if (workspaceName !== activeWorkspaceRef.current) {
        return;
      }

      upsertFileContent(nextActiveFile, content);
    },
    [listFiles, readFile, replaceFileList, upsertFileContent, writeFile],
  );
  const handlePythonDone = useCallback(
    (doneResult = {}) => {
      const error = typeof doneResult === "string" ? doneResult : doneResult?.error;
      const durationMs = typeof doneResult === "object" ? doneResult?.durationMs : null;
      const shouldTreatAsFailure = Boolean(
        error && error !== "Killed by user" && !error.startsWith("Timeout"),
      );

      terminalRef.current?.cancelInput({ newline: false });
      refreshWorkspaceFiles(activeFileRef.current, {
        workspaceName: activeWorkspaceRef.current,
      }).catch((refreshError) => {
        reportWorkspaceError(
          `[WasmForge] Failed to refresh workspace: ${refreshError.message || refreshError}`,
        );
      });

      setPythonExecution((previous) => {
        if (previous.filename !== activeFileRef.current) {
          return previous;
        }

        return {
          ...previous,
          error: shouldTreatAsFailure ? error : "",
          durationMs: typeof durationMs === "number" ? durationMs : previous.durationMs,
          executedAt: previous.executedAt || Date.now(),
        };
      });

      if (shouldTreatAsFailure) {
        setStatus("Error");
        return;
      }

      setStatus("Python ready");
      if (!error) {
        terminalRef.current?.writeln("\x1b[90m\n[Process completed]\x1b[0m");
      }
    },
    [refreshWorkspaceFiles, reportWorkspaceError],
  );

  const handleJavascriptDone = useCallback((error) => {
    if (!error) {
      terminalRef.current?.writeln("\x1b[90m\n[Process completed]\x1b[0m");
    }
  }, []);

  const syncActiveEditorDraft = useCallback(
    ({ scheduleWorkerWrite = true, updateState = true } = {}) => {
      const snapshot = getActiveEditorSnapshot();
      if (!snapshot) {
        return null;
      }

      const { filename, content } = snapshot;
      if (updateState) {
        upsertFileContent(filename, content);
      }
      stageRecoveryWrite(filename, content);

      if (scheduleWorkerWrite) {
        scheduleWrite(filename, content);
      }

      return snapshot;
    },
    [getActiveEditorSnapshot, scheduleWrite, stageRecoveryWrite, upsertFileContent],
  );

  const handleEditorMount = useCallback(
    (editor) => {
      editorRef.current = editor;

      if (editorSubscriptionRef.current) {
        editorSubscriptionRef.current.dispose();
      }

      editorSubscriptionRef.current = editor.onDidChangeModelContent(() => {
        const filename = getEditorFilename(editor);
        if (filename) {
          stageRecoveryWrite(filename, editor.getValue());
        }
      });
    },
    [getEditorFilename, stageRecoveryWrite],
  );

  const {
    runCode,
    submitStdin,
    killWorker,
    isReady,
    isRunning,
    isAwaitingInput,
  } = usePyodideWorker({
    workspaceName: activeWorkspace,
    onStdout: writeStdout,
    onStderr: writeStderr,
    onFigures: (figures) => {
      const normalizedFigures = normalizePythonFigures(figures);
      if (normalizedFigures.length === 0) {
        return;
      }

      const filename = activeFileRef.current;
      setPythonExecution((previous) => ({
        ...createEmptyPythonExecution(),
        filename,
        error: previous.filename === filename ? previous.error : "",
        durationMs: previous.filename === filename ? previous.durationMs : null,
        executedAt: previous.filename === filename && previous.executedAt
          ? previous.executedAt
          : Date.now(),
        figures: normalizedFigures,
      }));
      setBottomPanelMode("output");
    },
    onReady: ({ stdinSupported, workspaceName } = {}) => {
      setStatus("Python ready");
      terminalRef.current?.writeln(
        `\x1b[32m✓ Python environment ready for ${workspaceName || activeWorkspaceRef.current}\x1b[0m`,
      );
      terminalRef.current?.writeln(
        "\x1b[90mFiles save automatically to browser storage.\x1b[0m",
      );
      terminalRef.current?.writeln(
        stdinSupported
          ? "\x1b[90mInteractive input is available.\x1b[0m"
          : "\x1b[33mInteractive input is unavailable on this origin.\x1b[0m",
      );
      terminalRef.current?.writeln("");
    },
    onProgress: (msg) => {
      setStatus(msg);
      terminalRef.current?.writeln(`\x1b[90m${msg}\x1b[0m`);
    },
    onStdinRequest: (prompt) => {
      setStatus("Waiting for input...");
      terminalRef.current?.requestInput({
        prompt,
        onSubmit: (value) => {
          const submitted = submitStdinRef.current?.(value);
          if (submitted) {
            setStatus("Running...");
          }
          return submitted;
        },
      });
    },
    onDone: handlePythonDone,
  });

  useEffect(() => {
    submitStdinRef.current = submitStdin;
  }, [submitStdin]);

  const {
    runCode: runJsCode,
    killWorker: killJsWorker,
    isReady: isJsReady,
    isRunning: isJsRunning,
    status: jsStatus,
  } = useJsWorker({
    onStdout: writeStdout,
    onStderr: writeStderr,
    onReady: () => {
      terminalRef.current?.writeln(
        "\x1b[32m✓ JavaScript and TypeScript environment ready\x1b[0m",
      );
      terminalRef.current?.writeln("");
    },
    onDone: handleJavascriptDone,
  });
  const executeSqliteFile = useCallback(
    async ({ filename, code }) => {
      const database = getSqlDatabaseDescriptor(filename, activeWorkspaceRef.current);
      if (!database) {
        throw new Error("No SQLite database descriptor available");
      }

      setSqlExecution({
        ...createEmptySqlExecution(),
        engine: "sqlite",
        engineLabel: "SQLite",
        filename,
        databaseLabel: database.databaseLabel,
        executedAt: Date.now(),
      });

      const snapshotExists = await fileExists(database.databaseKey, "sqlite");
      const databaseBuffer = snapshotExists
        ? await readBinaryFile(database.databaseKey, "sqlite")
        : null;
      const hadSnapshotBytes = Boolean(databaseBuffer && databaseBuffer.byteLength > 0);

      const persistExecutionResult = async ({ executionResult, restoredFromOpfs, recoveryMessage = "", storageRecovered = false }) => {
        const { databaseBuffer: exportedDatabase, ...uiResult } = executionResult;

        if (exportedDatabase) {
          await writeBinaryFile(database.databaseKey, exportedDatabase, "sqlite");
        }

        setSqlExecution({
          ...uiResult,
          filename,
          databaseLabel: database.databaseLabel,
          executedAt: Date.now(),
          restoredFromOpfs,
          recoveryMessage,
          storageRecovered,
        });
      };

      try {
        const result = await runSqliteQuery({
          sql: code,
          databaseKey: database.databaseKey,
          databaseLabel: database.databaseLabel,
          databaseBuffer,
        });

        await persistExecutionResult({
          executionResult: result,
          restoredFromOpfs: snapshotExists,
        });
      } catch (error) {
        const canRecoverSnapshot = error?.details?.kind === "database_state" && hadSnapshotBytes;
        if (!canRecoverSnapshot) {
          throw error;
        }

        await writeBinaryFile(database.databaseKey, new ArrayBuffer(0), "sqlite");
        const recoveredResult = await runSqliteQuery({
          sql: code,
          databaseKey: database.databaseKey,
          databaseLabel: database.databaseLabel,
          databaseBuffer: new ArrayBuffer(0),
        });

        await persistExecutionResult({
          executionResult: recoveredResult,
          restoredFromOpfs: false,
          recoveryMessage: `Recovered ${database.databaseLabel} by resetting an incompatible SQLite snapshot.`,
          storageRecovered: true,
        });
      }
    },
    [fileExists, readBinaryFile, runSqliteQuery, writeBinaryFile],
  );

  const executePgliteFile = useCallback(
    async ({ filename, code }) => {
      const database = getSqlDatabaseDescriptor(filename, activeWorkspaceRef.current);
      if (!database) {
        throw new Error("No PostgreSQL database descriptor available");
      }

      setSqlExecution({
        ...createEmptySqlExecution(),
        engine: "pglite",
        engineLabel: "PostgreSQL (PGlite)",
        filename,
        databaseLabel: database.databaseLabel,
        executedAt: Date.now(),
      });

      const result = await runPgliteQuery({
        sql: code,
        databaseKey: database.databaseKey,
        databaseLabel: database.databaseLabel,
      });

      setSqlExecution({
        ...result,
        filename,
        databaseLabel: database.databaseLabel,
        executedAt: Date.now(),
      });
    },
    [runPgliteQuery],
  );

  useEffect(() => {
    if (!isIOWorkerReady) {
      return;
    }

    let cancelled = false;

    listWorkspaces()
      .then(async (existingWorkspaces) => {
        if (cancelled) {
          return;
        }

        let nextWorkspaces = [...existingWorkspaces];
        if (nextWorkspaces.length === 0) {
          const created = await createWorkspace(DEFAULT_WORKSPACE_NAME);
          nextWorkspaces = [created?.name ?? DEFAULT_WORKSPACE_NAME];
        }

        nextWorkspaces.sort((left, right) => left.localeCompare(right));
        setWorkspaces(nextWorkspaces);
        setWorkspaceBootstrapped(true);

        if (!nextWorkspaces.includes(activeWorkspaceRef.current)) {
          setActiveWorkspace(nextWorkspaces[0]);
        }
      })
      .catch((error) => {
        reportWorkspaceError(
          `[WasmForge] Failed to load workspaces: ${error.message || error}`,
        );
      });

    return () => {
      cancelled = true;
    };
  }, [createWorkspace, isIOWorkerReady, listWorkspaces, reportWorkspaceError]);

  useEffect(() => {
    if (!isIOWorkerReady || !workspaceBootstrapped) {
      return;
    }

    let cancelled = false;
    const workspaceName = activeWorkspace;

    recoverPendingWrites(workspaceName)
      .then(() =>
        refreshWorkspaceFiles(DEFAULT_FILENAME, {
          createDefaultIfEmpty: true,
          workspaceName,
        }),
      )
      .catch((error) => {
        if (!cancelled) {
          reportWorkspaceError(
            `[WasmForge] Failed to restore workspace "${workspaceName}": ${error.message || error}`,
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeWorkspace,
    isIOWorkerReady,
    recoverPendingWrites,
    refreshWorkspaceFiles,
    reportWorkspaceError,
    workspaceBootstrapped,
  ]);

  useEffect(() => {
    if (!isIOWorkerReady || !workspaceBootstrapped) {
      return;
    }

    let cancelled = false;
    const workspaceName = activeWorkspace;

    readFile(DEFAULT_FILENAME, "workspace", workspaceName)
      .then(async (content) => {
        const migratedDefaultPython = migrateLegacyDefaultPython(content);
        if (!migratedDefaultPython) {
          return;
        }

        await writeFile(DEFAULT_FILENAME, migratedDefaultPython, "workspace", workspaceName);
        clearRecoveryWrite(DEFAULT_FILENAME, workspaceName);

        if (cancelled || workspaceName !== activeWorkspaceRef.current) {
          return;
        }

        upsertFileContent(DEFAULT_FILENAME, migratedDefaultPython);
      })
      .catch((error) => {
        if (cancelled || workspaceName !== activeWorkspaceRef.current || isMissingWorkspaceFileError(error)) {
          return;
        }

        reportWorkspaceError(
          `[WasmForge] Failed to refresh the default Python starter: ${error.message || error}`,
        );
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeWorkspace,
    clearRecoveryWrite,
    isIOWorkerReady,
    readFile,
    reportWorkspaceError,
    upsertFileContent,
    workspaceBootstrapped,
    writeFile,
  ]);

  useEffect(() => {
    const flushPendingWorkspaceWrites = () => {
      syncActiveEditorDraft({ scheduleWorkerWrite: false, updateState: false });
      void flushAllWrites().catch(() => {});
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushPendingWorkspaceWrites();
      }
    };

    window.addEventListener("pagehide", flushPendingWorkspaceWrites);
    window.addEventListener("beforeunload", flushPendingWorkspaceWrites);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", flushPendingWorkspaceWrites);
      window.removeEventListener("beforeunload", flushPendingWorkspaceWrites);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [flushAllWrites, syncActiveEditorDraft]);

  useEffect(() => {
    return () => {
      editorSubscriptionRef.current?.dispose();
      editorSubscriptionRef.current = null;
    };
  }, []);
  const prepareWorkspaceMutation = useCallback(
    async (actionLabel) => {
      const runtimeBusy = isRunning || isJsRunning || isSqlRunning;
      if (runtimeBusy) {
        const message = `Finish or stop the active session before ${actionLabel}.`;
        terminalRef.current?.writeln(`\x1b[33m[WasmForge] ${message}\x1b[0m`);
        throw new Error(message);
      }

      syncActiveEditorDraft();
      await flushAllWrites();
    },
    [flushAllWrites, isJsRunning, isRunning, isSqlRunning, syncActiveEditorDraft],
  );

  const handleKill = useCallback(() => {
    terminalRef.current?.cancelInput({ reason: "^C" });
    if (getRuntimeKind(activeFileRef.current) === "javascript") {
      killJsWorker();
      return;
    }
    if (getRuntimeKind(activeFileRef.current) === "sqlite") {
      killSqlWorker("sqlite");
      return;
    }
    if (getRuntimeKind(activeFileRef.current) === "pglite") {
      killSqlWorker("pglite");
      return;
    }
    killWorker();
  }, [killJsWorker, killSqlWorker, killWorker]);

  const handleRun = useCallback(async () => {
    terminalRef.current?.cancelInput({ newline: false });
    const syncedSnapshot = syncActiveEditorDraft();
    const file = files.find((entry) => entry.name === activeFile);
    if (!file) {
      return;
    }

    setMobilePane("output");
    const runtime = getRuntimeKind(activeFile);
    setBottomPanelMode(runtime === "sqlite" || runtime === "pglite" ? "output" : "terminal");
    const codeToRun =
      syncedSnapshot?.filename === activeFile ? syncedSnapshot.content : file.content;
    terminalRef.current?.writeln(`\x1b[90m$ Running ${activeFile}...\x1b[0m\n`);

    switch (runtime) {
      case "python":
        if (!isReady) {
          terminalRef.current?.writeln("\x1b[33m[WasmForge] Python environment is still loading.\x1b[0m");
          return;
        }
        await flushAllWrites();
        setPythonExecution({
          ...createEmptyPythonExecution(),
          filename: activeFile,
          executedAt: Date.now(),
        });
        runCode({ filename: activeFile, code: codeToRun });
        setStatus("Running...");
        return;

      case "javascript":
        if (!isJsReady) {
          terminalRef.current?.writeln("\x1b[33m[WasmForge] JavaScript environment is still loading.\x1b[0m");
          return;
        }
        await flushAllWrites().catch(() => {});
        runJsCode({ filename: activeFile, code: codeToRun });
        return;

      case "sqlite":
        if (!sqliteReady || !codeToRun.trim()) {
          setSqlExecution({
            ...createEmptySqlExecution(),
            engine: "sqlite",
            engineLabel: "SQLite",
            filename: activeFile,
            error: !sqliteReady
              ? "SQLite is still loading. Please wait a moment and try again."
              : "SQL file is empty. Add statements and run again.",
            executedAt: Date.now(),
          });
          return;
        }
        await executeSqliteFile({ filename: activeFile, code: codeToRun }).catch((error) => {
          const database = getSqlDatabaseDescriptor(activeFile, activeWorkspaceRef.current);
          setSqlExecution({
            ...createEmptySqlExecution(),
            engine: "sqlite",
            engineLabel: "SQLite",
            filename: activeFile,
            databaseLabel: database?.databaseLabel ?? "",
            error: error.message || String(error),
            errorMeta: error.details || null,
            executedAt: Date.now(),
          });
        });
        return;

      case "pglite":
        if (!pgliteReady || !codeToRun.trim()) {
          setSqlExecution({
            ...createEmptySqlExecution(),
            engine: "pglite",
            engineLabel: "PostgreSQL (PGlite)",
            filename: activeFile,
            error: !pgliteReady
              ? "PostgreSQL is still loading. Please wait a moment and try again."
              : "SQL file is empty. Add statements and run again.",
            executedAt: Date.now(),
          });
          return;
        }
        await executePgliteFile({ filename: activeFile, code: codeToRun }).catch((error) => {
          const database = getSqlDatabaseDescriptor(activeFile, activeWorkspaceRef.current);
          setSqlExecution({
            ...createEmptySqlExecution(),
            engine: "pglite",
            engineLabel: "PostgreSQL (PGlite)",
            filename: activeFile,
            databaseLabel: database?.databaseLabel ?? "",
            error: error.message || String(error),
            errorMeta: error.details || null,
            executedAt: Date.now(),
          });
        });
        return;

      default:
        terminalRef.current?.writeln("\x1b[31m[WasmForge] Unknown file type.\x1b[0m\n");
    }
  }, [
    activeFile,
    executePgliteFile,
    executeSqliteFile,
    files,
    flushAllWrites,
    isJsReady,
    isReady,
    pgliteReady,
    runCode,
    runJsCode,
    sqliteReady,
    syncActiveEditorDraft,
  ]);

  const handleShareLink = useCallback(async () => {
    const snapshot = getActiveEditorSnapshot();
    const file = files.find((entry) => entry.name === activeFile);
    const filename = snapshot?.filename || file?.name || activeFile;

    if (!filename) {
      publishShareStatus("No file", "error");
      return;
    }

    const code =
      snapshot?.filename === filename
        ? snapshot.content
        : file?.content ?? "";

    try {
      const encodedPayload = encodeSharePayload(filename, code);
      const shareUrl = new URL(window.location.href);
      shareUrl.pathname = "/ide";
      shareUrl.search = "";
      shareUrl.hash = SHARE_HASH_PREFIX.slice(1) + encodedPayload;

      if (shareUrl.toString().length > MAX_SHARE_URL_LENGTH) {
        throw new Error("File is too large to share safely as a URL.");
      }

      await copyTextToClipboard(shareUrl.toString());
      terminalRef.current?.writeln(`\x1b[36m[Share] Link copied for ${filename}\x1b[0m`);
      publishShareStatus("Copied", "success");
    } catch (error) {
      terminalRef.current?.writeln(`\x1b[31m[Share] ${error.message || error}\x1b[0m`);
      publishShareStatus("Share failed", "error");
    }
  }, [activeFile, files, getActiveEditorSnapshot, publishShareStatus]);

  useEffect(() => {
    const sharedPayload =
      typeof window === "undefined" ? null : readSharedPayloadFromHash(window.location.hash);
    const runtimeBusy = isRunning || isJsRunning || isSqlRunning;
    if (!sharedPayload || !isIOWorkerReady || !workspaceBootstrapped || runtimeBusy) {
      return;
    }

    const shareImportKey = sharedPayload.error
      ? `error:${sharedPayload.error}`
      : `${sharedPayload.payload.filename}\n${sharedPayload.payload.code}`;

    if (shareImportKeyRef.current === shareImportKey) {
      return;
    }

    shareImportKeyRef.current = shareImportKey;

    const importSharedPayload = async () => {
      if (sharedPayload.error) {
        throw new Error(sharedPayload.error);
      }

      const { filename, code } = sharedPayload.payload;
      const sharedWorkspaceName = createSharedWorkspaceName(filename, code);

      await prepareWorkspaceMutation("opening a shared link");
      const knownWorkspaces = await listWorkspaces();
      if (!knownWorkspaces.includes(sharedWorkspaceName)) {
        await createWorkspace(sharedWorkspaceName);
      }

      await writeFile(filename, code, "workspace", sharedWorkspaceName);
      clearRecoveryWrite(filename, sharedWorkspaceName);

      if (!isMountedRef.current) {
        return;
      }

      setWorkspaces((prev) => {
        const next = prev.includes(sharedWorkspaceName)
          ? prev
          : [...prev, sharedWorkspaceName];
        return next.slice().sort((left, right) => left.localeCompare(right));
      });
      setSqlExecution(createEmptySqlExecution());
      setPythonExecution(createEmptyPythonExecution());
      setBottomPanelMode("terminal");
      setMobilePane("editor");
      setSidebarMode("explorer");
      setFileSearchQuery("");
      setOpenFiles([filename]);
      setFiles([createFileRecord(filename, code)]);
      setActiveFile(filename);
      setActiveWorkspace(sharedWorkspaceName);
      terminalRef.current?.writeln(
        `\x1b[36m[Share] Loaded ${filename} into ${sharedWorkspaceName}\x1b[0m`,
      );
      publishShareStatus("Loaded", "success");
      clearSharedPayloadHash();
      setShareHashSignal((value) => value + 1);
    };

    importSharedPayload().catch((error) => {
      if (!isMountedRef.current) {
        return;
      }

      reportWorkspaceError(`[WasmForge] Shared link import failed: ${error.message || error}`);
      publishShareStatus("Invalid link", "error");
      clearSharedPayloadHash();
      setShareHashSignal((value) => value + 1);
    });
  }, [
    clearRecoveryWrite,
    createWorkspace,
    isJsRunning,
    isIOWorkerReady,
    isRunning,
    isSqlRunning,
    listWorkspaces,
    prepareWorkspaceMutation,
    publishShareStatus,
    reportWorkspaceError,
    shareHashSignal,
    workspaceBootstrapped,
    writeFile,
  ]);

  const handleWorkspaceSelect = useCallback(async (workspaceName) => {
    if (workspaceName === activeWorkspaceRef.current) {
      return;
    }

    await prepareWorkspaceMutation("switching workspaces");
    setSqlExecution(createEmptySqlExecution());
    setPythonExecution(createEmptyPythonExecution());
    setOpenFiles([]);
    setFiles([]);
    setActiveFile("");
    setActiveWorkspace(workspaceName);
    setBottomPanelMode("terminal");
    setMobilePane("files");
    terminalRef.current?.writeln(`\x1b[90m[Workspace] Now using ${workspaceName}\x1b[0m`);
  }, [prepareWorkspaceMutation]);

  const handleCreateWorkspace = useCallback(async (name) => {
    const normalizedName = normalizeWorkspaceName(name);
    if (workspaces.some((workspaceName) => workspaceName.toLowerCase() === normalizedName.toLowerCase())) {
      throw new Error("A workspace with that name already exists.");
    }

    await prepareWorkspaceMutation("creating a new workspace");
    const created = await createWorkspace(normalizedName);
    const nextWorkspaces = await listWorkspaces();
    nextWorkspaces.sort((left, right) => left.localeCompare(right));
    setWorkspaces(nextWorkspaces);
    setSqlExecution(createEmptySqlExecution());
    setPythonExecution(createEmptyPythonExecution());
    setOpenFiles([]);
    setFiles([]);
    setActiveFile("");
    setActiveWorkspace(created?.name ?? normalizedName);
    setBottomPanelMode("terminal");
    setMobilePane("files");
    return created?.name ?? normalizedName;
  }, [createWorkspace, listWorkspaces, prepareWorkspaceMutation, workspaces]);

  const handleFileSelect = useCallback(async (name) => {
    if ((isRunning || isJsRunning || isSqlRunning) && name !== activeFileRef.current) {
      terminalRef.current?.writeln("\x1b[33m[WasmForge] Finish or stop the active session before switching files.\x1b[0m");
      return;
    }

    const workspaceName = activeWorkspaceRef.current;
    syncActiveEditorDraft();
    await flushAllWrites();
    let content = "";

    try {
      content = await readFile(name, "workspace", workspaceName);
    } catch (error) {
      if (workspaceName !== activeWorkspaceRef.current || isMissingWorkspaceFileError(error)) {
        return;
      }
      throw error;
    }

    if (workspaceName === activeWorkspaceRef.current) {
      setActiveFile(name);
      upsertFileContent(name, content);
      setMobilePane("editor");
    }
  }, [flushAllWrites, isJsRunning, isRunning, isSqlRunning, readFile, syncActiveEditorDraft, upsertFileContent]);

  const handleCodeChange = useCallback((newContent) => {
    if (!activeFile) {
      return;
    }
    upsertFileContent(activeFile, newContent);
    stageRecoveryWrite(activeFile, newContent);
    scheduleWrite(activeFile, newContent);
  }, [activeFile, scheduleWrite, stageRecoveryWrite, upsertFileContent]);

  const handleCreateFile = useCallback(async (name) => {
    const trimmed = normalizeWorkspaceFilename(name);
    if (files.some((file) => file.name === trimmed)) {
      throw new Error("File already exists.");
    }
    await prepareWorkspaceMutation("creating files");
    await writeFile(trimmed, "", "workspace", activeWorkspaceRef.current);
    await refreshWorkspaceFiles(trimmed, { workspaceName: activeWorkspaceRef.current });
    setMobilePane("editor");
  }, [files, prepareWorkspaceMutation, refreshWorkspaceFiles, writeFile]);

  const handleRenameFile = useCallback(async (currentName, nextName) => {
    const trimmed = normalizeWorkspaceFilename(nextName);
    if (currentName === trimmed) {
      return;
    }
    if (files.some((file) => file.name === trimmed && file.name !== currentName)) {
      throw new Error("File already exists.");
    }
    await prepareWorkspaceMutation("renaming files");
    await renameWorkspaceFile(currentName, trimmed, activeWorkspaceRef.current);
    clearRecoveryWrite(currentName);
    setOpenFiles((prev) => prev.map((fileName) => (
      fileName === currentName ? trimmed : fileName
    )));
    await refreshWorkspaceFiles(trimmed, { workspaceName: activeWorkspaceRef.current });
  }, [clearRecoveryWrite, files, prepareWorkspaceMutation, refreshWorkspaceFiles, renameWorkspaceFile]);

  const handleDeleteFile = useCallback(async (filename) => {
    await prepareWorkspaceMutation("deleting files");
    await deleteWorkspaceFile(filename, "workspace", activeWorkspaceRef.current);
    clearRecoveryWrite(filename);
    setOpenFiles((prev) => prev.filter((fileName) => fileName !== filename));
    const remainingNames = files.filter((file) => file.name !== filename).map((file) => file.name);
    if (remainingNames.length === 0) {
      setFiles([]);
      setActiveFile("");
      setMobilePane("files");
      return;
    }
    await refreshWorkspaceFiles(
      chooseActiveFile(
        remainingNames,
        activeFileRef.current === filename ? null : activeFileRef.current,
      ),
      { workspaceName: activeWorkspaceRef.current },
    );
  }, [clearRecoveryWrite, deleteWorkspaceFile, files, prepareWorkspaceMutation, refreshWorkspaceFiles]);

  const handleCloseTab = useCallback((filename) => {
    const runtimeBusy = isRunning || isJsRunning || isSqlRunning;
    if (runtimeBusy && filename === activeFileRef.current) {
      terminalRef.current?.writeln("\x1b[33m[WasmForge] Finish or stop the active session before closing the active tab.\x1b[0m");
      return;
    }

    const nextTabs = openFiles.filter((fileName) => fileName !== filename);
    setOpenFiles(nextTabs);

    if (filename !== activeFileRef.current) {
      return;
    }

    const nextActive = nextTabs[nextTabs.length - 1] ?? "";
    if (nextActive) {
      void handleFileSelect(nextActive);
      return;
    }

    setActiveFile("");
  }, [handleFileSelect, isJsRunning, isRunning, isSqlRunning, openFiles]);

  const activeFileData = files.find((file) => file.name === activeFile);
  const isMobileLayout = viewportWidth < MOBILE_LAYOUT_BREAKPOINT;
  const activeRuntime = getRuntimeKind(activeFile);
  const showSqlResultsPanel = activeRuntime === "sqlite" || activeRuntime === "pglite";
  const showPythonOutputPanel = activeRuntime === "python";
  const activeSqlResult = sqlExecution.filename === activeFile ? sqlExecution : null;
  const activePythonResult = pythonExecution.filename === activeFile ? pythonExecution : null;
  const activeRuntimeReady =
    activeRuntime === "python"
      ? isReady
      : activeRuntime === "javascript"
        ? isJsReady
        : activeRuntime === "sqlite"
          ? sqliteReady
          : activeRuntime === "pglite"
            ? pgliteReady
            : false;
  const activeRuntimeRunning =
    activeRuntime === "python"
      ? isRunning
      : activeRuntime === "javascript"
        ? isJsRunning
        : isSqlRunning && runningEngine === activeRuntime;
  const isAnyRuntimeBusy = isRunning || isJsRunning || isSqlRunning;
  const activeJsExtension = getFileExtension(activeFile);
  const activeStatusMessage =
    activeRuntime === "sqlite"
      ? sqliteStatus
      : activeRuntime === "pglite"
        ? pgliteStatus
        : activeRuntime === "javascript"
          ? activeJsExtension === "ts" && jsStatus === "JavaScript ready"
            ? "TypeScript ready"
            : jsStatus
          : activeRuntime === "unknown"
            ? files.length === 0
              ? "Create a file to begin"
              : "Unsupported file type"
            : status;
  const activeHasError =
    activeRuntime === "python"
      ? status === "Error" || Boolean(activePythonResult?.error)
      : activeRuntime === "javascript"
        ? jsStatus === "Execution failed" || jsStatus === "JavaScript unavailable"
        : Boolean(activeSqlResult?.error);
  const canKillActiveRuntime =
    activeRuntime === "python" ||
    activeRuntime === "javascript" ||
    activeRuntime === "sqlite" ||
    activeRuntime === "pglite";
  const draftStorageKey = getRecoveryStorageKey(activeWorkspace);
  const statusBarTone = getStatusBarTone(
    activeRuntime,
    activeStatusMessage,
    activeRuntimeRunning,
    activeHasError,
    activeRuntimeReady,
    isAwaitingInput,
  );
  const currentLanguageLabel = getRuntimeLanguageLabel(activeRuntime, activeFile);
  const shareButtonDisabled = !activeFile;

  useEffect(() => {
    setBottomPanelMode(showSqlResultsPanel ? "output" : "terminal");
  }, [activeFile, showSqlResultsPanel]);

  useEffect(() => {
    if (!isMobileLayout) {
      return;
    }

    if (!activeFile || files.length === 0) {
      setMobilePane("files");
    }
  }, [activeFile, files.length, isMobileLayout]);

  useEffect(() => {
    if (bottomPanelMode !== "terminal") {
      return;
    }
    if (isMobileLayout && mobilePane === "files") {
      return;
    }
    requestTerminalResize();
  }, [bottomPanelMode, isMobileLayout, mobilePane, requestTerminalResize]);

  useEffect(() => {
    if (!isMobileLayout || mobilePane !== "editor") {
      return;
    }

    const frameId = requestAnimationFrame(() => {
      editorRef.current?.layout?.();
    });

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [activeFile, isMobileLayout, mobilePane]);

  useEffect(() => {
    if (isMobileLayout) {
      return;
    }

    const frameId = requestAnimationFrame(() => {
      editorRef.current?.layout?.();
      requestTerminalResize();
    });

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [isMobileLayout, requestTerminalResize, sidebarWidth]);

  useEffect(() => {
    if (sidebarMode !== "search" && fileSearchQuery) {
      setFileSearchQuery("");
    }
  }, [fileSearchQuery, sidebarMode]);

  const fileTabs = openFiles.filter((filename) => files.some((file) => file.name === filename));
  const mobileDockedConsoleVisible = isMobileLayout && mobilePane === "editor";
  const terminalVisible = bottomPanelMode === "terminal" && (!isMobileLayout || mobilePane === "output" || mobileDockedConsoleVisible);
  const outputVisible = bottomPanelMode === "output" && (!isMobileLayout || mobilePane === "output" || mobileDockedConsoleVisible);
  const editorPaneStyle =
    isMobileLayout || editorPaneHeight === null
      ? { flex: `${DEFAULT_EDITOR_RATIO} 1 0%` }
      : { flex: `0 0 ${editorPaneHeight}px` };
  const runButtonDisabled = isAnyRuntimeBusy || activeRuntime === "unknown" || !activeRuntimeReady;
  const desktopNavWidth = ACTIVITY_BAR_WIDTH + sidebarWidth;
  const sidebarModeLabel = sidebarMode === "search" ? "Search" : "Explorer";
  const mobileNavMode =
    mobilePane === "files"
      ? (sidebarMode === "search" ? "search" : "explorer")
      : mobilePane === "output"
        ? "console"
        : "editor";
  const mobileHeaderTitle = activeFile || "No file selected";
  const toggleTheme = useCallback(() => {
    setTheme((currentTheme) => (currentTheme === "default" ? "inverted" : "default"));
  }, []);

  const filesPanel = (
    <FileTree
      theme={theme}
      files={files}
      activeFile={activeFile}
      activeWorkspace={activeWorkspace}
      mode={sidebarMode}
      searchQuery={fileSearchQuery}
      onSearchQueryChange={setFileSearchQuery}
      workspaces={workspaces}
      onSelectWorkspace={(workspaceName) => {
        void handleWorkspaceSelect(workspaceName);
      }}
      onCreateWorkspace={handleCreateWorkspace}
      onFileSelect={handleFileSelect}
      onCreateFile={handleCreateFile}
      onRenameFile={handleRenameFile}
      onDeleteFile={handleDeleteFile}
      disabled={isAnyRuntimeBusy || !workspaceBootstrapped}
    />
  );

  const editorPanel = (
    <div
      style={{
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
        background: "var(--ide-shell-editor-bg)",
      }}
    >
      {files.length === 0 ? (
        <EmptyEditorState workspaceName={activeWorkspace} isMobile={isMobileLayout} />
      ) : !activeFile ? (
        <EmptyEditorState workspaceName={activeWorkspace} hasFiles isMobile={isMobileLayout} />
      ) : (
        <Suspense
          fallback={(
            <div
              style={{
                height: "100%",
                display: "grid",
                placeItems: "center",
                color: "var(--ide-shell-muted)",
                fontSize: "13px",
                background: "var(--ide-shell-editor-bg)",
              }}
            >
              Loading editor...
            </div>
          )}
        >
          <Editor
            code={activeFileData?.content ?? ""}
            filename={activeFile || DEFAULT_FILENAME}
            onChange={handleCodeChange}
            onMount={handleEditorMount}
            language={getLanguage(activeFile || DEFAULT_FILENAME)}
            readOnly={isAnyRuntimeBusy}
            draftStorageKey={draftStorageKey}
            themeMode={ideTheme === "inverted" ? "day" : "night"}
          />
        </Suspense>
      )}
    </div>
  );

  const outputPanel = (
    <div
      style={{
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--ide-shell-gradient)",
      }}
    >
      <div
        style={{
          height: `${BOTTOM_TABBAR_HEIGHT}px`,
          display: "flex",
          alignItems: "stretch",
          justifyContent: "space-between",
          borderBottom: "1px solid var(--ide-shell-border)",
          background: "var(--ide-shell-elevated)",
          boxShadow: "inset 0 -1px 0 var(--ide-shell-accent-soft)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "stretch", minWidth: 0 }}>
          <BottomPanelTab active={bottomPanelMode === "terminal"} onClick={() => setBottomPanelMode("terminal")}>
            TERMINAL
          </BottomPanelTab>
          <BottomPanelTab active={bottomPanelMode === "output"} onClick={() => setBottomPanelMode("output")}>
            OUTPUT
          </BottomPanelTab>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              paddingLeft: "4px",
              minWidth: 0,
            }}
          >
            <span style={{ color: "var(--ide-shell-muted)", fontSize: "10px", letterSpacing: "0.14em", textTransform: "uppercase" }}>
              Runtime
            </span>
            <span
              style={{
                color: "var(--ide-shell-text)",
                fontSize: "11px",
                fontWeight: 600,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {currentLanguageLabel}
            </span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "0 12px" }}>
          <button
            type="button"
            onClick={() => {
              if (bottomPanelMode === "output" && showSqlResultsPanel) {
                setSqlExecution(createEmptySqlExecution());
                return;
              }
              if (bottomPanelMode === "output" && showPythonOutputPanel) {
                setPythonExecution(createEmptyPythonExecution());
                return;
              }
              terminalRef.current?.clear?.();
            }}
            style={terminalActionButtonStyle()}
            className="wf-terminal-action"
          >
            Clear
          </button>
          {canKillActiveRuntime && activeRuntimeRunning ? (
            <button
              type="button"
              onClick={handleKill}
              style={terminalActionButtonStyle({
                color: "var(--ide-shell-danger)",
                border: "color-mix(in srgb, var(--ide-shell-danger) 28%, transparent)",
              })}
              className="wf-terminal-action"
            >
              Kill
            </button>
          ) : null}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, position: "relative", background: "var(--ide-shell-editor-bg)" }}>
        <div style={{ display: terminalVisible ? "block" : "none", height: "100%" }}>
          <Terminal ref={terminalRef} isVisible={terminalVisible} themeMode={ideTheme === "inverted" ? "day" : "night"} />
        </div>
        <div style={{ display: outputVisible ? "block" : "none", height: "100%" }}>
          {showSqlResultsPanel ? (
            <SqlResultsPanel
              activeFile={activeFile}
              engine={activeRuntime}
              result={activeSqlResult}
              isReady={activeRuntimeReady}
              isRunning={activeRuntimeRunning}
              status={activeStatusMessage}
              schema={activeSqlResult?.schema}
            />
          ) : showPythonOutputPanel ? (
            <PythonOutputPanel
              activeFile={activeFile}
              result={activePythonResult}
              isReady={activeRuntimeReady}
              isRunning={activeRuntimeRunning}
              status={activeStatusMessage}
            />
          ) : (
            <OutputPlaceholder activeFile={activeFile} />
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div
      className="wasmforge-shell"
      style={{
        ...ideCssVars,
        minHeight: "100dvh",
        height: "100dvh",
        overflow: "hidden",
        position: "relative",
        background: "var(--ide-shell-bg)",
        color: "var(--ide-shell-text)",
        fontFamily: '"Instrument Sans", "Segoe UI Variable Text", "Segoe UI", sans-serif',
        display: "flex",
        flexDirection: "column",
      }}
    >
      <WasmForgeShellGlobalStyles />

      {!isMobileLayout ? (
        <div
          style={{
            height: `${TOP_HEADER_HEIGHT}px`,
            minHeight: `${TOP_HEADER_HEIGHT}px`,
            display: "flex",
            flexDirection: "column",
            position: "relative",
            zIndex: 1,
            background: "var(--ide-shell-elevated)",
            borderBottom: "1px solid var(--ide-shell-border)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              height: "32px",
              minHeight: "32px",
              padding: "0 14px",
              borderBottom: "1px solid var(--ide-shell-border)",
              background: "var(--ide-shell-elevated)",
            }}
          >
            <button
              type="button"
              onClick={() => onNavigateHome?.()}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                minWidth: 0,
                flexShrink: 0,
                border: "none",
                padding: 0,
                margin: 0,
                background: "transparent",
                cursor: onNavigateHome ? "pointer" : "default",
                color: "inherit",
              }}
            >
              <LogoMark />
              <div style={{ color: "var(--ide-shell-text)", fontSize: "13px", fontWeight: 700, whiteSpace: "nowrap", letterSpacing: "0.01em" }}>
                WasmForge
              </div>
            </button>

            <div style={{ flex: 1, minWidth: 0, display: "flex", justifyContent: "center", padding: "0 8px" }}>
              <ToolbarSearch
                value={fileSearchQuery}
                onChange={(value) => {
                  setSidebarMode("search");
                  setFileSearchQuery(value);
                }}
                onFocus={() => setSidebarMode("search")}
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "12px", flexShrink: 0, color: "var(--ide-shell-muted)", fontSize: "11px" }}>
              <span style={{ color: "var(--ide-shell-text)", maxWidth: "180px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {activeWorkspace}
              </span>
              <span style={{ width: "1px", height: "12px", background: "var(--ide-shell-border-strong)", flexShrink: 0 }} />
              <span>{currentLanguageLabel}</span>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "stretch",
              minHeight: "32px",
              background: "var(--ide-shell-subtle)",
            }}
          >
            <div
              style={{
                width: `${desktopNavWidth}px`,
                minWidth: `${desktopNavWidth}px`,
                borderRight: "1px solid var(--ide-shell-border)",
                background: "var(--ide-shell-subtle)",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "0 14px",
                color: "var(--ide-shell-muted)",
                fontSize: "11px",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                whiteSpace: "nowrap",
              }}
            >
              <span style={{ color: "var(--ide-shell-text)", fontWeight: 700 }}>{sidebarModeLabel}</span>
              <span style={{ width: "4px", height: "10px", borderRadius: "1px", background: "var(--ide-shell-accent)", flexShrink: 0 }} />
              <span>{files.length} file{files.length === 1 ? "" : "s"}</span>
            </div>

            <div
              style={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                alignItems: "stretch",
                overflowX: "auto",
                scrollbarWidth: "thin",
                background: "var(--ide-shell-subtle)",
              }}
            >
              {fileTabs.length === 0 ? (
                <div style={{ padding: "0 12px", color: "var(--ide-shell-muted)", fontSize: "12px", display: "flex", alignItems: "center" }}>
                  No file selected
                </div>
              ) : (
                fileTabs.map((filename) => (
                  <HeaderTab
                    key={filename}
                    active={filename === activeFile}
                    filename={filename}
                    onSelect={() => {
                      void handleFileSelect(filename);
                    }}
                    onClose={() => handleCloseTab(filename)}
                  />
                ))
              )}
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: "8px",
                padding: "0 12px",
                flexShrink: 0,
                borderLeft: "1px solid var(--ide-shell-border)",
                background: "var(--ide-shell-subtle)",
              }}
            >
              <button
                type="button"
                aria-label="Copy share link"
                title="Copy share link"
                onClick={handleShareLink}
                disabled={shareButtonDisabled}
                style={shareButtonStyle({
                  disabled: shareButtonDisabled,
                  tone: shareStatus.tone,
                })}
              >
                <ShareIcon />
                <span>{shareStatus.label}</span>
              </button>
              <button
                type="button"
                onClick={handleRun}
                disabled={runButtonDisabled}
                style={runButtonStyle(runButtonDisabled)}
                className="wf-run-btn"
              >
                ▶ Run
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isMobileLayout ? (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "var(--ide-shell-bg)", position: "relative", zIndex: 1 }}>
          <div
            style={{
              height: `${MOBILE_TOPBAR_HEIGHT}px`,
              minHeight: `${MOBILE_TOPBAR_HEIGHT}px`,
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "0 14px",
              background: "var(--ide-shell-elevated)",
              borderBottom: "1px solid var(--ide-shell-border)",
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              aria-label={mobilePane === "files" && sidebarMode === "explorer" ? "Back to editor" : "Open explorer"}
              onClick={() => {
                if (mobilePane === "files" && sidebarMode === "explorer") {
                  setMobilePane("editor");
                  return;
                }
                setSidebarMode("explorer");
                setMobilePane("files");
              }}
              style={mobileTopButtonStyle(mobilePane === "files" && sidebarMode === "explorer")}
            >
              <MenuIcon />
            </button>

            <button
              type="button"
              onClick={() => onNavigateHome?.()}
              style={{
                flex: 1,
                minWidth: 0,
                border: "none",
                padding: 0,
                margin: 0,
                background: "transparent",
                cursor: onNavigateHome ? "pointer" : "default",
                color: "inherit",
                textAlign: "left",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "9px", minWidth: 0 }}>
                <LogoMark />
                <div style={{ color: "var(--ide-shell-text)", fontSize: "14px", fontWeight: 700, letterSpacing: "0.01em" }}>
                  WasmForge
                </div>
              </div>
              <div
                style={{
                  marginTop: "4px",
                  color: "var(--ide-shell-text-soft)",
                  fontSize: "12px",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {mobileHeaderTitle}
                <span style={{ color: "var(--ide-shell-muted)" }}> — {activeWorkspace}</span>
              </div>
            </button>

            <button
              type="button"
              aria-label="Copy share link"
              title="Copy share link"
              onClick={handleShareLink}
              disabled={shareButtonDisabled}
              style={mobileTopButtonStyle(shareStatus.tone === "success")}
            >
              <ShareIcon />
            </button>

            <button
              type="button"
              aria-label="Toggle theme"
              onClick={toggleTheme}
              style={mobileTopButtonStyle(ideTheme === "inverted")}
            >
              <ThemeToggleGlyph theme={ideTheme} />
            </button>

            <div style={mobileSignalChipStyle(statusBarTone)}>
              <StatusPulseIcon tone={statusBarTone} />
            </div>
          </div>

          <div
            style={{
              height: `${MOBILE_TABBAR_HEIGHT}px`,
              minHeight: `${MOBILE_TABBAR_HEIGHT}px`,
              display: "flex",
              alignItems: "stretch",
              overflowX: "auto",
              background: "var(--ide-shell-subtle)",
              borderBottom: "1px solid var(--ide-shell-border)",
              flexShrink: 0,
              scrollbarWidth: "none",
            }}
          >
            {fileTabs.length === 0 ? (
              <div style={{ padding: "0 14px", display: "flex", alignItems: "center", color: "var(--ide-shell-muted)", fontSize: "12px" }}>
                Open a file from the explorer to begin
              </div>
            ) : (
              fileTabs.map((filename) => (
                <MobileHeaderTab
                  key={filename}
                  active={filename === activeFile}
                  filename={filename}
                  onSelect={() => {
                    void handleFileSelect(filename);
                  }}
                  onClose={() => handleCloseTab(filename)}
                />
              ))
            )}
          </div>

          <div style={{ flex: 1, minHeight: 0, overflow: "hidden", position: "relative" }}>
            {mobilePane === "files" ? (
              <div style={{ height: "100%" }}>{filesPanel}</div>
            ) : mobilePane === "output" ? (
              <div style={{ height: "100%" }}>{outputPanel}</div>
            ) : (
              <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--ide-shell-bg)" }}>
                <div style={{ flex: 1, minHeight: 0 }}>{editorPanel}</div>
                <div
                  style={{
                    flex: `0 0 ${MOBILE_DOCKED_PANEL_HEIGHT}px`,
                    minHeight: "180px",
                    borderTop: "1px solid var(--ide-shell-border)",
                    background: "var(--ide-shell-bg)",
                  }}
                >
                  {outputPanel}
                </div>
              </div>
            )}

            {mobilePane !== "files" ? (
              <button
              type="button"
              aria-label="Run current file"
              onClick={handleRun}
              disabled={runButtonDisabled}
              style={mobileRunButtonStyle(runButtonDisabled)}
              className="wf-fab"
            >
              <PlayIcon />
            </button>
          ) : null}
          </div>

          <div
            style={{
              height: `${MOBILE_STATUS_HEIGHT}px`,
              minHeight: `${MOBILE_STATUS_HEIGHT}px`,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "10px",
              padding: "0 10px",
              background: "var(--ide-shell-subtle)",
              color: "var(--ide-shell-text)",
              fontSize: "11px",
              borderTop: "1px solid var(--ide-shell-border)",
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "7px", minWidth: 0, flex: 1 }}>
              <span
                style={{
                  width: "8px",
                  height: "2px",
                  borderRadius: "1px",
                  background: statusBarTone,
                  flexShrink: 0,
                }}
              />
              <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {activeStatusMessage}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
              <span>{currentLanguageLabel}</span>
              <span>⚡ Offline-ready</span>
            </div>
          </div>

          <div
            style={{
              height: `${MOBILE_NAV_HEIGHT}px`,
              minHeight: `${MOBILE_NAV_HEIGHT}px`,
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: "8px",
              padding: "8px 10px 10px",
              background: "var(--ide-shell-elevated)",
              borderTop: "1px solid var(--ide-shell-border)",
              flexShrink: 0,
            }}
          >
            <MobileNavButton
              active={mobileNavMode === "explorer"}
              label="Explorer"
              onClick={() => {
                setSidebarMode("explorer");
                setMobilePane("files");
              }}
            >
              <ExplorerIcon />
            </MobileNavButton>
            <MobileNavButton
              active={mobileNavMode === "editor"}
              label="Editor"
              onClick={() => setMobilePane("editor")}
            >
              <CodeIcon />
            </MobileNavButton>
            <MobileNavButton
              active={mobileNavMode === "search"}
              label="Search"
              onClick={() => {
                setSidebarMode("search");
                setMobilePane("files");
              }}
            >
              <SearchIcon />
            </MobileNavButton>
            <MobileNavButton
              active={mobileNavMode === "console"}
              label="Console"
              onClick={() => {
                setBottomPanelMode("terminal");
                setMobilePane("output");
              }}
            >
              <TerminalIcon />
            </MobileNavButton>
          </div>
        </div>
      ) : (
        <div ref={desktopLayoutRef} style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden", position: "relative", zIndex: 1 }}>
          <div
            style={{
              width: `${ACTIVITY_BAR_WIDTH}px`,
              background: "var(--ide-activity-bg)",
              borderRight: "1px solid var(--ide-shell-border)",
              display: "flex",
              flexDirection: "column",
              alignItems: "stretch",
              justifyContent: "flex-start",
              paddingTop: "10px",
              paddingBottom: "10px",
              flexShrink: 0,
            }}
          >
            <div>
              <ActivityButton active={sidebarMode === "explorer"} title="Explorer" onClick={() => setSidebarMode("explorer")}>
                <ExplorerIcon />
              </ActivityButton>
              <ActivityButton active={sidebarMode === "search"} title="Search" onClick={() => setSidebarMode("search")}>
                <SearchIcon />
              </ActivityButton>
              <ActivityButton active={ideTheme === "inverted"} title="Toggle theme" onClick={toggleTheme}>
                <ThemeToggleGlyph theme={ideTheme} />
              </ActivityButton>
            </div>
          </div>

          <div
            style={{
              width: `${sidebarWidth}px`,
              background: "var(--ide-shell-elevated)",
              borderRight: "1px solid var(--ide-shell-border)",
              minWidth: 0,
              flexShrink: 0,
            }}
          >
            {filesPanel}
          </div>

          <VerticalResizeHandle onPointerDown={startResize("sidebar")} />

          <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <div
              ref={shellBodyRef}
              style={{
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                padding: "10px 12px 10px 10px",
                background: "var(--ide-shell-bg)",
              }}
            >
              <div
                style={{
                  ...editorPaneStyle,
                  minHeight: MIN_EDITOR_PANEL_HEIGHT,
                  minWidth: 0,
                  borderRadius: "4px",
                  overflow: "hidden",
                  border: "1px solid var(--ide-shell-border)",
                  boxShadow: "none",
                }}
              >
                {editorPanel}
              </div>
              <HorizontalResizeHandle onPointerDown={startResize("editor-terminal")} />
              <div
                style={{
                  flex: 1,
                  minHeight: MIN_TERMINAL_PANEL_HEIGHT,
                  minWidth: 0,
                  borderRadius: "4px",
                  overflow: "hidden",
                  border: "1px solid var(--ide-shell-border)",
                  boxShadow: "none",
                }}
              >
                {outputPanel}
              </div>
            </div>
          </div>
        </div>
      )}

      {!isMobileLayout ? (
        <div
          style={{
            height: `${STATUS_BAR_HEIGHT}px`,
            minHeight: `${STATUS_BAR_HEIGHT}px`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            padding: "0 10px",
            position: "relative",
            zIndex: 1,
            background: "var(--ide-shell-subtle)",
            color: "var(--ide-shell-text)",
            fontSize: "12px",
            borderTop: "1px solid var(--ide-shell-border)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
            <span style={{ ...statusBarTokenStyle(), maxWidth: "220px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {activeWorkspace}
            </span>
            <span style={statusBarDividerStyle()} />
            <span style={{ ...statusBarTokenStyle(), display: "inline-flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
              <span
                style={{
                  width: "8px",
                  height: "2px",
                  borderRadius: "1px",
                  background: statusBarTone,
                  flexShrink: 0,
                }}
              />
              <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {activeStatusMessage}
              </span>
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 }}>
            <span style={statusBarTokenStyle()}>{currentLanguageLabel}</span>
            <span style={statusBarDividerStyle()} />
            <span style={statusBarTokenStyle()}>⚡ Offline-ready</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function HorizontalResizeHandle({ onPointerDown }) {
  return (
    <div
      className="wf-horizontal-handle"
      onPointerDown={onPointerDown}
      style={{
        height: `${EDITOR_SPLIT_HANDLE_HEIGHT}px`,
        flexShrink: 0,
        cursor: "row-resize",
        background: "transparent",
        display: "grid",
        placeItems: "center",
      }}
    >
      <div style={{ width: "54px", height: "1px", background: "var(--ide-shell-border-strong)" }} />
    </div>
  );
}

function VerticalResizeHandle({ onPointerDown }) {
  return (
    <div
      className="wf-vertical-handle"
      onPointerDown={onPointerDown}
      style={{
        width: `${SIDEBAR_RESIZE_HANDLE_WIDTH}px`,
        flexShrink: 0,
        cursor: "col-resize",
        background: "transparent",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: "50%",
          width: "1px",
          transform: "translateX(-50%)",
          background: "var(--ide-shell-border-strong)",
        }}
      />
    </div>
  );
}

function ActivityButton({ active = false, children, disabled = false, title, onClick }) {
  return (
    <button
      className="wf-activity-btn"
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: "100%",
        height: "42px",
        border: "none",
        borderLeft: `2px solid ${active ? "var(--ide-shell-accent)" : "transparent"}`,
        background: active ? "var(--ide-shell-selection)" : "transparent",
        color: active ? "var(--ide-shell-text)" : "var(--ide-shell-muted)",
        display: "grid",
        placeItems: "center",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.8 : 1,
      }}
    >
      {children}
    </button>
  );
}

function HeaderTab({ active = false, filename, onSelect, onClose }) {
  const visual = getFileVisualMeta(filename);
  return (
    <button
      className="wf-tab"
      type="button"
      onClick={onSelect}
      style={{
        height: "32px",
        minWidth: "132px",
        maxWidth: "228px",
        padding: "0 12px",
        border: "none",
        borderTop: `1px solid ${active ? "var(--ide-shell-accent)" : "transparent"}`,
        borderRight: "1px solid var(--ide-shell-border)",
        background: active ? "var(--ide-shell-panel)" : "var(--ide-shell-elevated)",
        color: active ? "var(--ide-shell-text)" : "var(--ide-shell-text-soft)",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          width: "16px",
          height: "16px",
          borderRadius: "3px",
          display: "grid",
          placeItems: "center",
          background: visual.surface,
          color: visual.accent,
          fontSize: "8px",
          fontWeight: 700,
          flexShrink: 0,
          boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--ide-shell-border-strong) 34%, transparent)",
        }}
      >
        {visual.label}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontFamily: '"Cascadia Code", Consolas, monospace',
          fontSize: "12px",
          fontWeight: active ? 700 : 600,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          textAlign: "left",
          letterSpacing: "0.01em",
        }}
      >
        {filename}
      </span>
      <span
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        style={{
          color: active ? "var(--ide-shell-text-soft)" : "var(--ide-shell-muted)",
          fontSize: "12px",
          lineHeight: 1,
          width: "16px",
          height: "16px",
          display: "grid",
          placeItems: "center",
          borderRadius: "3px",
          background: active ? "var(--ide-shell-accent-soft)" : "transparent",
        }}
      >
        ×
      </span>
    </button>
  );
}

function BottomPanelTab({ active = false, children, onClick }) {
  return (
    <button
      className="wf-panel-tab"
      type="button"
      onClick={onClick}
      style={{
        border: "none",
        borderBottom: `1px solid ${active ? "var(--ide-shell-accent)" : "transparent"}`,
        background: "transparent",
        color: active ? "var(--ide-shell-text)" : "var(--ide-shell-muted)",
        padding: "0 15px",
        fontSize: "11px",
        fontWeight: 600,
        letterSpacing: "0.12em",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function MobileHeaderTab({ active = false, filename, onSelect, onClose }) {
  const visual = getFileVisualMeta(filename);
  return (
    <button
      className="wf-mobile-tab"
      type="button"
      onClick={onSelect}
      style={{
        height: "100%",
        minWidth: "124px",
        maxWidth: "186px",
        padding: "0 12px",
        border: "none",
        borderTop: `2px solid ${active ? "var(--ide-shell-accent)" : "transparent"}`,
        background: active ? "var(--ide-shell-panel)" : "var(--ide-shell-elevated)",
        color: active ? "var(--ide-shell-text)" : "var(--ide-shell-text-soft)",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        flexShrink: 0,
        cursor: "pointer",
      }}
    >
      <span
        style={{
          width: "14px",
          height: "14px",
          borderRadius: "3px",
          display: "grid",
          placeItems: "center",
          background: visual.surface,
          color: visual.accent,
          fontSize: "8px",
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {visual.label}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          textAlign: "left",
          fontFamily: '"Cascadia Code", Consolas, monospace',
          fontSize: "12px",
          letterSpacing: "0.01em",
        }}
      >
        {filename}
      </span>
      <span
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        style={{
          width: "16px",
          height: "16px",
          display: "grid",
          placeItems: "center",
          borderRadius: "3px",
          color: active ? "var(--ide-shell-text-soft)" : "var(--ide-shell-muted)",
          background: active ? "var(--ide-shell-accent-soft)" : "transparent",
          flexShrink: 0,
        }}
      >
        ×
      </span>
    </button>
  );
}

function MobileNavButton({ active = false, label, children, onClick }) {
  return (
    <button
      className="wf-mobile-nav-btn"
      type="button"
      onClick={onClick}
      style={{
        border: "none",
        background: active ? "var(--ide-shell-selection)" : "transparent",
        color: active ? "var(--ide-shell-text)" : "var(--ide-shell-muted)",
        borderRadius: "4px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "6px",
        cursor: "pointer",
        transition: "background 160ms ease, color 160ms ease, transform 160ms ease",
        boxShadow: active ? "inset 0 0 0 1px color-mix(in srgb, var(--ide-shell-accent) 14%, transparent)" : "none",
      }}
    >
      <span
        style={{
          width: "22px",
          height: "22px",
          display: "grid",
          placeItems: "center",
        }}
      >
        {children}
      </span>
      <span
        style={{
          fontSize: "11px",
          fontWeight: active ? 700 : 600,
          letterSpacing: "0.03em",
        }}
      >
        {label}
      </span>
    </button>
  );
}

function mobileTopButtonStyle(active = false) {
  return {
    width: "36px",
    height: "36px",
    border: "1px solid var(--ide-shell-border)",
    background: active ? "var(--ide-shell-selection)" : "var(--ide-shell-elevated)",
    color: active ? "var(--ide-shell-text)" : "var(--ide-shell-text-soft)",
    borderRadius: "4px",
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    flexShrink: 0,
  };
}

function mobileSignalChipStyle(tone) {
  return {
    width: "28px",
    height: "28px",
    borderRadius: "4px",
    background: "var(--ide-shell-elevated)",
    border: "1px solid var(--ide-shell-border)",
    display: "grid",
    placeItems: "center",
    color: tone,
    flexShrink: 0,
  };
}

function mobileRunButtonStyle(disabled = false) {
  return {
    position: "absolute",
    right: "16px",
    bottom: `calc(${MOBILE_NAV_HEIGHT + MOBILE_STATUS_HEIGHT}px + 14px)`,
    width: "52px",
    height: "52px",
    border: disabled
      ? "1px solid var(--ide-shell-border-strong)"
      : "1px solid color-mix(in srgb, var(--ide-shell-accent) 30%, transparent)",
    borderRadius: "4px",
    background: disabled ? "var(--ide-shell-panel)" : "var(--ide-shell-accent)",
    color: disabled ? "var(--ide-shell-muted-strong)" : "var(--ide-shell-accent-contrast)",
    display: "grid",
    placeItems: "center",
    cursor: disabled ? "not-allowed" : "pointer",
    zIndex: 6,
  };
}

function LogoMark() {
  return (
    <div
      style={{
        width: "20px",
        height: "20px",
        borderRadius: "3px",
        display: "grid",
        placeItems: "center",
        background: "linear-gradient(135deg, var(--ide-shell-accent) 0%, var(--ide-shell-accent-strong) 100%)",
        color: "var(--ide-shell-accent-contrast)",
        fontSize: "10px",
        fontWeight: 800,
        border: "1px solid color-mix(in srgb, var(--ide-shell-border-strong) 26%, transparent)",
      }}
    >
      <span style={{ letterSpacing: "-0.04em" }}>W</span>
    </div>
  );
}

function ToolbarSearch({ value, onChange, onFocus }) {
  return (
    <label
      className="wf-toolbar-search"
      style={{
        width: "100%",
        maxWidth: "520px",
        height: "30px",
        display: "flex",
        alignItems: "center",
        gap: "9px",
        padding: "0 12px",
        background: "var(--ide-shell-elevated)",
        border: "1px solid var(--ide-shell-border)",
        borderRadius: "4px",
        color: "var(--ide-shell-muted)",
      }}
    >
      <SearchIcon />
      <input
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        onFocus={onFocus}
        placeholder="Search files"
        spellCheck={false}
        style={{
          flex: 1,
          minWidth: 0,
          border: "none",
          outline: "none",
          background: "transparent",
          color: "var(--ide-shell-text)",
          fontSize: "12px",
          fontWeight: 500,
        }}
      />
    </label>
  );
}

function ThemeToggleGlyph({ theme = "default" }) {
  const active = theme === "inverted";

  return (
    <span
      aria-hidden="true"
      style={{
        position: "relative",
        width: "18px",
        height: "18px",
        display: "grid",
        placeItems: "center",
        borderRadius: "999px",
        border: "1px solid color-mix(in srgb, var(--ide-shell-border-strong) 60%, transparent)",
        background: "color-mix(in srgb, var(--ide-shell-panel) 85%, transparent)",
        boxShadow: "0 0 0 3px color-mix(in srgb, var(--ide-shell-accent-soft) 70%, transparent)",
      }}
    >
      <span
        style={{
          width: "10px",
          height: "10px",
          borderRadius: "999px",
          background: active
            ? "linear-gradient(135deg, var(--ide-shell-accent) 0 50%, var(--ide-shell-panel) 50% 100%)"
            : "linear-gradient(135deg, var(--ide-shell-panel) 0 50%, var(--ide-shell-accent) 50% 100%)",
          transform: active ? "rotate(-10deg)" : "rotate(18deg)",
          transition: "transform 220ms ease, background 220ms ease",
        }}
      />
    </span>
  );
}

function ExplorerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.25 4.25h4.1l1.1 1.25h6.3v6.25a1 1 0 0 1-1 1H3.25a1 1 0 0 1-1-1V4.25Z" stroke="currentColor" strokeWidth="1.1" />
      <path d="M2.25 5.5h11.5" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="6.75" cy="6.75" r="3.75" stroke="currentColor" strokeWidth="1.1" />
      <path d="m9.75 9.75 3 3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M10.75 3.5h2v2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.5 7.5 12.75 3.25" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <path d="M12 8.5v2.25a1 1 0 0 1-1 1H4.75a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1H7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.25 4h11.5M2.25 8h11.5M2.25 12h11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6 4 2.75 8 6 12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m10 4 3.25 4L10 12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TerminalIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2.25" y="3.25" width="11.5" height="9.5" rx="1.25" stroke="currentColor" strokeWidth="1.1" />
      <path d="M4.5 6.2 6.8 8 4.5 9.8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.4 10h2.7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

function StatusPulseIcon({ tone = "var(--ide-shell-success)" }) {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.2" opacity="0.35" />
      <rect x="5.25" y="5.25" width="5.5" height="5.5" rx="1.2" style={{ fill: tone }} />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M5 3.75v8.5l6.5-4.25L5 3.75Z" fill="currentColor" />
    </svg>
  );
}

function OutputPlaceholder({ activeFile }) {
  return (
    <div
      style={{
        height: "100%",
        display: "grid",
        placeItems: "center",
        background: "var(--ide-shell-output-bg)",
        color: "var(--ide-shell-muted)",
        padding: "24px",
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: "440px" }}>
        <div
          style={{
            display: "inline-block",
            color: "var(--ide-shell-muted)",
            fontSize: "10px",
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          Output
        </div>
        <div style={{ marginTop: "14px", color: "var(--ide-shell-text)", fontSize: "16px", fontWeight: 700, letterSpacing: "0.01em" }}>
          SQL results appear here
        </div>
        <div style={{ marginTop: "8px", fontSize: "12px", lineHeight: 1.7, color: "var(--ide-shell-muted)" }}>
          Run a `.sql` or `.pg` file to inspect result sets and schema output in this panel.
        </div>
      </div>
    </div>
  );
}

function EmptyEditorState({ workspaceName, hasFiles = false, isMobile = false }) {
  return (
    <div
      style={{
        height: "100%",
        display: "grid",
        placeItems: "center",
        padding: isMobile ? "18px" : "24px",
        background: "var(--ide-shell-editor-bg)",
      }}
    >
      <div
        style={{
          maxWidth: "420px",
          textAlign: "center",
          padding: isMobile ? "18px" : "20px",
        }}
      >
        <div style={{ color: "var(--ide-shell-muted)", fontSize: "11px", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase" }}>
          Workspace
        </div>
        <div style={{ marginTop: "10px", color: "var(--ide-shell-text-soft)", fontFamily: '"Cascadia Code", Consolas, monospace', fontSize: "12px" }}>
          {workspaceName}
        </div>
        <div style={{ color: "var(--ide-shell-text)", fontSize: isMobile ? "18px" : "20px", fontWeight: 700, marginTop: "18px" }}>
          {hasFiles ? "Open a file to start editing" : "Create a file to begin"}
        </div>
        <div style={{ color: "var(--ide-shell-muted)", fontSize: "13px", marginTop: "10px", lineHeight: 1.7 }}>
          {hasFiles
            ? "Select a file from the explorer to open it in the editor."
            : "Use the explorer to create a file. Files and runtime data persist locally."}
        </div>
      </div>
    </div>
  );
}

function terminalActionButtonStyle({
  color = "var(--ide-shell-text)",
  border = "color-mix(in srgb, var(--ide-shell-border-strong) 30%, transparent)",
} = {}) {
  return {
    border: `1px solid ${border}`,
    background: "var(--ide-shell-panel)",
    color,
    fontSize: "11px",
    cursor: "pointer",
    padding: "5px 9px",
    letterSpacing: "0.05em",
    borderRadius: "3px",
    fontWeight: 600,
  };
}

function runButtonStyle(disabled = false) {
  return {
    height: "28px",
    border: disabled
      ? "1px solid var(--ide-shell-border-strong)"
      : "1px solid color-mix(in srgb, var(--ide-shell-accent) 26%, transparent)",
    borderRadius: "3px",
    background: disabled ? "var(--ide-shell-panel)" : "var(--ide-shell-accent)",
    color: disabled ? "var(--ide-shell-muted-strong)" : "var(--ide-shell-accent-contrast)",
    padding: "0 14px",
    fontSize: "12px",
    fontWeight: 700,
    letterSpacing: "0.05em",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.82 : 1,
  };
}

function shareButtonStyle({ disabled = false, tone = "idle" } = {}) {
  const isSuccess = tone === "success";
  const isError = tone === "error";

  return {
    height: "28px",
    display: "inline-flex",
    alignItems: "center",
    gap: "7px",
    padding: "0 12px",
    borderRadius: "3px",
    border: disabled
      ? "1px solid var(--ide-shell-border-strong)"
      : isSuccess
        ? "1px solid color-mix(in srgb, var(--ide-shell-success) 36%, transparent)"
        : isError
          ? "1px solid color-mix(in srgb, var(--ide-shell-danger) 32%, transparent)"
          : "1px solid color-mix(in srgb, var(--ide-shell-border-strong) 46%, transparent)",
    background: disabled
      ? "var(--ide-shell-panel)"
      : isSuccess
        ? "color-mix(in srgb, var(--ide-shell-success) 18%, var(--ide-shell-panel))"
        : isError
          ? "color-mix(in srgb, var(--ide-shell-danger) 12%, var(--ide-shell-panel))"
          : "var(--ide-shell-panel)",
    color: disabled
      ? "var(--ide-shell-muted-strong)"
      : isSuccess
        ? "var(--ide-shell-success)"
        : isError
          ? "var(--ide-shell-danger)"
          : "var(--ide-shell-text)",
    fontSize: "12px",
    fontWeight: 700,
    letterSpacing: "0.04em",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.82 : 1,
  };
}

function statusBarTokenStyle() {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: "7px",
    padding: 0,
    position: "relative",
    whiteSpace: "nowrap",
    fontWeight: 500,
  };
}

function statusBarDividerStyle() {
  return {
    width: "1px",
    height: "12px",
    background: "color-mix(in srgb, var(--ide-shell-accent) 24%, transparent)",
    flexShrink: 0,
  };
}

function WasmForgeShellGlobalStyles() {
  return (
    <style>
      {`
        @keyframes wfShellRise {
          from {
            opacity: 0;
            transform: translateY(8px);
          }

          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .wasmforge-shell * {
          box-sizing: border-box;
        }

        .wasmforge-shell ::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }

        .wasmforge-shell ::-webkit-scrollbar-track {
          background: transparent;
        }

        .wasmforge-shell ::-webkit-scrollbar-thumb {
          background: color-mix(in srgb, var(--ide-shell-border-strong) 72%, transparent);
          border-radius: 3px;
          border: 2px solid transparent;
          background-clip: padding-box;
        }

        .wasmforge-shell ::-webkit-scrollbar-thumb:hover {
          background: color-mix(in srgb, var(--ide-shell-muted) 64%, transparent);
          background-clip: padding-box;
        }

        .wasmforge-shell .wf-activity-btn,
        .wasmforge-shell .wf-tab,
        .wasmforge-shell .wf-panel-tab,
        .wasmforge-shell .wf-mobile-tab,
        .wasmforge-shell .wf-mobile-nav-btn,
        .wasmforge-shell .wf-run-btn,
        .wasmforge-shell .wf-fab,
        .wasmforge-shell .wf-terminal-action,
        .wasmforge-shell .wf-toolbar-search,
        .wasmforge-shell .wf-horizontal-handle,
        .wasmforge-shell .wf-vertical-handle {
          transition: background 160ms ease, border-color 160ms ease, color 160ms ease, box-shadow 160ms ease, opacity 160ms ease;
        }

        .wasmforge-shell .wf-tab,
        .wasmforge-shell .wf-panel-tab,
        .wasmforge-shell .wf-terminal-surface {
          animation: wfShellRise 420ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
        }

        .wasmforge-shell .wf-activity-btn:hover:not(:disabled),
        .wasmforge-shell .wf-mobile-nav-btn:hover:not(:disabled),
        .wasmforge-shell .wf-run-btn:hover:not(:disabled),
        .wasmforge-shell .wf-fab:hover:not(:disabled),
        .wasmforge-shell .wf-terminal-action:hover:not(:disabled) {
          background: var(--ide-shell-hover);
        }

        .wasmforge-shell .wf-tab:hover,
        .wasmforge-shell .wf-mobile-tab:hover {
          background: var(--ide-shell-hover);
        }

        .wasmforge-shell .wf-panel-tab:hover,
        .wasmforge-shell .wf-activity-btn:hover,
        .wasmforge-shell .wf-mobile-nav-btn:hover,
        .wasmforge-shell .wf-terminal-action:hover,
        .wasmforge-shell .wf-toolbar-search:hover {
          box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ide-shell-accent) 12%, transparent);
        }

        .wasmforge-shell .wf-toolbar-search:focus-within {
          border-color: color-mix(in srgb, var(--ide-shell-accent) 30%, transparent);
          box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ide-shell-accent) 16%, transparent);
        }

        .wasmforge-shell .wf-horizontal-handle:hover,
        .wasmforge-shell .wf-vertical-handle:hover {
          background: color-mix(in srgb, var(--ide-shell-accent) 8%, transparent);
        }

        .wasmforge-shell .wf-terminal-surface {
          position: relative;
        }

        .wasmforge-shell .wf-terminal-surface::before {
          display: none;
        }
      `}
    </style>
  );
}

function getFileVisualMeta(filename = "") {
  switch (getFileExtension(filename)) {
    case "py":
      return { label: "PY", accent: "var(--ide-file-py-accent)", surface: "var(--ide-file-py-surface)" };
    case "js":
      return { label: "JS", accent: "var(--ide-file-js-accent)", surface: "var(--ide-file-js-surface)" };
    case "ts":
      return { label: "TS", accent: "var(--ide-file-ts-accent)", surface: "var(--ide-file-ts-surface)" };
    case "sql":
      return { label: "SQL", accent: "var(--ide-file-sql-accent)", surface: "var(--ide-file-sql-surface)" };
    case "pg":
      return { label: "PG", accent: "var(--ide-file-pg-accent)", surface: "var(--ide-file-pg-surface)" };
    default:
      return { label: "TXT", accent: "var(--ide-file-txt-accent)", surface: "var(--ide-file-txt-surface)" };
  }
}
