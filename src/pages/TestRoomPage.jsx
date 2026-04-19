import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor from "../components/Editor.jsx";
import PythonOutputPanel from "../components/PythonOutputPanel.jsx";
import Terminal from "../components/Terminal.jsx";
import { readStoredAppTheme } from "../constants/theme.js";
import { useIOWorker } from "../hooks/useIOWorker.js";
import { usePyodideWorker } from "../hooks/usePyodideWorker.js";
import {
  TEST_ROOM_CODE,
  createSubmissionPayload,
  formatDuration,
  getAttemptScore,
  getOrCreateStudentId,
  getQuestionScore,
  getSeededRoom,
  getTestWorkspaceName,
  normalizeRoomCode,
} from "../utils/mockTest.js";
import {
  TEST_ATTEMPT_FILE,
  enqueueSubmission,
  ensureTestWorkspace,
  getAttemptDeadline,
  getRemainingTimeMs,
  inspectStorageStatus,
  isAttemptLate,
  persistAttempt,
  persistQueue,
  persistStudentProfile,
  readStoredStudentProfile,
  writeAnswerSource,
} from "../utils/testRoomStorage.js";
import { fetchTestHealth, getQueueCounts, syncQueuedSubmissions } from "../utils/testSync.js";

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

function getThemeVars(theme) {
  if (theme === "inverted") {
    return {
      "--ide-shell-bg": "#ebe4da",
      "--ide-shell-elevated": "#e2d9e8",
      "--ide-shell-panel": "#efe8de",
      "--ide-shell-panel-strong": "#f2ece2",
      "--ide-shell-border": "#d2c8d8",
      "--ide-shell-border-strong": "#c3b8cb",
      "--ide-shell-text": "#32283c",
      "--ide-shell-text-soft": "#5e546c",
      "--ide-shell-muted": "#8c8298",
      "--ide-shell-muted-strong": "#a297ab",
      "--ide-shell-accent": "#7350a7",
      "--ide-shell-accent-soft": "rgba(115, 80, 167, 0.10)",
      "--ide-shell-success": "#61856d",
      "--ide-shell-warning": "#a7793e",
      "--ide-shell-danger": "#b5645d",
      "--ide-shell-editor-bg": "#f3ede2",
      "--ide-shell-output-bg": "#f0e9df",
      "--page-gradient":
        "radial-gradient(circle at top left, rgba(115, 80, 167, 0.14), transparent 34%), linear-gradient(180deg, #f0e9df 0%, #e5dcea 100%)",
    };
  }

  return {
    "--ide-shell-bg": "#09090b",
    "--ide-shell-elevated": "#111114",
    "--ide-shell-panel": "#222228",
    "--ide-shell-panel-strong": "#0d141c",
    "--ide-shell-border": "#2a2a32",
    "--ide-shell-border-strong": "#3a3a44",
    "--ide-shell-text": "#ececef",
    "--ide-shell-text-soft": "#c4c4cc",
    "--ide-shell-muted": "#8b8b96",
    "--ide-shell-muted-strong": "#56565f",
    "--ide-shell-accent": "#b48aea",
    "--ide-shell-accent-soft": "rgba(180, 138, 234, 0.12)",
    "--ide-shell-success": "#7dd8b0",
    "--ide-shell-warning": "#e8c872",
    "--ide-shell-danger": "#f48771",
    "--ide-shell-editor-bg": "#09090b",
    "--ide-shell-output-bg": "#0d141c",
    "--page-gradient":
      "radial-gradient(circle at top left, rgba(180, 138, 234, 0.16), transparent 34%), linear-gradient(180deg, #111114 0%, #09090b 100%)",
  };
}

function formatTimestamp(value) {
  if (!value) {
    return "Not yet";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Not yet";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatByteLabel(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Unknown";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function describeBackendHealth(health) {
  if (!health) {
    return {
      label: "Checking backend",
      tone: "warning",
    };
  }

  switch (health.status) {
    case "ready":
      return {
        label: "Backend ready",
        tone: "success",
      };
    case "offline":
      return {
        label: "Offline",
        tone: "warning",
      };
    case "not_configured":
      return {
        label: "Backend not configured",
        tone: "danger",
      };
    case "degraded":
      return {
        label: "Database unavailable",
        tone: "warning",
      };
    default:
      return {
        label: "Backend unavailable",
        tone: "warning",
      };
  }
}

function statusToneColor(tone) {
  switch (tone) {
    case "success":
      return "var(--ide-shell-success)";
    case "danger":
      return "var(--ide-shell-danger)";
    case "warning":
      return "var(--ide-shell-warning)";
    default:
      return "var(--ide-shell-accent)";
  }
}

function StatusPill({ children, tone = "accent" }) {
  const color = statusToneColor(tone);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "8px",
        padding: "6px 10px",
        borderRadius: "999px",
        border: `1px solid color-mix(in srgb, ${color} 32%, transparent)`,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        color,
        fontSize: "11px",
        fontWeight: 800,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function Panel({ children, style }) {
  return (
    <section
      style={{
        border: "1px solid var(--ide-shell-border)",
        borderRadius: "20px",
        background: "color-mix(in srgb, var(--ide-shell-panel) 84%, transparent)",
        boxShadow: "0 18px 60px rgba(0, 0, 0, 0.18)",
        ...style,
      }}
    >
      {children}
    </section>
  );
}

function MetricCard({ label, value, tone = "var(--ide-shell-text)" }) {
  return (
    <div
      style={{
        borderRadius: "16px",
        padding: "14px 16px",
        border: "1px solid var(--ide-shell-border)",
        background: "var(--ide-shell-panel-strong)",
      }}
    >
      <div
        style={{
          color: "var(--ide-shell-muted-strong)",
          fontSize: "11px",
          fontWeight: 800,
          letterSpacing: "0.09em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: "8px",
          color: tone,
          fontSize: "18px",
          fontWeight: 800,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function TestCaseRow({ test }) {
  const passed = Boolean(test?.passed);
  const tone = passed ? "success" : "danger";
  return (
    <div
      style={{
        borderRadius: "14px",
        border: "1px solid var(--ide-shell-border)",
        background: "var(--ide-shell-panel-strong)",
        padding: "12px 14px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "10px",
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ color: "var(--ide-shell-text)", fontSize: "13px", fontWeight: 700 }}>
            {test?.name || "Visible sample"}
          </div>
          <div style={{ color: "var(--ide-shell-muted)", fontSize: "12px", marginTop: "4px" }}>
            stdin: <code>{JSON.stringify(test?.stdin || "")}</code>
          </div>
        </div>
        <StatusPill tone={tone}>{passed ? "Pass" : "Fail"}</StatusPill>
      </div>
      <div
        style={{
          marginTop: "10px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "10px",
        }}
      >
        <div>
          <div style={{ color: "var(--ide-shell-muted-strong)", fontSize: "11px", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Expected
          </div>
          <pre
            style={{
              margin: "6px 0 0",
              padding: "10px",
              borderRadius: "12px",
              background: "var(--ide-shell-output-bg)",
              color: "var(--ide-shell-text-soft)",
              border: "1px solid var(--ide-shell-border)",
              fontSize: "12px",
              whiteSpace: "pre-wrap",
            }}
          >
            {test?.expectedStdout || "[empty]"}
          </pre>
        </div>
        <div>
          <div style={{ color: "var(--ide-shell-muted-strong)", fontSize: "11px", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Actual
          </div>
          <pre
            style={{
              margin: "6px 0 0",
              padding: "10px",
              borderRadius: "12px",
              background: "var(--ide-shell-output-bg)",
              color: passed ? "var(--ide-shell-success)" : "var(--ide-shell-text-soft)",
              border: "1px solid var(--ide-shell-border)",
              fontSize: "12px",
              whiteSpace: "pre-wrap",
            }}
          >
            {test?.stdout || "[empty]"}
          </pre>
        </div>
      </div>
      {test?.stderr || test?.error ? (
        <pre
          style={{
            margin: "10px 0 0",
            padding: "10px",
            borderRadius: "12px",
            background: "color-mix(in srgb, var(--ide-shell-danger) 10%, var(--ide-shell-output-bg))",
            color: "var(--ide-shell-danger)",
            border: "1px solid color-mix(in srgb, var(--ide-shell-danger) 28%, transparent)",
            fontSize: "12px",
            whiteSpace: "pre-wrap",
          }}
        >
          {test?.stderr || test?.error}
        </pre>
      ) : null}
    </div>
  );
}

function QuestionButton({ active, title, subtitle, status, onClick, testId }) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        borderRadius: "16px",
        border: active
          ? "1px solid color-mix(in srgb, var(--ide-shell-accent) 38%, transparent)"
          : "1px solid var(--ide-shell-border)",
        background: active
          ? "color-mix(in srgb, var(--ide-shell-accent) 10%, var(--ide-shell-panel-strong))"
          : "var(--ide-shell-panel-strong)",
        color: "var(--ide-shell-text)",
        padding: "14px",
        cursor: "pointer",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "10px",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: "14px", fontWeight: 800 }}>{title}</div>
          <div style={{ marginTop: "6px", color: "var(--ide-shell-muted)", fontSize: "12px", lineHeight: 1.6 }}>
            {subtitle}
          </div>
        </div>
        {status ? <StatusPill tone={status.tone}>{status.label}</StatusPill> : null}
      </div>
    </button>
  );
}

function InlineButton({ children, onClick, tone = "idle", disabled = false, ...props }) {
  const color = tone === "danger"
    ? "var(--ide-shell-danger)"
    : tone === "success"
      ? "var(--ide-shell-success)"
      : "var(--ide-shell-text)";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        height: "40px",
        borderRadius: "12px",
        border: `1px solid ${disabled ? "var(--ide-shell-border)" : `color-mix(in srgb, ${color} 34%, transparent)`}`,
        background: disabled
          ? "var(--ide-shell-panel)"
          : `color-mix(in srgb, ${color} 12%, var(--ide-shell-panel))`,
        color: disabled ? "var(--ide-shell-muted-strong)" : color,
        padding: "0 14px",
        fontSize: "13px",
        fontWeight: 800,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
      {...props}
    >
      {children}
    </button>
  );
}

export default function TestRoomPage({
  onNavigateHome,
  onNavigateIde,
  onNavigateTeacher,
}) {
  const storedProfile = useMemo(() => readStoredStudentProfile(), []);
  const [theme, setTheme] = useState(() => readStoredAppTheme());
  const [roomCodeInput, setRoomCodeInput] = useState(storedProfile.roomCode || TEST_ROOM_CODE);
  const [studentNameInput, setStudentNameInput] = useState(storedProfile.studentName || "");
  const [roomState, setRoomState] = useState(null);
  const [attempt, setAttempt] = useState(null);
  const [answers, setAnswers] = useState({});
  const [queue, setQueue] = useState([]);
  const [currentQuestionId, setCurrentQuestionId] = useState("");
  const [status, setStatus] = useState("Preparing Python...");
  const [pythonExecution, setPythonExecution] = useState(createEmptyPythonExecution());
  const [storageStatus, setStorageStatus] = useState({
    persisted: false,
    quota: null,
    usage: null,
    available: null,
    lowStorage: false,
  });
  const [backendHealth, setBackendHealth] = useState(null);
  const [joinError, setJoinError] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const [joining, setJoining] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [activeOutputTab, setActiveOutputTab] = useState("terminal");
  const [transientSaveError, setTransientSaveError] = useState("");
  const didAutoResumeRef = useRef(false);
  const roomStateRef = useRef(roomState);
  const attemptRef = useRef(attempt);
  const answersRef = useRef(answers);
  const queueRef = useRef(queue);
  const syncInFlightRef = useRef(false);
  const terminalRef = useRef(null);
  const workspaceName = roomState?.workspaceName || "mock-test-bootstrap";
  const themeMode = theme === "inverted" ? "day" : "night";
  const themeVars = useMemo(() => getThemeVars(theme), [theme]);

  useEffect(() => {
    roomStateRef.current = roomState;
  }, [roomState]);

  useEffect(() => {
    attemptRef.current = attempt;
  }, [attempt]);

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    const handleThemeChange = () => {
      setTheme(readStoredAppTheme());
    };

    window.addEventListener("wasmforge-theme-change", handleThemeChange);
    return () => {
      window.removeEventListener("wasmforge-theme-change", handleThemeChange);
    };
  }, []);

  const {
    isReady: ioReady,
    createWorkspace,
    flushAllWrites,
    readFile,
    writeFile,
  } = useIOWorker({
    workspaceName,
    onError: (error) => {
      setTransientSaveError(error?.message || String(error));
    },
  });

  const {
    runMockTests,
    isReady: pythonReady,
    isRunning: pythonRunning,
  } = usePyodideWorker({
    workspaceName,
    onStdout: (data) => {
      terminalRef.current?.write(data);
    },
    onStderr: (data) => {
      terminalRef.current?.write(`\x1b[31m${data}\x1b[0m`);
    },
    onReady: ({ workspaceName: readyWorkspace } = {}) => {
      setStatus("Python ready");
      terminalRef.current?.writeln(
        `\x1b[32m[Mock test] Python ready for ${readyWorkspace || workspaceName}\x1b[0m`,
      );
    },
    onProgress: (message) => {
      setStatus(message);
      terminalRef.current?.writeln(`\x1b[90m${message}\x1b[0m`);
    },
  });

  const room = roomState?.room || null;
  const student = roomState?.student || null;
  const currentQuestion = useMemo(
    () => room?.questions.find((question) => question.id === currentQuestionId) || room?.questions[0] || null,
    [currentQuestionId, room],
  );
  const currentSource = currentQuestion ? answers[currentQuestion.id] || "" : "";
  const score = room && attempt ? getAttemptScore(room, attempt.results) : { score: 0, maxScore: 0 };
  const queueCounts = useMemo(() => getQueueCounts(queue), [queue]);
  const effectiveLate = room && attempt
    ? isAttemptLate(room, attempt, attempt.submittedAt || now)
    : false;
  const remainingMs = room && attempt ? getRemainingTimeMs(room, attempt, now) : 0;
  const backendBadge = describeBackendHealth(backendHealth);
  const isSubmitted = attempt?.status === "submitted";
  const io = useMemo(() => ({
    createWorkspace,
    readFile,
    writeFile,
  }), [createWorkspace, readFile, writeFile]);

  const writeTerminalLine = useCallback((line, color = "90") => {
    terminalRef.current?.writeln(`\x1b[${color}m${line}\x1b[0m`);
  }, []);

  const persistQueueSnapshot = useCallback(async (nextQueue) => {
    if (!roomStateRef.current) {
      return;
    }

    await persistQueue(io, roomStateRef.current.workspaceName, nextQueue);
  }, [io]);

  const runQueueSync = useCallback(async (queueOverride = queueRef.current) => {
    if (!roomStateRef.current || syncInFlightRef.current) {
      return;
    }

    syncInFlightRef.current = true;

    try {
      const result = await syncQueuedSubmissions(queueOverride);
      setQueue(result.queue);
      await persistQueueSnapshot(result.queue);
      setBackendHealth(result.health);

      if (result.syncedCount > 0) {
        setSyncMessage(`Synced ${result.syncedCount} queued submission${result.syncedCount === 1 ? "" : "s"}.`);
        writeTerminalLine(
          `[Queue] Synced ${result.syncedCount} queued submission${result.syncedCount === 1 ? "" : "s"} to the teacher collection.`,
          "36",
        );
        return result;
      }

      if (result.health.status === "not_configured") {
        setSyncMessage("Queued locally. Backend not configured.");
      } else if (result.health.status === "offline") {
        setSyncMessage("Queued locally. Waiting for network.");
      } else if (result.lastError) {
        setSyncMessage(`Queued locally. ${result.lastError}`);
      }

      return result;
    } finally {
      syncInFlightRef.current = false;
    }
  }, [persistQueueSnapshot, writeTerminalLine]);

  const handleJoin = useCallback(async ({
    roomCode,
    studentName,
    studentId = storedProfile.studentId,
    silent = false,
  }) => {
    const normalizedRoomCode = normalizeRoomCode(roomCode);
    const nextRoom = getSeededRoom(normalizedRoomCode);
    const trimmedStudentName = String(studentName || "").trim();

    if (!nextRoom) {
      if (!silent) {
        setJoinError(`Unknown room code: ${normalizedRoomCode || roomCode}.`);
      }
      return;
    }

    if (!trimmedStudentName) {
      if (!silent) {
        setJoinError("Student name is required.");
      }
      return;
    }

    setJoining(true);
    setJoinError("");
    setSyncMessage("");
    setTransientSaveError("");

    const nextStudent = {
      id: studentId || readStoredStudentProfile().studentId || getOrCreateStudentId(),
      name: trimmedStudentName,
    };
    const nextWorkspaceName = getTestWorkspaceName(nextRoom.roomCode, nextStudent.id);

    try {
      const bundle = await ensureTestWorkspace(io, {
        workspaceName: nextWorkspaceName,
        room: nextRoom,
        student: nextStudent,
      });
      setRoomState({
        room: nextRoom,
        student: nextStudent,
        workspaceName: nextWorkspaceName,
      });
      setAttempt(bundle.attempt);
      setAnswers(bundle.answers);
      setQueue(bundle.queue);
      setCurrentQuestionId((previous) => {
        if (previous && nextRoom.questions.some((question) => question.id === previous)) {
          return previous;
        }

        return nextRoom.questions[0].id;
      });
      setPythonExecution(createEmptyPythonExecution());
      persistStudentProfile({
        roomCode: nextRoom.roomCode,
        studentId: nextStudent.id,
        studentName: nextStudent.name,
      });
      setRoomCodeInput(nextRoom.roomCode);
      setStudentNameInput(nextStudent.name);
      setStorageStatus(await inspectStorageStatus());

      const health = await fetchTestHealth();
      setBackendHealth(health);
      if (health.status === "not_configured") {
        setSyncMessage("Backend not configured. Submissions will stay local until env vars are set.");
      } else if (health.status === "offline") {
        setSyncMessage("Offline mode active. Submissions will queue locally.");
      }
    } catch (error) {
      setJoinError(error?.message || String(error));
    } finally {
      setJoining(false);
    }
  }, [io, storedProfile.studentId]);

  useEffect(() => {
    if (!room || !attempt) {
      return;
    }

    const timerId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timerId);
    };
  }, [attempt?.id, room?.id]);

  useEffect(() => {
    if (!ioReady || didAutoResumeRef.current) {
      return;
    }

    didAutoResumeRef.current = true;
    if (storedProfile.roomCode && storedProfile.studentName) {
      handleJoin({
        roomCode: storedProfile.roomCode,
        studentName: storedProfile.studentName,
        studentId: storedProfile.studentId,
        silent: true,
      });
    }
  }, [handleJoin, ioReady, storedProfile.roomCode, storedProfile.studentId, storedProfile.studentName]);

  useEffect(() => {
    const handleOnline = async () => {
      setBackendHealth(await fetchTestHealth());
      await runQueueSync();
    };

    const handleOffline = () => {
      setBackendHealth({
        ok: false,
        status: "offline",
        configured: false,
        databaseReady: false,
        httpStatus: null,
        message: "Offline",
      });
      setSyncMessage("Offline mode active. Submissions will queue locally.");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [runQueueSync]);

  useEffect(() => {
    if (!roomState || queueCounts.queued === 0) {
      return;
    }

    runQueueSync();
  }, [queueCounts.queued, roomState, runQueueSync]);

  useEffect(() => {
    if (!roomState) {
      return;
    }

    terminalRef.current?.clear?.();
    writeTerminalLine(`[Room] Joined ${roomState.room.roomCode} as ${roomState.student.name}`);
    writeTerminalLine(`[Workspace] ${roomState.workspaceName}`);
    writeTerminalLine(`[Timer] Deadline ${formatTimestamp(getAttemptDeadline(roomState.room, attemptRef.current || {}))}`);
  }, [roomState, writeTerminalLine]);

  const handleAnswerChange = useCallback(async (nextSource) => {
    if (!currentQuestion || !roomStateRef.current || isSubmitted) {
      return;
    }

    setAnswers((previous) => ({
      ...previous,
      [currentQuestion.id]: nextSource,
    }));
    setTransientSaveError("");

    try {
      await writeAnswerSource(io, {
        workspaceName: roomStateRef.current.workspaceName,
        question: currentQuestion,
        source: nextSource,
      });
    } catch (error) {
      setTransientSaveError(error?.message || String(error));
    }
  }, [currentQuestion, io, isSubmitted]);

  const handleRunVisibleSamples = useCallback(async () => {
    if (!room || !student || !attemptRef.current || !currentQuestion || isSubmitted) {
      return;
    }

    setActiveOutputTab("terminal");
    writeTerminalLine(`$ Running visible samples for ${currentQuestion.filename}...`);

    const result = await runMockTests({
      questionId: currentQuestion.id,
      filename: currentQuestion.filename,
      code: answersRef.current[currentQuestion.id] || "",
      tests: currentQuestion.tests.filter((test) => !test.hidden),
    });

    const executedAt = Date.now();
    const nextAttempt = {
      ...attemptRef.current,
      studentName: student.name,
      updatedAt: executedAt,
      answers: {
        ...attemptRef.current.answers,
        [currentQuestion.id]: {
          ...(attemptRef.current.answers?.[currentQuestion.id] || {}),
          filename: currentQuestion.filename,
          runCount: Number(attemptRef.current.answers?.[currentQuestion.id]?.runCount || 0) + 1,
        },
      },
      results: {
        ...attemptRef.current.results,
        [currentQuestion.id]: {
          questionId: currentQuestion.id,
          filename: currentQuestion.filename,
          error: result.error || "",
          tests: Array.isArray(result.tests) ? result.tests : [],
          durationMs: result.durationMs ?? null,
          executedAt,
        },
      },
    };

    setAttempt(nextAttempt);
    await persistAttempt(io, roomState.workspaceName, nextAttempt);

    setPythonExecution({
      ...createEmptyPythonExecution(),
      filename: currentQuestion.filename,
      error: result.error || "",
      durationMs: result.durationMs ?? null,
      executedAt,
    });

    if (result.error) {
      setStatus("Visible sample run failed");
      writeTerminalLine(`[Samples] ${result.error}`, "31");
      return;
    }

    setStatus("Python ready");
    for (const test of result.tests || []) {
      const color = test.passed ? "32" : "31";
      const label = test.passed ? "PASS" : "FAIL";
      writeTerminalLine(
        `[${label}] ${test.name} (${test.points}/${test.points})`,
        color,
      );

      if (!test.passed) {
        writeTerminalLine(`expected ${JSON.stringify(test.expectedStdout || "")}`, "90");
        writeTerminalLine(`actual   ${JSON.stringify(test.stdout || "")}`, "90");
      }
    }

    const questionScore = getQuestionScore(nextAttempt.results[currentQuestion.id]);
    writeTerminalLine(
      `[Samples] ${currentQuestion.id} score ${questionScore.score}/${questionScore.maxScore}`,
      "36",
    );
  }, [currentQuestion, io, isSubmitted, room, roomState, runMockTests, student, writeTerminalLine]);

  const handleSubmit = useCallback(async () => {
    if (!room || !student || !attemptRef.current || !roomStateRef.current || submitting || isSubmitted) {
      return;
    }

    setSubmitting(true);
    setJoinError("");
    setSyncMessage("");

    try {
      await flushAllWrites();

      const submittedAt = Date.now();
      const nextAttempt = {
        ...attemptRef.current,
        studentName: student.name,
        updatedAt: submittedAt,
        submittedAt,
        status: "submitted",
      };

      const submission = createSubmissionPayload({
        room,
        attempt: nextAttempt,
        student,
        answers: room.questions.reduce(
          (result, question) => ({
            ...result,
            [question.id]: answersRef.current[question.id] || "",
          }),
          {},
        ),
        late: isAttemptLate(room, nextAttempt, submittedAt),
      });

      const nextQueue = await enqueueSubmission(io, {
        workspaceName: roomStateRef.current.workspaceName,
        queue: queueRef.current,
        submission,
      });

      await persistAttempt(io, roomStateRef.current.workspaceName, nextAttempt);

      setAttempt(nextAttempt);
      setQueue(nextQueue);
      setSyncMessage("Queued locally.");
      writeTerminalLine(`[Queue] Submission ${submission.id} stored locally.`, "36");
      await runQueueSync(nextQueue);
    } catch (error) {
      setJoinError(error?.message || String(error));
    } finally {
      setSubmitting(false);
    }
  }, [flushAllWrites, io, isSubmitted, room, runQueueSync, student, submitting, writeTerminalLine]);

  const currentResult = currentQuestion && attempt?.results
    ? attempt.results[currentQuestion.id] || null
    : null;

  if (!roomState) {
    return (
      <main
        style={{
          ...themeVars,
          minHeight: "100vh",
          background: "var(--page-gradient)",
          color: "var(--ide-shell-text)",
          padding: "24px",
          fontFamily: '"Sora", "Segoe UI", sans-serif',
        }}
      >
        <div style={{ maxWidth: "1160px", margin: "0 auto" }}>
          <Panel style={{ overflow: "hidden" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1.1fr) minmax(320px, 0.9fr)",
                gap: "0px",
              }}
            >
              <div
                style={{
                  padding: "34px",
                  background: "linear-gradient(180deg, color-mix(in srgb, var(--ide-shell-accent) 10%, transparent) 0%, transparent 100%)",
                }}
              >
                <StatusPill tone="accent">/test</StatusPill>
                <h1 style={{ margin: "18px 0 0", fontSize: "44px", lineHeight: 1.05 }}>
                  Offline Python mock test.
                </h1>
                <p style={{ margin: "18px 0 0", color: "var(--ide-shell-text-soft)", fontSize: "17px", lineHeight: 1.7, maxWidth: "600px" }}>
                  Join the seeded room <strong>{TEST_ROOM_CODE}</strong>, solve three Python questions locally,
                  run visible samples in Pyodide, and submit to a local queue that syncs when the backend is ready.
                </p>
                <div
                  style={{
                    marginTop: "28px",
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: "14px",
                  }}
                >
                  <MetricCard label="Mode" value="Local-first" tone="var(--ide-shell-success)" />
                  <MetricCard label="Questions" value="3 Python tasks" />
                  <MetricCard label="Submission" value="Queue then sync" tone="var(--ide-shell-warning)" />
                </div>
              </div>

              <div style={{ padding: "34px", borderLeft: "1px solid var(--ide-shell-border)" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "12px",
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <div style={{ color: "var(--ide-shell-muted-strong)", fontSize: "11px", fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase" }}>
                      Join room
                    </div>
                    <div style={{ marginTop: "8px", fontSize: "24px", fontWeight: 800 }}>
                      Student access
                    </div>
                  </div>
                  <StatusPill tone={pythonReady ? "success" : "warning"}>
                    {pythonReady ? "Runtime ready" : status}
                  </StatusPill>
                </div>

                <div data-testid="test-room-join" style={{ marginTop: "26px", display: "grid", gap: "16px" }}>
                  <label style={{ display: "grid", gap: "8px" }}>
                    <span style={{ color: "var(--ide-shell-text-soft)", fontSize: "13px", fontWeight: 700 }}>
                      Room code
                    </span>
                    <input
                      aria-label="Room code"
                      data-testid="test-room-code"
                      value={roomCodeInput}
                      onChange={(event) => setRoomCodeInput(event.target.value)}
                      style={inputStyle}
                    />
                  </label>
                  <label style={{ display: "grid", gap: "8px" }}>
                    <span style={{ color: "var(--ide-shell-text-soft)", fontSize: "13px", fontWeight: 700 }}>
                      Student name
                    </span>
                    <input
                      aria-label="Student name"
                      data-testid="student-name"
                      value={studentNameInput}
                      onChange={(event) => setStudentNameInput(event.target.value)}
                      style={inputStyle}
                    />
                  </label>

                  {joinError ? (
                    <div
                      style={{
                        borderRadius: "14px",
                        padding: "12px 14px",
                        border: "1px solid color-mix(in srgb, var(--ide-shell-danger) 30%, transparent)",
                        background: "color-mix(in srgb, var(--ide-shell-danger) 10%, transparent)",
                        color: "var(--ide-shell-danger)",
                        fontSize: "13px",
                        lineHeight: 1.6,
                      }}
                    >
                      {joinError}
                    </div>
                  ) : null}

                  <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                    <InlineButton
                      data-testid="join-test-room"
                      disabled={!ioReady || joining}
                      onClick={() => handleJoin({ roomCode: roomCodeInput, studentName: studentNameInput })}
                    >
                      {joining ? "Joining..." : "Join room"}
                    </InlineButton>
                    <InlineButton onClick={onNavigateTeacher}>Teacher view</InlineButton>
                    <InlineButton onClick={onNavigateIde}>Open IDE</InlineButton>
                    <InlineButton onClick={onNavigateHome}>Home</InlineButton>
                  </div>

                  <div style={{ color: "var(--ide-shell-muted)", fontSize: "12px", lineHeight: 1.7 }}>
                    Local pointers stay in <code>localStorage</code>; code, attempts, and queued submissions stay in OPFS.
                  </div>
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </main>
    );
  }

  return (
    <main
      style={{
        ...themeVars,
        minHeight: "100vh",
        background: "var(--page-gradient)",
        color: "var(--ide-shell-text)",
        padding: "20px",
        fontFamily: '"Sora", "Segoe UI", sans-serif',
      }}
    >
      <div style={{ maxWidth: "1480px", margin: "0 auto", display: "grid", gap: "18px" }}>
        <Panel style={{ padding: "18px 20px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "14px",
              flexWrap: "wrap",
            }}
          >
            <div>
              <div style={{ color: "var(--ide-shell-muted-strong)", fontSize: "11px", fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase" }}>
                {room.roomCode}
              </div>
              <div style={{ marginTop: "8px", fontSize: "28px", fontWeight: 800 }}>
                {room.title}
              </div>
              <div style={{ marginTop: "6px", color: "var(--ide-shell-text-soft)", fontSize: "14px" }}>
                {student.name} • local-first session • attempt {attempt.id}
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
              <StatusPill tone={remainingMs > 0 ? "accent" : "danger"}>
                <span data-testid="mock-test-timer" aria-label="Time left">
                  {formatDuration(remainingMs)}
                </span>
              </StatusPill>
              <StatusPill tone={backendBadge.tone}>{backendBadge.label}</StatusPill>
              {isSubmitted ? (
                <StatusPill tone="success">{queueCounts.queued > 0 ? "Submitted, waiting sync" : "Submitted"}</StatusPill>
              ) : null}
              <InlineButton onClick={onNavigateTeacher}>Teacher</InlineButton>
              <InlineButton onClick={onNavigateIde}>IDE</InlineButton>
              <InlineButton onClick={onNavigateHome}>Home</InlineButton>
            </div>
          </div>
        </Panel>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(260px, 320px) minmax(0, 1fr) minmax(300px, 360px)",
            gap: "18px",
          }}
        >
          <Panel style={{ padding: "16px" }}>
            <div style={{ color: "var(--ide-shell-muted-strong)", fontSize: "11px", fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase" }}>
              Questions
            </div>
            <div style={{ marginTop: "14px", display: "grid", gap: "12px" }}>
              {room.questions.map((question) => {
                const result = attempt.results?.[question.id];
                const questionScore = getQuestionScore(result);
                const status = result
                  ? {
                      tone: result.error ? "danger" : questionScore.score === questionScore.maxScore ? "success" : "warning",
                      label: result.error ? "Error" : `${questionScore.score}/${questionScore.maxScore}`,
                    }
                  : null;

                return (
                  <QuestionButton
                    key={question.id}
                    active={currentQuestion?.id === question.id}
                    title={`${question.id.toUpperCase()} • ${question.title}`}
                    subtitle={`${question.tests.length} visible samples`}
                    status={status}
                    testId={`question-nav-${question.id}`}
                    onClick={() => setCurrentQuestionId(question.id)}
                  />
                );
              })}
            </div>
          </Panel>

          <div style={{ display: "grid", gap: "18px" }}>
            <Panel style={{ overflow: "hidden" }}>
              <div style={{ padding: "18px 18px 0" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "12px",
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <div style={{ color: "var(--ide-shell-muted-strong)", fontSize: "11px", fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase" }}>
                      Active problem
                    </div>
                    <div style={{ marginTop: "8px", fontSize: "20px", fontWeight: 800 }}>
                      {currentQuestion?.title}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                    <InlineButton
                      data-testid="run-visible-samples"
                      disabled={!currentQuestion || pythonRunning || !pythonReady || isSubmitted}
                      onClick={handleRunVisibleSamples}
                    >
                      {pythonRunning ? "Running..." : "Run visible samples"}
                    </InlineButton>
                    <InlineButton
                      data-testid="submit-test"
                      tone="success"
                      disabled={submitting || isSubmitted}
                      onClick={handleSubmit}
                    >
                      {submitting ? "Submitting..." : isSubmitted ? "Submitted" : "Submit test"}
                    </InlineButton>
                  </div>
                </div>

                <p style={{ margin: "12px 0 0", color: "var(--ide-shell-text-soft)", fontSize: "14px", lineHeight: 1.7 }}>
                  {currentQuestion?.prompt}
                </p>

                {transientSaveError ? (
                  <div
                    style={{
                      marginTop: "12px",
                      borderRadius: "12px",
                      padding: "10px 12px",
                      border: "1px solid color-mix(in srgb, var(--ide-shell-danger) 30%, transparent)",
                      background: "color-mix(in srgb, var(--ide-shell-danger) 10%, transparent)",
                      color: "var(--ide-shell-danger)",
                      fontSize: "13px",
                    }}
                  >
                    {transientSaveError}
                  </div>
                ) : null}
              </div>

              <div style={{ height: "440px", marginTop: "16px" }}>
                <Editor
                  code={currentSource}
                  filename={currentQuestion?.filename || "answer.py"}
                  modelPath={currentQuestion?.filename || "answer.py"}
                  language="python"
                  onChange={handleAnswerChange}
                  persistDrafts={false}
                  readOnly={isSubmitted}
                  themeMode={themeMode}
                />
              </div>
            </Panel>

            <Panel style={{ overflow: "hidden" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                  padding: "16px 18px",
                  borderBottom: "1px solid var(--ide-shell-border)",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  <InlineButton
                    disabled={activeOutputTab === "terminal"}
                    onClick={() => setActiveOutputTab("terminal")}
                  >
                    Terminal
                  </InlineButton>
                  <InlineButton
                    disabled={activeOutputTab === "output"}
                    onClick={() => setActiveOutputTab("output")}
                  >
                    Output
                  </InlineButton>
                </div>
                <div style={{ color: "var(--ide-shell-muted)", fontSize: "12px" }}>
                  {status}
                </div>
              </div>

              <div style={{ height: "320px" }}>
                {activeOutputTab === "terminal" ? (
                  <Terminal ref={terminalRef} themeMode={themeMode} />
                ) : (
                  <PythonOutputPanel
                    activeFile={currentQuestion?.filename || ""}
                    result={pythonExecution}
                    isReady={pythonReady}
                    isRunning={pythonRunning}
                    status={status}
                  />
                )}
              </div>
            </Panel>
          </div>

          <div style={{ display: "grid", gap: "18px" }}>
            <Panel style={{ padding: "16px" }}>
              <div style={{ color: "var(--ide-shell-muted-strong)", fontSize: "11px", fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase" }}>
                Attempt status
              </div>
              <div
                style={{
                  marginTop: "14px",
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: "10px",
                }}
              >
                <MetricCard label="Score" value={`${score.score}/${score.maxScore}`} tone="var(--ide-shell-success)" />
                <MetricCard label="Pending queue" value={String(queueCounts.queued)} tone="var(--ide-shell-warning)" />
                <MetricCard label="Started" value={formatTimestamp(attempt.startedAt)} />
                <MetricCard label="Late" value={effectiveLate ? "Yes" : "No"} tone={effectiveLate ? "var(--ide-shell-danger)" : "var(--ide-shell-text)"} />
              </div>

              <div
                style={{
                  marginTop: "14px",
                  borderRadius: "16px",
                  padding: "14px",
                  border: "1px solid var(--ide-shell-border)",
                  background: "var(--ide-shell-panel-strong)",
                }}
              >
                <div style={{ color: "var(--ide-shell-muted-strong)", fontSize: "11px", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  Sync status
                </div>
                <div data-testid="queue-status" style={{ marginTop: "8px", fontSize: "14px", lineHeight: 1.7, color: "var(--ide-shell-text-soft)" }}>
                  {syncMessage || "No pending sync activity."}
                </div>
              </div>

              <div
                style={{
                  marginTop: "14px",
                  borderRadius: "16px",
                  padding: "14px",
                  border: "1px solid var(--ide-shell-border)",
                  background: "var(--ide-shell-panel-strong)",
                }}
              >
                <div style={{ color: "var(--ide-shell-muted-strong)", fontSize: "11px", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  Storage
                </div>
                <div style={{ marginTop: "8px", display: "grid", gap: "8px", fontSize: "13px", color: "var(--ide-shell-text-soft)" }}>
                  <div>Persistent storage: {storageStatus.persisted ? "Requested" : "Best effort"}</div>
                  <div>Available: {formatByteLabel(storageStatus.available)}</div>
                  <div>Used: {formatByteLabel(storageStatus.usage)}</div>
                  {storageStatus.lowStorage ? (
                    <div style={{ color: "var(--ide-shell-warning)" }}>
                      Warning: local quota is getting low before the test is finished.
                    </div>
                  ) : null}
                </div>
              </div>
            </Panel>

            <Panel style={{ padding: "16px" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ color: "var(--ide-shell-muted-strong)", fontSize: "11px", fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase" }}>
                  Visible sample results
                </div>
                {currentResult ? (
                  <StatusPill
                    tone={currentResult.error ? "danger" : getQuestionScore(currentResult).score === getQuestionScore(currentResult).maxScore ? "success" : "warning"}
                  >
                    {currentResult.error
                      ? "Error"
                      : `${getQuestionScore(currentResult).score}/${getQuestionScore(currentResult).maxScore}`}
                  </StatusPill>
                ) : null}
              </div>

              <div style={{ marginTop: "14px", display: "grid", gap: "12px" }}>
                {currentResult?.tests?.length ? (
                  currentResult.tests.map((test) => (
                    <TestCaseRow key={test.id} test={test} />
                  ))
                ) : (
                  <div
                    style={{
                      borderRadius: "16px",
                      padding: "16px",
                      border: "1px solid var(--ide-shell-border)",
                      background: "var(--ide-shell-panel-strong)",
                      color: "var(--ide-shell-text-soft)",
                      fontSize: "14px",
                      lineHeight: 1.7,
                    }}
                  >
                    Run the visible samples to capture per-case stdout, stderr, and score. Results persist in {TEST_ATTEMPT_FILE}.
                  </div>
                )}
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </main>
  );
}

const inputStyle = {
  width: "100%",
  height: "46px",
  borderRadius: "12px",
  border: "1px solid var(--ide-shell-border-strong)",
  background: "var(--ide-shell-panel-strong)",
  color: "var(--ide-shell-text)",
  padding: "0 14px",
  fontSize: "14px",
  outline: "none",
};
