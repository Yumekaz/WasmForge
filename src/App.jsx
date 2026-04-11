import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Terminal from "./components/Terminal.jsx";
import FileTree from "./components/FileTree.jsx";
import SqlResultsPanel from "./components/SqlResultsPanel.jsx";
import PythonOutputPanel from "./components/PythonOutputPanel.jsx";
import OfflineProofPanel from "./components/OfflineProofPanel.jsx";
import PythonNotebook from "./components/PythonNotebook.jsx";
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
import {
  createDefaultPythonNotebookDocument,
  createNotebookCell,
  isPythonNotebookFile,
  parsePythonNotebookDocument,
  serializePythonNotebookDocument,
} from "./utils/pythonNotebook.js";
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
const OFFLINE_PROOF_WORKSPACE_NAME = "offline-proof-demo";
const OFFLINE_PROOF_HELPER_FILENAME = "offline_helper.py";
const OFFLINE_PROOF_REQUIRED_CACHE_PATTERNS = [
  /\/pyodide\/pyodide\.js/i,
  /\/pyodide\/pyodide\.asm\.wasm/i,
  /\/pyodide\/python_stdlib\.zip/i,
  /\/numpy-[^/]+\.whl/i,
];
const OFFLINE_PROOF_STEPS = [
  "Open the proof workspace once while online.",
  "Wait until every check says ready for Airplane Mode.",
  "Turn on Airplane Mode or disable Wi-Fi.",
  "Hard refresh the /ide page.",
  "Run main.py and answer the input() prompt.",
  "Watch the helper import, local runtime proof, and persisted workspace all survive.",
];
const OFFLINE_PROOF_MAIN_SOURCE = `from offline_helper import build_report

name = input("Offline proof > type any name: ")

for line in build_report(name):
    print(line)
`;
const OFFLINE_PROOF_HELPER_SOURCE = `import numpy as np


def build_report(name):
    sample = np.array([2, 4, 6, 8], dtype=int)
    return [
        f"offline-proof ok for {name}",
        f"helper-import ok {int(sample.sum())}",
        "browser worker ok",
        "workspace persistence ok",
        "airplane-mode demo ready",
    ]
`;
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
  if (isPythonNotebookFile(filename)) {
    return "json";
  }

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

function buildOfflineProofStepText() {
  return [
    "WasmForge offline proof",
    "",
    ...OFFLINE_PROOF_STEPS.map((step, index) => `${index + 1}. ${step}`),
    "",
    `Workspace: ${OFFLINE_PROOF_WORKSPACE_NAME}`,
    `Files: ${DEFAULT_FILENAME}, ${OFFLINE_PROOF_HELPER_FILENAME}`,
  ].join("\n");
}

function getOfflineProofGuidance(checks) {
  if (!checks.serviceWorkerControlled) {
    return "Stay online and refresh once so the service worker can take control of /ide.";
  }

  if (!checks.runtimeCacheReady) {
    return "Wait for Python to finish loading online so Pyodide, the stdlib, and NumPy are fully cached.";
  }

  if (!checks.inputReady) {
    return "Use the deployed or preview origin so SharedArrayBuffer-backed input() stays available.";
  }

  if (!checks.workspacePrepared) {
    return "Prepare the proof workspace to stage the offline demo files.";
  }

  return "Ready for Airplane Mode. Turn the network off, hard refresh, then run the prepared file.";
}

async function hasOfflineProofRuntimeAssetsCached() {
  if (typeof caches === "undefined") {
    return false;
  }

  try {
    const cacheKeys = await caches.keys();
    const satisfiedPatterns = OFFLINE_PROOF_REQUIRED_CACHE_PATTERNS.map(() => false);

    for (const cacheKey of cacheKeys) {
      const cache = await caches.open(cacheKey);
      const requests = await cache.keys();

      for (const request of requests) {
        OFFLINE_PROOF_REQUIRED_CACHE_PATTERNS.forEach((pattern, index) => {
          if (!satisfiedPatterns[index] && pattern.test(request.url)) {
            satisfiedPatterns[index] = true;
          }
        });
      }

      if (satisfiedPatterns.every(Boolean)) {
        return true;
      }
    }

    return satisfiedPatterns.every(Boolean);
  } catch {
    return false;
  }
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
    tables: [],
    error: "",
    durationMs: null,
    executedAt: null,
  };
}

function createEmptyNotebookState() {
  return {
    cellResults: {},
    runningCellId: "",
    runAllInProgress: false,
  };
}

function createNotebookFileContent() {
  return serializePythonNotebookDocument(createDefaultPythonNotebookDocument());
}

function getNotebookSessionKey(workspaceName, filename) {
  return `${workspaceName}::${filename}`;
}

function createNotebookFilename(existingFiles = []) {
  const existingNames = new Set(existingFiles.map((file) => file.name));

  if (!existingNames.has("analysis.wfnb")) {
    return "analysis.wfnb";
  }

  let index = 2;
  while (existingNames.has(`analysis-${index}.wfnb`)) {
    index += 1;
  }

  return `analysis-${index}.wfnb`;
}

function createInitialOfflineProofState() {
  return {
    checking: false,
    ready: false,
    error: "",
    guidance: "Open the proof flow to see whether this origin is ready for the Airplane Mode demo.",
    lastCheckedAt: null,
    checks: {
      serviceWorkerControlled: false,
      runtimeCacheReady: false,
      inputReady: false,
      workspacePrepared: false,
    },
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

function normalizePythonTables(tables = []) {
  if (!Array.isArray(tables)) {
    return [];
  }

  return tables.flatMap((table, index) => {
    const columns = Array.isArray(table?.columns)
      ? table.columns.map((column) => String(column ?? ""))
      : [];
    const rows = Array.isArray(table?.rows)
      ? table.rows.map((row) => (
        Array.isArray(row)
          ? row.map((cell) => (
            cell === null ||
            typeof cell === "string" ||
            typeof cell === "number" ||
            typeof cell === "boolean"
              ? cell
              : String(cell ?? "")
          ))
          : []
      ))
      : [];
    const rowCount = Number.isFinite(table?.rowCount)
      ? Math.max(0, Number(table.rowCount))
      : rows.length;
    const columnCount = Number.isFinite(table?.columnCount)
      ? Math.max(0, Number(table.columnCount))
      : columns.length;

    if (columns.length === 0 && rows.length === 0) {
      return [];
    }

    return [{
      id: String(table?.id || `Display ${index + 1}`).trim() || `Display ${index + 1}`,
      kind: String(table?.kind || "dataframe").trim().toLowerCase() || "dataframe",
      title: String(table?.title || `Display ${index + 1}`).trim() || `Display ${index + 1}`,
      columns,
      rows,
      index: Array.isArray(table?.index)
        ? table.index.map((value) => (
          value === null ||
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"
            ? value
            : String(value ?? "")
        ))
        : [],
      rowCount,
      columnCount,
      truncatedRows: Number.isFinite(table?.truncatedRows) ? Math.max(0, Number(table.truncatedRows)) : 0,
      truncatedColumns: Number.isFinite(table?.truncatedColumns) ? Math.max(0, Number(table.truncatedColumns)) : 0,
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
      return isPythonNotebookFile(filename) ? "Python Notebook" : "Python 3.13";
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

function formatExecutionDuration(durationMs) {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) {
    return "";
  }

  if (durationMs < 1000) {
    return `${durationMs.toFixed(1)}ms`;
  }

  return `${(durationMs / 1000).toFixed(2)}s`;
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
  const [isActiveFileLoading, setIsActiveFileLoading] = useState(true);
  const [status, setStatus] = useState("Loading workspace...");
  const [sqlExecution, setSqlExecution] = useState(createEmptySqlExecution);
  const [pythonExecution, setPythonExecution] = useState(createEmptyPythonExecution);
  const [notebookStateByFile, setNotebookStateByFile] = useState({});
  const [notebookSelectionByFile, setNotebookSelectionByFile] = useState({});
  const [workspaces, setWorkspaces] = useState([]);
  const [activeWorkspace, setActiveWorkspace] = useState(readPersistedActiveWorkspace);
  const [workspaceBootstrapped, setWorkspaceBootstrapped] = useState(false);
  const [editorPaneHeight, setEditorPaneHeight] = useState(null);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [sidebarMode, setSidebarMode] = useState("explorer");
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  const [bottomPanelMode, setBottomPanelMode] = useState("terminal");
  const [shareStatus, setShareStatus] = useState({ tone: "idle", label: "Share" });
  const [offlineProofVisible, setOfflineProofVisible] = useState(false);
  const [offlineProofState, setOfflineProofState] = useState(createInitialOfflineProofState);
  const [isPreparingOfflineProof, setIsPreparingOfflineProof] = useState(false);
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

    const fallbackFile = files.find((file) => file.name === filename);
    if (isPythonNotebookFile(filename)) {
      return {
        filename,
        content: fallbackFile?.content ?? "",
      };
    }

    const editorFilename = getEditorFilename(editorRef.current);
    const liveEditorValue = editorFilename === filename ? editorRef.current?.getValue() : null;
    return {
      filename,
      content: liveEditorValue ?? fallbackFile?.content ?? "",
    };
  }, [files, getEditorFilename]);

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
      const shouldTrackLoading = workspaceName === activeWorkspaceRef.current;
      if (shouldTrackLoading) {
        setIsActiveFileLoading(true);
      }

      try {
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
      } finally {
        if (workspaceName === activeWorkspaceRef.current) {
          setIsActiveFileLoading(false);
        }
      }
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
        const durationLabel = formatExecutionDuration(durationMs);
        if (durationLabel) {
          terminalRef.current?.writeln(
            `\x1b[36m\n[Local runtime] Executed on this device in ${durationLabel}.\x1b[0m`,
          );
        }
        terminalRef.current?.writeln("\x1b[90m[Process completed]\x1b[0m");
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
    runNotebookCell: runNotebookCellInWorker,
    resetNotebookSession: resetNotebookSessionInWorker,
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
        tables: previous.filename === filename ? previous.tables : [],
      }));
      setBottomPanelMode("output");
    },
    onTables: (tables) => {
      const normalizedTables = normalizePythonTables(tables);
      if (normalizedTables.length === 0) {
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
        figures: previous.filename === filename ? previous.figures : [],
        tables: normalizedTables,
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

  useEffect(() => {
    setNotebookStateByFile({});
    setNotebookSelectionByFile({});
  }, [activeWorkspace]);

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

  const refreshOfflineProofState = useCallback(
    async (knownWorkspaces = workspaces) => {
      setOfflineProofState((previous) => ({
        ...previous,
        checking: true,
        error: "",
      }));

      try {
        let serviceWorkerControlled = false;
        if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
          try {
            await navigator.serviceWorker.ready;
          } catch {
            // Fall back to the current controller state below.
          }
          serviceWorkerControlled = Boolean(navigator.serviceWorker.controller);
        }

        const runtimeCacheReady = await hasOfflineProofRuntimeAssetsCached();
        const inputReady =
          typeof window !== "undefined" &&
          window.crossOriginIsolated === true &&
          typeof SharedArrayBuffer === "function";

        let workspacePrepared = false;
        if (isIOWorkerReady && knownWorkspaces.includes(OFFLINE_PROOF_WORKSPACE_NAME)) {
          const proofFiles = await listFiles(OFFLINE_PROOF_WORKSPACE_NAME);
          workspacePrepared = [DEFAULT_FILENAME, OFFLINE_PROOF_HELPER_FILENAME].every((filename) =>
            proofFiles.includes(filename),
          );
        }

        const checks = {
          serviceWorkerControlled,
          runtimeCacheReady,
          inputReady,
          workspacePrepared,
        };

        setOfflineProofState({
          checking: false,
          ready: Object.values(checks).every(Boolean),
          error: "",
          guidance: getOfflineProofGuidance(checks),
          lastCheckedAt: Date.now(),
          checks,
        });
      } catch (error) {
        setOfflineProofState((previous) => ({
          ...previous,
          checking: false,
          error: error?.message || String(error),
          guidance: "Finish loading the IDE online, then refresh the proof checks.",
          lastCheckedAt: Date.now(),
        }));
      }
    },
    [isIOWorkerReady, listFiles, workspaces],
  );

  const openOfflineProofFlow = useCallback(() => {
    if (isRunning || isJsRunning || isSqlRunning) {
      terminalRef.current?.writeln(
        "\x1b[33m[Offline proof] Finish or stop the active session before opening the proof flow.\x1b[0m",
      );
      return;
    }

    setOfflineProofVisible(true);
    setBottomPanelMode("output");
    setMobilePane("output");
    void refreshOfflineProofState();
  }, [isJsRunning, isRunning, isSqlRunning, refreshOfflineProofState]);

  const closeOfflineProofFlow = useCallback(() => {
    setOfflineProofVisible(false);
  }, []);

  const handleRefreshOfflineProof = useCallback(() => {
    void refreshOfflineProofState();
  }, [refreshOfflineProofState]);

  const handleCopyOfflineProofSteps = useCallback(async () => {
    try {
      await copyTextToClipboard(buildOfflineProofStepText());
      terminalRef.current?.writeln(
        "\x1b[36m[Offline proof] Demo steps copied to the clipboard.\x1b[0m",
      );
    } catch (error) {
      terminalRef.current?.writeln(
        `\x1b[31m[Offline proof] ${error?.message || error}\x1b[0m`,
      );
    }
  }, []);

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
    if (!offlineProofVisible) {
      return;
    }

    void refreshOfflineProofState();
  }, [
    activeWorkspace,
    offlineProofVisible,
    refreshOfflineProofState,
    workspaces,
    workspaceBootstrapped,
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

  const handlePrepareOfflineProof = useCallback(async () => {
    setIsPreparingOfflineProof(true);

    try {
      await prepareWorkspaceMutation("preparing the offline proof demo");

      const existingWorkspaces = await listWorkspaces();
      if (!existingWorkspaces.includes(OFFLINE_PROOF_WORKSPACE_NAME)) {
        await createWorkspace(OFFLINE_PROOF_WORKSPACE_NAME);
      }

      await writeFile(DEFAULT_FILENAME, OFFLINE_PROOF_MAIN_SOURCE, "workspace", OFFLINE_PROOF_WORKSPACE_NAME);
      clearRecoveryWrite(DEFAULT_FILENAME, OFFLINE_PROOF_WORKSPACE_NAME);
      await writeFile(
        OFFLINE_PROOF_HELPER_FILENAME,
        OFFLINE_PROOF_HELPER_SOURCE,
        "workspace",
        OFFLINE_PROOF_WORKSPACE_NAME,
      );
      clearRecoveryWrite(OFFLINE_PROOF_HELPER_FILENAME, OFFLINE_PROOF_WORKSPACE_NAME);

      const nextWorkspaces = Array.from(
        new Set([...existingWorkspaces, OFFLINE_PROOF_WORKSPACE_NAME]),
      ).sort((left, right) => left.localeCompare(right));

      if (!isMountedRef.current) {
        return;
      }

      setWorkspaces(nextWorkspaces);
      setIsActiveFileLoading(true);
      setSqlExecution(createEmptySqlExecution());
      setPythonExecution(createEmptyPythonExecution());
      setSidebarMode("explorer");
      setFileSearchQuery("");
      setOpenFiles([]);
      setFiles([]);
      setActiveFile("");
      setActiveWorkspace(OFFLINE_PROOF_WORKSPACE_NAME);
      setBottomPanelMode("output");
      setMobilePane("output");
      setOfflineProofVisible(true);

      terminalRef.current?.writeln(
        `\x1b[36m[Offline proof] Prepared ${OFFLINE_PROOF_WORKSPACE_NAME} with ${DEFAULT_FILENAME} and ${OFFLINE_PROOF_HELPER_FILENAME}.\x1b[0m`,
      );
      terminalRef.current?.writeln(
        "\x1b[90m[Offline proof] Stay online until every check is ready, then switch to Airplane Mode and run main.py.\x1b[0m",
      );
      await refreshOfflineProofState(nextWorkspaces);
    } catch (error) {
      const message = error?.message || String(error);
      terminalRef.current?.writeln(`\x1b[31m[Offline proof] ${message}\x1b[0m`);
      setOfflineProofState((previous) => ({
        ...previous,
        checking: false,
        error: message,
        guidance: "Finish loading the IDE online, then refresh the proof checks.",
        lastCheckedAt: Date.now(),
      }));
    } finally {
      if (isMountedRef.current) {
        setIsPreparingOfflineProof(false);
      }
    }
  }, [
    clearRecoveryWrite,
    createWorkspace,
    listWorkspaces,
    prepareWorkspaceMutation,
    refreshOfflineProofState,
    writeFile,
  ]);

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

  const resetNotebookKernel = useCallback(async (filename, options = {}) => {
    const {
      announce = true,
      clearOutputs = true,
    } = options;
    const notebookKey = getNotebookSessionKey(activeWorkspaceRef.current, filename);

    await flushAllWrites();
    setStatus("Restarting notebook session...");

    if (clearOutputs) {
      setNotebookStateByFile((prev) => ({
        ...prev,
        [filename]: {
          ...(prev[filename] || createEmptyNotebookState()),
          cellResults: {},
          runningCellId: "",
          runAllInProgress: false,
        },
      }));
    }

    if (announce) {
      terminalRef.current?.writeln(`\x1b[90m[Notebook] Restarting Python session for ${filename}...\x1b[0m`);
    }

    const resetResult = await resetNotebookSessionInWorker({
      notebookKey,
      filename,
    });

    if (resetResult?.error) {
      setStatus("Error");
      terminalRef.current?.writeln(`\x1b[31m[Notebook] ${resetResult.error}\x1b[0m`);
      return resetResult;
    }

    setStatus("Python notebook ready");
    terminalRef.current?.writeln(`\x1b[32m[Notebook] Python session ready for ${filename}\x1b[0m`);
    return { error: "" };
  }, [flushAllWrites, resetNotebookSessionInWorker]);

  const executeNotebookCell = useCallback(async ({ filename, document, cellId }) => {
    const cellIndex = document.cells.findIndex((cell) => cell.id === cellId);
    const cell = cellIndex >= 0 ? document.cells[cellIndex] : null;

    if (!cell) {
      return { error: "Notebook cell could not be found." };
    }

    await flushAllWrites();
    setBottomPanelMode("terminal");
    setMobilePane("editor");
    setOfflineProofVisible(false);
    setNotebookStateByFile((prev) => ({
      ...prev,
      [filename]: {
        ...(prev[filename] || createEmptyNotebookState()),
        runningCellId: cellId,
      },
    }));

    const cellLabel = `Cell ${cellIndex + 1}`;
    terminalRef.current?.writeln(`\x1b[90m$ Running ${filename} - ${cellLabel}...\x1b[0m`);
    setStatus(`Running ${cellLabel}...`);

    const result = await runNotebookCellInWorker({
      notebookKey: getNotebookSessionKey(activeWorkspaceRef.current, filename),
      filename,
      cellId,
      code: cell.source,
    });

    const normalizedResult = {
      error: result?.error || "",
      stdout: String(result?.stdout ?? ""),
      stderr: String(result?.stderr ?? ""),
      figures: normalizePythonFigures(result?.figures),
      tables: normalizePythonTables(result?.tables),
      durationMs: typeof result?.durationMs === "number" ? result.durationMs : null,
      executedAt: Date.now(),
    };

    setNotebookStateByFile((prev) => {
      const current = prev[filename] || createEmptyNotebookState();
      return {
        ...prev,
        [filename]: {
          ...current,
          runningCellId: "",
          cellResults: {
            ...current.cellResults,
            [cellId]: normalizedResult,
          },
        },
      };
    });

    if (normalizedResult.error) {
      setStatus("Error");
      return normalizedResult;
    }

    setStatus("Python notebook ready");
    const durationLabel = formatExecutionDuration(normalizedResult.durationMs);
    if (durationLabel) {
      terminalRef.current?.writeln(`\x1b[36m[Notebook] ${cellLabel} executed on this device in ${durationLabel}.\x1b[0m`);
    }

    return normalizedResult;
  }, [flushAllWrites, runNotebookCellInWorker]);

  const handleRunNotebookAll = useCallback(async (filename, fileContent) => {
    const parsed = parsePythonNotebookDocument(fileContent);
    if (parsed.error || !parsed.document) {
      const message = parsed.error || "Notebook could not be parsed.";
      terminalRef.current?.writeln(`\x1b[31m[Notebook] ${message}\x1b[0m`);
      setStatus("Error");
      return;
    }

    const document = parsed.document;
    setNotebookStateByFile((prev) => ({
      ...prev,
      [filename]: {
        ...(prev[filename] || createEmptyNotebookState()),
        cellResults: {},
        runningCellId: "",
        runAllInProgress: true,
      },
    }));

    const resetResult = await resetNotebookKernel(filename, { announce: false, clearOutputs: false });
    if (resetResult?.error) {
      setNotebookStateByFile((prev) => ({
        ...prev,
        [filename]: {
          ...(prev[filename] || createEmptyNotebookState()),
          runningCellId: "",
          runAllInProgress: false,
        },
      }));
      return;
    }

    terminalRef.current?.writeln(`\x1b[90m$ Running notebook ${filename} (${document.cells.length} cells)...\x1b[0m`);

    try {
      for (const cell of document.cells) {
        const result = await executeNotebookCell({ filename, document, cellId: cell.id });
        if (result?.error) {
          break;
        }
      }
    } finally {
      setNotebookStateByFile((prev) => ({
        ...prev,
        [filename]: {
          ...(prev[filename] || createEmptyNotebookState()),
          runningCellId: "",
          runAllInProgress: false,
        },
      }));
    }
  }, [executeNotebookCell, resetNotebookKernel]);

  const handleRun = useCallback(async () => {
    terminalRef.current?.cancelInput({ newline: false });
    if (isActiveFileLoading) {
      terminalRef.current?.writeln("\x1b[33m[WasmForge] Wait for the active file to finish loading before running it.\x1b[0m");
      return;
    }
    setOfflineProofVisible(false);
    const file = files.find((entry) => entry.name === activeFile);
    if (!file) {
      return;
    }

    if (isPythonNotebookFile(activeFile)) {
      await handleRunNotebookAll(activeFile, file.content);
      return;
    }

    const syncedSnapshot = syncActiveEditorDraft();
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
    handleRunNotebookAll,
    isActiveFileLoading,
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
        setIsActiveFileLoading(true);
        setSqlExecution(createEmptySqlExecution());
        setPythonExecution(createEmptyPythonExecution());
        setOfflineProofVisible(false);
        setBottomPanelMode("terminal");
        setMobilePane("editor");
        setSidebarMode("explorer");
        setFileSearchQuery("");
        setOpenFiles([]);
        setFiles([]);
        setActiveFile("");
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
    setIsActiveFileLoading(true);
    setSqlExecution(createEmptySqlExecution());
    setPythonExecution(createEmptyPythonExecution());
    setOfflineProofVisible(false);
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
      setIsActiveFileLoading(true);
      setSqlExecution(createEmptySqlExecution());
      setPythonExecution(createEmptyPythonExecution());
    setOfflineProofVisible(false);
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
    setIsActiveFileLoading(true);
    let content = "";

    try {
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
    } finally {
      if (workspaceName === activeWorkspaceRef.current) {
        setIsActiveFileLoading(false);
      }
    }
  }, [flushAllWrites, isJsRunning, isRunning, isSqlRunning, readFile, syncActiveEditorDraft, upsertFileContent]);

  const persistNotebookDocument = useCallback((filename, document, options = {}) => {
    const {
      selectedCellId = null,
      preserveResults = true,
    } = options;
    const serialized = serializePythonNotebookDocument(document);

    upsertFileContent(filename, serialized);
    stageRecoveryWrite(filename, serialized);
    scheduleWrite(filename, serialized);

    if (selectedCellId) {
      setNotebookSelectionByFile((prev) => ({
        ...prev,
        [filename]: selectedCellId,
      }));
    }

    if (!preserveResults) {
      setNotebookStateByFile((prev) => ({
        ...prev,
        [filename]: createEmptyNotebookState(),
      }));
    }

    return serialized;
  }, [scheduleWrite, stageRecoveryWrite, upsertFileContent]);

  const handleCodeChange = useCallback((newContent) => {
    if (!activeFile) {
      return;
    }
    upsertFileContent(activeFile, newContent);
    stageRecoveryWrite(activeFile, newContent);
    scheduleWrite(activeFile, newContent);
  }, [activeFile, scheduleWrite, stageRecoveryWrite, upsertFileContent]);

  const handleNotebookSelectCell = useCallback((filename, cellId) => {
    setNotebookSelectionByFile((prev) => ({
      ...prev,
      [filename]: cellId,
    }));
  }, []);

  const handleNotebookCellChange = useCallback((filename, document, cellId, nextSource) => {
    const nextDocument = {
      ...document,
      cells: document.cells.map((cell) => (
        cell.id === cellId
          ? { ...cell, source: nextSource }
          : cell
      )),
    };

    persistNotebookDocument(filename, nextDocument, { selectedCellId: cellId });
  }, [persistNotebookDocument]);

  const handleNotebookAddCellAfter = useCallback((filename, document, afterCellId) => {
    const nextCell = createNotebookCell("");
    const cellIndex = document.cells.findIndex((cell) => cell.id === afterCellId);
    const nextCells = [...document.cells];

    if (cellIndex === -1) {
      nextCells.push(nextCell);
    } else {
      nextCells.splice(cellIndex + 1, 0, nextCell);
    }

    persistNotebookDocument(
      filename,
      {
        ...document,
        cells: nextCells,
      },
      { selectedCellId: nextCell.id },
    );
  }, [persistNotebookDocument]);

  const handleNotebookDeleteCell = useCallback((filename, document, cellId) => {
    const removedIndex = document.cells.findIndex((cell) => cell.id === cellId);
    const remainingCells = document.cells.filter((cell) => cell.id !== cellId);
    const nextCells = remainingCells.length > 0 ? remainingCells : [createNotebookCell("")];
    const safeIndex = Math.max(0, Math.min(removedIndex, nextCells.length - 1));
    const nextSelectedCellId = nextCells[safeIndex]?.id || nextCells[0].id;

    persistNotebookDocument(
      filename,
      {
        ...document,
        cells: nextCells,
      },
      { selectedCellId: nextSelectedCellId },
    );

    setNotebookStateByFile((prev) => {
      const current = prev[filename] || createEmptyNotebookState();
      if (!current.cellResults[cellId]) {
        return prev;
      }

      const nextResults = { ...current.cellResults };
      delete nextResults[cellId];

      return {
        ...prev,
        [filename]: {
          ...current,
          cellResults: nextResults,
          runningCellId: current.runningCellId === cellId ? "" : current.runningCellId,
        },
      };
    });
  }, [persistNotebookDocument]);

  const handleRepairNotebook = useCallback((filename) => {
    const document = createDefaultPythonNotebookDocument();
    persistNotebookDocument(filename, document, {
      selectedCellId: document.cells[0]?.id || null,
      preserveResults: false,
    });
  }, [persistNotebookDocument]);

  const handleCreateFile = useCallback(async (name) => {
    const trimmed = normalizeWorkspaceFilename(name);
    if (files.some((file) => file.name === trimmed)) {
      throw new Error("File already exists.");
    }
    const initialContent = isPythonNotebookFile(trimmed) ? createNotebookFileContent() : "";
    await prepareWorkspaceMutation("creating files");
    await writeFile(trimmed, initialContent, "workspace", activeWorkspaceRef.current);
    await refreshWorkspaceFiles(trimmed, { workspaceName: activeWorkspaceRef.current });
    setMobilePane("editor");
  }, [files, prepareWorkspaceMutation, refreshWorkspaceFiles, writeFile]);

  const handleCreateNotebook = useCallback(async () => {
    const nextFilename = createNotebookFilename(files);
    await handleCreateFile(nextFilename);
  }, [files, handleCreateFile]);

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
    setNotebookSelectionByFile((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, currentName)) {
        return prev;
      }

      const next = { ...prev };
      next[trimmed] = next[currentName];
      delete next[currentName];
      return next;
    });
    setNotebookStateByFile((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, currentName)) {
        return prev;
      }

      const next = { ...prev };
      next[trimmed] = next[currentName];
      delete next[currentName];
      return next;
    });
    setOpenFiles((prev) => prev.map((fileName) => (
      fileName === currentName ? trimmed : fileName
    )));
    await refreshWorkspaceFiles(trimmed, { workspaceName: activeWorkspaceRef.current });
  }, [clearRecoveryWrite, files, prepareWorkspaceMutation, refreshWorkspaceFiles, renameWorkspaceFile]);

  const handleDeleteFile = useCallback(async (filename) => {
    await prepareWorkspaceMutation("deleting files");
    await deleteWorkspaceFile(filename, "workspace", activeWorkspaceRef.current);
    clearRecoveryWrite(filename);
    setNotebookSelectionByFile((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, filename)) {
        return prev;
      }
      const next = { ...prev };
      delete next[filename];
      return next;
    });
    setNotebookStateByFile((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, filename)) {
        return prev;
      }
      const next = { ...prev };
      delete next[filename];
      return next;
    });
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
  const isActiveNotebook = isPythonNotebookFile(activeFile);
  const activeNotebookState = useMemo(() => {
    if (!isActiveNotebook) {
      return { document: null, error: "" };
    }

    return parsePythonNotebookDocument(activeFileData?.content ?? "");
  }, [activeFileData?.content, isActiveNotebook]);
  const activeNotebookDocument = activeNotebookState.document;
  const activeNotebookParseError = activeNotebookState.error;
  const activeNotebookUiState = notebookStateByFile[activeFile] || createEmptyNotebookState();
  const activeNotebookSelectedCellId =
    notebookSelectionByFile[activeFile] ||
    activeNotebookDocument?.cells?.[0]?.id ||
    "";
  const isMobileLayout = viewportWidth < MOBILE_LAYOUT_BREAKPOINT;
  const activeRuntime = getRuntimeKind(activeFile);
  const showSqlResultsPanel = activeRuntime === "sqlite" || activeRuntime === "pglite";
  const showPythonOutputPanel = activeRuntime === "python" && !isActiveNotebook;
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
  const activePythonDurationLabel = formatExecutionDuration(activePythonResult?.durationMs);
  const activePythonLocalProofLabel =
    activeRuntime === "python" &&
    !activeRuntimeRunning &&
    !activeHasError &&
    activePythonDurationLabel
      ? `Local run ${activePythonDurationLabel}`
      : "";
  const mobileStatusLabel = activePythonLocalProofLabel
    ? `${activeStatusMessage} • ${activePythonLocalProofLabel}`
    : activeStatusMessage;
  const shareButtonDisabled = !activeFile;
  const offlineProofChecks = useMemo(() => ([
    {
      id: "service-worker",
      label: "Offline reload shell",
      description: "Service worker control is active, so /ide can hard-refresh from cache instead of a server.",
      ok: offlineProofState.checks.serviceWorkerControlled,
    },
    {
      id: "runtime-cache",
      label: "Runtime cache warm",
      description: "Pyodide, the Python stdlib, and NumPy are already cached on this device for the demo.",
      ok: offlineProofState.checks.runtimeCacheReady,
    },
    {
      id: "interactive-input",
      label: "Interactive input ready",
      description: "SharedArrayBuffer-backed input() is available on this origin, so prompts still work offline.",
      ok: offlineProofState.checks.inputReady,
    },
    {
      id: "proof-workspace",
      label: "Proof workspace staged",
      description: `The ${OFFLINE_PROOF_WORKSPACE_NAME} workspace already has ${DEFAULT_FILENAME} and ${OFFLINE_PROOF_HELPER_FILENAME}.`,
      ok: offlineProofState.checks.workspacePrepared,
    },
  ]), [offlineProofState.checks]);
  const bottomPanelRuntimeLabel =
    bottomPanelMode === "output" && offlineProofVisible ? "Offline Proof" : currentLanguageLabel;

  useEffect(() => {
    if (!isActiveNotebook) {
      return;
    }

    editorSubscriptionRef.current?.dispose();
    editorSubscriptionRef.current = null;
    editorRef.current = null;
  }, [isActiveNotebook]);

  useEffect(() => {
    if (offlineProofVisible) {
      return;
    }
    setBottomPanelMode(showSqlResultsPanel ? "output" : "terminal");
  }, [activeFile, offlineProofVisible, showSqlResultsPanel]);

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
  const runButtonDisabled =
    isAnyRuntimeBusy ||
    isActiveFileLoading ||
    activeRuntime === "unknown" ||
    !activeRuntimeReady ||
    (isActiveNotebook && Boolean(activeNotebookParseError));
  const runButtonLabel = isActiveNotebook ? "▶ Run All" : "▶ Run";
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
      onCreateNotebook={handleCreateNotebook}
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
      ) : isActiveNotebook ? (
        <PythonNotebook
          filename={activeFile}
          document={activeNotebookDocument}
          parseError={activeNotebookParseError}
          selectedCellId={activeNotebookSelectedCellId}
          cellResults={activeNotebookUiState.cellResults}
          runningCellId={activeNotebookUiState.runningCellId}
          runAllInProgress={activeNotebookUiState.runAllInProgress}
          sessionBusy={isRunning}
          runtimeReady={isReady}
          themeMode={ideTheme === "inverted" ? "day" : "night"}
          EditorComponent={Editor}
          onSelectCell={(cellId) => handleNotebookSelectCell(activeFile, cellId)}
          onCellChange={(cellId, nextSource) => {
            if (!activeNotebookDocument) {
              return;
            }
            handleNotebookCellChange(activeFile, activeNotebookDocument, cellId, nextSource);
          }}
          onAddCellAfter={(cellId) => {
            if (!activeNotebookDocument) {
              return;
            }
            handleNotebookAddCellAfter(activeFile, activeNotebookDocument, cellId);
          }}
          onDeleteCell={(cellId) => {
            if (!activeNotebookDocument) {
              return;
            }
            handleNotebookDeleteCell(activeFile, activeNotebookDocument, cellId);
          }}
          onRunCell={(cellId) => {
            if (!activeNotebookDocument) {
              return;
            }
            void executeNotebookCell({
              filename: activeFile,
              document: activeNotebookDocument,
              cellId,
            });
          }}
          onRunAll={() => {
            void handleRunNotebookAll(activeFile, activeFileData?.content ?? "");
          }}
          onResetSession={() => {
            void resetNotebookKernel(activeFile);
          }}
          onRepair={() => handleRepairNotebook(activeFile)}
        />
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
              {bottomPanelRuntimeLabel}
            </span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "0 12px" }}>
          {bottomPanelMode === "output" && offlineProofVisible ? (
            <>
              <button
                type="button"
                onClick={handleRefreshOfflineProof}
                style={terminalActionButtonStyle()}
                className="wf-terminal-action"
              >
                Refresh
              </button>
              <button
                type="button"
                onClick={closeOfflineProofFlow}
                style={terminalActionButtonStyle()}
                className="wf-terminal-action"
              >
                Close
              </button>
            </>
          ) : (
            <>
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
                  if (bottomPanelMode === "output" && isActiveNotebook) {
                    setNotebookStateByFile((prev) => ({
                      ...prev,
                      [activeFile]: {
                        ...(prev[activeFile] || createEmptyNotebookState()),
                        cellResults: {},
                        runningCellId: "",
                        runAllInProgress: false,
                      },
                    }));
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
            </>
          )}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, position: "relative", background: "var(--ide-shell-editor-bg)" }}>
        <div style={{ display: terminalVisible ? "block" : "none", height: "100%" }}>
          <Terminal ref={terminalRef} isVisible={terminalVisible} themeMode={ideTheme === "inverted" ? "day" : "night"} />
        </div>
        <div style={{ display: outputVisible ? "block" : "none", height: "100%" }}>
          {offlineProofVisible ? (
            <OfflineProofPanel
              ready={offlineProofState.ready}
              checking={offlineProofState.checking}
              preparing={isPreparingOfflineProof}
              error={offlineProofState.error}
              guidance={offlineProofState.guidance}
              lastCheckedAt={offlineProofState.lastCheckedAt}
              checks={offlineProofChecks}
              steps={OFFLINE_PROOF_STEPS}
              workspaceName={OFFLINE_PROOF_WORKSPACE_NAME}
              activeWorkspace={activeWorkspace}
              onPrepare={handlePrepareOfflineProof}
              onRefresh={handleRefreshOfflineProof}
              onCopySteps={handleCopyOfflineProofSteps}
              onClose={closeOfflineProofFlow}
            />
          ) : showSqlResultsPanel ? (
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
            <OutputPlaceholder activeFile={activeFile} isNotebook={isActiveNotebook} />
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
                {runButtonLabel}
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
              aria-label={isActiveNotebook ? "Run notebook" : "Run current file"}
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
                {mobileStatusLabel}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
              <span>{currentLanguageLabel}</span>
              <button
                type="button"
                aria-label="Open offline proof flow"
                onClick={openOfflineProofFlow}
                disabled={isAnyRuntimeBusy}
                style={statusBarActionButtonStyle({
                  active: offlineProofVisible,
                  disabled: isAnyRuntimeBusy,
                })}
              >
                ⚡ Offline-ready
              </button>
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
            {activePythonLocalProofLabel ? (
              <>
                <span style={statusBarDividerStyle()} />
                <span style={{ ...statusBarTokenStyle(), color: "var(--ide-shell-accent)", fontWeight: 600 }}>
                  <span
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "999px",
                      background: "var(--ide-shell-accent)",
                      flexShrink: 0,
                    }}
                  />
                  {activePythonLocalProofLabel}
                </span>
              </>
            ) : null}
            <span style={statusBarTokenStyle()}>{currentLanguageLabel}</span>
            <span style={statusBarDividerStyle()} />
            <button
              type="button"
              aria-label="Open offline proof flow"
              onClick={openOfflineProofFlow}
              disabled={isAnyRuntimeBusy}
              style={statusBarActionButtonStyle({
                active: offlineProofVisible,
                disabled: isAnyRuntimeBusy,
              })}
            >
              ⚡ Offline-ready
            </button>
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

function OutputPlaceholder({ activeFile, isNotebook = false }) {
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
          {isNotebook ? "Notebook output stays inline" : "SQL results appear here"}
        </div>
        <div style={{ marginTop: "8px", fontSize: "12px", lineHeight: 1.7, color: "var(--ide-shell-muted)" }}>
          {isNotebook
            ? "Run cells inside the notebook to keep tables, figures, and stdout attached to the cell that produced them."
            : "Run a `.sql` or `.pg` file to inspect result sets and schema output in this panel."}
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

function statusBarActionButtonStyle({ active = false, disabled = false } = {}) {
  return {
    ...statusBarTokenStyle(),
    border: "none",
    background: "transparent",
    color: active ? "var(--ide-shell-accent)" : "var(--ide-shell-text)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.56 : 1,
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
    case "wfnb":
      return { label: "NB", accent: "var(--ide-file-py-accent)", surface: "var(--ide-file-py-surface)" };
    default:
      return { label: "TXT", accent: "var(--ide-file-txt-accent)", surface: "var(--ide-file-txt-surface)" };
  }
}
