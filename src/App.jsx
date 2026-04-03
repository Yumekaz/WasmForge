import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import Terminal from "./components/Terminal.jsx";
import FileTree from "./components/FileTree.jsx";
import SqlResultsPanel from "./components/SqlResultsPanel.jsx";
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

const DEFAULT_FILENAME = "main.py";
const DEFAULT_WORKSPACE_NAME = "python-experiments";
const ACTIVE_WORKSPACE_STORAGE_KEY = "wasmforge:active-workspace";
const RECOVERY_STORAGE_KEY_PREFIX = "wasmforge:pending-workspace-writes";
const MOBILE_LAYOUT_BREAKPOINT = 960;
const ACTIVITY_BAR_WIDTH = 40;
const DEFAULT_SIDEBAR_WIDTH = 280;
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 420;
const SIDEBAR_RESIZE_HANDLE_WIDTH = 6;
const TOP_HEADER_HEIGHT = 60;
const STATUS_BAR_HEIGHT = 22;
const BOTTOM_TABBAR_HEIGHT = 35;
const EDITOR_SPLIT_HANDLE_HEIGHT = 6;
const MIN_EDITOR_PANEL_HEIGHT = 220;
const MIN_TERMINAL_PANEL_HEIGHT = 160;
const DEFAULT_EDITOR_RATIO = 0.65;
const Editor = lazy(() => import("./components/Editor.jsx"));

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

function getRuntimePresentation(runtime) {
  switch (runtime) {
    case "python":
      return { label: "Python", accent: "#9ac7ab", bg: "rgba(25, 42, 33, 0.82)", border: "rgba(84, 112, 94, 0.34)" };
    case "javascript":
      return { label: "JS", accent: "#d3bc86", bg: "rgba(50, 40, 18, 0.82)", border: "rgba(115, 96, 55, 0.34)" };
    case "sqlite":
      return { label: "SQL", accent: "#9cb8d5", bg: "rgba(22, 34, 48, 0.84)", border: "rgba(87, 108, 132, 0.34)" };
    case "pglite":
      return { label: "SQL", accent: "#9cc7b0", bg: "rgba(20, 37, 29, 0.84)", border: "rgba(84, 110, 94, 0.34)" };
    default:
      return { label: "Text", accent: "#a5afbb", bg: "rgba(26, 32, 41, 0.86)", border: "rgba(104, 115, 129, 0.3)" };
  }
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
    return "#f48771";
  }
  if (activeRuntime === "python" && isAwaitingInput) {
    return "#dcdcaa";
  }
  if (activeRuntimeRunning) {
    return "#d7ba7d";
  }
  if (activeRuntimeReady) {
    return "#3fb950";
  }
  if (!activeStatusMessage) {
    return "#858585";
  }
  return "#858585";
}

export default function App() {
  const [files, setFiles] = useState([]);
  const [activeFile, setActiveFile] = useState(DEFAULT_FILENAME);
  const [openFiles, setOpenFiles] = useState([]);
  const [status, setStatus] = useState("Loading workspace...");
  const [sqlExecution, setSqlExecution] = useState(createEmptySqlExecution);
  const [workspaces, setWorkspaces] = useState([]);
  const [activeWorkspace, setActiveWorkspace] = useState(readPersistedActiveWorkspace);
  const [workspaceBootstrapped, setWorkspaceBootstrapped] = useState(false);
  const [editorPaneHeight, setEditorPaneHeight] = useState(null);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [sidebarMode, setSidebarMode] = useState("explorer");
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  const [bottomPanelMode, setBottomPanelMode] = useState("terminal");
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
  const recoveryWritesRef = useRef(readRecoveryEntries(activeWorkspace));

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
    (error) => {
      terminalRef.current?.cancelInput({ newline: false });
      refreshWorkspaceFiles(activeFileRef.current, {
        workspaceName: activeWorkspaceRef.current,
      }).catch((refreshError) => {
        reportWorkspaceError(
          `[WasmForge] Failed to refresh workspace: ${refreshError.message || refreshError}`,
        );
      });

      if (error && error !== "Killed by user" && !error.startsWith("Timeout")) {
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

  const handleWorkspaceSelect = useCallback(async (workspaceName) => {
    if (workspaceName === activeWorkspaceRef.current) {
      return;
    }

    await prepareWorkspaceMutation("switching workspaces");
    setSqlExecution(createEmptySqlExecution());
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
  const showResultsPanel = activeRuntime === "sqlite" || activeRuntime === "pglite";
  const activeSqlResult = sqlExecution.filename === activeFile ? sqlExecution : null;
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
  const activeStatusMessage =
    activeRuntime === "sqlite"
      ? sqliteStatus
      : activeRuntime === "pglite"
        ? pgliteStatus
        : activeRuntime === "javascript"
          ? jsStatus
          : activeRuntime === "unknown"
            ? files.length === 0
              ? "Create a file to begin"
              : "Unsupported file type"
            : status;
  const activeHasError =
    activeRuntime === "python"
      ? status === "Error"
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

  useEffect(() => {
    setBottomPanelMode(showResultsPanel ? "output" : "terminal");
  }, [activeFile, showResultsPanel]);

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
    if (isMobileLayout && mobilePane !== "output") {
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
  const terminalVisible = bottomPanelMode === "terminal" && (!isMobileLayout || mobilePane === "output");
  const outputVisible = bottomPanelMode === "output" && (!isMobileLayout || mobilePane === "output");
  const editorPaneStyle =
    isMobileLayout || editorPaneHeight === null
      ? { flex: `${DEFAULT_EDITOR_RATIO} 1 0%` }
      : { flex: `0 0 ${editorPaneHeight}px` };
  const runButtonDisabled = isAnyRuntimeBusy || activeRuntime === "unknown" || !activeRuntimeReady;
  const desktopNavWidth = ACTIVITY_BAR_WIDTH + sidebarWidth;

  const filesPanel = (
    <FileTree
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
        background: "#1e1e1e",
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
                color: "#858585",
                fontSize: "13px",
                background: "#1e1e1e",
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
        background: "#14171c",
      }}
    >
      <div
        style={{
          height: `${BOTTOM_TABBAR_HEIGHT}px`,
          display: "flex",
          alignItems: "stretch",
          justifyContent: "space-between",
          borderBottom: "1px solid rgba(255,255,255,0.04)",
          background: "#1a1c21",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "stretch" }}>
          <BottomPanelTab active={bottomPanelMode === "terminal"} onClick={() => setBottomPanelMode("terminal")}>
            TERMINAL
          </BottomPanelTab>
          <BottomPanelTab active={bottomPanelMode === "output"} onClick={() => setBottomPanelMode("output")}>
            OUTPUT
          </BottomPanelTab>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "0 12px" }}>
          <button
            type="button"
            onClick={() => {
              if (bottomPanelMode === "output" && showResultsPanel) {
                setSqlExecution(createEmptySqlExecution());
                return;
              }
              terminalRef.current?.clear?.();
            }}
            style={terminalActionButtonStyle()}
          >
            Clear
          </button>
          {canKillActiveRuntime && activeRuntimeRunning ? (
            <button type="button" onClick={handleKill} style={terminalActionButtonStyle({ color: "#f48771" })}>
              Kill
            </button>
          ) : null}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, position: "relative", background: "#111317" }}>
        <div style={{ display: terminalVisible ? "block" : "none", height: "100%" }}>
          <Terminal ref={terminalRef} isVisible={terminalVisible} />
        </div>
        <div style={{ display: outputVisible ? "block" : "none", height: "100%" }}>
          {showResultsPanel ? (
            <SqlResultsPanel
              activeFile={activeFile}
              engine={activeRuntime}
              result={activeSqlResult}
              isReady={activeRuntimeReady}
              isRunning={activeRuntimeRunning}
              status={activeStatusMessage}
              schema={activeSqlResult?.schema}
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
      style={{
        minHeight: "100dvh",
        height: "100dvh",
        overflow: "hidden",
        background: "#111317",
        color: "#d4d4d4",
        fontFamily: '"Segoe UI Variable Text", "Segoe UI", sans-serif',
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          height: `${TOP_HEADER_HEIGHT}px`,
          minHeight: `${TOP_HEADER_HEIGHT}px`,
          display: "flex",
          flexDirection: "column",
          background: "#1a1c21",
          borderBottom: "1px solid #111317",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "14px",
            height: "28px",
            minHeight: "28px",
            padding: "0 12px",
            borderBottom: "1px solid rgba(255,255,255,0.04)",
            background: "#1b1d22",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0, flexShrink: 0 }}>
            <LogoMark />
            <div style={{ color: "#ffffff", fontSize: "13px", fontWeight: 600, whiteSpace: "nowrap" }}>WasmForge</div>
            {!isMobileLayout ? (
              <div style={{ color: "#6e7681", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.12em" }}>
                Local IDE
              </div>
            ) : null}
          </div>

          {!isMobileLayout ? (
            <div style={{ display: "flex", alignItems: "center", gap: "14px", color: "#9aa3ae", fontSize: "11px", flexShrink: 0 }}>
              <ToolbarMenuLabel>File</ToolbarMenuLabel>
              <ToolbarMenuLabel>Edit</ToolbarMenuLabel>
              <ToolbarMenuLabel>Selection</ToolbarMenuLabel>
              <ToolbarMenuLabel>Terminal</ToolbarMenuLabel>
              <ToolbarMenuLabel>Help</ToolbarMenuLabel>
            </div>
          ) : null}

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

          {!isMobileLayout ? (
            <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "#666d76", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em", flexShrink: 0 }}>
              <span>Project</span>
              <span style={{ color: "#1997ff", fontWeight: 700, letterSpacing: "0.04em", textTransform: "none", fontSize: "11px", maxWidth: "180px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {activeWorkspace}
              </span>
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "stretch",
            minHeight: "31px",
            background: "#1a1c21",
          }}
        >
          {!isMobileLayout ? (
            <div
              style={{
                width: `${desktopNavWidth}px`,
                minWidth: `${desktopNavWidth}px`,
                borderRight: "1px solid rgba(255,255,255,0.04)",
                background: "#1a1c21",
              }}
            />
          ) : null}

          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "stretch",
              overflowX: "auto",
              scrollbarWidth: "thin",
            }}
          >
            {fileTabs.length === 0 ? (
              <div style={{ padding: "0 12px", color: "#737b86", fontSize: "12px", display: "flex", alignItems: "center" }}>
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
              padding: "0 12px",
              flexShrink: 0,
              borderLeft: "1px solid rgba(255,255,255,0.04)",
              background: "#1a1c21",
            }}
          >
            <button type="button" onClick={handleRun} disabled={runButtonDisabled} style={runButtonStyle(runButtonDisabled)}>
              ▶ Run
            </button>
          </div>
        </div>
      </div>

      {isMobileLayout ? (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <div
            style={{
              height: "34px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "0 10px",
              background: "#171b21",
              borderBottom: "1px solid rgba(255,255,255,0.04)",
              flexShrink: 0,
            }}
          >
            <MobilePaneButton active={mobilePane === "files"} onClick={() => setMobilePane("files")}>
              Explorer
            </MobilePaneButton>
            <MobilePaneButton active={mobilePane === "editor"} onClick={() => setMobilePane("editor")}>
              Editor
            </MobilePaneButton>
            <MobilePaneButton active={mobilePane === "output"} onClick={() => setMobilePane("output")}>
              {bottomPanelMode === "output" ? "Output" : "Terminal"}
            </MobilePaneButton>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            <div style={{ display: mobilePane === "files" ? "block" : "none", height: "100%" }}>{filesPanel}</div>
            <div style={{ display: mobilePane === "editor" ? "block" : "none", height: "100%" }}>{editorPanel}</div>
            <div style={{ display: mobilePane === "output" ? "block" : "none", height: "100%" }}>{outputPanel}</div>
          </div>
        </div>
      ) : (
        <div ref={desktopLayoutRef} style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
          <div
            style={{
              width: `${ACTIVITY_BAR_WIDTH}px`,
              background: "#17191d",
              borderRight: "1px solid rgba(255,255,255,0.04)",
              display: "flex",
              flexDirection: "column",
              alignItems: "stretch",
              paddingTop: "10px",
              flexShrink: 0,
            }}
          >
            <ActivityButton active={sidebarMode === "explorer"} title="Explorer" onClick={() => setSidebarMode("explorer")}>
              <ExplorerIcon />
            </ActivityButton>
            <ActivityButton active={sidebarMode === "search"} title="Search" onClick={() => setSidebarMode("search")}>
              <SearchIcon />
            </ActivityButton>
          </div>

          <div
            style={{
              width: `${sidebarWidth}px`,
              background: "#17191d",
              borderRight: "1px solid rgba(255,255,255,0.04)",
              minWidth: 0,
              flexShrink: 0,
            }}
          >
            {filesPanel}
          </div>

          <VerticalResizeHandle onPointerDown={startResize("sidebar")} />

          <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <div ref={shellBodyRef} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              <div style={{ ...editorPaneStyle, minHeight: MIN_EDITOR_PANEL_HEIGHT, minWidth: 0 }}>
                {editorPanel}
              </div>
              <HorizontalResizeHandle onPointerDown={startResize("editor-terminal")} />
              <div style={{ flex: 1, minHeight: MIN_TERMINAL_PANEL_HEIGHT, minWidth: 0 }}>
                {outputPanel}
              </div>
            </div>
          </div>
        </div>
      )}

      <div
        style={{
          height: `${STATUS_BAR_HEIGHT}px`,
          minHeight: `${STATUS_BAR_HEIGHT}px`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          padding: "0 10px",
          background: "#007acc",
          color: "#ffffff",
          fontSize: "12px",
          borderTop: "1px solid rgba(255,255,255,0.1)",
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
                height: "8px",
                borderRadius: "999px",
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
    </div>
  );
}

function HorizontalResizeHandle({ onPointerDown }) {
  return (
    <div
      onPointerDown={onPointerDown}
      style={{
        height: `${EDITOR_SPLIT_HANDLE_HEIGHT}px`,
        flexShrink: 0,
        cursor: "row-resize",
        background: "#15181d",
        display: "grid",
        placeItems: "center",
      }}
    >
      <div style={{ width: "48px", height: "1px", background: "#2a2f36" }} />
    </div>
  );
}

function VerticalResizeHandle({ onPointerDown }) {
  return (
    <div
      onPointerDown={onPointerDown}
      style={{
        width: `${SIDEBAR_RESIZE_HANDLE_WIDTH}px`,
        flexShrink: 0,
        cursor: "col-resize",
        background: "#15181d",
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
          background: "rgba(255,255,255,0.05)",
        }}
      />
    </div>
  );
}

function ActivityButton({ active = false, children, disabled = false, title, onClick }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        height: "40px",
        border: "none",
        borderLeft: `2px solid ${active ? "#007acc" : "transparent"}`,
        background: active ? "rgba(255,255,255,0.03)" : "transparent",
        color: active ? "#ffffff" : "#858585",
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
      type="button"
      onClick={onSelect}
      style={{
        height: "31px",
        minWidth: "124px",
        maxWidth: "220px",
        padding: "0 10px",
        border: "none",
        borderTop: `1px solid ${active ? "#007acc" : "transparent"}`,
        borderRight: "1px solid rgba(255,255,255,0.035)",
        background: active ? "#1e2127" : "#1a1c21",
        color: active ? "#ffffff" : "#b8bec6",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        cursor: "pointer",
        flexShrink: 0,
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
          fontFamily: '"Cascadia Code", Consolas, monospace',
          fontSize: "12px",
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
          color: active ? "#9da3aa" : "#858585",
          fontSize: "12px",
          lineHeight: 1,
          width: "16px",
          height: "16px",
          display: "grid",
          placeItems: "center",
          borderRadius: "3px",
          background: active ? "rgba(255,255,255,0.03)" : "transparent",
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
      type="button"
      onClick={onClick}
      style={{
        border: "none",
        borderBottom: `1px solid ${active ? "#007acc" : "transparent"}`,
        background: "transparent",
        color: active ? "#ffffff" : "#858585",
        padding: "0 14px",
        fontSize: "11px",
        fontWeight: 600,
        letterSpacing: "0.08em",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function MobilePaneButton({ active = false, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: "24px",
        border: "none",
        background: active ? "#22262d" : "transparent",
        color: active ? "#ffffff" : "#858585",
        borderRadius: "4px",
        padding: "0 10px",
        fontSize: "12px",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function LogoMark() {
  return (
    <div
      style={{
        width: "18px",
        height: "18px",
        borderRadius: "4px",
        display: "grid",
        placeItems: "center",
        background: "linear-gradient(180deg, #0d8ef2 0%, #0068bf 100%)",
        color: "#ffffff",
        fontSize: "10px",
        fontWeight: 800,
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.18), 0 6px 12px rgba(0,122,204,0.24)",
      }}
    >
      W
    </div>
  );
}

function ToolbarMenuLabel({ children }) {
  return (
    <span
      style={{
        color: "#8f98a3",
        fontSize: "11px",
        fontWeight: 500,
        letterSpacing: "0.01em",
        userSelect: "none",
        cursor: "default",
      }}
    >
      {children}
    </span>
  );
}

function ToolbarSearch({ value, onChange, onFocus }) {
  return (
    <label
      style={{
        width: "100%",
        maxWidth: "420px",
        height: "26px",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "0 10px",
        background: "#121419",
        border: "1px solid rgba(255,255,255,0.06)",
        color: "#7d8590",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)",
      }}
    >
      <SearchIcon />
      <input
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        onFocus={onFocus}
        placeholder="Search workspace files"
        spellCheck={false}
        style={{
          flex: 1,
          minWidth: 0,
          border: "none",
          outline: "none",
          background: "transparent",
          color: "#d4d4d4",
          fontSize: "12px",
        }}
      />
      <span
        style={{
          flexShrink: 0,
          color: "#5e6670",
          fontSize: "10px",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          userSelect: "none",
        }}
      >
        Search
      </span>
    </label>
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

function OutputPlaceholder({ activeFile }) {
  const visual = getFileVisualMeta(activeFile || "main.sql");
  return (
    <div
      style={{
        height: "100%",
        display: "grid",
        placeItems: "center",
        background: "#121418",
        color: "#858585",
        padding: "24px",
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: "440px" }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: "42px",
            height: "18px",
            padding: "0 8px",
            borderRadius: "3px",
            background: visual.surface,
            color: visual.accent,
            fontSize: "10px",
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.035)",
          }}
        >
          {visual.label}
        </div>
        <div style={{ marginTop: "12px", color: "#d4d4d4", fontSize: "14px", fontWeight: 600 }}>
          Output panel is idle
        </div>
        <div style={{ marginTop: "8px", fontSize: "12px", lineHeight: 1.65, color: "#7d8590" }}>
          Run a SQL file such as {activeFile || "main.sql"} to populate this panel with query results.
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
        background: "#17191d",
      }}
    >
      <div
        style={{
          maxWidth: "420px",
          textAlign: "center",
          padding: isMobile ? "20px" : "24px",
        }}
      >
        <div style={{ color: "#8b949e", fontSize: "11px", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase" }}>
          Explorer
        </div>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            marginTop: "12px",
            padding: "4px 10px",
            borderRadius: "3px",
            background: "#1a1d22",
            color: "#d4d4d4",
            fontFamily: '"Cascadia Code", Consolas, monospace',
            fontSize: "11px",
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.04)",
          }}
        >
          <span style={{ width: "7px", height: "7px", borderRadius: "999px", background: "#007acc", flexShrink: 0 }} />
          {workspaceName}
        </div>
        <div style={{ color: "#ffffff", fontSize: isMobile ? "18px" : "20px", fontWeight: 700, marginTop: "18px" }}>
          {hasFiles ? "Pick a file to start editing" : "Create your first file"}
        </div>
        <div style={{ color: "#7d8590", fontSize: "13px", marginTop: "10px", lineHeight: 1.7 }}>
          {hasFiles
            ? "Select a file from the explorer to open it in the editor."
            : "Create a file from the explorer to start working in this workspace."}
        </div>
      </div>
    </div>
  );
}

function terminalActionButtonStyle({ color = "#d4d4d4" } = {}) {
  return {
    border: "none",
    background: "transparent",
    color,
    fontSize: "11px",
    cursor: "pointer",
    padding: "0 2px",
    letterSpacing: "0.03em",
  };
}

function runButtonStyle(disabled = false) {
  return {
    height: "28px",
    border: disabled ? "1px solid rgba(255,255,255,0.04)" : "1px solid rgba(0,122,204,0.48)",
    borderRadius: "4px",
    background: disabled ? "#1d2229" : "linear-gradient(180deg, #0e83e6 0%, #0069c2 100%)",
    color: disabled ? "#7f8894" : "#ffffff",
    padding: "0 12px",
    fontSize: "12px",
    fontWeight: 700,
    letterSpacing: "0.04em",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.82 : 1,
    boxShadow: disabled ? "none" : "inset 0 1px 0 rgba(255,255,255,0.18), 0 10px 18px rgba(0,122,204,0.22)",
  };
}

function statusBarTokenStyle() {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: 0,
    position: "relative",
    whiteSpace: "nowrap",
  };
}

function statusBarDividerStyle() {
  return {
    width: "1px",
    height: "12px",
    background: "rgba(255,255,255,0.28)",
    flexShrink: 0,
  };
}

function getFileVisualMeta(filename = "") {
  switch (getFileExtension(filename)) {
    case "py":
      return { label: "PY", accent: "#7bc4ae", surface: "rgba(123, 196, 174, 0.12)" };
    case "js":
      return { label: "JS", accent: "#d6c472", surface: "rgba(214, 196, 114, 0.12)" };
    case "ts":
      return { label: "TS", accent: "#7eb5ff", surface: "rgba(126, 181, 255, 0.12)" };
    case "sql":
      return { label: "SQL", accent: "#b790d7", surface: "rgba(183, 144, 215, 0.12)" };
    case "pg":
      return { label: "PG", accent: "#83b7d6", surface: "rgba(131, 183, 214, 0.12)" };
    default:
      return { label: "TXT", accent: "#9da3aa", surface: "rgba(157, 163, 170, 0.1)" };
  }
}
