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
      return { label: "Python", accent: "#7ee787", bg: "rgba(25, 58, 40, 0.78)", border: "rgba(63, 185, 80, 0.4)" };
    case "javascript":
      return { label: "JS", accent: "#f0b95a", bg: "rgba(57, 39, 7, 0.78)", border: "rgba(210, 153, 34, 0.38)" };
    case "sqlite":
      return { label: "SQL", accent: "#6fb7ff", bg: "rgba(13, 37, 56, 0.8)", border: "rgba(31, 111, 235, 0.38)" };
    case "pglite":
      return { label: "SQL", accent: "#79ebad", bg: "rgba(15, 46, 31, 0.8)", border: "rgba(35, 134, 54, 0.38)" };
    default:
      return { label: "Text", accent: "#9aa7b7", bg: "rgba(24, 30, 40, 0.82)", border: "rgba(110, 118, 129, 0.3)" };
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
    if (!showResultsPanel) {
      requestTerminalResize();
    }
  }, [requestTerminalResize, showResultsPanel]);

  return (
    <div style={{ minHeight: "100vh", height: "100vh", overflow: "hidden", background: "radial-gradient(circle at top left, rgba(23, 91, 181, 0.16), transparent 24%), radial-gradient(circle at top right, rgba(23, 134, 95, 0.14), transparent 24%), #071018", color: "#c9d1d9", fontFamily: '"Aptos", "Segoe UI", sans-serif', padding: "12px", boxSizing: "border-box" }}>
      <div style={{ display: "flex", flexDirection: "column", height: "100%", borderRadius: "26px", overflow: "hidden", background: "rgba(8, 12, 18, 0.86)", border: "1px solid rgba(90, 108, 135, 0.22)", boxShadow: "0 28px 100px rgba(2, 8, 23, 0.48)" }}>
        <div style={{ padding: "16px 18px", borderBottom: "1px solid rgba(90, 108, 135, 0.18)", background: "linear-gradient(180deg, rgba(18, 24, 34, 0.98), rgba(12, 17, 24, 0.96))" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: "220px" }}>
              <div style={{ width: "42px", height: "42px", borderRadius: "14px", display: "grid", placeItems: "center", background: "linear-gradient(135deg, rgba(43, 115, 225, 0.95), rgba(34, 199, 171, 0.74))", color: "#f7fbff", fontWeight: 900, letterSpacing: "0.08em" }}>WF</div>
              <div>
                <div style={{ color: "#f5f7fb", fontSize: "18px", fontWeight: 800 }}>WasmForge</div>
                <div style={{ color: "#8ea2bf", fontSize: "12px", marginTop: "4px" }}>Browser-native IDE with persistent workspaces</div>
              </div>
            </div>

            <WorkspaceSwitcher
              workspaces={workspaces}
              activeWorkspace={activeWorkspace}
              onSelectWorkspace={(workspaceName) => { void handleWorkspaceSelect(workspaceName); }}
              onCreateWorkspace={handleCreateWorkspace}
              disabled={isAnyRuntimeBusy || !workspaceBootstrapped}
            />

            <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", borderRadius: "16px", border: "1px solid rgba(95, 112, 140, 0.22)", background: "linear-gradient(180deg, rgba(17, 23, 32, 0.94), rgba(10, 15, 22, 0.94))", minWidth: "220px", flex: 1 }}>
              <RuntimeBadge runtime={activeRuntime} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <SectionLabel>Active File</SectionLabel>
                <div style={{ color: "#f5f7fb", fontSize: "14px", fontWeight: 700, marginTop: "4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{activeFile || "No file selected"}</div>
              </div>
            </div>

            <div style={{ flex: 1 }} />

            <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", justifyContent: "flex-end" }}>
              <div style={{ padding: "10px 14px", borderRadius: "16px", border: "1px solid rgba(95, 112, 140, 0.22)", background: "linear-gradient(180deg, rgba(17, 23, 32, 0.94), rgba(10, 15, 22, 0.94))", minWidth: "210px" }}>
                <SectionLabel>Status</SectionLabel>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", color: statusColor, fontSize: "13px", fontWeight: 700, marginTop: "6px" }}>
                  <span style={{ width: "9px", height: "9px", borderRadius: "999px", background: statusColor, boxShadow: `0 0 16px ${statusColor}44`, flexShrink: 0 }} />
                  <span>{activeStatusMessage}</span>
                </div>
              </div>

              {canKillActiveRuntime && activeRuntimeRunning ? (
                <button onClick={handleKill} style={actionButtonStyle({ background: "linear-gradient(135deg, #662b2b, #9e3a3a)", border: "#c55555" })}>Stop</button>
              ) : (
                <button
                  onClick={handleRun}
                  disabled={isAnyRuntimeBusy || activeRuntime === "unknown" || !activeRuntimeReady}
                  style={actionButtonStyle({
                    background: activeRuntimeReady && !isAnyRuntimeBusy ? "linear-gradient(135deg, #0e7a3d, #1ca253)" : "linear-gradient(135deg, #212833, #1b212b)",
                    border: activeRuntimeReady && !isAnyRuntimeBusy ? "#43c16f" : "#394150",
                    disabled: isAnyRuntimeBusy || activeRuntime === "unknown" || !activeRuntimeReady,
                  })}
                >
                  {activeRuntimeRunning ? "Running..." : isAnyRuntimeBusy ? "Busy" : "Run"}
                </button>
              )}
            </div>
          </div>
        </div>

        <div ref={shellBodyRef} style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
          <div style={{ width: `${panelLayout.left}px`, minWidth: 0, flexShrink: 0 }}>
            <FileTree files={files} activeFile={activeFile} onFileSelect={handleFileSelect} onCreateFile={handleCreateFile} onRenameFile={handleRenameFile} onDeleteFile={handleDeleteFile} disabled={isAnyRuntimeBusy} />
          </div>
          <ResizeHandle onPointerDown={startResize("left")} />
          <div style={{ flex: 1, minWidth: 0, display: "flex", overflow: "hidden" }}>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: "linear-gradient(180deg, rgba(11, 16, 24, 0.94), rgba(8, 12, 18, 0.96))", borderLeft: "1px solid rgba(90, 108, 135, 0.12)", borderRight: "1px solid rgba(90, 108, 135, 0.12)" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(90, 108, 135, 0.12)", background: "linear-gradient(180deg, rgba(16, 21, 30, 0.95), rgba(10, 15, 22, 0.95))", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                <div>
                  <SectionLabel>Editor</SectionLabel>
                  <div style={{ color: "#f5f7fb", fontSize: "13px", fontWeight: 700, marginTop: "4px" }}>{activeFile || "No file selected"}</div>
                </div>
                <div style={{ color: "#8ea2bf", fontSize: "12px" }}>{activeWorkspace}</div>
              </div>
              <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
                {files.length === 0 ? (
                  <EmptyEditorState workspaceName={activeWorkspace} />
                ) : (
                  <Suspense fallback={<div style={{ height: "100%", display: "grid", placeItems: "center", color: "#8b949e", fontSize: "13px", background: "#0d1117" }}>Loading editor...</div>}>
                    <Editor code={activeFileData?.content ?? ""} filename={activeFile || DEFAULT_FILENAME} onChange={handleCodeChange} onMount={handleEditorMount} language={getLanguage(activeFile || DEFAULT_FILENAME)} readOnly={isAnyRuntimeBusy} draftStorageKey={draftStorageKey} />
                  </Suspense>
                )}
              </div>
            </div>
            <ResizeHandle onPointerDown={startResize("right")} />
            <div style={{ width: `${panelLayout.right}px`, minWidth: 0, flexShrink: 0, display: "flex", flexDirection: "column", background: "linear-gradient(180deg, rgba(13, 18, 27, 0.98), rgba(8, 12, 18, 0.98))" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(90, 108, 135, 0.14)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", background: "linear-gradient(180deg, rgba(18, 24, 34, 0.98), rgba(12, 17, 24, 0.96))" }}>
                <div>
                  <SectionLabel>{showResultsPanel ? "Results & Schema" : "Terminal"}</SectionLabel>
                  <div style={{ color: "#f5f7fb", fontSize: "13px", fontWeight: 700, marginTop: "4px" }}>{showResultsPanel ? "Query results" : `${runtimePresentation.label} console`}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div style={{ color: runtimePresentation.accent, background: runtimePresentation.bg, border: `1px solid ${runtimePresentation.border}`, padding: "4px 10px", borderRadius: "999px", fontSize: "11px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}>{showResultsPanel ? "SQL" : runtimePresentation.label}</div>
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
                <div style={{ display: showResultsPanel ? "none" : "block", height: "100%" }}>
                  <Terminal ref={terminalRef} isVisible={!showResultsPanel} />
                </div>
                <div style={{ display: showResultsPanel ? "block" : "none", height: "100%" }}>
                  <SqlResultsPanel activeFile={activeFile} engine={activeRuntime} result={activeSqlResult} isReady={activeRuntimeReady} isRunning={activeRuntimeRunning} status={activeStatusMessage} schema={activeSqlResult?.schema} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ResizeHandle({ onPointerDown }) {
  return (
    <div onPointerDown={onPointerDown} style={{ width: `${RESIZE_HANDLE_WIDTH}px`, flexShrink: 0, cursor: "col-resize", display: "grid", placeItems: "center", background: "transparent" }}>
      <div style={{ width: "2px", height: "100%", background: "linear-gradient(180deg, rgba(86, 102, 128, 0.08), rgba(120, 190, 255, 0.2), rgba(86, 102, 128, 0.08))", borderRadius: "999px" }} />
    </div>
  );
}

function RuntimeBadge({ runtime }) {
  const presentation = getRuntimePresentation(runtime);

  return (
    <div style={{ minWidth: "48px", height: "40px", borderRadius: "13px", display: "grid", placeItems: "center", background: presentation.bg, border: `1px solid ${presentation.border}`, color: presentation.accent, fontSize: "11px", fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase", flexShrink: 0 }}>
      {presentation.label}
    </div>
  );
}

function EmptyEditorState({ workspaceName }) {
  return (
    <div style={{ height: "100%", display: "grid", placeItems: "center", padding: "24px", background: "radial-gradient(circle at top left, rgba(31, 111, 235, 0.12), transparent 28%), #0d1117" }}>
      <div style={{ maxWidth: "420px", textAlign: "center", borderRadius: "22px", border: "1px solid rgba(95, 112, 140, 0.2)", background: "linear-gradient(180deg, rgba(17, 23, 32, 0.96), rgba(11, 16, 24, 0.96))", padding: "28px", boxShadow: "0 18px 42px rgba(2, 6, 23, 0.34)" }}>
        <div style={{ color: "#7ee7d8", fontSize: "11px", fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase" }}>Empty Workspace</div>
        <div style={{ color: "#f5f7fb", fontSize: "22px", fontWeight: 800, marginTop: "10px" }}>{workspaceName}</div>
        <div style={{ color: "#8ea2bf", fontSize: "13px", marginTop: "12px", lineHeight: 1.6 }}>
          This workspace is empty. Create a file from the sidebar to start working in this workspace.
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }) {
  return <div style={{ color: "#7ee7d8", fontSize: "10px", fontWeight: 800, letterSpacing: "0.18em", textTransform: "uppercase" }}>{children}</div>;
}

function actionButtonStyle({ background, border, disabled = false }) {
  return {
    background,
    border: `1px solid ${border}`,
    color: disabled ? "#7b8594" : "#f5f7fb",
    padding: "11px 16px",
    borderRadius: "16px",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: "13px",
    fontWeight: 800,
    letterSpacing: "0.02em",
    minWidth: "132px",
    opacity: disabled ? 0.7 : 1,
  };
}

function utilityButtonStyle() {
  return {
    background: "rgba(255, 255, 255, 0.04)",
    border: "1px solid rgba(95, 112, 140, 0.24)",
    color: "#c9d1d9",
    padding: "9px 12px",
    borderRadius: "12px",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: 700,
  };
}
