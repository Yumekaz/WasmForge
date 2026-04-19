import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Terminal from "./components/Terminal.jsx";
import FileTree from "./components/FileTree.jsx";
import SqlResultsPanel from "./components/SqlResultsPanel.jsx";
import PythonOutputPanel from "./components/PythonOutputPanel.jsx";
import OfflineProofPanel from "./components/OfflineProofPanel.jsx";
import AirlockSyncPanel from "./components/AirlockSyncPanel.jsx";
import PythonNotebook from "./components/PythonNotebook.jsx";
import { usePyodideWorker } from "./hooks/usePyodideWorker.js";
import { useIOWorker } from "./hooks/useIOWorker.js";
import { useJsWorker } from "./hooks/useJsWorker.js";
import { useHostBridge } from "./hooks/useHostBridge.js";
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
import {
  applyReconciliationResolution,
  buildResolvedFileMap,
  createReconciliationResult,
  createSnapshotRecord,
  deserializeSnapshotCollection,
  deserializeSnapshotRecord,
  hasPendingConflicts,
  normalizeSnapshotEntries,
  serializeSnapshotCollection,
  serializeSnapshotRecord,
} from "./utils/airlockSync.js";

const DEFAULT_FILENAME = "main.py";
const DEFAULT_WORKSPACE_NAME = "local-workspace";
const ACTIVE_WORKSPACE_STORAGE_KEY = "wasmforge:active-workspace";
const RECOVERY_STORAGE_KEY_PREFIX = "wasmforge:pending-workspace-writes";
const AIRLOCK_META_STORAGE_KEY_PREFIX = "wasmforge:airlock:meta";
const AIRLOCK_LAST_SYNC_STORAGE_KEY_PREFIX = "wasmforge:airlock:last-sync";
const AIRLOCK_SNAPSHOTS_STORAGE_KEY_PREFIX = "wasmforge:airlock:snapshots";
const AIRLOCK_MAX_SNAPSHOTS = 12;
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
const LOCAL_FOLDER_TEXT_EXTENSIONS = new Set([
  "",
  "bat",
  "c",
  "cc",
  "cmd",
  "conf",
  "cpp",
  "css",
  "csv",
  "cxx",
  "html",
  "h",
  "hh",
  "hpp",
  "hxx",
  "ini",
  "java",
  "js",
  "jsx",
  "json",
  "kt",
  "kts",
  "lua",
  "md",
  "mm",
  "m",
  "pg",
  "php",
  "py",
  "rb",
  "rs",
  "scala",
  "sh",
  "sql",
  "swift",
  "toml",
  "ts",
  "tsx",
  "txt",
  "wfnb",
  "xml",
  "yaml",
  "yml",
  "zig",
  "zsh",
  "env",
  "gitignore",
  "ps1",
  "properties",
]);
const LOCAL_FOLDER_ENTRY_KIND_DIRECTORY = "directory";
const LOCAL_FOLDER_ENTRY_KIND_FILE = "file";
const AIRLOCK_SNAPSHOT_STORAGE_KEY_PREFIX = "wasmforge:airlock-snapshots";
const AIRLOCK_STATUS_UNCHANGED = "unchanged";
const AIRLOCK_STATUS_LOCAL = "local";
const AIRLOCK_STATUS_DISK = "disk";
const AIRLOCK_STATUS_CONFLICT = "conflict";
const AIRLOCK_STATUS_RESOLVED = "resolved";
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
    case "c":
    case "h":
      return "c";
    case "cc":
    case "cpp":
    case "cxx":
    case "hh":
    case "hpp":
    case "hxx":
      return "cpp";
    case "go":
      return "go";
    case "java":
      return "java";
    case "py":
      return "python";
    case "js":
    case "jsx":
      return "javascript";
    case "rs":
      return "rust";
    case "ts":
    case "tsx":
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

function createFileRecord(entry, content = "") {
  const normalizedEntry = typeof entry === "string" ? { name: entry } : entry || {};
  const name = normalizedEntry.name || "";
  const kind = normalizedEntry.kind || LOCAL_FOLDER_ENTRY_KIND_FILE;

  return {
    name,
    content,
    language: getLanguage(name),
    kind,
    supported: normalizedEntry.supported ?? kind === LOCAL_FOLDER_ENTRY_KIND_FILE,
  };
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

function normalizeLocalFolderPath(name) {
  const normalized = String(name ?? "")
    .replace(/^\/?workspace\//u, "")
    .replace(/\\/gu, "/")
    .trim()
    .replace(/^\/+|\/+$/gu, "");

  if (!normalized) {
    throw new Error("File path is required.");
  }

  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) {
    throw new Error("Local folder paths cannot escape the selected folder.");
  }

  return parts.join("/");
}

function getLocalFolderBasename(path) {
  const normalized = String(path ?? "").replace(/\\/gu, "/");
  return normalized.split("/").filter(Boolean).pop() || normalized;
}

function isLocalFolderTextFileName(name) {
  const normalized = normalizeLocalFolderPath(name);
  const basename = getLocalFolderBasename(normalized);
  const extension = basename.includes(".")
    ? basename.split(".").pop()?.toLowerCase() || ""
    : "";
  return LOCAL_FOLDER_TEXT_EXTENSIONS.has(extension);
}

function sortLocalFolderEntries(entries) {
  return [...entries].sort((left, right) => {
    const leftDepth = left.name.split("/").length;
    const rightDepth = right.name.split("/").length;
    const leftParent = left.name.split("/").slice(0, -1).join("/");
    const rightParent = right.name.split("/").slice(0, -1).join("/");

    if (leftParent !== rightParent) {
      return leftParent.localeCompare(rightParent);
    }
    if (leftDepth !== rightDepth) {
      return leftDepth - rightDepth;
    }
    if (left.kind !== right.kind) {
      return left.kind === LOCAL_FOLDER_ENTRY_KIND_DIRECTORY ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
}

async function listLocalFolderEntries(directoryHandle, basePath = "") {
  if (!directoryHandle) {
    return [];
  }

  const entries = [];
  for await (const [name, handle] of directoryHandle.entries()) {
    const relativePath = basePath ? `${basePath}/${name}` : name;

    if (handle.kind === "directory") {
      entries.push({
        name: relativePath,
        kind: LOCAL_FOLDER_ENTRY_KIND_DIRECTORY,
        supported: false,
      });
      entries.push(...await listLocalFolderEntries(handle, relativePath));
      continue;
    }

    if (handle.kind === "file") {
      entries.push({
        name: relativePath,
        kind: LOCAL_FOLDER_ENTRY_KIND_FILE,
        supported: isLocalFolderTextFileName(relativePath),
      });
    }
  }

  return sortLocalFolderEntries(entries);
}

async function getLocalFolderParentDirectory(directoryHandle, filename, options = {}) {
  const normalized = normalizeLocalFolderPath(filename);
  const parts = normalized.split("/");
  const basename = parts.pop();
  let currentDirectory = directoryHandle;

  for (const segment of parts) {
    currentDirectory = await currentDirectory.getDirectoryHandle(segment, {
      create: Boolean(options.create),
    });
  }

  return { directory: currentDirectory, basename, path: normalized };
}

async function readLocalFolderTextFile(directoryHandle, filename) {
  const { directory, basename } = await getLocalFolderParentDirectory(directoryHandle, filename);
  if (!isLocalFolderTextFileName(filename)) {
    throw new Error("This local file type is visible but not editable in WasmForge yet.");
  }
  const fileHandle = await directory.getFileHandle(basename);
  const file = await fileHandle.getFile();
  return file.text();
}

async function writeLocalFolderTextFile(directoryHandle, filename, content) {
  const { directory, basename, path } = await getLocalFolderParentDirectory(directoryHandle, filename, { create: true });
  if (!isLocalFolderTextFileName(path)) {
    throw new Error("Local folder Explorer supports text and code files only.");
  }
  const fileHandle = await directory.getFileHandle(basename, { create: true });
  const writable = await fileHandle.createWritable();

  try {
    await writable.write(String(content ?? ""));
  } finally {
    await writable.close();
  }

  return path;
}

async function deleteLocalFolderTextFile(directoryHandle, filename) {
  const { directory, basename } = await getLocalFolderParentDirectory(directoryHandle, filename);
  await directory.removeEntry(basename);
}

async function renameLocalFolderTextFile(directoryHandle, currentName, nextName) {
  const normalizedCurrentName = normalizeLocalFolderPath(currentName);
  const normalizedNextName = normalizeLocalFolderPath(nextName);
  const content = await readLocalFolderTextFile(directoryHandle, normalizedCurrentName);
  await writeLocalFolderTextFile(directoryHandle, normalizedNextName, content);
  await deleteLocalFolderTextFile(directoryHandle, normalizedCurrentName);
  return normalizedNextName;
}

async function readLocalFolderTextFileMap(directoryHandle) {
  const entries = await listLocalFolderEntries(directoryHandle);
  const files = new Map();

  for (const entry of entries) {
    if (entry.kind !== LOCAL_FOLDER_ENTRY_KIND_FILE || entry.supported === false) {
      continue;
    }

    files.set(entry.name, {
      name: entry.name,
      content: await readLocalFolderTextFile(directoryHandle, entry.name),
    });
  }

  return files;
}

async function hashText(content) {
  const text = String(content ?? "");
  const bytes = new TextEncoder().encode(text);

  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv-${(hash >>> 0).toString(16)}-${text.length}`;
}

async function createManifestFromFileMap(fileMap) {
  const manifest = {};

  for (const [name, file] of fileMap) {
    manifest[name] = {
      hash: await hashText(file?.content ?? ""),
      content: file?.content ?? "",
    };
  }

  return manifest;
}

function createFileMapFromRecords(records = []) {
  const fileMap = new Map();

  for (const file of records) {
    if (!isSelectableFileRecord(file)) {
      continue;
    }

    fileMap.set(file.name, {
      name: file.name,
      content: file.content ?? "",
    });
  }

  return fileMap;
}

function createEntriesFromTextFileMap(fileMap) {
  return Array.from(fileMap.keys()).map((name) => ({
    name,
    kind: LOCAL_FOLDER_ENTRY_KIND_FILE,
    supported: true,
  }));
}

function createEmptyLocalFolderBridge() {
  return {
    handle: null,
    name: "",
    syncEnabled: false,
    baseManifest: {},
  };
}

function isLocalFolderSyncActive(bridge) {
  return Boolean(bridge?.handle && bridge?.syncEnabled);
}

function getAirlockSnapshotStorageKey(workspaceName) {
  return `${AIRLOCK_SNAPSHOT_STORAGE_KEY_PREFIX}:${workspaceName || DEFAULT_WORKSPACE_NAME}`;
}

function normalizeLegacyAirlockSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }

  try {
    if (!Array.isArray(snapshot.files)) {
      return createSnapshotRecord(snapshot);
    }

    const files = Object.fromEntries(
      snapshot.files
        .filter((file) => typeof file?.name === "string" && typeof file?.content === "string")
        .map((file) => [file.name, file.content]),
    );

    return createSnapshotRecord({
      id: snapshot.id,
      label: snapshot.label || "Snapshot",
      reason: snapshot.reason || "legacy",
      source: snapshot.source || "local",
      linkedFolderName: snapshot.linkedFolderName || snapshot.folderName || "",
      createdAt: snapshot.createdAt,
      files,
    });
  } catch {
    return null;
  }
}

function readStoredAirlockSnapshots(workspaceName) {
  if (typeof window === "undefined") {
    return [];
  }

  const parseSnapshotCollection = (raw) => {
    if (!raw) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .map(normalizeLegacyAirlockSnapshot)
          .filter(Boolean);
      }

      return deserializeSnapshotCollection(raw);
    } catch {
      return [];
    }
  };

  try {
    const snapshots = [
      ...parseSnapshotCollection(window.localStorage.getItem(getAirlockSnapshotsStorageKey(workspaceName))),
      ...parseSnapshotCollection(window.localStorage.getItem(getAirlockSnapshotStorageKey(workspaceName))),
    ];
    const uniqueSnapshots = new Map();
    for (const snapshot of snapshots) {
      uniqueSnapshots.set(snapshot.id, snapshot);
    }

    return Array.from(uniqueSnapshots.values())
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, AIRLOCK_MAX_SNAPSHOTS);
  } catch {
    return [];
  }
}

function persistAirlockSnapshots(workspaceName, snapshots) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const storageKey = getAirlockSnapshotsStorageKey(workspaceName);
    const normalizedSnapshots = snapshots.slice(0, AIRLOCK_MAX_SNAPSHOTS);
    if (normalizedSnapshots.length === 0) {
      window.localStorage.removeItem(storageKey);
      window.localStorage.removeItem(getAirlockSnapshotStorageKey(workspaceName));
      return;
    }

    window.localStorage.setItem(storageKey, serializeSnapshotCollection(normalizedSnapshots));
    window.localStorage.removeItem(getAirlockSnapshotStorageKey(workspaceName));
  } catch {
    // Snapshot storage is best-effort; the live workspace remains the source of truth.
  }
}

function createAirlockSnapshotRecord(fileMap, label, folderName = "") {
  return createSnapshotRecord({
    id: `snap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    label,
    reason: "manual",
    source: "local",
    linkedFolderName: folderName,
    createdAt: Date.now(),
    files: Object.fromEntries(
      Array.from(fileMap.values()).map((file) => [file.name, file.content ?? ""]),
    ),
  });
}

function formatAirlockSnapshotTime(timestamp) {
  if (!timestamp) {
    return "";
  }

  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(timestamp);
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

function classifyAirlockChanges(baseManifest = {}, localManifest = {}, diskManifest = {}, localFileMap = new Map(), diskFileMap = new Map()) {
  const filenames = Array.from(new Set([
    ...Object.keys(baseManifest),
    ...Object.keys(localManifest),
    ...Object.keys(diskManifest),
  ])).sort((left, right) => left.localeCompare(right));

  return filenames.map((name) => {
    const baseHash = baseManifest[name]?.hash ?? null;
    const localHash = localManifest[name]?.hash ?? null;
    const diskHash = diskManifest[name]?.hash ?? null;
    const localContent = localFileMap.has(name) ? localFileMap.get(name)?.content ?? "" : null;
    const diskContent = diskFileMap.has(name) ? diskFileMap.get(name)?.content ?? "" : null;
    const localChanged = localHash !== baseHash;
    const diskChanged = diskHash !== baseHash;
    let status = AIRLOCK_STATUS_UNCHANGED;

    if (localHash === diskHash) {
      status = AIRLOCK_STATUS_UNCHANGED;
    } else if (localChanged && !diskChanged) {
      status = AIRLOCK_STATUS_LOCAL;
    } else if (!localChanged && diskChanged) {
      status = AIRLOCK_STATUS_DISK;
    } else if (localChanged && diskChanged) {
      status = AIRLOCK_STATUS_CONFLICT;
    }

    return {
      id: name,
      name,
      status,
      baseHash,
      localHash,
      diskHash,
      localContent,
      diskContent,
      resolved: status === AIRLOCK_STATUS_UNCHANGED,
      resolution: status === AIRLOCK_STATUS_UNCHANGED ? "unchanged" : "",
    };
  });
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

function isSelectableFileRecord(file) {
  return file?.kind !== LOCAL_FOLDER_ENTRY_KIND_DIRECTORY && file?.supported !== false;
}

function getSelectableFileNames(files) {
  return files
    .filter(isSelectableFileRecord)
    .map((file) => file.name);
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

function getAirlockMetaStorageKey(workspaceName) {
  return `${AIRLOCK_META_STORAGE_KEY_PREFIX}:${workspaceName}`;
}

function getAirlockLastSyncStorageKey(workspaceName) {
  return `${AIRLOCK_LAST_SYNC_STORAGE_KEY_PREFIX}:${workspaceName}`;
}

function getAirlockSnapshotsStorageKey(workspaceName) {
  return `${AIRLOCK_SNAPSHOTS_STORAGE_KEY_PREFIX}:${workspaceName}`;
}

function readStoredAirlockMeta(workspaceName) {
  if (typeof window === "undefined") {
    return { linkedFolderName: "" };
  }

  try {
    const raw = window.localStorage.getItem(getAirlockMetaStorageKey(workspaceName));
    if (!raw) {
      return { linkedFolderName: "" };
    }

    const parsed = JSON.parse(raw);
    return {
      linkedFolderName: typeof parsed?.linkedFolderName === "string" ? parsed.linkedFolderName : "",
    };
  } catch {
    return { linkedFolderName: "" };
  }
}

function persistAirlockMeta(workspaceName, meta = {}) {
  if (typeof window === "undefined") {
    return;
  }

  const normalizedMeta = {
    linkedFolderName: String(meta?.linkedFolderName || "").trim(),
  };

  if (!normalizedMeta.linkedFolderName) {
    window.localStorage.removeItem(getAirlockMetaStorageKey(workspaceName));
    return;
  }

  window.localStorage.setItem(getAirlockMetaStorageKey(workspaceName), JSON.stringify(normalizedMeta));
}

function readStoredAirlockLastSyncedSnapshot(workspaceName) {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return deserializeSnapshotRecord(
      window.localStorage.getItem(getAirlockLastSyncStorageKey(workspaceName)),
    );
  } catch {
    return null;
  }
}

function persistAirlockLastSyncedSnapshot(workspaceName, snapshot) {
  if (typeof window === "undefined") {
    return;
  }

  const storageKey = getAirlockLastSyncStorageKey(workspaceName);
  if (!snapshot) {
    window.localStorage.removeItem(storageKey);
    return;
  }

  window.localStorage.setItem(storageKey, serializeSnapshotRecord(snapshot));
}

function snapshotEntriesEqual(leftEntries = {}, rightEntries = {}) {
  const left = normalizeSnapshotEntries(leftEntries);
  const right = normalizeSnapshotEntries(rightEntries);
  const leftPaths = Object.keys(left);
  const rightPaths = Object.keys(right);

  if (leftPaths.length !== rightPaths.length) {
    return false;
  }

  return leftPaths.every((path, index) => (
    path === rightPaths[index]
    && left[path] === right[path]
  ));
}

function createLocalEntriesFromReconciliation(entries = []) {
  return normalizeSnapshotEntries(
    Object.fromEntries(
      entries
        .filter((entry) => typeof entry?.localContent === "string")
        .map((entry) => [entry.path, entry.localContent]),
    ),
  );
}



function createInitialLocalFolderBridge(workspaceName = readPersistedActiveWorkspace()) {
  const meta = readStoredAirlockMeta(workspaceName);
  return {
    handle: null,
    name: meta.linkedFolderName || "",
    syncEnabled: false,
    lastSyncedSnapshot: readStoredAirlockLastSyncedSnapshot(workspaceName),
  };
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

function getHostRuntimeLanguageLabel(filename = "", runner = null) {
  if (runner?.label) {
    return `${runner.label} · Host Bridge`;
  }

  switch (getFileExtension(filename)) {
    case "c":
      return "C · Host Bridge";
    case "cc":
    case "cpp":
    case "cxx":
      return "C++ · Host Bridge";
    case "go":
      return "Go · Host Bridge";
    case "java":
      return "Java · Host Bridge";
    case "rs":
      return "Rust · Host Bridge";
    case "zig":
      return "Zig · Host Bridge";
    default:
      return "Host Bridge";
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
  const [isBottomPanelVisible, setIsBottomPanelVisible] = useState(true);
  const [shareStatus, setShareStatus] = useState({ tone: "idle", label: "Share" });
  const [offlineProofVisible, setOfflineProofVisible] = useState(false);
  const [offlineProofState, setOfflineProofState] = useState(createInitialOfflineProofState);
  const [isPreparingOfflineProof, setIsPreparingOfflineProof] = useState(false);
  const [localFolderBridge, setLocalFolderBridge] = useState(() => createInitialLocalFolderBridge(readPersistedActiveWorkspace()));
  const [airlockSnapshots, setAirlockSnapshots] = useState(() => readStoredAirlockSnapshots(readPersistedActiveWorkspace()));
  const [airlockReconciliation, setAirlockReconciliation] = useState(null);
  const [airlockCenter, setAirlockCenter] = useState({
    open: false,
    items: [],
    compareFile: "",
    message: "",
  });
  const [airlockBusy, setAirlockBusy] = useState(false);
  const [localFolderSecurityPromptOpen, setLocalFolderSecurityPromptOpen] = useState(false);
  const [localFolderSecurityAccepted, setLocalFolderSecurityAccepted] = useState(false);
  const [hostBridgeSecurityPromptOpen, setHostBridgeSecurityPromptOpen] = useState(false);
  const [hostBridgeSecurityPhrase, setHostBridgeSecurityPhrase] = useState("");

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
  const closingTabRef = useRef("");
  const activeWorkspaceRef = useRef(activeWorkspace);
  const isMountedRef = useRef(true);
  const recoveryWritesRef = useRef(readRecoveryEntries(activeWorkspace));
  const localFolderBridgeRef = useRef(localFolderBridge);
  const localFolderWriteQueueRef = useRef(Promise.resolve());
  const shareStatusTimeoutRef = useRef(null);
  const shareImportKeyRef = useRef("");
  const ideTheme = theme;
  const idePalette = useMemo(() => getIdePalette(ideTheme), [ideTheme]);
  const ideCssVars = useMemo(() => getIdeCssVars(idePalette), [idePalette]);
  const runtimeLocalFolderHandle = isLocalFolderSyncActive(localFolderBridge)
    ? localFolderBridge.handle
    : null;

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
    if (closingTabRef.current && activeFile !== closingTabRef.current) {
      closingTabRef.current = "";
    }
  }, [activeFile]);

  useEffect(() => {
    const availableFileNames = getSelectableFileNames(files);
    setOpenFiles((prev) => {
      const next = prev.filter((filename) => availableFileNames.includes(filename));
      const isClosingActiveTab = Boolean(closingTabRef.current) && activeFile === closingTabRef.current;

      if (
        activeFile &&
        availableFileNames.includes(activeFile) &&
        !next.includes(activeFile) &&
        !isClosingActiveTab
      ) {
        next.push(activeFile);
      }

      if (next.length === 0 && activeFile && availableFileNames.includes(activeFile) && !isClosingActiveTab) {
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
    setAirlockSnapshots(readStoredAirlockSnapshots(activeWorkspace));

    if (typeof window !== "undefined") {
      window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, activeWorkspace);
    }
  }, [activeWorkspace]);

  useEffect(() => {
    const persistedBridge = createInitialLocalFolderBridge(activeWorkspace);
    localFolderBridgeRef.current = persistedBridge;
    setLocalFolderBridge(persistedBridge);
    setAirlockSnapshots(readStoredAirlockSnapshots(activeWorkspace));
    setAirlockReconciliation(null);
  }, [activeWorkspace]);

  useEffect(() => {
    localFolderBridgeRef.current = localFolderBridge;
  }, [localFolderBridge]);

  useEffect(() => {
    persistAirlockMeta(activeWorkspace, {
      linkedFolderName: localFolderBridge.name,
    });
    persistAirlockLastSyncedSnapshot(activeWorkspace, localFolderBridge.lastSyncedSnapshot);
  }, [activeWorkspace, localFolderBridge.lastSyncedSnapshot, localFolderBridge.name]);

  useEffect(() => {
    persistAirlockSnapshots(activeWorkspace, airlockSnapshots);
  }, [activeWorkspace, airlockSnapshots]);

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

  const replaceFileList = useCallback((entries) => {
    setFiles((prev) => {
      const previousFiles = new Map(prev.map((file) => [file.name, file]));
      return entries
        .map((entry) => {
          const name = typeof entry === "string" ? entry : entry.name;
          return createFileRecord(entry, previousFiles.get(name)?.content ?? "");
        })
        .sort((left, right) => left.name.localeCompare(right.name));
    });
  }, []);

  const getSyncedLocalFolderHandle = useCallback(() => {
    const bridge = localFolderBridgeRef.current;
    return bridge.syncEnabled ? bridge.handle : null;
  }, []);

  const readBrowserWorkspaceFileMap = useCallback(async (workspaceName = activeWorkspaceRef.current) => {
    await flushAllWrites();
    const filenames = await listFiles(workspaceName);
    const fileMap = new Map();

    for (const filename of filenames) {
      fileMap.set(filename, {
        name: filename,
        content: await readFile(filename, "workspace", workspaceName),
      });
    }

    return fileMap;
  }, [flushAllWrites, listFiles, readFile]);

  const replaceBrowserWorkspaceWithFileMap = useCallback(async (fileMap, workspaceName = activeWorkspaceRef.current) => {
    await flushAllWrites();
    const existingFilenames = await listFiles(workspaceName);

    for (const filename of existingFilenames) {
      if (!fileMap.has(filename)) {
        await deleteWorkspaceFile(filename, "workspace", workspaceName);
        clearRecoveryWrite(filename, workspaceName);
      }
    }

    for (const [filename, file] of fileMap) {
      await writeFile(filename, file.content ?? "", "workspace", workspaceName);
      clearRecoveryWrite(filename, workspaceName);
    }
  }, [clearRecoveryWrite, deleteWorkspaceFile, flushAllWrites, listFiles, writeFile]);

  const pushAirlockSnapshot = useCallback((snapshot) => {
    setAirlockSnapshots((previous) => {
      const next = [snapshot, ...previous]
        .filter(Boolean)
        .slice(0, AIRLOCK_MAX_SNAPSHOTS);
      persistAirlockSnapshots(activeWorkspaceRef.current, next);
      return next;
    });
  }, []);

  const createSnapshotFromFileMap = useCallback((fileMap, label, folderName = localFolderBridgeRef.current.name) => {
    const snapshot = createAirlockSnapshotRecord(fileMap, label, folderName);
    pushAirlockSnapshot(snapshot);
    return snapshot;
  }, [pushAirlockSnapshot]);


  const enqueueLocalFolderWrite = useCallback(
    (filename, content, folderHandle = getSyncedLocalFolderHandle()) => {
      if (!folderHandle) {
        return Promise.resolve();
      }

      const writeTask = localFolderWriteQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          await writeLocalFolderTextFile(folderHandle, filename, content);
          clearRecoveryWrite(filename);
        });

      localFolderWriteQueueRef.current = writeTask;
      return writeTask;
    },
    [clearRecoveryWrite, getSyncedLocalFolderHandle],
  );

  const flushLocalFolderEditorSnapshot = useCallback(
    async (snapshot = getActiveEditorSnapshot()) => {
      const folderHandle = getSyncedLocalFolderHandle();
      if (!folderHandle) {
        return;
      }

      if (snapshot) {
        await enqueueLocalFolderWrite(snapshot.filename, snapshot.content, folderHandle);
      }

      await localFolderWriteQueueRef.current;
    },
    [enqueueLocalFolderWrite, getActiveEditorSnapshot, getSyncedLocalFolderHandle],
  );

  const reportLocalFolderWriteError = useCallback(
    (error) => {
      reportWorkspaceError(`[Airlock] Save failed: ${error?.message || error}`);
    },
    [reportWorkspaceError],
  );

  const flushCurrentStorageWrites = useCallback(
    async (snapshot = getActiveEditorSnapshot()) => {
      if (getSyncedLocalFolderHandle()) {
        await flushLocalFolderEditorSnapshot(snapshot);
        return;
      }

      await flushAllWrites();
    },
    [flushAllWrites, flushLocalFolderEditorSnapshot, getActiveEditorSnapshot, getSyncedLocalFolderHandle],
  );

  const recoverPendingWrites = useCallback(async (workspaceName = activeWorkspaceRef.current) => {
    const entries = Object.entries(readRecoveryEntries(workspaceName));

    for (const [filename, content] of entries) {
      await writeFile(filename, content, "workspace", workspaceName);
      clearRecoveryWrite(filename, workspaceName);
    }
  }, [clearRecoveryWrite, writeFile]);

  const refreshBrowserWorkspaceFiles = useCallback(
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

  const refreshLocalFolderFiles = useCallback(
    async (folderHandle, preferredFile = activeFileRef.current) => {
      const activeHandle = folderHandle || getSyncedLocalFolderHandle();
      if (!activeHandle) {
        return;
      }

      setIsActiveFileLoading(true);

      try {
        const entries = await listLocalFolderEntries(activeHandle);

        if (activeHandle !== getSyncedLocalFolderHandle()) {
          return;
        }

        replaceFileList(entries);
        const selectableFilenames = getSelectableFileNames(entries);

        if (selectableFilenames.length === 0) {
          setOpenFiles([]);
          setActiveFile("");
          return;
        }

        const nextActiveFile = chooseActiveFile(selectableFilenames, preferredFile);
        const content = await readLocalFolderTextFile(activeHandle, nextActiveFile);

        if (activeHandle !== getSyncedLocalFolderHandle()) {
          return;
        }

        setActiveFile(nextActiveFile);
        upsertFileContent(nextActiveFile, content);
      } finally {
        if (activeHandle === getSyncedLocalFolderHandle()) {
          setIsActiveFileLoading(false);
        }
      }
    },
    [getSyncedLocalFolderHandle, replaceFileList, upsertFileContent],
  );

  const refreshWorkspaceFiles = useCallback(
    async (preferredFile = activeFileRef.current, options = {}) => {
      const workspaceName = options.workspaceName ?? activeWorkspaceRef.current;
      const localFolderHandle = getSyncedLocalFolderHandle();

      if (localFolderHandle && workspaceName === activeWorkspaceRef.current) {
        await refreshLocalFolderFiles(localFolderHandle, preferredFile);
        return;
      }

      await refreshBrowserWorkspaceFiles(preferredFile, options);
    },
    [getSyncedLocalFolderHandle, refreshBrowserWorkspaceFiles, refreshLocalFolderFiles],
  );

  const buildWorkspaceTextSnapshot = useCallback(
    async (activeSnapshot = getActiveEditorSnapshot()) => {
      const activeLocalFolderHandle = getSyncedLocalFolderHandle();
      const workspaceName = activeWorkspaceRef.current;
      const selectableNames = getSelectableFileNames(files);
      const activeOverrideName = activeSnapshot?.filename || "";

      const snapshotFiles = await Promise.all(
        selectableNames.map(async (filename) => {
          if (filename === activeOverrideName) {
            return {
              path: filename,
              content: activeSnapshot.content,
            };
          }

          if (activeLocalFolderHandle) {
            return {
              path: filename,
              content: await readLocalFolderTextFile(activeLocalFolderHandle, filename),
            };
          }

          return {
            path: filename,
            content: await readFile(filename, "workspace", workspaceName),
          };
        }),
      );

      if (!snapshotFiles.some((file) => file.path === activeFileRef.current)) {
        throw new Error(`The active file ${activeFileRef.current} could not be included in the host snapshot.`);
      }

      return snapshotFiles;
    },
    [files, getActiveEditorSnapshot, getSyncedLocalFolderHandle, readFile],
  );

  const readLocalFolderTextEntries = useCallback(async (folderHandle) => {
    if (!folderHandle) {
      return {};
    }

    const entries = await listLocalFolderEntries(folderHandle);
    const readableFiles = entries.filter((entry) => (
      entry.kind === LOCAL_FOLDER_ENTRY_KIND_FILE && entry.supported !== false
    ));
    const filesByPath = await Promise.all(
      readableFiles.map(async (entry) => [
        entry.name,
        await readLocalFolderTextFile(folderHandle, entry.name),
      ]),
    );

    return normalizeSnapshotEntries(Object.fromEntries(filesByPath));
  }, []);

  const captureBrowserWorkspaceEntries = useCallback(
    async (options = {}) => {
      const {
        activeSnapshot = getActiveEditorSnapshot(),
        workspaceName = activeWorkspaceRef.current,
      } = options;
      const filenames = await listFiles(workspaceName);
      const snapshotMap = {};

      for (const filename of filenames) {
        if (activeSnapshot?.filename === filename) {
          snapshotMap[filename] = activeSnapshot.content;
          continue;
        }

        snapshotMap[filename] = await readFile(filename, "workspace", workspaceName);
      }

      if (
        activeSnapshot?.filename &&
        !Object.prototype.hasOwnProperty.call(snapshotMap, activeSnapshot.filename)
      ) {
        snapshotMap[activeSnapshot.filename] = activeSnapshot.content;
      }

      return normalizeSnapshotEntries(snapshotMap);
    },
    [getActiveEditorSnapshot, listFiles, readFile],
  );

  const applyBrowserWorkspaceEntries = useCallback(
    async (entriesMap, options = {}) => {
      const workspaceName = options.workspaceName ?? activeWorkspaceRef.current;
      const normalizedEntries = normalizeSnapshotEntries(entriesMap);
      const existingFiles = await listFiles(workspaceName);
      const nextPaths = new Set(Object.keys(normalizedEntries));

      for (const filename of existingFiles) {
        if (!nextPaths.has(filename)) {
          await deleteWorkspaceFile(filename, "workspace", workspaceName);
          clearRecoveryWrite(filename, workspaceName);
        }
      }

      for (const [filename, content] of Object.entries(normalizedEntries)) {
        await writeFile(filename, content, "workspace", workspaceName);
        clearRecoveryWrite(filename, workspaceName);
      }

      return normalizedEntries;
    },
    [clearRecoveryWrite, deleteWorkspaceFile, listFiles, writeFile],
  );

  const applyLocalFolderEntries = useCallback(async (folderHandle, entriesMap) => {
    if (!folderHandle) {
      return {};
    }

    const normalizedEntries = normalizeSnapshotEntries(entriesMap);
    const entries = await listLocalFolderEntries(folderHandle);
    const currentTextFiles = entries
      .filter((entry) => entry.kind === LOCAL_FOLDER_ENTRY_KIND_FILE && entry.supported !== false)
      .map((entry) => normalizeLocalFolderPath(entry.name));
    const nextPaths = new Set(Object.keys(normalizedEntries));

    for (const [filename, content] of Object.entries(normalizedEntries)) {
      await writeLocalFolderTextFile(folderHandle, filename, content);
    }

    for (const filename of currentTextFiles) {
      if (!nextPaths.has(filename)) {
        await deleteLocalFolderTextFile(folderHandle, filename);
      }
    }

    return normalizedEntries;
  }, []);

  const saveAirlockSnapshot = useCallback(async (label, options = {}) => {
    const {
      reason = "manual",
      source = getSyncedLocalFolderHandle() ? "disk" : "local",
      linkedFolderName = localFolderBridgeRef.current.name,
      entriesMap = null,
      replaceExisting = false,
    } = options;
    const files = entriesMap
      || (getSyncedLocalFolderHandle()
        ? await readLocalFolderTextEntries(getSyncedLocalFolderHandle())
        : await captureBrowserWorkspaceEntries());
    const snapshot = createSnapshotRecord({
      label,
      reason,
      source,
      linkedFolderName,
      files,
    });

    setAirlockSnapshots((previous) => [
      snapshot,
      ...(replaceExisting ? [] : previous.filter((entry) => entry.id !== snapshot.id)),
    ].slice(0, AIRLOCK_MAX_SNAPSHOTS));

    return snapshot;
  }, [captureBrowserWorkspaceEntries, getSyncedLocalFolderHandle, readLocalFolderTextEntries]);
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
    refreshWorkspaceFiles(activeFileRef.current, {
      workspaceName: activeWorkspaceRef.current,
    }).catch(() => undefined);

    if (!error) {
      terminalRef.current?.writeln("\x1b[90m\n[Process completed]\x1b[0m");
    }
  }, [refreshWorkspaceFiles]);

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

      if (!getSyncedLocalFolderHandle()) {
        stageRecoveryWrite(filename, content);
      }

      if (scheduleWorkerWrite && !getSyncedLocalFolderHandle()) {
        scheduleWrite(filename, content);
      }

      return snapshot;
    },
    [getActiveEditorSnapshot, getSyncedLocalFolderHandle, scheduleWrite, stageRecoveryWrite, upsertFileContent],
  );

  const handleEditorMount = useCallback(
    (editor) => {
      editorRef.current = editor;

      if (editorSubscriptionRef.current) {
        editorSubscriptionRef.current.dispose();
      }

      editorSubscriptionRef.current = editor.onDidChangeModelContent(() => {
        const filename = getEditorFilename(editor);
        if (filename && !getSyncedLocalFolderHandle()) {
          stageRecoveryWrite(filename, editor.getValue());
        }
      });
    },
    [getEditorFilename, getSyncedLocalFolderHandle, stageRecoveryWrite],
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
    localFolderHandle: runtimeLocalFolderHandle,

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
    localFolderHandle: runtimeLocalFolderHandle,

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
  const {
    bridgeUrl,
    connected: hostBridgeConnected,
    status: hostBridgeStatus,
    lastError: hostBridgeError,
    capabilities: hostBridgeCapabilities,
    availableLanguages: hostBridgeLanguages,
    isRunning: isHostBridgeRunning,
    lastRun: lastHostBridgeRun,
    connect: connectHostBridge,
    disconnect: disconnectHostBridge,
    runSnapshot: runHostBridgeSnapshot,
    killRun: killHostBridgeRun,
    getRunnerForFilename: getHostBridgeRunnerForFilename,
  } = useHostBridge({
    onStdout: writeStdout,
    onStderr: writeStderr,
    onStatus: (message) => {
      setStatus(message);
      terminalRef.current?.writeln(`\x1b[90m[Host bridge] ${message}\x1b[0m`);
    },
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
    if (isRunning || isJsRunning || isSqlRunning || isHostBridgeRunning) {
      terminalRef.current?.writeln(
        "\x1b[33m[Offline proof] Finish or stop the active session before opening the proof flow.\x1b[0m",
      );
      return;
    }

    setOfflineProofVisible(true);
    setBottomPanelMode("output");
    setMobilePane("output");
    void refreshOfflineProofState();
  }, [isHostBridgeRunning, isJsRunning, isRunning, isSqlRunning, refreshOfflineProofState]);

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
      const snapshot = syncActiveEditorDraft({ scheduleWorkerWrite: false, updateState: false });

      if (getSyncedLocalFolderHandle()) {
        void flushLocalFolderEditorSnapshot(snapshot).catch(() => {});
        return;
      }

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
  }, [flushAllWrites, flushLocalFolderEditorSnapshot, getSyncedLocalFolderHandle, syncActiveEditorDraft]);

  useEffect(() => {
    return () => {
      editorSubscriptionRef.current?.dispose();
      editorSubscriptionRef.current = null;
    };
  }, []);
  const prepareWorkspaceMutation = useCallback(
    async (actionLabel) => {
      const runtimeBusy = isRunning || isJsRunning || isSqlRunning || isHostBridgeRunning;
      if (runtimeBusy) {
        const message = `Finish or stop the active session before ${actionLabel}.`;
        terminalRef.current?.writeln(`\x1b[33m[WasmForge] ${message}\x1b[0m`);
        throw new Error(message);
      }

      const snapshot = syncActiveEditorDraft();
      await flushCurrentStorageWrites(snapshot);
    },
    [flushCurrentStorageWrites, isHostBridgeRunning, isJsRunning, isRunning, isSqlRunning, syncActiveEditorDraft],
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
    if (isHostBridgeRunning) {
      void killHostBridgeRun();
      return;
    }
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
  }, [isHostBridgeRunning, killHostBridgeRun, killJsWorker, killSqlWorker, killWorker]);

  const resetNotebookKernel = useCallback(async (filename, options = {}) => {
    const {
      announce = true,
      clearOutputs = true,
    } = options;
    const notebookKey = getNotebookSessionKey(activeWorkspaceRef.current, filename);

    await flushCurrentStorageWrites();
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
  }, [flushCurrentStorageWrites, resetNotebookSessionInWorker]);

  const executeNotebookCell = useCallback(async ({ filename, document, cellId }) => {
    const cellIndex = document.cells.findIndex((cell) => cell.id === cellId);
    const cell = cellIndex >= 0 ? document.cells[cellIndex] : null;

    if (!cell) {
      return { error: "Notebook cell could not be found." };
    }

    await flushCurrentStorageWrites();
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
  }, [flushCurrentStorageWrites, runNotebookCellInWorker]);

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
    const hostBridgeRunner = runtime === "unknown" ? getHostBridgeRunnerForFilename(activeFile) : null;
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
        await flushCurrentStorageWrites(syncedSnapshot);
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
        await flushCurrentStorageWrites(syncedSnapshot).catch(() => {});
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
        if (!hostBridgeRunner) {
          terminalRef.current?.writeln(
            hostBridgeConnected
              ? "\x1b[31m[WasmForge] This file type is not supported by the browser runtimes or the connected host bridge.\x1b[0m\n"
              : "\x1b[33m[WasmForge] Unsupported browser runtime. Start the optional host bridge to run local toolchains for this file type.\x1b[0m\n",
          );
          return;
        }

        if (!hostBridgeConnected) {
          terminalRef.current?.writeln(
            `\x1b[33m[Host bridge] Start the bridge with "npm run bridge" and connect it before running ${activeFile}.\x1b[0m\n`,
          );
          return;
        }

        await flushCurrentStorageWrites(syncedSnapshot);
        setStatus(`Running ${hostBridgeRunner.label}...`);
        try {
          const snapshotFiles = await buildWorkspaceTextSnapshot(syncedSnapshot);
          const result = await runHostBridgeSnapshot({
            entrypoint: activeFile,
            files: snapshotFiles,
          });

          if (result?.commandPreview) {
            terminalRef.current?.writeln(`\x1b[90m[Host bridge] ${result.commandPreview}\x1b[0m`);
          }

          if (!result?.error) {
            const durationLabel = formatExecutionDuration(result?.durationMs);
            if (durationLabel) {
              terminalRef.current?.writeln(
                `\x1b[36m[Host bridge] Executed with local toolchains in ${durationLabel}.\x1b[0m`,
              );
            }
            terminalRef.current?.writeln("\x1b[90m[Process completed]\x1b[0m");
          } else {
            terminalRef.current?.writeln(`\x1b[31m[Host bridge] ${result.error}\x1b[0m`);
            setStatus("Error");
          }
        } catch (error) {
          terminalRef.current?.writeln(`\x1b[31m[Host bridge] ${error?.message || error}\x1b[0m`);
          setStatus("Error");
        } finally {
          await refreshWorkspaceFiles(activeFileRef.current, {
            workspaceName: activeWorkspaceRef.current,
          }).catch(() => undefined);
        }
        return;
    }
  }, [
    activeFile,
    buildWorkspaceTextSnapshot,
    executePgliteFile,
    executeSqliteFile,
    files,
    flushCurrentStorageWrites,
    getHostBridgeRunnerForFilename,
    handleRunNotebookAll,
    hostBridgeConnected,
    isActiveFileLoading,
    isJsReady,
    isReady,
    pgliteReady,
    refreshWorkspaceFiles,
    runCode,
    runHostBridgeSnapshot,
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

  const openAirlockPanel = useCallback(() => {
    setIsBottomPanelVisible(true);
    setBottomPanelMode("airlock");
    if (viewportWidth < MOBILE_LAYOUT_BREAKPOINT) {
      setMobilePane("output");
    }
  }, [viewportWidth]);

  const handleResolveAirlockEntry = useCallback((path, resolution) => {
    setAirlockReconciliation((previous) => {
      if (!previous) {
        return previous;
      }

      const nextEntries = applyReconciliationResolution(previous.entries, path, resolution);
      return {
        ...previous,
        entries: nextEntries,
        unresolvedCount: nextEntries.filter((entry) => entry.status === "conflict" && !entry.resolution).length,
      };
    });
  }, []);

  const handleCompleteAirlockReattach = useCallback(async () => {
    const folderHandle = localFolderBridgeRef.current.handle;
    const folderName = localFolderBridgeRef.current.name || "selected folder";
    if (!folderHandle || !airlockReconciliation) {
      return;
    }

    try {
      setAirlockBusy(true);

      if (hasPendingConflicts(airlockReconciliation.entries)) {
        terminalRef.current?.writeln(
          "\x1b[33m[Airlock] Resolve every conflict before reattaching sync.\x1b[0m",
        );
        return;
      }

      await prepareWorkspaceMutation("completing Airlock reattach");
      const currentLocalEntries = await captureBrowserWorkspaceEntries();
      const scannedLocalEntries = createLocalEntriesFromReconciliation(airlockReconciliation.entries);

      if (!snapshotEntriesEqual(currentLocalEntries, scannedLocalEntries)) {
        const currentDiskEntries = await readLocalFolderTextEntries(folderHandle);
        const nextReconciliation = createReconciliationResult({
          lastSynced: localFolderBridgeRef.current.lastSyncedSnapshot?.files || {},
          currentLocal: currentLocalEntries,
          currentDisk: currentDiskEntries,
        });
        setAirlockReconciliation(nextReconciliation);
        openAirlockPanel();
        terminalRef.current?.writeln(
          "\x1b[33m[Airlock] Detached files changed after the reattach scan. WasmForge refreshed the Conflict Center; review the latest changes before completing reattach.\x1b[0m",
        );
        return;
      }

      const mergedEntries = buildResolvedFileMap(airlockReconciliation.entries);
      await applyLocalFolderEntries(folderHandle, mergedEntries);
      await applyBrowserWorkspaceEntries(mergedEntries);

      const baseline = createSnapshotRecord({
        label: `Synced · ${folderName}`,
        reason: "reattached",
        source: "merged",
        linkedFolderName: folderName,
        files: mergedEntries,
      });
      const nextBridge = {
        ...localFolderBridgeRef.current,
        syncEnabled: true,
        lastSyncedSnapshot: baseline,
      };

      localFolderBridgeRef.current = nextBridge;
      setLocalFolderBridge(nextBridge);
      setAirlockReconciliation(null);
      setOfflineProofVisible(false);
      openAirlockPanel();
      await refreshLocalFolderFiles(folderHandle, activeFileRef.current);
      terminalRef.current?.writeln(
        `\x1b[36m[Airlock] Sync reattached for "${folderName}". WebIDE and disk are aligned again.\x1b[0m`,
      );
    } catch (error) {
      const detachedBridge = {
        ...localFolderBridgeRef.current,
        syncEnabled: false,
      };
      localFolderBridgeRef.current = detachedBridge;
      setLocalFolderBridge(detachedBridge);
      openAirlockPanel();
      terminalRef.current?.writeln(
        `\x1b[31m[Airlock] Reattach did not complete: ${error?.message || error}\x1b[0m`,
      );
    } finally {
      setAirlockBusy(false);
    }
  }, [
    airlockReconciliation,
    applyBrowserWorkspaceEntries,
    applyLocalFolderEntries,
    captureBrowserWorkspaceEntries,
    openAirlockPanel,
    prepareWorkspaceMutation,
    readLocalFolderTextEntries,
    refreshLocalFolderFiles,
  ]);

  const handleRestoreAirlockSnapshot = useCallback(async (snapshotId) => {
    const snapshot = airlockSnapshots.find((entry) => entry.id === snapshotId);
    if (!snapshot) {
      return;
    }

    if (localFolderBridgeRef.current.syncEnabled) {
      terminalRef.current?.writeln(
        "\x1b[33m[Airlock] Turn sync off before restoring a detached snapshot.\x1b[0m",
      );
      return;
    }

    await prepareWorkspaceMutation("restoring an Airlock snapshot");
    await applyBrowserWorkspaceEntries(snapshot.files);
    setAirlockReconciliation(null);
    openAirlockPanel();
    await refreshBrowserWorkspaceFiles(
      chooseActiveFile(Object.keys(snapshot.files), activeFileRef.current),
      {
        createDefaultIfEmpty: false,
        workspaceName: activeWorkspaceRef.current,
      },
    );
    terminalRef.current?.writeln(
      `\x1b[36m[Airlock] Restored snapshot "${snapshot.label}" into the detached shadow workspace.\x1b[0m`,
    );
  }, [
    airlockSnapshots,
    applyBrowserWorkspaceEntries,
    openAirlockPanel,
    prepareWorkspaceMutation,
    refreshBrowserWorkspaceFiles,
  ]);

  const handleSaveAirlockSnapshot = useCallback(async () => {
    try {
      await prepareWorkspaceMutation("saving an Airlock snapshot");
      const snapshot = await saveAirlockSnapshot(
        `Snapshot · ${localFolderBridgeRef.current.name || activeWorkspaceRef.current}`,
      );
      openAirlockPanel();
      terminalRef.current?.writeln(
        `\x1b[36m[Airlock] Saved snapshot "${snapshot.label}".\x1b[0m`,
      );
    } catch (error) {
      terminalRef.current?.writeln(`\x1b[31m[Airlock] ${error?.message || error}\x1b[0m`);
    }
  }, [openAirlockPanel, prepareWorkspaceMutation, saveAirlockSnapshot]);

  const beginAirlockReattach = useCallback(async (folderHandle = localFolderBridgeRef.current.handle) => {
    if (!folderHandle) {
      throw new Error("Link a local folder before turning sync back on.");
    }

    const folderName = folderHandle.name || localFolderBridgeRef.current.name || "selected folder";
    const previousBridge = localFolderBridgeRef.current;
    const currentLocalEntries = await captureBrowserWorkspaceEntries();
    const currentDiskEntries = await readLocalFolderTextEntries(folderHandle);
    await saveAirlockSnapshot(`Before Reattach · ${folderName}`, {
      reason: "before-reattach",
      source: "local",
      linkedFolderName: folderName,
      entriesMap: currentLocalEntries,
    });
    const reconciliation = createReconciliationResult({
      lastSynced: localFolderBridgeRef.current.lastSyncedSnapshot?.files || {},
      currentLocal: currentLocalEntries,
      currentDisk: currentDiskEntries,
    });

    if (!reconciliation.hasChanges) {
      const baseline = createSnapshotRecord({
        label: `Synced · ${folderName}`,
        reason: "reattached",
        source: "disk",
        linkedFolderName: folderName,
        files: currentDiskEntries,
      });
      const nextBridge = {
        ...previousBridge,
        handle: folderHandle,
        name: folderName,
        syncEnabled: true,
        lastSyncedSnapshot: baseline,
      };

      await applyBrowserWorkspaceEntries(currentDiskEntries);
      localFolderBridgeRef.current = nextBridge;
      setLocalFolderBridge(nextBridge);
      setAirlockReconciliation(null);
      openAirlockPanel();
      try {
        await refreshLocalFolderFiles(folderHandle, activeFileRef.current);
      } catch (error) {
        localFolderBridgeRef.current = previousBridge;
        setLocalFolderBridge(previousBridge);
        throw error;
      }
      terminalRef.current?.writeln(
        `\x1b[36m[Airlock] "${folderName}" is already aligned. Sync is back on.\x1b[0m`,
      );
      return;
    }

    setAirlockReconciliation(reconciliation);
    openAirlockPanel();
    terminalRef.current?.writeln(
      `\x1b[36m[Airlock] Reattach scan complete for "${folderName}". Review ${reconciliation.summary.conflict} conflict(s) in the Conflict Center.\x1b[0m`,
    );
  }, [
    applyBrowserWorkspaceEntries,
    captureBrowserWorkspaceEntries,
    openAirlockPanel,
    readLocalFolderTextEntries,
    refreshLocalFolderFiles,
    saveAirlockSnapshot,
  ]);

  const handleDisableAirlockSync = useCallback(async (options = {}) => {
    const { quiet = false } = options;
    const folderHandle = localFolderBridgeRef.current.handle;
    const folderName = localFolderBridgeRef.current.name || "selected folder";
    if (!folderHandle || !localFolderBridgeRef.current.syncEnabled) {
      return;
    }

    await prepareWorkspaceMutation("turning Airlock sync off");
    const currentDiskEntries = await readLocalFolderTextEntries(folderHandle);
    await applyBrowserWorkspaceEntries(currentDiskEntries);
    const detachedBaseline = createSnapshotRecord({
      label: `Synced - ${folderName}`,
      reason: "detached",
      source: "disk",
      linkedFolderName: folderName,
      files: currentDiskEntries,
    });
    await saveAirlockSnapshot(`Sync Off · ${folderName}`, {
      reason: "sync-off",
      source: "disk",
      linkedFolderName: folderName,
      entriesMap: currentDiskEntries,
    });

    const nextBridge = {
      ...localFolderBridgeRef.current,
      syncEnabled: false,
      lastSyncedSnapshot: detachedBaseline,
    };
    localFolderBridgeRef.current = nextBridge;
    setLocalFolderBridge(nextBridge);
    setAirlockReconciliation(null);
    setOfflineProofVisible(false);
    setSidebarMode("explorer");
    setFileSearchQuery("");
    openAirlockPanel();
    await refreshBrowserWorkspaceFiles(activeFileRef.current || DEFAULT_FILENAME, {
      createDefaultIfEmpty: true,
      workspaceName: activeWorkspaceRef.current,
    });

    if (!quiet) {
      terminalRef.current?.writeln(
        `\x1b[90m[Airlock] Sync is off for "${folderName}". WasmForge is now editing the detached local shadow workspace.\x1b[0m`,
      );
    }
  }, [
    applyBrowserWorkspaceEntries,
    openAirlockPanel,
    prepareWorkspaceMutation,
    readLocalFolderTextEntries,
    refreshBrowserWorkspaceFiles,
    saveAirlockSnapshot,
  ]);

  const handleConnectLocalFolder = useCallback(async ({ confirmed = false } = {}) => {
    if (isRunning || isJsRunning || isSqlRunning || isHostBridgeRunning) {
      terminalRef.current?.writeln(
        "\x1b[33m[Airlock] Finish or stop the active session before linking a folder.\x1b[0m",
      );
      return;
    }

    if (typeof window === "undefined" || typeof window.showDirectoryPicker !== "function") {
      terminalRef.current?.writeln(
        "\x1b[31m[Airlock] This browser does not support the File System Access API. Use Chromium/Edge on localhost or HTTPS.\x1b[0m",
      );
      return;
    }

    if (!confirmed) {
      setLocalFolderSecurityAccepted(false);
      setLocalFolderSecurityPromptOpen(true);
      return;
    }

    try {
      setAirlockBusy(true);
      await prepareWorkspaceMutation("linking a real folder");

      const handle = await window.showDirectoryPicker({
        id: "wasmforge-local-folder",
        mode: "readwrite",
      });
      const permissionOptions = { mode: "readwrite" };
      const currentPermission =
        typeof handle.queryPermission === "function"
          ? await handle.queryPermission(permissionOptions)
          : "granted";
      const nextPermission =
        currentPermission === "granted" || typeof handle.requestPermission !== "function"
          ? currentPermission
          : await handle.requestPermission(permissionOptions);

      if (nextPermission !== "granted") {
        throw new Error("Folder permission was not granted.");
      }

      const folderName = handle.name || "selected folder";
      const previousBridge = localFolderBridgeRef.current;
      const hasBaseline = Boolean(previousBridge.lastSyncedSnapshot);
      const expectedFolderName =
        previousBridge.lastSyncedSnapshot?.linkedFolderName
        || previousBridge.name
        || "";
      const startsFreshAfterUnlink =
        hasBaseline
        && !previousBridge.handle
        && expectedFolderName
        && folderName !== expectedFolderName;

      if (hasBaseline && !startsFreshAfterUnlink) {
        if (expectedFolderName && folderName !== expectedFolderName) {
          throw new Error(`Selected "${folderName}", but this Airlock workspace expects "${expectedFolderName}". Choose the original folder or Return to WebIDE before linking a different folder.`);
        }

        const linkedBridge = {
          ...previousBridge,
          handle,
          name: folderName,
          syncEnabled: false,
        };
        localFolderBridgeRef.current = linkedBridge;
        setLocalFolderBridge(linkedBridge);

        try {
          await beginAirlockReattach(handle);
        } catch (error) {
          localFolderBridgeRef.current = previousBridge;
          setLocalFolderBridge(previousBridge);
          throw error;
        }
        return;
      }

      const currentLocalEntries = await captureBrowserWorkspaceEntries();
      const currentDiskEntries = await readLocalFolderTextEntries(handle);
      if (startsFreshAfterUnlink && Object.keys(currentLocalEntries).length === 0) {
        setAirlockSnapshots([]);
      }

      if (Object.keys(currentLocalEntries).length > 0) {
        await saveAirlockSnapshot(`Before Link · ${folderName}`, {
          reason: "before-link",
          source: "local",
          linkedFolderName: folderName,
          entriesMap: currentLocalEntries,
          replaceExisting: startsFreshAfterUnlink,
        });
      }

      await applyBrowserWorkspaceEntries(currentDiskEntries);

      const baseline = createSnapshotRecord({
        label: `Synced · ${folderName}`,
        reason: "linked",
        source: "disk",
        linkedFolderName: folderName,
        files: currentDiskEntries,
      });
      const nextBridge = {
        handle,
        name: folderName,
        syncEnabled: true,
        lastSyncedSnapshot: baseline,
      };

      localFolderBridgeRef.current = nextBridge;
      setLocalFolderBridge(nextBridge);
      setAirlockReconciliation(null);
      setSqlExecution(createEmptySqlExecution());
      setPythonExecution(createEmptyPythonExecution());
      setOfflineProofVisible(false);
      setSidebarMode("explorer");
      setFileSearchQuery("");
      openAirlockPanel();
      await refreshLocalFolderFiles(handle, activeFileRef.current);
      if (startsFreshAfterUnlink) {
        terminalRef.current?.writeln(
          `\x1b[36m[Airlock] Started a new Airlock link for "${folderName}". Previous "${expectedFolderName}" Airlock history was cleared.\x1b[0m`,
        );
      }
      terminalRef.current?.writeln(
        `\x1b[36m[Airlock] Linked "${folderName}". Sync is on, so WasmForge and VS Code now point at the same folder.\x1b[0m`,
      );
    } catch (error) {
      if (error?.name === "AbortError") {
        terminalRef.current?.writeln("\x1b[90m[Airlock] Folder selection cancelled.\x1b[0m");
        return;
      }

      terminalRef.current?.writeln(`\x1b[31m[Airlock] ${error?.message || error}\x1b[0m`);
    } finally {
      setAirlockBusy(false);
    }
  }, [
    applyBrowserWorkspaceEntries,
    beginAirlockReattach,
    captureBrowserWorkspaceEntries,
    isHostBridgeRunning,
    isJsRunning,
    isRunning,
    isSqlRunning,
    openAirlockPanel,
    prepareWorkspaceMutation,
    readLocalFolderTextEntries,
    refreshLocalFolderFiles,
    saveAirlockSnapshot,
  ]);

  const handleCancelLocalFolderSecurityPrompt = useCallback(() => {
    setLocalFolderSecurityPromptOpen(false);
    setLocalFolderSecurityAccepted(false);
    terminalRef.current?.writeln("\x1b[90m[Airlock] Folder link cancelled. Browser sandbox remains active.\x1b[0m");
  }, []);

  const handleConfirmLocalFolderSecurityPrompt = useCallback(async () => {
    if (!localFolderSecurityAccepted) {
      return;
    }

    setLocalFolderSecurityPromptOpen(false);
    setLocalFolderSecurityAccepted(false);
    await handleConnectLocalFolder({ confirmed: true });
  }, [
    handleConnectLocalFolder,
    localFolderSecurityAccepted,
  ]);


  const handleDisconnectLocalFolder = useCallback(async () => {
    if (isRunning || isJsRunning || isSqlRunning || isHostBridgeRunning) {
      terminalRef.current?.writeln(
        "\x1b[33m[Airlock] Finish or stop the active session before unlinking the live folder handle.\x1b[0m",

      );
      return;
    }


    const folderName = localFolderBridgeRef.current.name || "selected folder";
    try {
      setAirlockBusy(true);
      if (localFolderBridgeRef.current.syncEnabled && localFolderBridgeRef.current.handle) {
        try {
          await handleDisableAirlockSync({ quiet: true });
        } catch (error) {
          terminalRef.current?.writeln(
            `\x1b[33m[Airlock] Could not copy the live folder before unlinking: ${error?.message || error}. Removing the stale folder handle anyway.\x1b[0m`,
          );
        }
      }

      const nextBridge = {
        ...localFolderBridgeRef.current,
        handle: null,
        syncEnabled: false,
      };
      localFolderBridgeRef.current = nextBridge;
      setLocalFolderBridge(nextBridge);
      setAirlockReconciliation(null);
      openAirlockPanel();
      terminalRef.current?.writeln(
        `\x1b[90m[Airlock] Live folder access removed for "${folderName}". The detached shadow workspace and snapshots remain available locally.\x1b[0m`,
      );
    } finally {
      setAirlockBusy(false);
    }
  }, [
    handleDisableAirlockSync,
    isHostBridgeRunning,
    isJsRunning,
    isRunning,
    isSqlRunning,
    openAirlockPanel,
  ]);

  const handleExitAirlockWorkspace = useCallback(async () => {
    const folderName =
      localFolderBridgeRef.current.name
      || localFolderBridgeRef.current.lastSyncedSnapshot?.linkedFolderName
      || "Airlock";
    const browserReturnSnapshot = airlockSnapshots.find((snapshot) => (
      snapshot?.reason === "before-link"
      && snapshot?.source === "local"
      && snapshot?.files
      && Object.keys(snapshot.files).length > 0
    ));

    try {
      await prepareWorkspaceMutation("returning to the browser workspace");

      const folderHandle = localFolderBridgeRef.current.handle;
      let entriesMap = null;

      if (browserReturnSnapshot) {
        entriesMap = browserReturnSnapshot.files;
      } else if (folderHandle && localFolderBridgeRef.current.syncEnabled) {
        try {
          entriesMap = await readLocalFolderTextEntries(folderHandle);
        } catch (error) {
          terminalRef.current?.writeln(
            `\x1b[33m[Airlock] Could not read the live folder while returning to WebIDE: ${error?.message || error}. Falling back to the latest local Airlock copy.\x1b[0m`,
          );
          entriesMap = localFolderBridgeRef.current.lastSyncedSnapshot?.files
            || await captureBrowserWorkspaceEntries();
        }
      } else {
        entriesMap = await captureBrowserWorkspaceEntries();
      }

      const restoredEntries = await applyBrowserWorkspaceEntries(entriesMap);

      const clearedBridge = {
        handle: null,
        name: "",
        syncEnabled: false,
        lastSyncedSnapshot: null,
      };
      localFolderBridgeRef.current = clearedBridge;
      setLocalFolderBridge(clearedBridge);
      setAirlockSnapshots([]);
      setAirlockReconciliation(null);
      setAirlockCenter({
        open: false,
        items: [],
        compareFile: "",
        message: "",
      });
      setOfflineProofVisible(false);
      setSidebarMode("explorer");
      setFileSearchQuery("");
      setBottomPanelMode("terminal");

      await refreshBrowserWorkspaceFiles(
        chooseActiveFile(Object.keys(restoredEntries), activeFileRef.current),
        {
          createDefaultIfEmpty: true,
          workspaceName: activeWorkspaceRef.current,
        },
      );
      terminalRef.current?.writeln(
        browserReturnSnapshot
          ? `\x1b[36m[Airlock] Restored the normal browser workspace from before "${folderName}" was linked. Folder access and Airlock history are cleared for this workspace.\x1b[0m`
          : `\x1b[36m[Airlock] Returned "${folderName}" to the normal browser workspace. No pre-link browser snapshot was available, so the current shadow files were kept.\x1b[0m`,
      );
    } catch (error) {
      terminalRef.current?.writeln(`\x1b[31m[Airlock] ${error?.message || error}\x1b[0m`);
    }
  }, [
    airlockSnapshots,
    applyBrowserWorkspaceEntries,
    captureBrowserWorkspaceEntries,
    prepareWorkspaceMutation,
    readLocalFolderTextEntries,
    refreshBrowserWorkspaceFiles,
  ]);

  const handleToggleLocalFolder = useCallback(() => {
    if (!localFolderBridge.handle) {
      return;
    }

    if (localFolderBridge.syncEnabled) {
      void handleDisableAirlockSync();
      return;
    }

    void beginAirlockReattach(localFolderBridge.handle).catch((error) => {
      terminalRef.current?.writeln(`\x1b[31m[Airlock] ${error?.message || error}\x1b[0m`);
    });
  }, [beginAirlockReattach, handleDisableAirlockSync, localFolderBridge.handle, localFolderBridge.syncEnabled]);

  const handleLocalFolderButtonClick = useCallback(() => {
    const hasAirlockHistory =
      Boolean(localFolderBridgeRef.current.handle)
      || Boolean(localFolderBridgeRef.current.lastSyncedSnapshot)
      || airlockSnapshots.length > 0
      || Boolean(airlockReconciliation);
    if (hasAirlockHistory) {
      openAirlockPanel();
      return;
    }

    void handleConnectLocalFolder();
  }, [airlockReconciliation, airlockSnapshots.length, handleConnectLocalFolder, openAirlockPanel]);

  const connectHostBridgeWithConsent = useCallback(async () => {
    if (isRunning || isJsRunning || isSqlRunning || isHostBridgeRunning) {
      terminalRef.current?.writeln(
        "\x1b[33m[Host bridge] Finish or stop the active session before changing host bridge state.\x1b[0m",

      );
      return;
    }

    try {
      const capabilities = await connectHostBridge();
      const languageList = capabilities?.runners?.map((runner) => runner.language).join(", ");
      terminalRef.current?.writeln(`\x1b[36m[Host bridge] Connected to ${bridgeUrl}\x1b[0m`);
      if (languageList) {
        terminalRef.current?.writeln(`\x1b[90m[Host bridge] Local toolchains ready for ${languageList}.\x1b[0m`);
      }
    } catch (error) {
      terminalRef.current?.writeln(`\x1b[31m[Host bridge] ${error?.message || error}\x1b[0m`);
      terminalRef.current?.writeln(
        `\x1b[90m[Host bridge] Start it with "npm run bridge" and keep it on ${bridgeUrl}.\x1b[0m`,
      );
    }
  }, [
    bridgeUrl,
    connectHostBridge,
    isHostBridgeRunning,
    isJsRunning,
    isRunning,
    isSqlRunning,
  ]);

  const handleToggleHostBridge = useCallback(async () => {
    if (isRunning || isJsRunning || isSqlRunning || isHostBridgeRunning) {
      terminalRef.current?.writeln(
        "\x1b[33m[Host bridge] Finish or stop the active session before changing host bridge state.\x1b[0m",

      );
      return;
    }

    if (hostBridgeConnected) {
      disconnectHostBridge();
      terminalRef.current?.writeln("\x1b[90m[Host bridge] Disconnected. Browser runtimes remain available.\x1b[0m");
      return;
    }

    setHostBridgeSecurityPhrase("");
    setHostBridgeSecurityPromptOpen(true);
  }, [
    disconnectHostBridge,
    hostBridgeConnected,
    isHostBridgeRunning,
    isJsRunning,
    isRunning,
    isSqlRunning,
  ]);

  const handleCancelHostBridgeSecurityPrompt = useCallback(() => {
    setHostBridgeSecurityPromptOpen(false);
    setHostBridgeSecurityPhrase("");
    terminalRef.current?.writeln("\x1b[90m[Host bridge] Connection cancelled. Browser sandbox remains active.\x1b[0m");
  }, []);

  const handleConfirmHostBridgeSecurityPrompt = useCallback(async () => {
    if (hostBridgeSecurityPhrase.trim().toUpperCase() !== "CONNECT") {
      return;
    }

    setHostBridgeSecurityPromptOpen(false);
    setHostBridgeSecurityPhrase("");
    await connectHostBridgeWithConsent();
  }, [
    connectHostBridgeWithConsent,
    hostBridgeSecurityPhrase,
  ]);


  useEffect(() => {
    const sharedPayload =
      typeof window === "undefined" ? null : readSharedPayloadFromHash(window.location.hash);
    const runtimeBusy = isRunning || isJsRunning || isSqlRunning || isHostBridgeRunning;
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
    isHostBridgeRunning,
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
    if (localFolderBridgeRef.current.handle) {
      terminalRef.current?.writeln("\x1b[33m[Airlock] Unlink the live folder before switching browser workspaces.\x1b[0m");
      return;
    }

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
    if (localFolderBridgeRef.current.handle) {
      throw new Error("Unlink the live Airlock folder before creating browser workspaces.");
    }

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
    const selectedFile = files.find((file) => file.name === name);
    if (selectedFile?.kind === LOCAL_FOLDER_ENTRY_KIND_DIRECTORY) {
      return;
    }
    if (selectedFile?.supported === false) {
      terminalRef.current?.writeln(
        `\x1b[33m[Airlock] ${name} is visible, but this file type is not editable in WasmForge yet.\x1b[0m`,
      );
      return;
    }

    if ((isRunning || isJsRunning || isSqlRunning || isHostBridgeRunning) && name !== activeFileRef.current) {
        terminalRef.current?.writeln("\x1b[33m[WasmForge] Finish or stop the active session before switching files.\x1b[0m");
      return;
    }

    const workspaceName = activeWorkspaceRef.current;
    const snapshot = syncActiveEditorDraft();
    await flushCurrentStorageWrites(snapshot);
    setIsActiveFileLoading(true);
    let content = "";

    try {
      const localFolderHandle = getSyncedLocalFolderHandle();
      if (localFolderHandle) {
        content = await readLocalFolderTextFile(localFolderHandle, name);
        if (localFolderHandle !== getSyncedLocalFolderHandle()) {
          return;
        }
      } else {
        try {
          content = await readFile(name, "workspace", workspaceName);
        } catch (error) {
          if (workspaceName !== activeWorkspaceRef.current || isMissingWorkspaceFileError(error)) {
            return;
          }
          throw error;
        }
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

  }, [files, flushCurrentStorageWrites, getSyncedLocalFolderHandle, isHostBridgeRunning, isJsRunning, isRunning, isSqlRunning, readFile, syncActiveEditorDraft, upsertFileContent]);


  const persistNotebookDocument = useCallback((filename, document, options = {}) => {
    const {
      selectedCellId = null,
      preserveResults = true,
    } = options;
    const serialized = serializePythonNotebookDocument(document);

    upsertFileContent(filename, serialized);

    if (getSyncedLocalFolderHandle()) {
      void enqueueLocalFolderWrite(filename, serialized).catch(reportLocalFolderWriteError);
    } else {
      stageRecoveryWrite(filename, serialized);
      scheduleWrite(filename, serialized);
    }

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
  }, [enqueueLocalFolderWrite, getSyncedLocalFolderHandle, reportLocalFolderWriteError, scheduleWrite, stageRecoveryWrite, upsertFileContent]);

  const handleCodeChange = useCallback((newContent) => {
    if (!activeFile) {
      return;
    }
    upsertFileContent(activeFile, newContent);

    if (getSyncedLocalFolderHandle()) {
      void enqueueLocalFolderWrite(activeFile, newContent).catch(reportLocalFolderWriteError);
      return;
    }

    stageRecoveryWrite(activeFile, newContent);
    scheduleWrite(activeFile, newContent);
  }, [activeFile, enqueueLocalFolderWrite, getSyncedLocalFolderHandle, reportLocalFolderWriteError, scheduleWrite, stageRecoveryWrite, upsertFileContent]);

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

    const localFolderHandle = getSyncedLocalFolderHandle();
    const usesNestedPaths = Boolean(localFolderHandle || localFolderBridgeRef.current.lastSyncedSnapshot);
    const trimmed = usesNestedPaths

      ? normalizeLocalFolderPath(name)
      : normalizeWorkspaceFilename(name);
    if (files.some((file) => file.name === trimmed)) {
      throw new Error("File already exists.");
    }
    if (localFolderBridge.handle && !isLocalFolderTextFileName(trimmed)) {
      throw new Error("Local folder Explorer supports text and code files only.");
    }
    const initialContent = isPythonNotebookFile(trimmed) ? createNotebookFileContent() : "";
    await prepareWorkspaceMutation("creating files");

    if (localFolderHandle) {
      await writeLocalFolderTextFile(localFolderHandle, trimmed, initialContent);
    } else {
      await writeFile(trimmed, initialContent, "workspace", activeWorkspaceRef.current);
    }

    await refreshWorkspaceFiles(trimmed, { workspaceName: activeWorkspaceRef.current });
    setMobilePane("editor");
  }, [files, getSyncedLocalFolderHandle, prepareWorkspaceMutation, refreshWorkspaceFiles, writeFile]);

  const handleCreateNotebook = useCallback(async () => {
    const nextFilename = createNotebookFilename(files);
    await handleCreateFile(nextFilename);
  }, [files, handleCreateFile]);

  const handleRenameFile = useCallback(async (currentName, nextName) => {

    const localFolderHandle = getSyncedLocalFolderHandle();
    const usesNestedPaths = Boolean(localFolderHandle || localFolderBridgeRef.current.lastSyncedSnapshot);
    const trimmed = usesNestedPaths

      ? normalizeLocalFolderPath(nextName)
      : normalizeWorkspaceFilename(nextName);
    if (currentName === trimmed) {
      return;
    }
    if (files.some((file) => file.name === trimmed && file.name !== currentName)) {
      throw new Error("File already exists.");
    }
    if (localFolderBridge.handle && !isLocalFolderTextFileName(trimmed)) {
      throw new Error("Local folder Explorer supports text and code files only.");
    }
    await prepareWorkspaceMutation("renaming files");

    if (localFolderHandle) {
      await renameLocalFolderTextFile(localFolderHandle, currentName, trimmed);
    } else {
      await renameWorkspaceFile(currentName, trimmed, activeWorkspaceRef.current);
    }

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
  }, [clearRecoveryWrite, files, getSyncedLocalFolderHandle, prepareWorkspaceMutation, refreshWorkspaceFiles, renameWorkspaceFile]);

  const handleDeleteFile = useCallback(async (filename) => {
    await prepareWorkspaceMutation("deleting files");

    const localFolderHandle = getSyncedLocalFolderHandle();
    if (localFolderHandle) {
      await deleteLocalFolderTextFile(localFolderHandle, filename);
    } else {
      await deleteWorkspaceFile(filename, "workspace", activeWorkspaceRef.current);
    }

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
    const remainingNames = getSelectableFileNames(files.filter((file) => file.name !== filename));
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
  }, [clearRecoveryWrite, deleteWorkspaceFile, files, getSyncedLocalFolderHandle, prepareWorkspaceMutation, refreshWorkspaceFiles]);

  const handleCloseTab = useCallback((filename) => {
    const runtimeBusy = isRunning || isJsRunning || isSqlRunning || isHostBridgeRunning;
    if (runtimeBusy && filename === activeFileRef.current) {
      terminalRef.current?.writeln("\x1b[33m[WasmForge] Finish or stop the active session before closing the active tab.\x1b[0m");
      return;
    }

    if (filename === activeFileRef.current) {
      closingTabRef.current = filename;
    }

    const nextTabs = openFiles.filter((fileName) => fileName !== filename);
    setOpenFiles(nextTabs);

    if (filename !== activeFileRef.current) {
      return;
    }

    const nextActive = nextTabs[nextTabs.length - 1] ?? "";
    if (nextActive) {
      activeFileRef.current = nextActive;
      setActiveFile(nextActive);
      void handleFileSelect(nextActive);
      return;
    }

    activeFileRef.current = "";
    setActiveFile("");
  }, [handleFileSelect, isHostBridgeRunning, isJsRunning, isRunning, isSqlRunning, openFiles]);

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
  const activeHostBridgeRunner =
    activeRuntime === "unknown" ? getHostBridgeRunnerForFilename(activeFile) : null;
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
            : activeRuntime === "unknown"
              ? hostBridgeConnected && Boolean(activeHostBridgeRunner)
            : false;
  const activeRuntimeRunning =
    activeRuntime === "python"
      ? isRunning
      : activeRuntime === "javascript"
        ? isJsRunning
        : activeRuntime === "unknown"
          ? isHostBridgeRunning
          : isSqlRunning && runningEngine === activeRuntime;
  const isAnyRuntimeBusy = isRunning || isJsRunning || isSqlRunning || isHostBridgeRunning;
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
            ? activeHostBridgeRunner
              ? hostBridgeConnected
                ? hostBridgeStatus
                : "Host bridge required"
              : files.length === 0
                ? "Create a file to begin"
                : "Unsupported file type"
            : status;
  const activeHasError =
    activeRuntime === "python"
      ? status === "Error" || Boolean(activePythonResult?.error)
      : activeRuntime === "javascript"
        ? jsStatus === "Execution failed" || jsStatus === "JavaScript unavailable"
        : activeRuntime === "unknown" && activeHostBridgeRunner
          ? Boolean(lastHostBridgeRun?.error) || Boolean(hostBridgeError)
        : Boolean(activeSqlResult?.error);
  const canKillActiveRuntime =
    activeRuntime === "python" ||
    activeRuntime === "javascript" ||
    activeRuntime === "sqlite" ||
    activeRuntime === "pglite" ||
    (activeRuntime === "unknown" && isHostBridgeRunning);
  const draftStorageKey = getRecoveryStorageKey(activeWorkspace);
  const statusBarTone = getStatusBarTone(
    activeRuntime,
    activeStatusMessage,
    activeRuntimeRunning,
    activeHasError,
    activeRuntimeReady,
    isAwaitingInput,
  );
  const currentLanguageLabel =
    activeRuntime === "unknown" && activeHostBridgeRunner
      ? getHostRuntimeLanguageLabel(activeFile, activeHostBridgeRunner)
      : getRuntimeLanguageLabel(activeRuntime, activeFile);
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

  const airlockHasLiveFolder = Boolean(localFolderBridge.handle);
  const airlockSyncOn = airlockHasLiveFolder && localFolderBridge.syncEnabled;
  const airlockHasHistory =
    airlockHasLiveFolder
    || Boolean(localFolderBridge.lastSyncedSnapshot)
    || airlockSnapshots.length > 0
    || Boolean(airlockReconciliation);
  const airlockUsesNestedPaths = airlockHasLiveFolder || Boolean(localFolderBridge.lastSyncedSnapshot);
  const localFolderName =
    localFolderBridge.name
    || localFolderBridge.lastSyncedSnapshot?.linkedFolderName
    || "selected folder";
  const workspaceDisplayName = airlockHasHistory ? localFolderName : activeWorkspace;
  const hostBridgeToolchainSummary = hostBridgeCapabilities?.runners?.length
    ? hostBridgeCapabilities.runners.map((runner) => runner.language).join(", ")
    : hostBridgeLanguages.join(", ");
  const hostBridgeStatusLabel = hostBridgeConnected
    ? hostBridgeToolchainSummary
      ? `Host bridge: ${hostBridgeToolchainSummary}`
      : "Host bridge connected"
    : `Host bridge offline (${bridgeUrl})`;
  const localFolderStatusLabel = airlockHasLiveFolder
    ? airlockSyncOn
      ? `Airlock sync on: ${localFolderName}`
      : `Airlock detached: ${localFolderName}`
    : airlockHasHistory
      ? "Airlock shadow workspace saved locally"
      : "Sandboxed browser workspace";
  const localFolderButtonLabel = airlockHasHistory ? "Airlock" : "Link Folder";
  const localFolderButtonTitle = airlockHasHistory
    ? "Open the Airlock sync panel"
    : "Link a real folder for Airlock sync";
  const hostBridgeButtonLabel = hostBridgeConnected ? "Bridge Live" : "Host Bridge";
  const hostBridgeButtonTitle = hostBridgeConnected
    ? hostBridgeStatusLabel
    : `Connect the optional local-native bridge at ${bridgeUrl}. Start it with "npm run bridge".`;

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
    bottomPanelMode === "airlock"
      ? "Airlock Sync"
      : bottomPanelMode === "output" && offlineProofVisible
        ? "Offline Proof"
        : currentLanguageLabel;
  const airlockPanelAvailable = airlockHasHistory || bottomPanelMode === "airlock";
  const closeBottomPanel = useCallback(() => {
    setIsBottomPanelVisible(false);
  }, []);
  const openTerminalPanel = useCallback(() => {
    setIsBottomPanelVisible(true);
    setBottomPanelMode("terminal");
    if (isMobileLayout) {
      setMobilePane("output");
    }

    if (typeof window === "undefined") {
      terminalRef.current?.focus?.();
      return;
    }

    window.requestAnimationFrame(() => {
      requestTerminalResize();
      window.requestAnimationFrame(() => {
        terminalRef.current?.focus?.();
      });
    });
  }, [isMobileLayout, requestTerminalResize]);

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
    setBottomPanelMode((currentMode) => {
      if (currentMode === "airlock") {
        return currentMode;
      }
      return showSqlResultsPanel ? "output" : "terminal";
    });
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
    if (typeof window === "undefined") {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.code !== "Backquote") {
        return;
      }

      event.preventDefault();
      openTerminalPanel();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [openTerminalPanel]);

  useEffect(() => {
    if (isMobileLayout || isBottomPanelVisible) {
      return;
    }

    const shouldReveal =
      offlineProofVisible ||
      (bottomPanelMode === "airlock" && airlockPanelAvailable) ||
      (bottomPanelMode === "output" && (showSqlResultsPanel || showPythonOutputPanel || isActiveNotebook)) ||
      (bottomPanelMode === "terminal" && (activeRuntimeRunning || isAwaitingInput));

    if (shouldReveal) {
      setIsBottomPanelVisible(true);
    }
  }, [
    activeRuntimeRunning,
    bottomPanelMode,
    isActiveNotebook,
    isAwaitingInput,
    isBottomPanelVisible,
    isMobileLayout,
    offlineProofVisible,
    airlockPanelAvailable,
    showPythonOutputPanel,
    showSqlResultsPanel,
  ]);

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
  }, [isBottomPanelVisible, isMobileLayout, requestTerminalResize, sidebarWidth]);

  useEffect(() => {
    if (sidebarMode !== "search" && fileSearchQuery) {
      setFileSearchQuery("");
    }
  }, [fileSearchQuery, sidebarMode]);

  const fileTabs = openFiles.filter((filename) => files.some((file) => file.name === filename));
  const mobileDockedConsoleVisible = isMobileLayout && mobilePane === "editor";
  const terminalVisible = bottomPanelMode === "terminal" && (!isMobileLayout || mobilePane === "output" || mobileDockedConsoleVisible);
  const outputVisible =
    bottomPanelMode !== "terminal" && (!isMobileLayout || mobilePane === "output" || mobileDockedConsoleVisible);
  const editorPaneStyle =
    !isMobileLayout && !isBottomPanelVisible
      ? { flex: "1 1 0%" }
      : isMobileLayout || editorPaneHeight === null
      ? { flex: `${DEFAULT_EDITOR_RATIO} 1 0%` }
      : { flex: `0 0 ${editorPaneHeight}px` };
  const runButtonDisabled =
    isAnyRuntimeBusy ||
    isActiveFileLoading ||
    (activeRuntime === "unknown" && !activeHostBridgeRunner) ||
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

  const airlockCenterPanel = airlockCenter.open ? (
    <AirlockConflictCenter
      items={airlockCenter.items}
      message={airlockCenter.message}
      compareFile={airlockCenter.compareFile}
      snapshots={airlockSnapshots}
      busy={airlockBusy}
      unresolvedCount={unresolvedAirlockItems.length}
      onApplySafe={handleApplySafeAirlockChanges}
      onFinish={handleFinishAirlockReattach}
      onResolve={handleResolveAirlockItem}
      onCompare={(filename) => {
        setAirlockCenter((previous) => ({
          ...previous,
          compareFile: previous.compareFile === filename ? "" : filename,
        }));
      }}
      onRestoreSnapshot={handleRestoreAirlockSnapshot}
      onClose={closeAirlockCenter}
    />
  ) : null;

  const filesPanel = (
    <FileTree
      theme={theme}
      files={files}
      activeFile={activeFile}
      activeWorkspace={workspaceDisplayName}
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

      workspaceLocked={airlockHasLiveFolder}
      storageLabel={airlockSyncOn ? "Linked real folder" : airlockHasHistory ? "Detached local shadow" : "Stored locally"}
      footerLabel={airlockSyncOn ? "Writing through Airlock sync" : airlockHasHistory ? "Saved to shadow workspace" : "Saved locally"}
      allowNestedPaths={airlockUsesNestedPaths}
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
        <EmptyEditorState workspaceName={workspaceDisplayName} isMobile={isMobileLayout} />
      ) : !activeFile ? (
        <EmptyEditorState workspaceName={workspaceDisplayName} hasFiles isMobile={isMobileLayout} />
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
          {airlockPanelAvailable ? (
            <BottomPanelTab active={bottomPanelMode === "airlock"} onClick={openAirlockPanel}>
              AIRLOCK
            </BottomPanelTab>
          ) : null}
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
              {!isMobileLayout ? (
                <button
                  type="button"
                  onClick={closeBottomPanel}
                  aria-label="Hide bottom panel"
                  title="Hide bottom panel"
                  style={terminalIconButtonStyle()}
                  className="wf-terminal-action"
                >
                  <CloseIcon />
                </button>
              ) : null}
            </>
          ) : bottomPanelMode === "airlock" ? (
            <>
              {!isMobileLayout ? (
                <button
                  type="button"
                  onClick={closeBottomPanel}
                  aria-label="Hide bottom panel"
                  title="Hide bottom panel"
                  style={terminalIconButtonStyle()}
                  className="wf-terminal-action"
                >
                  <CloseIcon />
                </button>
              ) : null}
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
              {!isMobileLayout ? (
                <button
                  type="button"
                  onClick={closeBottomPanel}
                  aria-label="Hide bottom panel"
                  title="Hide bottom panel"
                  style={terminalIconButtonStyle()}
                  className="wf-terminal-action"
                >
                  <CloseIcon />
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
          {bottomPanelMode === "airlock" ? (
            <AirlockSyncPanel
              linkedFolderName={localFolderName}
              linked={airlockHasLiveFolder}
              syncEnabled={airlockSyncOn}
              statusText={
                airlockHasLiveFolder
                  ? airlockSyncOn
                    ? "Reads and writes are flowing straight through to the linked folder."
                    : "Edits are staying inside the detached shadow workspace until you reattach."
                  : airlockHasHistory
                    ? "Relink the real folder to compare disk against the detached shadow workspace again."
                    : "Link a real folder to mirror it inside WasmForge."
              }
              lastSyncedAt={localFolderBridge.lastSyncedSnapshot?.createdAt || 0}
              lastSyncedSnapshot={localFolderBridge.lastSyncedSnapshot}
              snapshots={airlockSnapshots}
              reconciliation={airlockReconciliation}
              busy={isAnyRuntimeBusy || airlockBusy}
              onLinkFolder={() => {
                void handleConnectLocalFolder();
              }}
              onUnlinkFolder={() => {
                void handleDisconnectLocalFolder();
              }}
              onToggleSync={() => {
                void handleToggleLocalFolder();
              }}
              onExitAirlock={() => {
                void handleExitAirlockWorkspace();
              }}
              onSaveSnapshot={() => {
                void handleSaveAirlockSnapshot();
              }}
              onRestoreSnapshot={(snapshotId) => {
                void handleRestoreAirlockSnapshot(snapshotId);
              }}
              onResolveEntry={handleResolveAirlockEntry}
              onCompleteReattach={() => {
                void handleCompleteAirlockReattach();
              }}
            />
          ) : offlineProofVisible ? (
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
                {workspaceDisplayName}
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
                aria-label="Show terminal"
                title="Show terminal (Ctrl+`)"
                onClick={openTerminalPanel}
                style={headerIconButtonStyle(isBottomPanelVisible && bottomPanelMode === "terminal")}
                className="wf-terminal-action"
              >
                <TerminalIcon />
              </button>
              <button
                type="button"

                aria-label={airlockHasHistory ? `Open Airlock panel for ${localFolderName}` : "Link local folder"}
                title={localFolderButtonTitle}
                onClick={handleLocalFolderButtonClick}
                disabled={isAnyRuntimeBusy}
                style={localFolderButtonStyle({
                  active: airlockHasHistory,
                  disabled: isAnyRuntimeBusy,

                })}
              >
                <FolderBridgeIcon />
                <span>{localFolderButtonLabel}</span>
              </button>
              <button
                type="button"
                aria-label={hostBridgeConnected ? "Disconnect host bridge" : "Connect host bridge"}
                title={hostBridgeButtonTitle}
                onClick={handleToggleHostBridge}
                disabled={isAnyRuntimeBusy}
                style={localFolderButtonStyle({
                  active: hostBridgeConnected,
                  disabled: isAnyRuntimeBusy,
                })}
              >
                <HostBridgeIcon />
                <span>{hostBridgeButtonLabel}</span>
              </button>
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
                <span style={{ color: "var(--ide-shell-muted)" }}> — {workspaceDisplayName}</span>
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

              aria-label={airlockHasHistory ? `Open Airlock panel for ${localFolderName}` : "Link local folder"}
              title={localFolderButtonTitle}
              onClick={handleLocalFolderButtonClick}
              disabled={isAnyRuntimeBusy}
              style={{
                ...mobileTopButtonStyle(airlockHasHistory),
                opacity: isAnyRuntimeBusy ? 0.56 : 1,
                cursor: isAnyRuntimeBusy ? "not-allowed" : "pointer",

              }}
            >
              <FolderBridgeIcon />
            </button>

            <button
              type="button"
              aria-label={hostBridgeConnected ? "Disconnect host bridge" : "Connect host bridge"}
              title={hostBridgeButtonTitle}
              onClick={handleToggleHostBridge}
              disabled={isAnyRuntimeBusy}
              style={{
                ...mobileTopButtonStyle(hostBridgeConnected),
                opacity: isAnyRuntimeBusy ? 0.56 : 1,
                cursor: isAnyRuntimeBusy ? "not-allowed" : "pointer",
              }}
            >
              <HostBridgeIcon />
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
                {airlockCenterPanel}
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
              {airlockCenterPanel}
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
              {isBottomPanelVisible ? <HorizontalResizeHandle onPointerDown={startResize("editor-terminal")} /> : null}
              <div
                style={{
                  flex: 1,
                  minHeight: MIN_TERMINAL_PANEL_HEIGHT,
                  minWidth: 0,
                  borderRadius: "4px",
                  overflow: "hidden",
                  border: "1px solid var(--ide-shell-border)",
                  boxShadow: "none",
                  display: isBottomPanelVisible ? "block" : "none",
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
              {workspaceDisplayName}
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
            <span style={statusBarDividerStyle()} />
            <span
              style={{
                ...statusBarTokenStyle(),
                color: airlockSyncOn
                  ? "var(--ide-shell-success)"
                  : airlockHasHistory
                    ? "var(--ide-shell-warning)"
                    : "var(--ide-shell-muted)",
                maxWidth: "260px",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={localFolderStatusLabel}
            >
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "999px",
                  background: airlockSyncOn
                    ? "var(--ide-shell-success)"
                    : airlockHasHistory
                      ? "var(--ide-shell-warning)"
                      : "var(--ide-shell-muted)",
                  flexShrink: 0,
                }}
              />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                {localFolderStatusLabel}
              </span>
            </span>
            <span style={statusBarDividerStyle()} />
            <span
              style={{
                ...statusBarTokenStyle(),
                color: hostBridgeConnected ? "var(--ide-shell-accent)" : "var(--ide-shell-muted)",
                maxWidth: "260px",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={hostBridgeStatusLabel}
            >
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "999px",
                  background: hostBridgeConnected
                    ? "var(--ide-shell-accent)"
                    : "var(--ide-shell-muted)",
                  flexShrink: 0,
                }}
              />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                {hostBridgeStatusLabel}
              </span>
            </span>
            <span style={statusBarTokenStyle()}>{currentLanguageLabel}</span>
            {airlockPanelAvailable ? (
              <>
                <span style={statusBarDividerStyle()} />
                <button
                  type="button"
                  aria-label="Open Airlock sync panel"
                  onClick={openAirlockPanel}
                  style={statusBarActionButtonStyle({
                    active: isBottomPanelVisible && bottomPanelMode === "airlock",
                    disabled: false,
                  })}
                >
                  Airlock
                </button>
              </>
            ) : null}
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

      <LocalFolderSecurityPrompt
        open={localFolderSecurityPromptOpen}
        accepted={localFolderSecurityAccepted}
        onAcceptedChange={setLocalFolderSecurityAccepted}
        onCancel={handleCancelLocalFolderSecurityPrompt}
        onConfirm={handleConfirmLocalFolderSecurityPrompt}
      />

      <HostBridgeSecurityPrompt
        open={hostBridgeSecurityPromptOpen}
        bridgeUrl={bridgeUrl}
        confirmationValue={hostBridgeSecurityPhrase}
        onConfirmationChange={setHostBridgeSecurityPhrase}
        onCancel={handleCancelHostBridgeSecurityPrompt}
        onConfirm={handleConfirmHostBridgeSecurityPrompt}
      />
    </div>
  );
}

function LocalFolderSecurityPrompt({
  open,
  accepted,
  onAcceptedChange,
  onCancel,
  onConfirm,
}) {
  if (!open) {
    return null;
  }

  return (
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 78,
        display: "grid",
        placeItems: "center",
        padding: "24px",
        background: "color-mix(in srgb, var(--ide-shell-bg) 72%, transparent)",
        backdropFilter: "blur(14px)",
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="local-folder-security-title"
        aria-describedby="local-folder-security-body"
        onSubmit={(event) => {
          event.preventDefault();
          if (accepted) {
            onConfirm?.();
          }
        }}
        style={{
          width: "min(590px, 100%)",
          border: "1px solid color-mix(in srgb, var(--ide-shell-accent) 34%, var(--ide-shell-border))",
          borderRadius: "18px",
          background: "linear-gradient(145deg, var(--ide-shell-panel), var(--ide-shell-elevated))",
          color: "var(--ide-shell-text)",
          boxShadow: "0 28px 80px color-mix(in srgb, #000 48%, transparent), inset 0 1px 0 rgba(255,255,255,0.05)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "18px 20px",
            borderBottom: "1px solid var(--ide-shell-border)",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "12px",
              display: "grid",
              placeItems: "center",
              background: "color-mix(in srgb, var(--ide-shell-accent) 15%, transparent)",
              color: "var(--ide-shell-accent)",
              fontFamily: '"Cascadia Code", Consolas, monospace',
              fontWeight: 900,
              letterSpacing: "-0.04em",
            }}
          >
            FS
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              id="local-folder-security-title"
              style={{
                fontSize: "16px",
                fontWeight: 800,
                letterSpacing: "0.02em",
              }}
            >
              Local Folder Security Check
            </div>
            <div style={{ color: "var(--ide-shell-muted)", fontSize: "12px", marginTop: "3px" }}>
              The browser will ask for the final folder permission next.
            </div>
          </div>
        </div>

        <div id="local-folder-security-body" style={{ padding: "20px", display: "grid", gap: "14px" }}>
          <p style={{ margin: 0, color: "var(--ide-shell-text-soft)", lineHeight: 1.55, fontSize: "13px" }}>
            WasmForge can read and write only inside the folder you choose and only after Chrome or Edge grants access.
            It does not scan your whole OS or touch folders you did not select.
          </p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: "10px",
            }}
          >
            {[
              ["Selected folder only", "Access is scoped to the directory you pick in the browser dialog."],
              ["Sync ON writes to disk", "Edits in WasmForge appear in the real folder and VS Code."],
              ["Sync OFF is detached", "Changes stay in the local shadow workspace until you reattach."],
              ["Disconnect anytime", "Removing the live handle returns WasmForge to sandbox mode."],
            ].map(([title, body]) => (
              <div
                key={title}
                style={{
                  border: "1px solid var(--ide-shell-border)",
                  borderRadius: "12px",
                  padding: "11px",
                  background: "color-mix(in srgb, var(--ide-shell-bg) 40%, transparent)",
                }}
              >
                <div style={{ color: "var(--ide-shell-text)", fontSize: "12px", fontWeight: 800, marginBottom: "5px" }}>
                  {title}
                </div>
                <div style={{ color: "var(--ide-shell-muted)", fontSize: "11px", lineHeight: 1.45 }}>
                  {body}
                </div>
              </div>
            ))}
          </div>

          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "10px",
              padding: "12px",
              borderRadius: "12px",
              border: "1px solid color-mix(in srgb, var(--ide-shell-accent) 28%, transparent)",
              background: "color-mix(in srgb, var(--ide-shell-accent) 8%, transparent)",
              color: "var(--ide-shell-text-soft)",
              fontSize: "12px",
              lineHeight: 1.45,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={accepted}
              onChange={(event) => onAcceptedChange?.(event.target.checked)}
              style={{ marginTop: "2px", accentColor: "var(--ide-shell-accent)" }}
            />
            <span>
              I understand that while Sync is ON, WasmForge can edit files inside the selected folder.
            </span>
          </label>
        </div>

        <div
          style={{
            padding: "14px 20px",
            display: "flex",
            justifyContent: "flex-end",
            gap: "10px",
            borderTop: "1px solid var(--ide-shell-border)",
            background: "color-mix(in srgb, var(--ide-shell-bg) 34%, transparent)",
          }}
        >
          <button type="button" onClick={onCancel} style={dialogSecondaryButtonStyle()}>
            Stay sandboxed
          </button>
          <button
            type="submit"
            disabled={!accepted}
            style={dialogPrimaryButtonStyle({ disabled: !accepted })}
          >
            Continue to browser permission
          </button>
        </div>
      </form>
    </div>
  );
}

function HostBridgeSecurityPrompt({
  open,
  bridgeUrl,
  confirmationValue,
  onConfirmationChange,
  onCancel,
  onConfirm,
}) {
  if (!open) {
    return null;
  }

  const canConfirm = confirmationValue.trim().toUpperCase() === "CONNECT";

  return (
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        display: "grid",
        placeItems: "center",
        padding: "24px",
        background: "color-mix(in srgb, var(--ide-shell-bg) 78%, transparent)",
        backdropFilter: "blur(14px)",
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="host-bridge-security-title"
        aria-describedby="host-bridge-security-body"
        onSubmit={(event) => {
          event.preventDefault();
          if (canConfirm) {
            onConfirm?.();
          }
        }}
        style={{
          width: "min(560px, 100%)",
          border: "1px solid color-mix(in srgb, var(--ide-shell-danger) 42%, var(--ide-shell-border))",
          borderRadius: "18px",
          background: "linear-gradient(145deg, var(--ide-shell-panel), var(--ide-shell-elevated))",
          color: "var(--ide-shell-text)",
          boxShadow: "0 28px 80px color-mix(in srgb, #000 52%, transparent), inset 0 1px 0 rgba(255,255,255,0.05)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "18px 20px",
            borderBottom: "1px solid var(--ide-shell-border)",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: "34px",
              height: "34px",
              borderRadius: "10px",
              display: "grid",
              placeItems: "center",
              background: "color-mix(in srgb, var(--ide-shell-danger) 16%, transparent)",
              color: "var(--ide-shell-danger)",
              fontFamily: '"Cascadia Code", Consolas, monospace',
              fontWeight: 800,
            }}
          >
            !
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              id="host-bridge-security-title"
              style={{
                fontSize: "16px",
                fontWeight: 800,
                letterSpacing: "0.02em",
              }}
            >
              Host Bridge Security Check
            </div>
            <div style={{ color: "var(--ide-shell-muted)", fontSize: "12px", marginTop: "3px" }}>
              Browser sandbox stays active unless you approve this local bridge.
            </div>
          </div>
        </div>

        <div id="host-bridge-security-body" style={{ padding: "20px", display: "grid", gap: "14px" }}>
          <p style={{ margin: 0, color: "var(--ide-shell-text-soft)", lineHeight: 1.55, fontSize: "13px" }}>
            Host Bridge connects WasmForge to a local server at <strong>{bridgeUrl}</strong>. It can detect
            installed toolchains and run supported files through your operating system permissions.
          </p>

          <div
            style={{
              display: "grid",
              gap: "8px",
              padding: "12px",
              borderRadius: "12px",
              background: "color-mix(in srgb, var(--ide-shell-danger) 10%, transparent)",
              border: "1px solid color-mix(in srgb, var(--ide-shell-danger) 30%, transparent)",
              color: "var(--ide-shell-text-soft)",
              fontSize: "12px",
              lineHeight: 1.45,
            }}
          >
            <strong style={{ color: "var(--ide-shell-danger)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Only continue if:
            </strong>
            <span>You started the bridge yourself with <code>npm run bridge</code>.</span>
            <span>You trust the current workspace code.</span>
            <span>You understand host execution is more powerful than browser-only WasmForge.</span>
          </div>

          <label style={{ display: "grid", gap: "8px", color: "var(--ide-shell-muted)", fontSize: "12px" }}>
            Type <strong style={{ color: "var(--ide-shell-text)" }}>CONNECT</strong> to allow local toolchain detection.
            <input
              autoFocus
              value={confirmationValue}
              onChange={(event) => onConfirmationChange?.(event.target.value)}
              placeholder="CONNECT"
              style={{
                height: "38px",
                border: "1px solid var(--ide-shell-border-strong)",
                borderRadius: "10px",
                padding: "0 12px",
                background: "var(--ide-shell-bg)",
                color: "var(--ide-shell-text)",
                outline: "none",
                fontFamily: '"Cascadia Code", Consolas, monospace',
                fontSize: "13px",
                letterSpacing: "0.08em",
              }}
            />
          </label>
        </div>

        <div
          style={{
            padding: "14px 20px",
            display: "flex",
            justifyContent: "flex-end",
            gap: "10px",
            borderTop: "1px solid var(--ide-shell-border)",
            background: "color-mix(in srgb, var(--ide-shell-bg) 34%, transparent)",
          }}
        >
          <button type="button" onClick={onCancel} style={dialogSecondaryButtonStyle()}>
            Keep sandboxed
          </button>
          <button
            type="submit"
            disabled={!canConfirm}
            style={dialogDangerButtonStyle({ disabled: !canConfirm })}
          >
            I understand, connect
          </button>
        </div>
      </form>
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
    <div
      className="wf-tab"
      style={{
        height: "32px",
        minWidth: "132px",
        maxWidth: "228px",
        border: "none",
        borderTop: `1px solid ${active ? "var(--ide-shell-accent)" : "transparent"}`,
        borderRight: "1px solid var(--ide-shell-border)",
        background: active ? "var(--ide-shell-panel)" : "var(--ide-shell-elevated)",
        color: active ? "var(--ide-shell-text)" : "var(--ide-shell-text-soft)",
        display: "flex",
        alignItems: "center",
        flexShrink: 0,
      }}
    >
      <button
        type="button"
        onClick={onSelect}
        style={{
          flex: 1,
          minWidth: 0,
          border: "none",
          background: "transparent",
          color: "inherit",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "0 0 0 12px",
          cursor: "pointer",
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
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label={`Close ${filename}`}
        title={`Close ${filename}`}
        style={{
          color: active ? "var(--ide-shell-text-soft)" : "var(--ide-shell-muted)",
          fontSize: "12px",
          lineHeight: 1,
          width: "24px",
          height: "100%",
          display: "grid",
          placeItems: "center",
          border: "none",
          borderRadius: "3px",
          background: active ? "var(--ide-shell-accent-soft)" : "transparent",
          cursor: "pointer",
          flexShrink: 0,
          marginRight: "4px",
        }}
      >
        ×
      </button>
    </div>
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
    <div
      className="wf-mobile-tab"
      style={{
        height: "100%",
        minWidth: "124px",
        maxWidth: "186px",
        border: "none",
        borderTop: `2px solid ${active ? "var(--ide-shell-accent)" : "transparent"}`,
        background: active ? "var(--ide-shell-panel)" : "var(--ide-shell-elevated)",
        color: active ? "var(--ide-shell-text)" : "var(--ide-shell-text-soft)",
        display: "flex",
        alignItems: "center",
        flexShrink: 0,
      }}
    >
      <button
        type="button"
        onClick={onSelect}
        style={{
          flex: 1,
          minWidth: 0,
          border: "none",
          background: "transparent",
          color: "inherit",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "0 0 0 12px",
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
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label={`Close ${filename}`}
        title={`Close ${filename}`}
        style={{
          width: "24px",
          height: "100%",
          display: "grid",
          placeItems: "center",
          border: "none",
          borderRadius: "3px",
          color: active ? "var(--ide-shell-text-soft)" : "var(--ide-shell-muted)",
          background: active ? "var(--ide-shell-accent-soft)" : "transparent",
          flexShrink: 0,
          cursor: "pointer",
          marginRight: "4px",
        }}
      >
        ×
      </button>
    </div>
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

function FolderBridgeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.25 5h3.55l1 1.15h6.95v5.6a1 1 0 0 1-1 1h-9.5a1 1 0 0 1-1-1V5Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M5.15 9.1h5.7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <path d="m8.65 7.45 1.9 1.65-1.9 1.65" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function HostBridgeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2.25" y="3.25" width="11.5" height="9.5" rx="1.25" stroke="currentColor" strokeWidth="1.1" />
      <path d="M5.1 6.2 7 8l-1.9 1.8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.6 6.2 10.5 8l-1.9 1.8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.1 12.2h3.8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m4.25 4.25 7.5 7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="m11.75 4.25-7.5 7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
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

function AirlockConflictCenter({
  items = [],
  message = "",
  compareFile = "",
  snapshots = [],
  busy = false,
  unresolvedCount = 0,
  onApplySafe,
  onFinish,
  onResolve,
  onCompare,
  onRestoreSnapshot,
  onClose,
}) {
  const safeCount = items.filter((item) =>
    !item.resolved && (item.status === AIRLOCK_STATUS_LOCAL || item.status === AIRLOCK_STATUS_DISK),
  ).length;
  const conflictCount = items.filter((item) => !item.resolved && item.status === AIRLOCK_STATUS_CONFLICT).length;
  const visibleItems = items.filter((item) => item.status !== AIRLOCK_STATUS_UNCHANGED || item.resolved);
  const compareItem = items.find((item) => item.name === compareFile);

  return (
    <section
      style={{
        flexShrink: 0,
        border: "1px solid color-mix(in srgb, var(--ide-shell-accent) 24%, var(--ide-shell-border))",
        borderRadius: "4px",
        background: "linear-gradient(180deg, color-mix(in srgb, var(--ide-shell-panel) 96%, var(--ide-shell-accent) 4%), var(--ide-shell-panel-strong))",
        marginBottom: "8px",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          minHeight: "40px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          padding: "8px 12px",
          borderBottom: "1px solid var(--ide-shell-border)",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "var(--ide-shell-text)", fontSize: "12px", fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}>
            Airlock Conflict Center
          </div>
          <div style={{ marginTop: "4px", color: "var(--ide-shell-muted)", fontSize: "12px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {message || "Resolve detached workspace changes before writing to disk again."}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          <span style={airlockMetricStyle(conflictCount > 0 ? "danger" : "idle")}>
            {conflictCount} conflict{conflictCount === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            onClick={onApplySafe}
            disabled={busy || safeCount === 0}
            style={airlockPanelButtonStyle({ disabled: busy || safeCount === 0 })}
          >
            Apply Safe
          </button>
          <button
            type="button"
            onClick={onFinish}
            disabled={busy || unresolvedCount > 0}
            style={airlockPanelButtonStyle({
              tone: "success",
              disabled: busy || unresolvedCount > 0,
            })}
          >
            Resume Sync ON
          </button>
          <button
            type="button"
            aria-label="Close Airlock Center"
            onClick={onClose}
            style={terminalIconButtonStyle()}
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: snapshots.length > 0 ? "minmax(0, 1fr) 240px" : "minmax(0, 1fr)", minHeight: "96px" }}>
        <div style={{ padding: "10px 12px", minWidth: 0 }}>
          {visibleItems.length === 0 ? (
            <div style={{ color: "var(--ide-shell-muted)", fontSize: "12px", lineHeight: 1.7 }}>
              No conflicts are pending. Snapshots still let you roll back the detached workspace for the demo.
            </div>
          ) : (
            <div style={{ display: "grid", gap: "6px" }}>
              {visibleItems.map((item) => (
                <div
                  key={item.name}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto",
                    alignItems: "center",
                    gap: "10px",
                    padding: "8px",
                    border: "1px solid var(--ide-shell-border)",
                    background: "color-mix(in srgb, var(--ide-shell-elevated) 78%, transparent)",
                    borderRadius: "4px",
                  }}
                >
                  <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={airlockStatusBadgeStyle(item.status)}>{getAirlockStatusLabel(item.status, item.resolution)}</span>
                    <span style={{ color: "var(--ide-shell-text)", fontFamily: '"Cascadia Code", Consolas, monospace', fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.name}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    {item.status === AIRLOCK_STATUS_CONFLICT ? (
                      <button type="button" onClick={() => onCompare?.(item.name)} style={airlockMiniButtonStyle()}>
                        Compare
                      </button>
                    ) : null}
                    {!item.resolved ? (
                      <>
                        <button type="button" onClick={() => onResolve?.(item, "local")} style={airlockMiniButtonStyle({ tone: "success" })}>
                          Keep Local
                        </button>
                        <button type="button" onClick={() => onResolve?.(item, "disk")} style={airlockMiniButtonStyle()}>
                          Keep Disk
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}

          {compareItem ? (
            <div style={{ marginTop: "10px", display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "8px" }}>
              <AirlockComparePane label="Local Shadow" content={compareItem.localContent} />
              <AirlockComparePane label="Disk Version" content={compareItem.diskContent} />
            </div>
          ) : null}
        </div>

        {snapshots.length > 0 ? (
          <aside
            style={{
              borderLeft: "1px solid var(--ide-shell-border)",
              padding: "10px",
              minWidth: 0,
              background: "color-mix(in srgb, var(--ide-shell-elevated) 82%, transparent)",
            }}
          >
            <div style={{ color: "var(--ide-shell-muted)", fontSize: "10px", fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase" }}>
              Local Snapshots
            </div>
            <div style={{ display: "grid", gap: "6px", marginTop: "8px", maxHeight: "180px", overflow: "auto" }}>
              {snapshots.map((snapshot) => (
                <button
                  key={snapshot.id}
                  type="button"
                  onClick={() => onRestoreSnapshot?.(snapshot)}
                  disabled={busy}
                  style={{
                    border: "1px solid var(--ide-shell-border)",
                    background: "var(--ide-shell-panel)",
                    color: "var(--ide-shell-text)",
                    borderRadius: "4px",
                    padding: "7px",
                    textAlign: "left",
                    cursor: busy ? "not-allowed" : "pointer",
                    opacity: busy ? 0.62 : 1,
                  }}
                >
                  <span style={{ display: "block", fontSize: "11px", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {snapshot.label}
                  </span>
                  <span style={{ display: "block", marginTop: "3px", color: "var(--ide-shell-muted)", fontSize: "10px" }}>
                    {snapshot.fileCount ?? (Array.isArray(snapshot.files) ? snapshot.files.length : Object.keys(snapshot.files || {}).length)} files • {formatAirlockSnapshotTime(snapshot.createdAt)}
                  </span>
                </button>
              ))}
            </div>
          </aside>
        ) : null}
      </div>
    </section>
  );
}

function AirlockComparePane({ label, content }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ color: "var(--ide-shell-muted)", fontSize: "10px", fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: "5px" }}>
        {label}
      </div>
      <pre
        style={{
          margin: 0,
          maxHeight: "180px",
          overflow: "auto",
          padding: "9px",
          border: "1px solid var(--ide-shell-border)",
          borderRadius: "4px",
          background: "var(--ide-shell-editor-bg)",
          color: content === null ? "var(--ide-shell-muted)" : "var(--ide-shell-text-soft)",
          fontFamily: '"Cascadia Code", Consolas, monospace',
          fontSize: "11px",
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
        }}
      >
        {content === null ? "[file deleted]" : content}
      </pre>
    </div>
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

function getAirlockStatusLabel(status, resolution = "") {
  switch (status) {
    case AIRLOCK_STATUS_LOCAL:
      return "Local changed";
    case AIRLOCK_STATUS_DISK:
      return "Disk changed";
    case AIRLOCK_STATUS_CONFLICT:
      return "Conflict";
    case AIRLOCK_STATUS_RESOLVED:
      return resolution === "disk" ? "Resolved: disk" : "Resolved: local";
    default:
      return "Unchanged";
  }
}

function airlockStatusBadgeStyle(status) {
  const color =
    status === AIRLOCK_STATUS_CONFLICT
      ? "var(--ide-shell-danger)"
      : status === AIRLOCK_STATUS_LOCAL || status === AIRLOCK_STATUS_RESOLVED
        ? "var(--ide-shell-success)"
        : status === AIRLOCK_STATUS_DISK
          ? "var(--ide-shell-warning)"
          : "var(--ide-shell-muted)";

  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "3px 6px",
    borderRadius: "3px",
    border: `1px solid color-mix(in srgb, ${color} 34%, transparent)`,
    background: `color-mix(in srgb, ${color} 11%, transparent)`,
    color,
    fontSize: "10px",
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  };
}

function airlockPanelButtonStyle({ tone = "idle", disabled = false } = {}) {
  const color = tone === "success" ? "var(--ide-shell-success)" : "var(--ide-shell-text)";

  return {
    border: `1px solid ${tone === "success" ? "color-mix(in srgb, var(--ide-shell-success) 32%, transparent)" : "var(--ide-shell-border)"}`,
    background: tone === "success"
      ? "color-mix(in srgb, var(--ide-shell-success) 12%, var(--ide-shell-panel))"
      : "var(--ide-shell-panel)",
    color: disabled ? "var(--ide-shell-muted-strong)" : color,
    borderRadius: "3px",
    height: "28px",
    padding: "0 9px",
    fontSize: "11px",
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.58 : 1,
  };
}

function airlockMiniButtonStyle({ tone = "idle" } = {}) {
  const color = tone === "success" ? "var(--ide-shell-success)" : "var(--ide-shell-text-soft)";

  return {
    border: "1px solid var(--ide-shell-border)",
    background: "var(--ide-shell-panel)",
    color,
    borderRadius: "3px",
    padding: "4px 7px",
    fontSize: "10px",
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}

function airlockMetricStyle(tone = "idle") {
  const color = tone === "danger" ? "var(--ide-shell-danger)" : "var(--ide-shell-muted)";

  return {
    color,
    border: `1px solid color-mix(in srgb, ${color} 26%, transparent)`,
    background: `color-mix(in srgb, ${color} 9%, transparent)`,
    borderRadius: "999px",
    padding: "5px 8px",
    fontSize: "10px",
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  };
}

function dialogSecondaryButtonStyle() {
  return {
    height: "34px",
    border: "1px solid var(--ide-shell-border-strong)",
    borderRadius: "8px",
    background: "var(--ide-shell-panel)",
    color: "var(--ide-shell-text)",
    padding: "0 12px",
    fontSize: "12px",
    fontWeight: 800,
    letterSpacing: "0.04em",
    cursor: "pointer",
  };
}

function dialogPrimaryButtonStyle({ disabled = false } = {}) {
  return {
    height: "34px",
    border: disabled
      ? "1px solid var(--ide-shell-border-strong)"
      : "1px solid color-mix(in srgb, var(--ide-shell-accent) 42%, transparent)",
    borderRadius: "8px",
    background: disabled
      ? "var(--ide-shell-panel)"
      : "color-mix(in srgb, var(--ide-shell-accent) 18%, var(--ide-shell-panel))",
    color: disabled ? "var(--ide-shell-muted-strong)" : "var(--ide-shell-accent)",
    padding: "0 12px",
    fontSize: "12px",
    fontWeight: 900,
    letterSpacing: "0.04em",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.62 : 1,
  };
}

function dialogDangerButtonStyle({ disabled = false } = {}) {
  return {
    height: "34px",
    border: disabled
      ? "1px solid var(--ide-shell-border-strong)"
      : "1px solid color-mix(in srgb, var(--ide-shell-danger) 50%, transparent)",
    borderRadius: "8px",
    background: disabled
      ? "var(--ide-shell-panel)"
      : "color-mix(in srgb, var(--ide-shell-danger) 22%, var(--ide-shell-panel))",
    color: disabled ? "var(--ide-shell-muted-strong)" : "var(--ide-shell-danger)",
    padding: "0 12px",
    fontSize: "12px",
    fontWeight: 900,
    letterSpacing: "0.04em",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.62 : 1,
  };
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

function terminalIconButtonStyle() {
  return {
    width: "28px",
    height: "28px",
    display: "grid",
    placeItems: "center",
    border: "1px solid color-mix(in srgb, var(--ide-shell-border-strong) 30%, transparent)",
    background: "var(--ide-shell-panel)",
    color: "var(--ide-shell-muted)",
    cursor: "pointer",
    padding: 0,
    borderRadius: "3px",
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

function headerIconButtonStyle(active = false) {
  return {
    width: "28px",
    height: "28px",
    display: "grid",
    placeItems: "center",
    border: active
      ? "1px solid color-mix(in srgb, var(--ide-shell-accent) 30%, transparent)"
      : "1px solid color-mix(in srgb, var(--ide-shell-border-strong) 46%, transparent)",
    borderRadius: "3px",
    background: active
      ? "color-mix(in srgb, var(--ide-shell-accent) 12%, var(--ide-shell-panel))"
      : "var(--ide-shell-panel)",
    color: active ? "var(--ide-shell-accent)" : "var(--ide-shell-text)",
    cursor: "pointer",
    padding: 0,
    flexShrink: 0,
  };
}

function headerTextButtonStyle({ active = false, disabled = false } = {}) {
  return {
    height: "28px",
    border: active
      ? "1px solid color-mix(in srgb, var(--ide-shell-accent) 32%, transparent)"
      : "1px solid color-mix(in srgb, var(--ide-shell-border-strong) 46%, transparent)",
    borderRadius: "3px",
    background: active
      ? "color-mix(in srgb, var(--ide-shell-accent) 12%, var(--ide-shell-panel))"
      : "var(--ide-shell-panel)",
    color: active ? "var(--ide-shell-accent)" : "var(--ide-shell-text)",
    padding: "0 10px",
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "0.05em",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.56 : 1,
    flexShrink: 0,
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

function localFolderButtonStyle({ active = false, linked = false, disabled = false } = {}) {
  const color = active
    ? "var(--ide-shell-success)"
    : linked
      ? "var(--ide-shell-warning)"
      : "var(--ide-shell-text)";

  return {
    height: "28px",
    display: "inline-flex",
    alignItems: "center",
    gap: "7px",
    padding: "0 11px",
    borderRadius: "3px",
    border: active
      ? "1px solid color-mix(in srgb, var(--ide-shell-success) 38%, transparent)"
      : linked
        ? "1px solid color-mix(in srgb, var(--ide-shell-warning) 38%, transparent)"
      : "1px solid color-mix(in srgb, var(--ide-shell-border-strong) 46%, transparent)",
    background: active
      ? "color-mix(in srgb, var(--ide-shell-success) 13%, var(--ide-shell-panel))"
      : linked
        ? "color-mix(in srgb, var(--ide-shell-warning) 12%, var(--ide-shell-panel))"
      : "var(--ide-shell-panel)",
    color,
    fontSize: "12px",
    fontWeight: 700,
    letterSpacing: "0.04em",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.56 : 1,
    flexShrink: 0,
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
    case "c":
    case "h":
      return { label: "C", accent: "var(--ide-file-ts-accent)", surface: "var(--ide-file-ts-surface)" };
    case "cc":
    case "cpp":
    case "cxx":
    case "hh":
    case "hpp":
    case "hxx":
      return { label: "C++", accent: "var(--ide-file-js-accent)", surface: "var(--ide-file-js-surface)" };
    case "go":
      return { label: "GO", accent: "var(--ide-file-ts-accent)", surface: "var(--ide-file-ts-surface)" };
    case "java":
      return { label: "JV", accent: "var(--ide-file-pg-accent)", surface: "var(--ide-file-pg-surface)" };
    case "py":
      return { label: "PY", accent: "var(--ide-file-py-accent)", surface: "var(--ide-file-py-surface)" };
    case "js":
      return { label: "JS", accent: "var(--ide-file-js-accent)", surface: "var(--ide-file-js-surface)" };
    case "rs":
      return { label: "RS", accent: "var(--ide-file-pg-accent)", surface: "var(--ide-file-pg-surface)" };
    case "ts":
      return { label: "TS", accent: "var(--ide-file-ts-accent)", surface: "var(--ide-file-ts-surface)" };
    case "sql":
      return { label: "SQL", accent: "var(--ide-file-sql-accent)", surface: "var(--ide-file-sql-surface)" };
    case "pg":
      return { label: "PG", accent: "var(--ide-file-pg-accent)", surface: "var(--ide-file-pg-surface)" };
    case "wfnb":
      return { label: "NB", accent: "var(--ide-file-py-accent)", surface: "var(--ide-file-py-surface)" };
    case "zig":
      return { label: "ZG", accent: "var(--ide-file-sql-accent)", surface: "var(--ide-file-sql-surface)" };
    default:
      return { label: "TXT", accent: "var(--ide-file-txt-accent)", surface: "var(--ide-file-txt-surface)" };
  }
}
