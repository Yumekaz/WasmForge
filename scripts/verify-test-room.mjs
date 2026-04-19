import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import {
  SEEDED_TEST_ROOMS,
  TEST_ROOM_CODE,
  STUDENT_ID_STORAGE_KEY,
  STUDENT_NAME_STORAGE_KEY,
  ROOM_CODE_STORAGE_KEY,
  getTestWorkspaceName,
} from "../src/utils/mockTest.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "..");
const artifactsDir = path.join(workspaceRoot, "artifacts");

const baseUrl = process.env.WASMFORGE_VERIFY_URL || "http://localhost:5173";
const testUrl = new URL("/test", baseUrl).toString();
const teacherUrl = new URL("/teacher", baseUrl).toString();

const room = SEEDED_TEST_ROOMS[TEST_ROOM_CODE];
const primaryQuestion = room.questions[0];
const verificationStudentId = process.env.WASMFORGE_VERIFY_STUDENT_ID || `playwright-test-room-${Date.now().toString(36)}`;
const verificationStudentName = process.env.WASMFORGE_VERIFY_STUDENT_NAME || "Playwright Student";
const teacherPin = process.env.WASMFORGE_VERIFY_TEACHER_PIN || "2468";
const verificationWorkspace = getTestWorkspaceName(TEST_ROOM_CODE, verificationStudentId);
const answerSource = "nums = list(map(int, input().split()))\nprint(sum(nums))\n";
const answerSnippet = "print(sum(nums))";
const expectedRoomTitle = room.title;

const selectorSets = {
  roomCodeInput: [
    byTestId("test-room-code"),
    byTestId("mock-test-room-code"),
    byLabel(/room code/i),
    byPlaceholder(/room code/i),
    byPlaceholder(/python-101/i),
    byRole("textbox", /room code/i),
  ],
  studentNameInput: [
    byTestId("student-name"),
    byTestId("mock-test-student-name"),
    byLabel(/student name|display name|your name/i),
    byPlaceholder(/student name|display name|your name/i),
    byRole("textbox", /student name|display name|your name/i),
  ],
  joinButton: [
    byTestId("join-test-room"),
    byRole("button", /join (test )?room|start test|enter room/i),
    byRole("button", new RegExp(`join\\s+${escapeRegExp(TEST_ROOM_CODE)}`, "i")),
    byText(/join room/i),
  ],
  runVisibleSamplesButton: [
    byTestId("run-visible-samples"),
    byRole("button", /run visible sample tests|run visible samples|run samples|run tests/i),
    byText(/visible samples/i),
  ],
  submitButton: [
    byTestId("submit-test"),
    byTestId("submit-mock-test"),
    byRole("button", /submit mock test|submit test|submit answers|submit/i),
  ],
  syncQueueButton: [
    byTestId("sync-queued-submissions"),
    byRole("button", /sync queued submissions|retry queued submissions|retry sync|sync now|try sync again/i),
  ],
  teacherRoomCodeInput: [
    byTestId("teacher-room-code"),
    byLabel(/room code/i),
    byPlaceholder(/room code/i),
    byRole("textbox", /room code/i),
  ],
  teacherPinInput: [
    byTestId("teacher-pin"),
    byLabel(/admin pin|teacher pin|pin/i),
    byPlaceholder(/admin pin|teacher pin|pin/i),
    byRole("textbox", /admin pin|teacher pin|pin/i),
  ],
  teacherLoadButton: [
    byTestId("load-submissions"),
    byRole("button", /load submissions|view submissions|open dashboard|fetch submissions|enter/i),
  ],
  teacherTable: [
    byTestId("teacher-submissions-table"),
    {
      describe: "table on teacher page",
      create: (page) => page.getByRole("table"),
    },
  ],
};

async function ensureArtifactsDir() {
  await fs.mkdir(artifactsDir, { recursive: true });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function byTestId(testId) {
  return {
    describe: `data-testid=${testId}`,
    create: (page) => page.getByTestId(testId),
  };
}

function byLabel(name) {
  return {
    describe: `label ${String(name)}`,
    create: (page) => page.getByLabel(name),
  };
}

function byPlaceholder(name) {
  return {
    describe: `placeholder ${String(name)}`,
    create: (page) => page.getByPlaceholder(name),
  };
}

function byRole(role, name) {
  return {
    describe: `role=${role} name=${String(name)}`,
    create: (page) => page.getByRole(role, { name }),
  };
}

function byText(text) {
  return {
    describe: `text ${String(text)}`,
    create: (page) => page.getByText(text),
  };
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function dirname(posixPath) {
  const parts = String(posixPath).split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function joinPosix(...segments) {
  return segments
    .flatMap((segment) => String(segment || "").split("/"))
    .filter(Boolean)
    .join("/");
}

function timerTextToSeconds(value) {
  const match = String(value || "").match(/(\d{1,2}):(\d{2})/);
  if (!match) {
    return null;
  }

  return (Number(match[1]) * 60) + Number(match[2]);
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function extractAnswerSource(submission, questionId) {
  const rawAnswer = submission?.answers?.[questionId];
  if (typeof rawAnswer === "string") {
    return rawAnswer;
  }
  if (rawAnswer && typeof rawAnswer === "object") {
    return String(
      rawAnswer.source
      || rawAnswer.code
      || rawAnswer.content
      || rawAnswer.value
      || "",
    );
  }
  return "";
}

function buildTeacherRecord(submission) {
  const receivedAt = new Date().toISOString();
  return {
    id: submission.id,
    roomCode: submission.roomCode,
    studentName: submission.studentName,
    attemptId: submission.attemptId,
    score: submission.score,
    maxScore: submission.maxScore,
    late: submission.late,
    clientCreatedAt: submission.clientCreatedAt,
    clientCreatedAtIso: new Date(submission.clientCreatedAt).toISOString(),
    submittedAt: receivedAt,
    receivedAt,
    answers: submission.answers,
    results: submission.results,
    payload: submission,
  };
}

function createMockApi() {
  return {
    submitMode: "abort",
    submitRequests: [],
    successfulSubmissionIds: [],
    successfulSubmissions: [],
    teacherRequests: [],
    healthRequests: [],
  };
}

async function installApiMocks(page, mockApi) {
  await page.route("**/api/test/submit**", async (route) => {
    const request = route.request();
    const bodyText = request.postData() || "";
    const payload = safeJsonParse(bodyText) || {};

    mockApi.submitRequests.push({
      url: request.url(),
      method: request.method(),
      headers: request.headers(),
      bodyText,
      payload,
      mode: mockApi.submitMode,
    });

    if (mockApi.submitMode === "abort") {
      await route.abort("internetdisconnected");
      return;
    }

    const submissionId = payload.id || `submission-${Date.now().toString(36)}`;
    mockApi.successfulSubmissionIds.push(submissionId);
    mockApi.successfulSubmissions.push(payload);

    await route.fulfill(jsonResponse({
      ok: true,
      status: "synced",
      submissionId,
      receivedAt: new Date().toISOString(),
      submission: payload,
      payload,
    }));
  });

  await page.route("**/api/test/submissions**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    mockApi.teacherRequests.push({
      url: request.url(),
      method: request.method(),
      headers: request.headers(),
      search: Object.fromEntries(url.searchParams.entries()),
    });

    const submissions = mockApi.successfulSubmissions.map(buildTeacherRecord);
    await route.fulfill(jsonResponse({
      ok: true,
      roomCode: url.searchParams.get("roomCode") || TEST_ROOM_CODE,
      count: submissions.length,
      submissions,
      items: submissions,
      rows: submissions,
    }));
  });

  await page.route("**/api/test/health**", async (route) => {
    const request = route.request();
    mockApi.healthRequests.push({
      url: request.url(),
      method: request.method(),
      headers: request.headers(),
    });

    await route.fulfill(jsonResponse({
      ok: true,
      status: "ok",
      configured: true,
      backendConfigured: true,
    }));
  });
}

function jsonResponse(value, status = 200) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(value),
  };
}

async function resolveVisibleLocator(page, candidates, { timeout = 20000 } = {}) {
  const deadline = Date.now() + timeout;
  let lastError = null;

  while (Date.now() < deadline) {
    for (const candidate of candidates) {
      const locator = candidate.create(page).first();
      try {
        if (!(await locator.count())) {
          continue;
        }
        if (await locator.isVisible()) {
          return locator;
        }
      } catch (error) {
        lastError = error;
      }
    }

    await page.waitForTimeout(200);
  }

  throw new Error(
    `Unable to find a visible element. Tried: ${candidates.map((candidate) => candidate.describe).join(", ")}`
    + (lastError ? `. Last error: ${lastError.message}` : ""),
  );
}

async function maybeResolveVisibleLocator(page, candidates, { timeout = 1500 } = {}) {
  try {
    return await resolveVisibleLocator(page, candidates, { timeout });
  } catch {
    return null;
  }
}

async function fillUsingSelectors(page, candidates, value, options = {}) {
  const locator = await resolveVisibleLocator(page, candidates, options);
  await locator.fill(value);
  return locator;
}

async function clickUsingSelectors(page, candidates, options = {}) {
  const locator = await resolveVisibleLocator(page, candidates, options);
  await locator.click();
  return locator;
}

async function maybeClickUsingSelectors(page, candidates, options = {}) {
  const locator = await maybeResolveVisibleLocator(page, candidates, options);
  if (!locator) {
    return false;
  }
  await locator.click();
  return true;
}

async function waitForCondition(action, description, { timeout = 20000, interval = 250 } = {}) {
  const deadline = Date.now() + timeout;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const result = await action();
      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, interval);
    });
  }

  throw new Error(
    `Timed out waiting for ${description}.`
    + (lastError ? ` Last error: ${lastError.message}` : ""),
  );
}

async function bodyText(page) {
  return normalizeWhitespace(await page.locator("body").textContent().catch(() => ""));
}

function matchesText(text, expected) {
  if (expected instanceof RegExp) {
    return expected.test(text);
  }
  return text.includes(normalizeWhitespace(expected));
}

async function waitForBodyText(page, expectations, { timeout = 20000, mode = "all" } = {}) {
  return waitForCondition(async () => {
    const text = await bodyText(page);
    const results = expectations.map((expected) => matchesText(text, expected));
    const passes = mode === "any" ? results.some(Boolean) : results.every(Boolean);
    return passes ? text : null;
  }, `body text (${mode})`, { timeout });
}

async function waitForEditorText(page, text, timeout = 30000) {
  await page.waitForFunction(
    (expected) => {
      const normalize = (value) => (value || "").replace(/\s+/g, " ").trim();
      const expectedText = normalize(expected);
      const candidates = [
        document.querySelector(".monaco-editor .view-lines")?.textContent,
        document.querySelector(".monaco-editor")?.textContent,
        document.body?.innerText,
      ];

      return candidates.some((candidate) => normalize(candidate).includes(expectedText));
    },
    text,
    { timeout },
  );
}

async function focusEditor(page) {
  await page.locator(".monaco-editor").first().click({ position: { x: 180, y: 24 } });
}

async function setEditorValue(page, content) {
  await focusEditor(page);
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText(content);
}

async function seedVerificationState(page) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate(
    ({ studentId, studentIdKey, studentNameKey, roomCodeKey }) => {
      window.localStorage.setItem(studentIdKey, studentId);
      window.localStorage.removeItem(studentNameKey);
      window.localStorage.removeItem(roomCodeKey);
    },
    {
      studentId: verificationStudentId,
      studentIdKey: STUDENT_ID_STORAGE_KEY,
      studentNameKey: STUDENT_NAME_STORAGE_KEY,
      roomCodeKey: ROOM_CODE_STORAGE_KEY,
    },
  );

  await page.evaluate(async (workspaceName) => {
    const root = await navigator.storage.getDirectory();

    async function removeMatchingDirectory(parent) {
      for await (const [name, handle] of parent.entries()) {
        if (handle.kind !== "directory") {
          continue;
        }

        if (name === workspaceName) {
          await parent.removeEntry(name, { recursive: true }).catch(() => undefined);
          continue;
        }

        await removeMatchingDirectory(handle);
      }
    }

    await removeMatchingDirectory(root);
  }, verificationWorkspace);
}

async function readTestLocalStorage(page) {
  return page.evaluate(
    ({ studentIdKey, studentNameKey, roomCodeKey }) => ({
      studentId: window.localStorage.getItem(studentIdKey),
      studentName: window.localStorage.getItem(studentNameKey),
      roomCode: window.localStorage.getItem(roomCodeKey),
    }),
    {
      studentIdKey: STUDENT_ID_STORAGE_KEY,
      studentNameKey: STUDENT_NAME_STORAGE_KEY,
      roomCodeKey: ROOM_CODE_STORAGE_KEY,
    },
  );
}

async function listOpfsEntries(page) {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const entries = [];

    async function walk(directory, prefix = "") {
      for await (const [name, handle] of directory.entries()) {
        const nextPath = prefix ? `${prefix}/${name}` : name;
        entries.push({ path: nextPath, kind: handle.kind });
        if (handle.kind === "directory") {
          await walk(handle, nextPath);
        }
      }
    }

    await walk(root);
    return entries;
  });
}

function resolveWorkspaceRoot(entries, workspaceName) {
  const files = Array.isArray(entries) ? entries.filter((entry) => entry.kind === "file") : [];
  const preferredAttempt = files.find((entry) =>
    entry.path.endsWith("/mock-attempt.json") && entry.path.includes(workspaceName),
  );
  if (preferredAttempt) {
    return dirname(preferredAttempt.path);
  }

  const matchingAnswer = files.find((entry) =>
    entry.path.endsWith(`/${primaryQuestion.filename}`) && entry.path.includes(workspaceName),
  );
  if (matchingAnswer) {
    return dirname(dirname(matchingAnswer.path));
  }

  const candidateRoots = files
    .filter((entry) => entry.path.endsWith("/mock-attempt.json"))
    .map((entry) => dirname(entry.path));

  if (candidateRoots.length === 1) {
    return candidateRoots[0];
  }

  return "";
}

async function readOpfsText(page, selectedPath) {
  return page.evaluate(async (targetPath) => {
    const root = await navigator.storage.getDirectory();
    const parts = String(targetPath).split("/").filter(Boolean);
    let current = root;

    for (const segment of parts.slice(0, -1)) {
      current = await current.getDirectoryHandle(segment);
    }

    const fileHandle = await current.getFileHandle(parts.at(-1));
    return await (await fileHandle.getFile()).text();
  }, selectedPath);
}

async function readOpfsTextIfExists(page, selectedPath) {
  try {
    return await readOpfsText(page, selectedPath);
  } catch {
    return null;
  }
}

async function readWorkspaceJson(page, workspaceDir, relativePath) {
  const text = await readOpfsText(page, joinPosix(workspaceDir, relativePath));
  return JSON.parse(text);
}

async function readWorkspaceJsonIfExists(page, workspaceDir, relativePath) {
  const text = await readOpfsTextIfExists(page, joinPosix(workspaceDir, relativePath));
  return text ? JSON.parse(text) : null;
}

async function waitForWorkspace(page) {
  return waitForCondition(async () => {
    const entries = await listOpfsEntries(page);
    const rootPath = resolveWorkspaceRoot(entries, verificationWorkspace);
    return rootPath ? { rootPath, entries } : null;
  }, `test workspace ${verificationWorkspace}`, { timeout: 30000, interval: 400 });
}

async function waitForWorkspaceAnswer(page, workspaceDir, question, expectedSnippet) {
  return waitForCondition(async () => {
    const answer = await readOpfsTextIfExists(page, joinPosix(workspaceDir, question.filename));
    if (!answer || !answer.includes(expectedSnippet)) {
      return null;
    }
    return answer;
  }, `${question.filename} to contain ${expectedSnippet}`, { timeout: 30000, interval: 400 });
}

async function waitForAttemptResult(page, workspaceDir, questionId, expectedCount) {
  return waitForCondition(async () => {
    const attempt = await readWorkspaceJsonIfExists(page, workspaceDir, "mock-attempt.json");
    const result = attempt?.results?.[questionId];
    if (!result || !Array.isArray(result.tests) || result.tests.length < expectedCount) {
      return null;
    }
    return attempt;
  }, `attempt results for ${questionId}`, { timeout: 60000, interval: 500 });
}

async function readTimerSnapshot(page) {
  return page.evaluate(() => {
    const directSelectors = [
      '[data-testid="mock-test-timer"]',
      '[data-testid="test-room-timer"]',
      '[aria-label*="timer" i]',
      '[aria-label*="time left" i]',
      '[aria-label*="remaining" i]',
    ];
    const candidates = [];

    const remember = (text, source) => {
      const match = String(text || "").match(/\b\d{1,2}:\d{2}\b/);
      if (match) {
        candidates.push({ text: match[0], source });
      }
    };

    for (const selector of directSelectors) {
      const element = document.querySelector(selector);
      if (element) {
        remember(element.textContent, selector);
      }
    }

    const labeledNodes = Array.from(document.querySelectorAll("body *")).filter((element) => {
      const text = String(element.textContent || "").trim();
      return /\b(time left|remaining|timer|ends in)\b/i.test(text) && /\b\d{1,2}:\d{2}\b/.test(text);
    });

    for (const element of labeledNodes.slice(0, 10)) {
      remember(element.textContent, element.tagName.toLowerCase());
    }

    return candidates[0] || null;
  });
}

async function waitForTimer(page) {
  return waitForCondition(async () => {
    const snapshot = await readTimerSnapshot(page);
    return snapshot?.text ? snapshot : null;
  }, "visible timer", { timeout: 30000, interval: 300 });
}

async function openPrimaryQuestion(page) {
  const index = room.questions.findIndex((question) => question.id === primaryQuestion.id) + 1;
  await maybeClickUsingSelectors(page, [
    byTestId(`question-${primaryQuestion.id}`),
    byRole("tab", new RegExp(`${escapeRegExp(primaryQuestion.title)}|Q${index}`, "i")),
    byRole("button", new RegExp(`${escapeRegExp(primaryQuestion.title)}|Q${index}`, "i")),
    byText(primaryQuestion.title),
  ], { timeout: 2500 });
}

async function waitForTestRoomReady(page) {
  await waitForBodyText(page, [
    new RegExp(escapeRegExp(expectedRoomTitle), "i"),
    new RegExp(escapeRegExp(primaryQuestion.title), "i"),
  ], { timeout: 60000, mode: "any" });
  await page.locator(".monaco-editor").first().waitFor({ timeout: 60000 });
  await openPrimaryQuestion(page);
}

async function joinTestRoom(page) {
  await fillUsingSelectors(page, selectorSets.roomCodeInput, TEST_ROOM_CODE, { timeout: 60000 });
  await fillUsingSelectors(page, selectorSets.studentNameInput, verificationStudentName, { timeout: 60000 });
  await clickUsingSelectors(page, selectorSets.joinButton, { timeout: 60000 });
  await waitForTestRoomReady(page);

  const storage = await readTestLocalStorage(page);
  assert(storage.studentId === verificationStudentId, `Expected student id ${verificationStudentId}, got ${storage.studentId}`);
  assert(storage.studentName === verificationStudentName, `Expected student name ${verificationStudentName}, got ${storage.studentName}`);
  assert(storage.roomCode === TEST_ROOM_CODE, `Expected room code ${TEST_ROOM_CODE}, got ${storage.roomCode}`);
}

async function runVisibleSamples(page) {
  await clickUsingSelectors(page, selectorSets.runVisibleSamplesButton, { timeout: 30000 });
  await waitForBodyText(page, [
    new RegExp(escapeRegExp(primaryQuestion.tests[0].name), "i"),
    /passed|2\s*\/\s*2/i,
  ], { timeout: 60000, mode: "any" });
}

async function submitAttempt(page) {
  await clickUsingSelectors(page, selectorSets.submitButton, { timeout: 30000 });
}

async function waitForQueuedSubmission(page, workspaceDir) {
  await waitForBodyText(page, [/queued locally|saved locally|sync when online|stored locally/i], {
    timeout: 30000,
    mode: "any",
  });

  const queue = await waitForCondition(async () => {
    const nextQueue = await readWorkspaceJsonIfExists(page, workspaceDir, "submissions/queue.json");
    const queuedEntry = Array.isArray(nextQueue)
      ? nextQueue.find((entry) => entry?.status !== "synced" && entry?.submission?.studentId === verificationStudentId)
      : null;
    return queuedEntry ? { queue: nextQueue, queuedEntry } : null;
  }, "queued submission entry", { timeout: 30000, interval: 500 });

  const queuedSubmissionPath = joinPosix(workspaceDir, "submissions", `${queue.queuedEntry.submission.id}.json`);
  const persistedSubmission = await readOpfsTextIfExists(page, queuedSubmissionPath);
  assert(Boolean(persistedSubmission), `Expected persisted submission file at ${queuedSubmissionPath}`);
  return queue;
}

async function triggerQueuedSync(page) {
  await page.evaluate(() => {
    window.dispatchEvent(new Event("online"));
  });

  if (await maybeClickUsingSelectors(page, selectorSets.syncQueueButton, { timeout: 2500 })) {
    return;
  }

  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForTestRoomReady(page);
  await maybeClickUsingSelectors(page, selectorSets.syncQueueButton, { timeout: 2500 });
}

async function waitForQueuedSync(page, workspaceDir, submissionId, mockApi) {
  await waitForCondition(
    async () => mockApi.successfulSubmissionIds.includes(submissionId) || null,
    `submission ${submissionId} to reach mocked submit API`,
    { timeout: 30000, interval: 300 },
  );

  const syncedQueue = await waitForCondition(async () => {
    const queue = await readWorkspaceJsonIfExists(page, workspaceDir, "submissions/queue.json");
    if (!Array.isArray(queue)) {
      return [];
    }
    const entry = queue.find((item) => item?.submission?.id === submissionId);
    if (!entry || entry.status === "synced") {
      return queue;
    }
    return null;
  }, `queue to sync ${submissionId}`, { timeout: 30000, interval: 500 });

  await waitForBodyText(page, [/synced|submitted successfully|queue empty|all submissions synced/i], {
    timeout: 20000,
    mode: "any",
  }).catch(() => null);

  return syncedQueue;
}

async function openTeacherDashboard(page) {
  await page.goto(teacherUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await fillUsingSelectors(page, selectorSets.teacherRoomCodeInput, TEST_ROOM_CODE, { timeout: 60000 });
  await fillUsingSelectors(page, selectorSets.teacherPinInput, teacherPin, { timeout: 60000 });
  await clickUsingSelectors(page, selectorSets.teacherLoadButton, { timeout: 60000 });
  await resolveVisibleLocator(page, selectorSets.teacherTable, { timeout: 60000 });
}

async function revealTeacherSubmissionDetails(page, studentName) {
  const row = page.getByRole("row", { name: new RegExp(escapeRegExp(studentName), "i") }).first();
  if (await row.count()) {
    const detailButton = row.getByRole("button", { name: /view|details|code|expand|preview/i }).first();
    if (await detailButton.count()) {
      try {
        await detailButton.click();
        return;
      } catch {
        // Fall through to row click.
      }
    }

    await row.click().catch(() => undefined);
  }
}

async function verifyTeacherRendering(page, submission, mockApi) {
  await waitForBodyText(page, [
    new RegExp(escapeRegExp(submission.studentName), "i"),
    new RegExp(`${submission.score}\\s*/\\s*${submission.maxScore}`),
  ], { timeout: 30000, mode: "all" });

  const teacherRequest = await waitForCondition(
    async () => mockApi.teacherRequests.at(-1) || null,
    "teacher submissions API request",
    { timeout: 10000, interval: 200 },
  );

  assert(
    teacherRequest.search.roomCode === TEST_ROOM_CODE,
    `Expected teacher request roomCode=${TEST_ROOM_CODE}, got ${teacherRequest.search.roomCode}`,
  );
  assert(
    teacherRequest.headers["x-wasmforge-teacher-pin"] === teacherPin,
    "Teacher request did not include x-wasmforge-teacher-pin header.",
  );

  const codePreview = extractAnswerSource(submission, primaryQuestion.id);
  if (codePreview) {
    await revealTeacherSubmissionDetails(page, submission.studentName);
    await waitForBodyText(page, [
      new RegExp(escapeRegExp(primaryQuestion.title), "i"),
      new RegExp(escapeRegExp(answerSnippet), "i"),
      new RegExp(escapeRegExp(primaryQuestion.tests[0].name), "i"),
    ], { timeout: 30000, mode: "any" });
  }
}

async function writeFailureArtifacts(page, mockApi, consoleErrors) {
  const debugState = {
    url: page.url(),
    consoleErrors,
    localStorage: await readTestLocalStorage(page).catch(() => null),
    opfsEntries: await listOpfsEntries(page).catch(() => []),
    submitRequests: mockApi.submitRequests,
    teacherRequests: mockApi.teacherRequests,
    healthRequests: mockApi.healthRequests,
    bodyText: await bodyText(page).catch(() => ""),
  };

  await fs.writeFile(
    path.join(artifactsDir, "verify-test-room-debug.json"),
    JSON.stringify(debugState, null, 2),
  );
  await page.screenshot({
    path: path.join(artifactsDir, "verify-test-room-failure.png"),
    fullPage: true,
  }).catch(() => undefined);
}

async function main() {
  await ensureArtifactsDir();

  const mockApi = createMockApi();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 980 } });
  const consoleErrors = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(String(error));
  });

  await installApiMocks(page, mockApi);

  try {
    await seedVerificationState(page);
    await page.goto(testUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await joinTestRoom(page);

    const workspace = await waitForWorkspace(page);
    const testDefinition = await readWorkspaceJson(page, workspace.rootPath, "mock-test.json");
    assert(testDefinition.roomCode === TEST_ROOM_CODE, `Expected workspace room code ${TEST_ROOM_CODE}, got ${testDefinition.roomCode}`);

    const initialAttempt = await readWorkspaceJson(page, workspace.rootPath, "mock-attempt.json");
    assert(initialAttempt.id, "Expected a persisted attempt id after joining the room.");

    await openPrimaryQuestion(page);
    await waitForEditorText(page, primaryQuestion.starterCode, 30000);
    await setEditorValue(page, answerSource);
    await waitForWorkspaceAnswer(page, workspace.rootPath, primaryQuestion, answerSnippet);

    await runVisibleSamples(page);
    const attemptAfterRun = await waitForAttemptResult(
      page,
      workspace.rootPath,
      primaryQuestion.id,
      primaryQuestion.tests.length,
    );
    assert(
      attemptAfterRun.answers?.[primaryQuestion.id]?.runCount > 0,
      `Expected ${primaryQuestion.id} runCount to increment after running visible samples.`,
    );
    assert(
      attemptAfterRun.results?.[primaryQuestion.id]?.tests?.every((test) => test.passed),
      "Expected all visible sample tests to pass for the primary question.",
    );

    const timerBeforeReload = await waitForTimer(page);

    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForTestRoomReady(page);
    await openPrimaryQuestion(page);
    await waitForEditorText(page, answerSnippet, 30000);

    const timerAfterReload = await waitForTimer(page);
    const attemptAfterReload = await readWorkspaceJson(page, workspace.rootPath, "mock-attempt.json");
    assert(
      attemptAfterReload.id === initialAttempt.id,
      `Expected attempt id ${initialAttempt.id} to survive reload, got ${attemptAfterReload.id}`,
    );
    assert(
      attemptAfterReload.results?.[primaryQuestion.id]?.tests?.length === primaryQuestion.tests.length,
      "Expected visible sample test results to survive reload.",
    );

    const timerBeforeSeconds = timerTextToSeconds(timerBeforeReload.text);
    const timerAfterSeconds = timerTextToSeconds(timerAfterReload.text);
    assert(timerBeforeSeconds !== null, `Could not parse timer before reload: ${timerBeforeReload.text}`);
    assert(timerAfterSeconds !== null, `Could not parse timer after reload: ${timerAfterReload.text}`);
    assert(
      timerAfterSeconds <= timerBeforeSeconds && timerAfterSeconds >= timerBeforeSeconds - 30,
      `Expected timer to keep counting down across reload. Before=${timerBeforeReload.text}, After=${timerAfterReload.text}`,
    );

    mockApi.submitMode = "abort";
    await submitAttempt(page);
    const queuedState = await waitForQueuedSubmission(page, workspace.rootPath);
    const queuedSubmission = queuedState.queuedEntry.submission;
    assert(queuedSubmission.id, "Expected queued submission id to be persisted.");
    assert(
      extractAnswerSource(queuedSubmission, primaryQuestion.id).includes(answerSnippet),
      "Expected queued submission to contain the edited answer source.",
    );

    mockApi.submitMode = "success";
    await triggerQueuedSync(page);
    const syncedQueue = await waitForQueuedSync(page, workspace.rootPath, queuedSubmission.id, mockApi);
    const syncedEntry = Array.isArray(syncedQueue)
      ? syncedQueue.find((entry) => entry?.submission?.id === queuedSubmission.id)
      : null;
    if (syncedEntry) {
      assert(syncedEntry.status === "synced", `Expected queued submission status to become synced, got ${syncedEntry.status}`);
    }

    await openTeacherDashboard(page);
    await verifyTeacherRendering(page, queuedSubmission, mockApi);

    await page.screenshot({
      path: path.join(artifactsDir, "verify-test-room.png"),
      fullPage: true,
    });

    console.log(JSON.stringify({
      baseUrl,
      testUrl,
      teacherUrl,
      roomCode: TEST_ROOM_CODE,
      roomTitle: expectedRoomTitle,
      workspace: verificationWorkspace,
      studentId: verificationStudentId,
      studentName: verificationStudentName,
      attemptId: initialAttempt.id,
      answerPath: primaryQuestion.filename,
      visibleSamples: "ok",
      reloadPersistence: "ok",
      queuedSubmission: queuedSubmission.id,
      queuedSubmissionStatus: syncedEntry?.status || "removed-after-sync",
      mockedSubmitCalls: mockApi.submitRequests.length,
      mockedTeacherCalls: mockApi.teacherRequests.length,
      consoleErrors,
    }, null, 2));
  } catch (error) {
    await writeFailureArtifacts(page, mockApi, consoleErrors);
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
