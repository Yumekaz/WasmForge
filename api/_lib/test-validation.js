export const ANSWER_SIZE_LIMIT_BYTES = 128 * 1024;
export const MAX_ANSWER_ENTRY_BYTES = ANSWER_SIZE_LIMIT_BYTES + (8 * 1024);
export const MAX_SUBMISSION_BYTES = 1024 * 1024;
export const MAX_JSON_DEPTH = 8;
export const MAX_JSON_ARRAY_LENGTH = 256;
export const MAX_JSON_OBJECT_KEYS = 256;
export const MAX_JSON_NODES = 5000;
export const SUBMISSION_KIND = "python-mock-submission";
export const ROOM_CODE_PATTERN = /^[A-Z0-9-]{1,64}$/u;
export const QUESTION_KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;

export function normalizeRoomCode(value) {
  return String(value ?? "").trim().toUpperCase().replace(/\s+/gu, "-");
}

export function measureJsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
}

export function validateSubmissionRequest(body) {
  const candidate = body?.submission ?? body;
  if (!isPlainObject(candidate)) {
    throw new Error("Submission payload must be a JSON object.");
  }

  const version = requireInteger(candidate.version, "version", { min: 1, max: 50 });
  const kind = requireExactString(candidate.kind, "kind", SUBMISSION_KIND);
  const id = requireIdentifier(candidate.id, "id");
  const roomCode = requireRoomCode(candidate.roomCode);
  const testId = requireIdentifier(candidate.testId, "testId");
  const testTitle = requireText(candidate.testTitle, "testTitle", { maxLength: 200 });
  const attemptId = requireIdentifier(candidate.attemptId, "attemptId");
  const studentId = requireIdentifier(candidate.studentId, "studentId");
  const studentName = requireText(candidate.studentName, "studentName", { maxLength: 120 });
  const score = requireFiniteNumber(candidate.score, "score", { min: 0 });
  const maxScore = requireFiniteNumber(candidate.maxScore, "maxScore", { min: 0 });
  const late = Boolean(candidate.late);
  const answers = sanitizeAnswers(candidate.answers);
  const results = sanitizeResults(candidate.results);
  const clientCreatedAt = requireTimestamp(candidate.clientCreatedAt, "clientCreatedAt");

  if (score > maxScore) {
    throw new Error("score cannot be greater than maxScore.");
  }

  const submission = {
    version,
    kind,
    id,
    roomCode,
    testId,
    testTitle,
    attemptId,
    studentId,
    studentName,
    score,
    maxScore,
    late,
    answers,
    results,
    clientCreatedAt: clientCreatedAt.epochMs,
  };

  const payloadBytes = measureJsonBytes(submission);
  if (payloadBytes > MAX_SUBMISSION_BYTES) {
    throw new Error(`Submission payload exceeds the ${MAX_SUBMISSION_BYTES} byte limit.`);
  }

  return {
    submission,
    clientCreatedAtIso: clientCreatedAt.isoString,
    payloadBytes,
  };
}

export function requireRoomCode(value) {
  const normalized = normalizeRoomCode(value);
  if (!ROOM_CODE_PATTERN.test(normalized)) {
    throw new Error("roomCode must be a non-empty code like PYTHON-101.");
  }

  return normalized;
}

function sanitizeAnswers(value) {
  const answers = sanitizeJsonValue(value, {
    path: "answers",
    depth: 0,
    nodes: { count: 0 },
    maxStringBytes: ANSWER_SIZE_LIMIT_BYTES,
  });

  if (!isPlainObject(answers) || Object.keys(answers).length === 0) {
    throw new Error("answers must be a non-empty object.");
  }

  for (const [questionId, answer] of Object.entries(answers)) {
    if (!QUESTION_KEY_PATTERN.test(questionId)) {
      throw new Error(`answers.${questionId} is not a valid question identifier.`);
    }

    if (measureJsonBytes(answer) > MAX_ANSWER_ENTRY_BYTES) {
      throw new Error(`answers.${questionId} exceeds the ${MAX_ANSWER_ENTRY_BYTES} byte limit.`);
    }
  }

  return answers;
}

function sanitizeResults(value) {
  const results = sanitizeJsonValue(value ?? {}, {
    path: "results",
    depth: 0,
    nodes: { count: 0 },
    maxStringBytes: ANSWER_SIZE_LIMIT_BYTES,
  });

  if (!isPlainObject(results)) {
    throw new Error("results must be an object.");
  }

  return results;
}

function sanitizeJsonValue(value, context) {
  if (context.depth > MAX_JSON_DEPTH) {
    throw new Error(`${context.path} is nested too deeply.`);
  }

  context.nodes.count += 1;
  if (context.nodes.count > MAX_JSON_NODES) {
    throw new Error("Submission payload is too large to store safely.");
  }

  if (value === null) {
    return null;
  }

  if (typeof value === "string") {
    const byteLength = Buffer.byteLength(value, "utf8");
    if (byteLength > context.maxStringBytes) {
      throw new Error(`${context.path} exceeds the ${context.maxStringBytes} byte limit.`);
    }

    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${context.path} must not contain non-finite numbers.`);
    }

    return value;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    if (value.length > MAX_JSON_ARRAY_LENGTH) {
      throw new Error(`${context.path} has too many items.`);
    }

    return value.map((entry, index) =>
      sanitizeJsonValue(entry, {
        ...context,
        path: `${context.path}[${index}]`,
        depth: context.depth + 1,
      }),
    );
  }

  if (!isPlainObject(value)) {
    throw new Error(`${context.path} must contain only JSON-safe values.`);
  }

  const keys = Object.keys(value);
  if (keys.length > MAX_JSON_OBJECT_KEYS) {
    throw new Error(`${context.path} has too many properties.`);
  }

  const next = {};

  for (const key of keys) {
    if (key.length === 0 || key.length > 120) {
      throw new Error(`${context.path} contains an invalid property name.`);
    }

    const nested = value[key];
    if (nested === undefined) {
      continue;
    }

    next[key] = sanitizeJsonValue(nested, {
      ...context,
      path: `${context.path}.${key}`,
      depth: context.depth + 1,
    });
  }

  return next;
}

function requireExactString(value, fieldName, expected) {
  const text = requireText(value, fieldName, { maxLength: expected.length });
  if (text !== expected) {
    throw new Error(`${fieldName} must equal ${expected}.`);
  }

  return text;
}

function requireIdentifier(value, fieldName) {
  return requireText(value, fieldName, {
    maxLength: 160,
    pattern: /^[A-Za-z0-9._:-]+$/u,
  });
}

function requireText(value, fieldName, options = {}) {
  const text = String(value ?? "").trim();
  if (!text) {
    throw new Error(`${fieldName} is required.`);
  }

  if (options.maxLength && text.length > options.maxLength) {
    throw new Error(`${fieldName} must be at most ${options.maxLength} characters.`);
  }

  if (options.pattern && !options.pattern.test(text)) {
    throw new Error(`${fieldName} has an invalid format.`);
  }

  return text;
}

function requireFiniteNumber(value, fieldName, options = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${fieldName} must be a finite number.`);
  }

  if (options.min != null && number < options.min) {
    throw new Error(`${fieldName} must be at least ${options.min}.`);
  }

  if (options.max != null && number > options.max) {
    throw new Error(`${fieldName} must be at most ${options.max}.`);
  }

  return number;
}

function requireInteger(value, fieldName, options = {}) {
  const number = requireFiniteNumber(value, fieldName, options);
  if (!Number.isInteger(number)) {
    throw new Error(`${fieldName} must be an integer.`);
  }

  return number;
}

function requireTimestamp(value, fieldName) {
  let epochMs = null;

  if (typeof value === "number" && Number.isFinite(value)) {
    epochMs = Math.trunc(value);
  } else if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      epochMs = parsed;
    }
  }

  if (!Number.isFinite(epochMs)) {
    throw new Error(`${fieldName} must be a valid timestamp.`);
  }

  const date = new Date(epochMs);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} must be a valid timestamp.`);
  }

  return {
    epochMs,
    isoString: date.toISOString(),
  };
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}
