export const TEST_ROOM_CODE = "PYTHON-101";
export const TEST_WORKSPACE_PREFIX = "mock-test";
export const ANSWER_SIZE_LIMIT_BYTES = 128 * 1024;
export const QUEUE_SUBMISSION_LIMIT = 100;
export const QUEUE_BYTE_LIMIT = 5 * 1024 * 1024;
export const LOW_STORAGE_BYTES = 10 * 1024 * 1024;

export const STUDENT_ID_STORAGE_KEY = "wasmforge:test:student-id";
export const STUDENT_NAME_STORAGE_KEY = "wasmforge:test:student-name";
export const ROOM_CODE_STORAGE_KEY = "wasmforge:test:room-code";

const textEncoder = new TextEncoder();

export const SEEDED_TEST_ROOMS = {
  [TEST_ROOM_CODE]: {
    version: 1,
    kind: "python-mock-test",
    id: "python-basics-001",
    roomCode: TEST_ROOM_CODE,
    title: "Python Basics Mock Test",
    durationMinutes: 45,
    description: "Practice core Python loops, strings, and stacks in a local-first test room.",
    questions: [
      {
        id: "q1",
        title: "Sum The Numbers",
        prompt:
          "Read one line of space-separated integers and print their sum. Example: input `1 2 3` should print `6`.",
        filename: "answers/q1.py",
        starterCode: "nums = input().split()\n# TODO: print the sum of the numbers\nprint(0)\n",
        tests: [
          {
            id: "q1-visible-1",
            name: "small positives",
            stdin: "1 2 3\n",
            expectedStdout: "6\n",
            points: 1,
            hidden: false,
          },
          {
            id: "q1-visible-2",
            name: "mixed values",
            stdin: "10 -4 7\n",
            expectedStdout: "13\n",
            points: 1,
            hidden: false,
          },
        ],
      },
      {
        id: "q2",
        title: "Count Vowels",
        prompt:
          "Read a string and print how many vowels it contains. Count a, e, i, o, u in either case.",
        filename: "answers/q2.py",
        starterCode:
          "text = input()\n# TODO: count vowels in text\nprint(0)\n",
        tests: [
          {
            id: "q2-visible-1",
            name: "mixed case",
            stdin: "WasmForge\n",
            expectedStdout: "3\n",
            points: 1,
            hidden: false,
          },
          {
            id: "q2-visible-2",
            name: "no vowels",
            stdin: "rhythm\n",
            expectedStdout: "0\n",
            points: 1,
            hidden: false,
          },
        ],
      },
      {
        id: "q3",
        title: "Balanced Parentheses",
        prompt:
          "Read a string containing only `(` and `)`. Print `YES` if the parentheses are balanced, otherwise print `NO`.",
        filename: "answers/q3.py",
        starterCode:
          "s = input().strip()\n# TODO: decide whether s is balanced\nprint(\"NO\")\n",
        tests: [
          {
            id: "q3-visible-1",
            name: "balanced",
            stdin: "(()())\n",
            expectedStdout: "YES\n",
            points: 1,
            hidden: false,
          },
          {
            id: "q3-visible-2",
            name: "early close",
            stdin: "())(\n",
            expectedStdout: "NO\n",
            points: 1,
            hidden: false,
          },
        ],
      },
    ],
  },
};

export function normalizeRoomCode(value) {
  return String(value ?? "").trim().toUpperCase().replace(/\s+/gu, "-");
}

export function getSeededRoom(roomCode) {
  return SEEDED_TEST_ROOMS[normalizeRoomCode(roomCode)] || null;
}

export function createStudentId() {
  const randomPart =
    globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `student-${randomPart}`;
}

export function getOrCreateStudentId() {
  if (typeof window === "undefined") {
    return createStudentId();
  }

  try {
    const stored = window.localStorage.getItem(STUDENT_ID_STORAGE_KEY);
    if (stored) {
      return stored;
    }

    const next = createStudentId();
    window.localStorage.setItem(STUDENT_ID_STORAGE_KEY, next);
    return next;
  } catch {
    return createStudentId();
  }
}

export function createAttemptId() {
  return `attempt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getTestWorkspaceName(roomCode, studentId) {
  const safeRoom = normalizeRoomCode(roomCode).toLowerCase().replace(/[^a-z0-9-]/gu, "-");
  const safeStudent = String(studentId || "student")
    .toLowerCase()
    .replace(/[^a-z0-9-]/gu, "-")
    .slice(0, 42);
  return `${TEST_WORKSPACE_PREFIX}-${safeRoom}-${safeStudent}`;
}

export function createFreshAttempt(room, student) {
  const now = Date.now();
  return {
    version: 1,
    kind: "python-mock-attempt",
    id: createAttemptId(),
    roomCode: room.roomCode,
    testId: room.id,
    testHash: createContentHash(JSON.stringify(room)),
    studentId: student.id,
    studentName: student.name,
    status: "draft",
    startedAt: now,
    updatedAt: now,
    submittedAt: null,
    answers: Object.fromEntries(
      room.questions.map((question) => [
        question.id,
        {
          filename: question.filename,
          runCount: 0,
        },
      ]),
    ),
    results: {},
  };
}

export function normalizeAttempt(value, room, student) {
  if (!value || value.kind !== "python-mock-attempt" || value.testId !== room.id) {
    return createFreshAttempt(room, student);
  }

  return {
    ...value,
    roomCode: room.roomCode,
    studentId: value.studentId || student.id,
    studentName: value.studentName || student.name,
    answers: {
      ...Object.fromEntries(
        room.questions.map((question) => [
          question.id,
          {
            filename: question.filename,
            runCount: 0,
          },
        ]),
      ),
      ...(value.answers && typeof value.answers === "object" ? value.answers : {}),
    },
    results: value.results && typeof value.results === "object" ? value.results : {},
  };
}

export function getQuestionScore(result) {
  if (!result || !Array.isArray(result.tests)) {
    return { score: 0, maxScore: 0 };
  }

  return result.tests.reduce(
    (total, test) => ({
      score: total.score + (test.passed ? Number(test.points || 0) : 0),
      maxScore: total.maxScore + Number(test.points || 0),
    }),
    { score: 0, maxScore: 0 },
  );
}

export function getAttemptScore(room, results = {}) {
  return room.questions.reduce(
    (total, question) => {
      const questionScore = getQuestionScore(results[question.id]);
      const fallbackMax = question.tests.reduce((sum, test) => sum + Number(test.points || 0), 0);
      return {
        score: total.score + questionScore.score,
        maxScore: total.maxScore + (questionScore.maxScore || fallbackMax),
      };
    },
    { score: 0, maxScore: 0 },
  );
}

export function createSubmissionPayload({ room, attempt, student, answers, late = false }) {
  const score = getAttemptScore(room, attempt.results);
  const now = Date.now();
  return {
    version: 1,
    kind: "python-mock-submission",
    id: `submission-${attempt.id}-${now.toString(36)}`,
    roomCode: room.roomCode,
    testId: room.id,
    testTitle: room.title,
    attemptId: attempt.id,
    studentId: student.id,
    studentName: student.name,
    score: score.score,
    maxScore: score.maxScore,
    late: Boolean(late),
    answers,
    results: attempt.results || {},
    clientCreatedAt: now,
  };
}

export function normalizeQueue(value) {
  return Array.isArray(value)
    ? value
        .filter((entry) => entry?.submission?.id)
        .map((entry) => ({
          status: entry.status === "synced" ? "synced" : "queued",
          lastError: typeof entry.lastError === "string" ? entry.lastError : "",
          queuedAt: Number.isFinite(entry.queuedAt) ? entry.queuedAt : Date.now(),
          syncedAt: Number.isFinite(entry.syncedAt) ? entry.syncedAt : null,
          submission: entry.submission,
        }))
    : [];
}

export function measureJsonBytes(value) {
  return textEncoder.encode(JSON.stringify(value ?? null)).byteLength;
}

export function canAppendToQueue(queue, nextSubmission) {
  const nextQueue = [
    ...normalizeQueue(queue).filter((entry) => entry.status !== "synced"),
    {
      status: "queued",
      queuedAt: Date.now(),
      lastError: "",
      syncedAt: null,
      submission: nextSubmission,
    },
  ];

  return {
    ok:
      nextQueue.length <= QUEUE_SUBMISSION_LIMIT
      && measureJsonBytes(nextQueue) <= QUEUE_BYTE_LIMIT,
    queue: nextQueue,
  };
}

export function getAnswerByteLength(source) {
  return textEncoder.encode(String(source ?? "")).byteLength;
}

export function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function createContentHash(value) {
  const text = String(value ?? "");
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}
