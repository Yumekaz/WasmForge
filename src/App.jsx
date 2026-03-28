import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import Terminal from "./components/Terminal.jsx";
import FileTree from "./components/FileTree.jsx";
import SqlResultsPanel from "./components/SqlResultsPanel.jsx";
import WorkspaceSwitcher from "./components/WorkspaceSwitcher.jsx";
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
const MIN_LEFT_PANEL_WIDTH = 232;
const MIN_RIGHT_PANEL_WIDTH = 360;
const MIN_EDITOR_PANEL_WIDTH = 320;
const RESIZE_HANDLE_WIDTH = 10;
const MOBILE_LAYOUT_BREAKPOINT = 960;
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

function clampPanelLayout(layout, containerWidth) {
  if (!containerWidth) {
    return layout;
  }

  let left = clamp(
    layout.left,
    MIN_LEFT_PANEL_WIDTH,
    containerWidth - layout.right - MIN_EDITOR_PANEL_WIDTH - RESIZE_HANDLE_WIDTH * 2,
  );
  let right = clamp(
    layout.right,
    MIN_RIGHT_PANEL_WIDTH,
    containerWidth - left - MIN_EDITOR_PANEL_WIDTH - RESIZE_HANDLE_WIDTH * 2,
  );
  left = clamp(
    left,
    MIN_LEFT_PANEL_WIDTH,
    containerWidth - right - MIN_EDITOR_PANEL_WIDTH - RESIZE_HANDLE_WIDTH * 2,
  );

  return { left, right };
}

export default function App() {
  const [files, setFiles] = useState([]);
  const [activeFile, setActiveFile] = useState(DEFAULT_FILENAME);
  const [status, setStatus] = useState("Loading workspace...");
  const [sqlExecution, setSqlExecution] = useState(createEmptySqlExecution);
  const [workspaces, setWorkspaces] = useState([]);
  const [activeWorkspace, setActiveWorkspace] = useState(readPersistedActiveWorkspace);
  const [workspaceBootstrapped, setWorkspaceBootstrapped] = useState(false);
  const [panelLayout, setPanelLayout] = useState({ left: 276, right: 476 });
  const [viewportWidth, setViewportWidth] = useState(
    typeof window === "undefined" ? 1280 : window.innerWidth,
  );
  const [mobilePane, setMobilePane] = useState("editor");
  const terminalRef = useRef(null);
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
      const runtime = getRuntimeKind(activeFileRef.current);
      if (runtime === "sqlite" || runtime === "pglite") {
        return;
      }
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
      const container = shellBodyRef.current;
      if (!session || !container) {
        return;
      }

      const bounds = container.getBoundingClientRect();
      const totalWidth = bounds.width;
      if (!totalWidth) {
        return;
      }

      setPanelLayout((prev) => {
        if (session.side === "left") {
          return clampPanelLayout(
            { ...prev, left: event.clientX - bounds.left },
            totalWidth,
          );
        }

        return clampPanelLayout(
          { ...prev, right: bounds.right - event.clientX },
          totalWidth,
        );
      });

      requestTerminalResize();
    };

    const stopResize = () => {
      if (!resizeStateRef.current) {
        return;
      }

      resizeStateRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
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
      const width = shellBodyRef.current?.getBoundingClientRect().width ?? 0;
      if (!width) {
        return;
      }

      setPanelLayout((prev) => clampPanelLayout(prev, width));
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
    document.body.style.cursor = "col-resize";
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
    setFiles([]);
    setActiveFile("");
    setActiveWorkspace(workspaceName);
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
    setFiles([]);
    setActiveFile("");
    setActiveWorkspace(created?.name ?? normalizedName);
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
    await refreshWorkspaceFiles(trimmed, { workspaceName: activeWorkspaceRef.current });
  }, [clearRecoveryWrite, files, prepareWorkspaceMutation, refreshWorkspaceFiles, renameWorkspaceFile]);

  const handleDeleteFile = useCallback(async (filename) => {
    await prepareWorkspaceMutation("deleting files");
    await deleteWorkspaceFile(filename, "workspace", activeWorkspaceRef.current);
    clearRecoveryWrite(filename);
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
  const runtimePresentation = getRuntimePresentation(activeRuntime);
  const statusColor =
    activeHasError
      ? "#ff7b72"
      : activeRuntime === "python" && isAwaitingInput
        ? "#79c0ff"
        : activeRuntimeRunning
          ? "#f0b95a"
          : activeRuntimeReady
            ? "#7ee787"
            : "#8b949e";
  const draftStorageKey = getRecoveryStorageKey(activeWorkspace);

  useEffect(() => {
    if (!isMobileLayout) {
      return;
    }

    if (!activeFile || files.length === 0) {
      setMobilePane("files");
    }
  }, [activeFile, files.length, isMobileLayout]);

  useEffect(() => {
    if (showResultsPanel) {
      return;
    }
    if (isMobileLayout && mobilePane !== "output") {
      return;
    }
    requestTerminalResize();
  }, [isMobileLayout, mobilePane, requestTerminalResize, showResultsPanel]);

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

  const terminalVisible = !showResultsPanel && (!isMobileLayout || mobilePane === "output");
  const filesPanel = (
    <div style={{ width: "100%", height: "100%", minWidth: 0, minHeight: 0 }}>
      <FileTree
        files={files}
        activeFile={activeFile}
        onFileSelect={handleFileSelect}
        onCreateFile={handleCreateFile}
        onRenameFile={handleRenameFile}
        onDeleteFile={handleDeleteFile}
        disabled={isAnyRuntimeBusy}
      />
    </div>
  );
  const editorPanel = (
    <div
      style={{
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: "#0d141c",
        borderLeft: isMobileLayout ? "none" : "1px solid rgba(90, 108, 135, 0.1)",
        borderRight: isMobileLayout ? "none" : "1px solid rgba(90, 108, 135, 0.1)",
      }}
    >
      <div style={{ padding: isMobileLayout ? "10px 14px" : "12px 16px", borderBottom: "1px solid rgba(90, 108, 135, 0.12)", background: "#111821", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
        <div>
          <SectionLabel>Editor</SectionLabel>
          <div style={{ color: "#f5f7fb", fontSize: "13px", fontWeight: 700, marginTop: "4px" }}>{activeFile || "No file selected"}</div>
        </div>
        <div style={{ color: "#8c98a8", fontSize: "12px", maxWidth: "40%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeWorkspace}</div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {files.length === 0 ? (
          <EmptyEditorState workspaceName={activeWorkspace} isMobile={isMobileLayout} />
        ) : (
          <Suspense fallback={<div style={{ height: "100%", display: "grid", placeItems: "center", color: "#8b949e", fontSize: "13px", background: "#0d1117" }}>Loading editor...</div>}>
            <Editor code={activeFileData?.content ?? ""} filename={activeFile || DEFAULT_FILENAME} onChange={handleCodeChange} onMount={handleEditorMount} language={getLanguage(activeFile || DEFAULT_FILENAME)} readOnly={isAnyRuntimeBusy} draftStorageKey={draftStorageKey} />
          </Suspense>
        )}
      </div>
    </div>
  );
  const outputPanel = (
    <div style={{ height: "100%", minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", background: "#0d141b" }}>
      <div style={{ padding: isMobileLayout ? "10px 14px" : "12px 16px", borderBottom: "1px solid rgba(90, 108, 135, 0.14)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", background: "#111821" }}>
        <div>
          <SectionLabel>{showResultsPanel ? "Results & Schema" : "Terminal"}</SectionLabel>
          <div style={{ color: "#f5f7fb", fontSize: "13px", fontWeight: 700, marginTop: "4px" }}>{showResultsPanel ? "Query results" : `${runtimePresentation.label} console`}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
          <div style={{ color: runtimePresentation.accent, background: runtimePresentation.bg, border: `1px solid ${runtimePresentation.border}`, padding: "4px 9px", borderRadius: "10px", fontSize: "11px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em" }}>{showResultsPanel ? "SQL" : runtimePresentation.label}</div>
          <button onClick={() => {
            if (showResultsPanel) {
              setSqlExecution(createEmptySqlExecution());
            } else {
              terminalRef.current?.clear?.();
            }
          }} style={utilityButtonStyle()}>
            {showResultsPanel ? "Clear Results" : "Clear"}
          </button>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <div style={{ display: terminalVisible ? "block" : "none", height: "100%" }}>
          <Terminal ref={terminalRef} isVisible={terminalVisible} />
        </div>
        <div style={{ display: showResultsPanel ? "block" : "none", height: "100%" }}>
          <SqlResultsPanel activeFile={activeFile} engine={activeRuntime} result={activeSqlResult} isReady={activeRuntimeReady} isRunning={activeRuntimeRunning} status={activeStatusMessage} schema={activeSqlResult?.schema} />
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100dvh", height: "100dvh", overflow: "hidden", background: "linear-gradient(180deg, #0b1016 0%, #090d13 100%)", color: "#c9d1d9", fontFamily: '"Aptos", "Segoe UI", sans-serif', padding: isMobileLayout ? "6px" : "10px", boxSizing: "border-box" }}>
      <div style={{ display: "flex", flexDirection: "column", height: "100%", borderRadius: isMobileLayout ? "14px" : "18px", overflow: "hidden", background: "#0c1219", border: "1px solid rgba(90, 108, 135, 0.18)", boxShadow: isMobileLayout ? "none" : "0 14px 36px rgba(2, 8, 23, 0.28)" }}>
        <div style={{ padding: isMobileLayout ? "14px" : "16px 18px", borderBottom: "1px solid rgba(90, 108, 135, 0.16)", background: "#111821" }}>
          <div style={{ display: "flex", alignItems: isMobileLayout ? "stretch" : "center", gap: "14px", flexWrap: isMobileLayout ? "nowrap" : "wrap", flexDirection: isMobileLayout ? "column" : "row" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: isMobileLayout ? 0 : "220px" }}>
              <div style={{ width: "42px", height: "42px", borderRadius: "12px", display: "grid", placeItems: "center", background: "#131c27", border: "1px solid rgba(90, 108, 135, 0.22)", color: "#d9e3ef", fontWeight: 900, letterSpacing: "0.08em" }}>WF</div>
              <div>
                <div style={{ color: "#f5f7fb", fontSize: "18px", fontWeight: 800 }}>WasmForge</div>
                <div style={{ color: "#8c98a8", fontSize: "12px", marginTop: "4px" }}>Browser-native IDE with persistent workspaces</div>
              </div>
            </div>

            <div style={{ width: isMobileLayout ? "100%" : "auto", flex: isMobileLayout ? "1 1 100%" : "0 1 auto" }}>
              <WorkspaceSwitcher
                workspaces={workspaces}
                activeWorkspace={activeWorkspace}
                onSelectWorkspace={(workspaceName) => { void handleWorkspaceSelect(workspaceName); }}
                onCreateWorkspace={handleCreateWorkspace}
                disabled={isAnyRuntimeBusy || !workspaceBootstrapped}
                fullWidth={isMobileLayout}
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", borderRadius: "12px", border: "1px solid rgba(95, 112, 140, 0.18)", background: "#0f161f", minWidth: isMobileLayout ? 0 : "220px", width: isMobileLayout ? "100%" : "auto", flex: isMobileLayout ? "1 1 100%" : 1 }}>
              <RuntimeBadge runtime={activeRuntime} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <SectionLabel>Active File</SectionLabel>
                <div style={{ color: "#f5f7fb", fontSize: "14px", fontWeight: 700, marginTop: "4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{activeFile || "No file selected"}</div>
              </div>
            </div>

            {!isMobileLayout ? <div style={{ flex: 1 }} /> : null}

            <div style={{ display: "flex", alignItems: isMobileLayout ? "stretch" : "center", flexDirection: isMobileLayout ? "column" : "row", gap: "12px", flexWrap: "wrap", justifyContent: "flex-end", width: isMobileLayout ? "100%" : "auto" }}>
              <div style={{ padding: "10px 14px", borderRadius: "12px", border: "1px solid rgba(95, 112, 140, 0.18)", background: "#0f161f", minWidth: isMobileLayout ? 0 : "210px", width: isMobileLayout ? "100%" : "auto" }}>
                <SectionLabel>Status</SectionLabel>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", color: statusColor, fontSize: "13px", fontWeight: 700, marginTop: "6px" }}>
                  <span style={{ width: "8px", height: "8px", borderRadius: "999px", background: statusColor, flexShrink: 0 }} />
                  <span>{activeStatusMessage}</span>
                </div>
              </div>

              {canKillActiveRuntime && activeRuntimeRunning ? (
                <button onClick={handleKill} style={actionButtonStyle({ background: "#3f2226", border: "#6b3b42", fullWidth: isMobileLayout })}>Stop</button>
              ) : (
                <button
                  onClick={handleRun}
                  disabled={isAnyRuntimeBusy || activeRuntime === "unknown" || !activeRuntimeReady}
                  style={actionButtonStyle({
                    background: activeRuntimeReady && !isAnyRuntimeBusy ? "#173728" : "#1a212b",
                    border: activeRuntimeReady && !isAnyRuntimeBusy ? "#29543f" : "#394150",
                    disabled: isAnyRuntimeBusy || activeRuntime === "unknown" || !activeRuntimeReady,
                    fullWidth: isMobileLayout,
                  })}
                >
                  {activeRuntimeRunning ? "Running..." : isAnyRuntimeBusy ? "Busy" : "Run"}
                </button>
              )}
            </div>
          </div>
        </div>

        <div ref={shellBodyRef} style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden", flexDirection: isMobileLayout ? "column" : "row" }}>
          {isMobileLayout ? (
            <>
              <div style={{ display: "flex", gap: "8px", padding: "10px 12px", borderBottom: "1px solid rgba(90, 108, 135, 0.12)", background: "#101720", flexWrap: "wrap" }}>
                <button type="button" onClick={() => setMobilePane("files")} style={paneButtonStyle(mobilePane === "files")}>Files</button>
                <button type="button" onClick={() => setMobilePane("editor")} style={paneButtonStyle(mobilePane === "editor")}>Editor</button>
                <button type="button" onClick={() => setMobilePane("output")} style={paneButtonStyle(mobilePane === "output")}>{showResultsPanel ? "Results" : "Console"}</button>
              </div>
              <div style={{ flex: 1, minHeight: 0, overflow: "hidden", position: "relative" }}>
                <div style={{ display: mobilePane === "files" ? "block" : "none", height: "100%" }}>{filesPanel}</div>
                <div style={{ display: mobilePane === "editor" ? "block" : "none", height: "100%" }}>{editorPanel}</div>
                <div style={{ display: mobilePane === "output" ? "block" : "none", height: "100%" }}>{outputPanel}</div>
              </div>
            </>
          ) : (
            <>
              <div style={{ width: `${panelLayout.left}px`, minWidth: 0, flexShrink: 0 }}>
                {filesPanel}
              </div>
              <ResizeHandle onPointerDown={startResize("left")} />
              <div style={{ flex: 1, minWidth: 0, display: "flex", overflow: "hidden" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {editorPanel}
                </div>
                <ResizeHandle onPointerDown={startResize("right")} />
                <div style={{ width: `${panelLayout.right}px`, minWidth: 0, flexShrink: 0 }}>
                  {outputPanel}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ResizeHandle({ onPointerDown }) {
  return (
    <div onPointerDown={onPointerDown} style={{ width: `${RESIZE_HANDLE_WIDTH}px`, flexShrink: 0, cursor: "col-resize", display: "grid", placeItems: "center", background: "transparent" }}>
      <div style={{ width: "1px", height: "100%", background: "rgba(90, 108, 135, 0.16)", borderRadius: "999px" }} />
    </div>
  );
}

function RuntimeBadge({ runtime }) {
  const presentation = getRuntimePresentation(runtime);

  return (
    <div style={{ minWidth: "48px", height: "38px", borderRadius: "10px", display: "grid", placeItems: "center", background: presentation.bg, border: `1px solid ${presentation.border}`, color: presentation.accent, fontSize: "11px", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0 }}>
      {presentation.label}
    </div>
  );
}

function EmptyEditorState({ workspaceName, isMobile = false }) {
  return (
    <div style={{ height: "100%", display: "grid", placeItems: "center", padding: isMobile ? "18px" : "24px", background: "#0d141c" }}>
      <div style={{ maxWidth: "420px", textAlign: "center", borderRadius: "16px", border: "1px dashed rgba(95, 112, 140, 0.2)", background: "#101720", padding: isMobile ? "22px" : "28px" }}>
        <div style={{ color: "#8ea2bf", fontSize: "11px", fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase" }}>Empty Workspace</div>
        <div style={{ color: "#f5f7fb", fontSize: isMobile ? "20px" : "22px", fontWeight: 800, marginTop: "10px" }}>{workspaceName}</div>
        <div style={{ color: "#8ea2bf", fontSize: "13px", marginTop: "12px", lineHeight: 1.6 }}>
          This workspace is empty. Create a file from the sidebar to start working in this workspace.
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }) {
  return <div style={{ color: "#8ea2bf", fontSize: "10px", fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase" }}>{children}</div>;
}

function actionButtonStyle({ background, border, disabled = false, fullWidth = false }) {
  return {
    background,
    border: `1px solid ${border}`,
    color: disabled ? "#7b8594" : "#f5f7fb",
    padding: "11px 16px",
    borderRadius: "12px",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: "13px",
    fontWeight: 800,
    letterSpacing: "0.02em",
    minWidth: fullWidth ? "100%" : "132px",
    width: fullWidth ? "100%" : "auto",
    opacity: disabled ? 0.7 : 1,
  };
}

function utilityButtonStyle() {
  return {
    background: "#101720",
    border: "1px solid rgba(95, 112, 140, 0.22)",
    color: "#c9d1d9",
    padding: "9px 12px",
    borderRadius: "10px",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: 700,
  };
}

function paneButtonStyle(active = false) {
  return {
    border: `1px solid ${active ? "rgba(118, 132, 153, 0.3)" : "rgba(95, 112, 140, 0.18)"}`,
    background: active ? "rgba(95, 112, 140, 0.16)" : "#0f161f",
    color: active ? "#f5f7fb" : "#aab5c2",
    padding: "9px 12px",
    borderRadius: "10px",
    fontSize: "12px",
    fontWeight: 700,
    cursor: "pointer",
  };
}
