import {
  ANSWER_SIZE_LIMIT_BYTES,
  LOW_STORAGE_BYTES,
  QUEUE_BYTE_LIMIT,
  QUEUE_SUBMISSION_LIMIT,
  ROOM_CODE_STORAGE_KEY,
  STUDENT_ID_STORAGE_KEY,
  STUDENT_NAME_STORAGE_KEY,
  canAppendToQueue,
  getAnswerByteLength,
  getOrCreateStudentId,
  normalizeAttempt,
  normalizeQueue,
} from "./mockTest.js";

export const TEST_METADATA_FILE = "mock-test.json";
export const TEST_ATTEMPT_FILE = "mock-attempt.json";
export const TEST_QUEUE_FILE = "submissions/queue.json";

function isMissingFileError(error) {
  const message = error?.message || String(error || "");
  return error?.name === "NotFoundError" || /could not be found/i.test(message);
}

export function readStoredStudentProfile() {
  if (typeof window === "undefined") {
    return {
      roomCode: "",
      studentId: "",
      studentName: "",
    };
  }

  try {
    return {
      roomCode: window.localStorage.getItem(ROOM_CODE_STORAGE_KEY) || "",
      studentId: window.localStorage.getItem(STUDENT_ID_STORAGE_KEY) || "",
      studentName: window.localStorage.getItem(STUDENT_NAME_STORAGE_KEY) || "",
    };
  } catch {
    return {
      roomCode: "",
      studentId: "",
      studentName: "",
    };
  }
}

export function persistStudentProfile({ roomCode, studentId, studentName }) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(ROOM_CODE_STORAGE_KEY, String(roomCode || ""));
  window.localStorage.setItem(STUDENT_ID_STORAGE_KEY, String(studentId || getOrCreateStudentId()));
  window.localStorage.setItem(STUDENT_NAME_STORAGE_KEY, String(studentName || ""));
}

export async function readJsonFile(io, filename, workspaceName) {
  try {
    const raw = await io.readFile(filename, "workspace", workspaceName);
    return JSON.parse(raw);
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw error;
  }
}

export async function writeJsonFile(io, filename, value, workspaceName) {
  await io.writeFile(filename, JSON.stringify(value, null, 2), "workspace", workspaceName);
}

export async function ensureTestWorkspace(io, { workspaceName, room, student }) {
  await io.createWorkspace(workspaceName);
  await writeJsonFile(io, TEST_METADATA_FILE, room, workspaceName);

  const answers = {};
  for (const question of room.questions) {
    try {
      answers[question.id] = await io.readFile(question.filename, "workspace", workspaceName);
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }

      answers[question.id] = question.starterCode;
      await io.writeFile(question.filename, question.starterCode, "workspace", workspaceName);
    }
  }

  const storedAttempt = await readJsonFile(io, TEST_ATTEMPT_FILE, workspaceName);
  const attempt = normalizeAttempt(storedAttempt, room, student);
  await writeJsonFile(io, TEST_ATTEMPT_FILE, attempt, workspaceName);

  const storedQueue = normalizeQueue(await readJsonFile(io, TEST_QUEUE_FILE, workspaceName));
  await writeJsonFile(io, TEST_QUEUE_FILE, storedQueue, workspaceName);

  return {
    attempt,
    answers,
    queue: storedQueue,
  };
}

export async function writeAnswerSource(io, { workspaceName, question, source }) {
  const nextSource = String(source ?? "");
  const byteLength = getAnswerByteLength(nextSource);
  if (byteLength > ANSWER_SIZE_LIMIT_BYTES) {
    throw new Error(
      `Answer is ${byteLength} bytes. The limit is ${ANSWER_SIZE_LIMIT_BYTES} bytes.`,
    );
  }

  await io.writeFile(question.filename, nextSource, "workspace", workspaceName);
  return {
    ok: true,
    byteLength,
  };
}

export async function persistAttempt(io, workspaceName, attempt) {
  await writeJsonFile(io, TEST_ATTEMPT_FILE, attempt, workspaceName);
}

export async function persistQueue(io, workspaceName, queue) {
  await writeJsonFile(io, TEST_QUEUE_FILE, normalizeQueue(queue), workspaceName);
}

export async function enqueueSubmission(io, { workspaceName, queue, submission }) {
  const nextState = canAppendToQueue(queue, submission);
  if (!nextState.ok) {
    throw new Error(
      `Local queue limit reached. Keep at most ${QUEUE_SUBMISSION_LIMIT} queued submissions or ${Math.floor(
        QUEUE_BYTE_LIMIT / (1024 * 1024),
      )} MB of pending payloads.`,
    );
  }

  await writeJsonFile(
    io,
    `submissions/${submission.id}.json`,
    submission,
    workspaceName,
  );
  await persistQueue(io, workspaceName, nextState.queue);
  return nextState.queue;
}

export function getAttemptDeadline(room, attempt) {
  const startedAt = Number(attempt?.startedAt || 0);
  const durationMs = Number(room?.durationMinutes || 0) * 60 * 1000;
  return startedAt + durationMs;
}

export function getRemainingTimeMs(room, attempt, now = Date.now()) {
  return Math.max(0, getAttemptDeadline(room, attempt) - now);
}

export function isAttemptLate(room, attempt, now = Date.now()) {
  return now > getAttemptDeadline(room, attempt);
}

export async function inspectStorageStatus() {
  if (typeof navigator === "undefined" || !navigator.storage) {
    return {
      persisted: false,
      quota: null,
      usage: null,
      available: null,
      lowStorage: false,
    };
  }

  let persisted = false;
  try {
    persisted = Boolean(await navigator.storage.persist?.());
  } catch {
    persisted = false;
  }

  let quota = null;
  let usage = null;
  try {
    const estimate = await navigator.storage.estimate?.();
    quota = Number.isFinite(estimate?.quota) ? Number(estimate.quota) : null;
    usage = Number.isFinite(estimate?.usage) ? Number(estimate.usage) : null;
  } catch {
    quota = null;
    usage = null;
  }

  const available =
    typeof quota === "number" && typeof usage === "number"
      ? Math.max(0, quota - usage)
      : null;

  return {
    persisted,
    quota,
    usage,
    available,
    lowStorage: typeof available === "number" ? available < LOW_STORAGE_BYTES : false,
  };
}
