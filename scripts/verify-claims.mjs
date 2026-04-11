import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "..");
const artifactsDir = path.join(workspaceRoot, "artifacts");
const profileDir = path.join(artifactsDir, "playwright-profile-claims");
const baseUrl = process.env.WASMFORGE_VERIFY_URL || "http://localhost:5173";
const landingUrl = new URL("/", baseUrl).toString();
const ideUrl = new URL("/ide", baseUrl).toString();
const verificationWorkspace = "playwright-claims";
const offlineProofWorkspace = "offline-proof-demo";

async function ensureArtifactsDir() {
  await fs.mkdir(artifactsDir, { recursive: true });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function openWorkspaceMenu(page) {
  await page.getByLabel("Workspace switcher").click();
  await page.getByText("Workspaces", { exact: true }).waitFor();
}

async function ensureVerificationWorkspace(page) {
  await openWorkspaceMenu(page);

  const workspaceButton = page.getByRole("button", {
    name: new RegExp(`^${escapeRegExp(verificationWorkspace)}$`),
  });

  if (await workspaceButton.count()) {
    await workspaceButton.click();
    return;
  }

  await page.getByPlaceholder("workspace-name").fill(verificationWorkspace);
  await page.getByRole("button", { name: "Add" }).click();
  await page.locator(`button[title="${verificationWorkspace}"]`).first().waitFor();
}

async function selectWorkspace(page, workspaceName) {
  await openWorkspaceMenu(page);
  await page.getByRole("button", {
    name: new RegExp(`^${escapeRegExp(workspaceName)}$`),
  }).click();
}

async function createFile(page, filename) {
  const maybeRow = page.getByText(filename, { exact: true });
  if (await maybeRow.count()) {
    await maybeRow.first().click();
    return;
  }

  await page.getByTitle("Create file").click();
  const input = page.getByPlaceholder("new-file.txt");
  await input.fill(filename);
  await input.press("Enter");
  await page.getByText(filename, { exact: true }).first().waitFor();
  await page.getByText(filename, { exact: true }).first().click();
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

async function clickRun(page) {
  await page.getByRole("button", { name: /Run/ }).click();
}

async function openOfflineProofFlow(page) {
  await page.getByRole("button", { name: "Open offline proof flow" }).click();
  await page.getByText("Offline reload shell", { exact: true }).waitFor({ timeout: 20000 });
}

async function waitForRunEnabled(page, timeout = 60000) {
  const runButton = page.getByRole("button", { name: /Run/ });
  await runButton.waitFor({ timeout });
  await page.waitForFunction(
    () => {
      const button = Array.from(document.querySelectorAll("button")).find((candidate) =>
        /\bRun\b/.test(candidate.textContent || ""),
      );
      return Boolean(button) && !button.disabled;
    },
    undefined,
    { timeout },
  );
}

async function showTerminal(page) {
  await page.getByText("TERMINAL", { exact: true }).click();
}

async function waitForTerminalText(page, text, timeout = 40000) {
  await page.waitForFunction(
    ({ selector, expected }) => {
      const element = document.querySelector(selector);
      return Boolean(element?.textContent?.includes(expected));
    },
    { selector: ".xterm-rows", expected: text },
    { timeout },
  );
}

async function waitForEditorText(page, text, timeout = 20000) {
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

async function verifyPythonExecutionProof(page) {
  await page.getByText("OUTPUT", { exact: true }).click();
  await page.getByText("Python Output", { exact: true }).waitFor({ timeout: 20000 });
  await page.getByText("Local runtime", { exact: true }).waitFor({ timeout: 20000 });
  await page.getByText("Duration", { exact: true }).waitFor({ timeout: 20000 });
  await page.getByText("Executed", { exact: true }).waitFor({ timeout: 20000 });
  await page.waitForFunction(
    () => {
      const text = document.body.innerText.toLowerCase();
      return (
        text.includes("python output") &&
        text.includes("executed on this device in") &&
        text.includes("duration") &&
        text.includes("executed") &&
        /\b\d+(?:\.\d+)?(?:ms|s)\b/.test(text) &&
        !text.includes("not available yet") &&
        !text.includes("waiting for a run")
      );
    },
    undefined,
    { timeout: 20000 },
  );
  await page.getByText("TERMINAL", { exact: true }).click();
}

async function waitForFigure(page, timeout = 60000) {
  await page.getByText("Python Output", { exact: true }).waitFor({ timeout });
  await page.locator('img[alt*="Figure"]').first().waitFor({ timeout });
}

async function verifyLandingOfflineProof(page) {
  await page.goto(landingUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByRole("link", { name: "See the proof" }).click();
  await page.getByText("90 seconds. No network.", { exact: true }).waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: /^Wi-Fi: ON$/ }).waitFor({ timeout: 20000 });

  await page.getByRole("button", { name: /^Wi-Fi: ON$/ }).click();
  await page.getByRole("button", { name: /^Wi-Fi: OFF$/ }).waitFor({ timeout: 20000 });
  await page.getByText("Turn Wi-Fi off. Airplane Mode is the real test.", { exact: true }).waitFor({ timeout: 20000 });
  await page.getByText("Run the file. The terminal or result panel still responds immediately.", { exact: true }).waitFor({ timeout: 20000 });
  await page.getByText("Hard refresh. The shell reloads from cache instead of a server.", { exact: true }).waitFor({ timeout: 20000 });
  await page.getByText("The same workspace is still there because files persist locally.", { exact: true }).waitFor({ timeout: 20000 });

  await page.getByRole("button", { name: /^Wi-Fi: OFF$/ }).click();
  await page.getByRole("button", { name: /^Wi-Fi: ON$/ }).waitFor({ timeout: 20000 });

  await page.context().setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByText("90 seconds. No network.", { exact: true }).waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: /^Wi-Fi: ON$/ }).waitFor({ timeout: 20000 });
  await page.context().setOffline(false);
}

async function prepareVisibleOfflineProof(page) {
  await openOfflineProofFlow(page);
  await page.getByText("Offline reload shell", { exact: true }).waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Prepare Demo Workspace", exact: true }).click();
  await page.getByText("main.py", { exact: true }).first().waitFor({ timeout: 30000 });
  await page.getByText("offline_helper.py", { exact: true }).first().waitFor({ timeout: 30000 });
  await page.waitForFunction(
    ({ workspaceName }) => {
      const text = document.body.innerText;
      return (
        text.includes("Offline Proof") &&
        text.includes(workspaceName) &&
        text.includes("Ready for Airplane Mode")
      );
    },
    { workspaceName: offlineProofWorkspace },
    { timeout: 60000 },
  );
}

async function ensureIdeLoaded(page) {
  await page.goto(ideUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByRole("button", { name: /Run/ }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
}

async function ensureServiceWorkerControl(page) {
  await page.waitForFunction(() => "serviceWorker" in navigator, undefined, { timeout: 30000 });
  await page.waitForFunction(
    async () => {
      try {
        await navigator.serviceWorker.ready;
        return true;
      } catch {
        return false;
      }
    },
    undefined,
    { timeout: 30000 },
  );

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const hasController = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
    if (hasController) {
      return;
    }

    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await page.getByRole("button", { name: /Run/ }).waitFor({ timeout: 60000 });
    await page.waitForTimeout(1000);
  }

  throw new Error("Service worker never took control of /ide");
}

async function readServiceWorkerState(page) {
  return page.evaluate(async () => {
    const cacheKeys = await caches.keys();
    const interestingUrls = new Set();

    for (const cacheKey of cacheKeys) {
      const cache = await caches.open(cacheKey);
      const requests = await cache.keys();
      for (const request of requests) {
        if (/pyodide|pglite|sql-wasm|workbox|manifest|index|matplotlib|contourpy|kiwisolver|pillow|fonttools|packaging|pyparsing|cycler/i.test(request.url)) {
          interestingUrls.add(request.url);
        }
      }
    }

    return {
      controlled: Boolean(navigator.serviceWorker.controller),
      ready: "serviceWorker" in navigator,
      cacheKeys,
      interestingUrls: Array.from(interestingUrls).slice(0, 60),
      hasRuntimeAssets: Array.from(interestingUrls).some((url) =>
        /pyodide|pglite|sql-wasm/i.test(url),
      ),
      hasMatplotlibAssets: Array.from(interestingUrls).some((url) =>
        /matplotlib|contourpy|kiwisolver|pillow|fonttools|packaging|pyparsing|cycler/i.test(url),
      ),
    };
  });
}

async function readIsolationState(page) {
  return page.evaluate(() => ({
    crossOriginIsolated: window.crossOriginIsolated === true,
    sharedArrayBuffer: typeof SharedArrayBuffer === "function",
    serviceWorkerController: Boolean(navigator.serviceWorker?.controller),
  }));
}

async function verifyOfflinePythonFlow(page) {
  await showTerminal(page);
  await prepareVisibleOfflineProof(page);
  await showTerminal(page);
  await page.getByText("main.py", { exact: true }).first().click();

  await page.context().setOffline(true);
  await waitForRunEnabled(page);
  await clickRun(page);
  await waitForTerminalText(page, "Offline proof > type any name:");
  await page.keyboard.insertText("cached");
  await page.keyboard.press("Enter");
  await waitForTerminalText(page, "offline-proof ok for cached");
  await waitForTerminalText(page, "helper-import ok 20");
  await waitForTerminalText(page, "[Local runtime] Executed on this device in ");
  await page.getByText(/^Local run /).first().waitFor({ timeout: 20000 });
  await verifyPythonExecutionProof(page);

  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByRole("button", { name: /Run/ }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(1200);
  await showTerminal(page);
  await page.getByText("main.py", { exact: true }).first().click();
  await waitForRunEnabled(page);
  await waitForEditorText(page, "Offline proof > type any name:");
  await clickRun(page);
  await waitForTerminalText(page, "Offline proof > type any name:");
  await page.keyboard.insertText("reload");
  await page.keyboard.press("Enter");
  await waitForTerminalText(page, "offline-proof ok for reload");
  await waitForTerminalText(page, "helper-import ok 20");
  await waitForTerminalText(page, "[Local runtime] Executed on this device in ");

  await page.context().setOffline(false);
  await ensureVerificationWorkspace(page);
}

async function verifyDataFrameOfflineFlow(page) {
  await createFile(page, "offline-dataframe.py");
  await setEditorValue(
    page,
    'import pandas as pd\n\nframe = pd.DataFrame([\n{"name": "Ada", "score": 42},\n{"name": "Linus", "score": 36},\n])\ndisplay(frame)\n',
  );

  await clickRun(page);
  await page.getByText("OUTPUT", { exact: true }).click();
  await page.getByRole("heading", { name: "DataFrame Preview" }).waitFor({ timeout: 40000 });
  await page.getByRole("table", { name: /DataFrame/i }).waitFor({ timeout: 40000 });
  await page.getByRole("columnheader", { name: "name", exact: true }).waitFor({ timeout: 40000 });
  await page.getByRole("columnheader", { name: "score", exact: true }).waitFor({ timeout: 40000 });
  await page.getByRole("cell", { name: "Ada", exact: true }).waitFor({ timeout: 40000 });
  await verifyPythonExecutionProof(page);

  await page.context().setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByRole("button", { name: /Run/ }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.getByText("offline-dataframe.py", { exact: true }).first().click();
  await waitForRunEnabled(page);
  await clickRun(page);
  await page.getByText("OUTPUT", { exact: true }).click();
  await page.getByRole("heading", { name: "DataFrame Preview" }).waitFor({ timeout: 40000 });
  await page.getByRole("table", { name: /DataFrame/i }).waitFor({ timeout: 40000 });
  await page.getByRole("cell", { name: "Linus", exact: true }).waitFor({ timeout: 40000 });
  await verifyPythonExecutionProof(page);
  await page.context().setOffline(false);
}

async function verifyMatplotlibOfflineFlow(page) {
  await createFile(page, "plot.py");
  await setEditorValue(
    page,
    'import matplotlib.pyplot as plt\nplt.plot([1, 2, 3], [1, 4, 9])\nplt.title("Offline Plot")\nplt.xlabel("x")\nplt.ylabel("y")\nplt.show()\n',
  );

  await clickRun(page);
  await waitForFigure(page);
  await verifyPythonExecutionProof(page);

  await page.context().setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByRole("button", { name: /Run/ }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.getByText("plot.py", { exact: true }).first().click();
  await clickRun(page);
  await waitForFigure(page);
  await verifyPythonExecutionProof(page);
  await page.context().setOffline(false);
}

async function verifyJavaScriptKillRecovery(page) {
  await showTerminal(page);
  await createFile(page, "kill.js");
  await setEditorValue(
    page,
    'console.log("kill-start");\nsetInterval(() => console.log("tick"), 25);\n',
  );
  await clickRun(page);
  await waitForTerminalText(page, "kill-start");
  await waitForTerminalText(page, "tick");
  await page.getByRole("button", { name: "Kill", exact: true }).click();
  await waitForTerminalText(page, "Execution killed by user.");

  await setEditorValue(page, 'console.log("kill-recovered");\n');
  await clickRun(page);
  await waitForTerminalText(page, "kill-recovered");
}

async function verifyPythonWatchdog(page) {
  await showTerminal(page);
  await createFile(page, "watchdog.py");
  await setEditorValue(page, "while True:\n    pass\n");
  await clickRun(page);
  await waitForTerminalText(page, "Execution timeout - infinite loop detected.", 20000);

  await setEditorValue(page, 'print("watchdog-ok")\n');
  await clickRun(page);
  await waitForTerminalText(page, "watchdog-ok");
  await waitForTerminalText(page, "[Local runtime] Executed on this device in ");
}

async function verifySqlitePersistence(page) {
  await createFile(page, "persist.sql");
  await setEditorValue(
    page,
    "create table if not exists people (name text);\ndelete from people;\ninsert into people (name) values ('sqlite-persist');\nselect name from people;\n",
  );
  await clickRun(page);
  await page.getByText("Query Results", { exact: true }).waitFor();
  await page.getByText("sqlite-persist", { exact: true }).waitFor({ timeout: 20000 });

  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByRole("button", { name: /Run/ }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.getByText("persist.sql", { exact: true }).first().click();
  await setEditorValue(page, "select name from people;\n");
  await clickRun(page);
  await page.getByText("sqlite-persist", { exact: true }).waitFor({ timeout: 20000 });
}

async function verifyPglitePersistence(page) {
  await createFile(page, "persist.pg");
  await setEditorValue(
    page,
    "create table if not exists members (name text);\ntruncate table members;\ninsert into members (name) values ('pg-persist');\nselect name from members;\n",
  );
  await clickRun(page);
  await page.getByText("Query Results", { exact: true }).waitFor();
  await page.getByText("pg-persist", { exact: true }).waitFor({ timeout: 20000 });

  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByRole("button", { name: /Run/ }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.getByText("persist.pg", { exact: true }).first().click();
  await setEditorValue(page, "select name from members;\n");
  await clickRun(page);
  await page.getByText("pg-persist", { exact: true }).waitFor({ timeout: 20000 });
}

async function verifyBrowserRestartPersistence() {
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    viewport: { width: 1600, height: 980 },
  });
  const page = context.pages()[0] || (await context.newPage());
  const consoleErrors = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(String(error));
  });

  return { context, page, consoleErrors };
}

async function verifyRestartedState(page) {
  await ensureIdeLoaded(page);
  await ensureServiceWorkerControl(page);
  await showTerminal(page);

  const activeWorkspace = await page.evaluate(() => window.localStorage.getItem("wasmforge:active-workspace"));
  if (activeWorkspace !== verificationWorkspace) {
    throw new Error(`Expected active workspace "${verificationWorkspace}" after restart, got "${activeWorkspace}"`);
  }

  await page.getByText("persist.sql", { exact: true }).first().click();
  await setEditorValue(page, "select name from people;\n");
  await clickRun(page);
  await page.getByText("sqlite-persist", { exact: true }).waitFor({ timeout: 20000 });

  await page.getByText("persist.pg", { exact: true }).first().click();
  await setEditorValue(page, "select name from members;\n");
  await clickRun(page);
  await page.getByText("pg-persist", { exact: true }).waitFor({ timeout: 20000 });

  await selectWorkspace(page, offlineProofWorkspace);
  await page.locator(`button[title="${offlineProofWorkspace}"]`).first().waitFor({ timeout: 30000 });
  await page.getByText("main.py", { exact: true }).first().waitFor({ timeout: 30000 });
  await waitForEditorText(page, "Offline proof > type any name:", 30000);
  await page.context().setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByRole("button", { name: /Run/ }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(1200);
  await showTerminal(page);
  await page.getByText("main.py", { exact: true }).first().click();
  await waitForRunEnabled(page);
  await waitForEditorText(page, "Offline proof > type any name:", 30000);
  await clickRun(page);
  await waitForTerminalText(page, "Offline proof > type any name:");
  await page.keyboard.insertText("restart");
  await page.keyboard.press("Enter");
  await waitForTerminalText(page, "offline-proof ok for restart");
  await waitForTerminalText(page, "helper-import ok 20");
  await verifyPythonExecutionProof(page);
  await page.context().setOffline(false);
}

async function main() {
  await ensureArtifactsDir();
  await fs.rm(profileDir, { recursive: true, force: true });

  const report = {
    baseUrl,
    ideUrl,
    workspace: verificationWorkspace,
  };

  let context;
  let page;
  let sessionConsoleErrors = [];
  let restartConsoleErrors = [];

  try {
    ({ context, page, consoleErrors: sessionConsoleErrors } = await verifyBrowserRestartPersistence());

    await ensureIdeLoaded(page);
    await ensureVerificationWorkspace(page);
    await ensureServiceWorkerControl(page);

    report.isolation = await readIsolationState(page);
    if (!report.isolation.crossOriginIsolated || !report.isolation.sharedArrayBuffer) {
      throw new Error("SharedArrayBuffer input prerequisites are not active");
    }

    report.serviceWorker = await readServiceWorkerState(page);
    if (
      !report.serviceWorker.controlled ||
      !report.serviceWorker.hasRuntimeAssets ||
      !report.serviceWorker.hasMatplotlibAssets
    ) {
      throw new Error("Service worker cache/runtime assets were not fully detected");
    }

    await verifyLandingOfflineProof(page);
    report.landingOfflineProof = "ok";

    await ensureIdeLoaded(page);
    await ensureVerificationWorkspace(page);

    await verifyOfflinePythonFlow(page);
    report.visibleOfflineProof = "ok";
    report.offlinePython = "ok";
    report.pythonExecutionProof = "ok";
    report.pythonMultiFileImports = "ok";

    await verifyDataFrameOfflineFlow(page);
    report.offlinePandasDataFrame = "ok";

    await verifyMatplotlibOfflineFlow(page);
    report.offlineMatplotlib = "ok";

    await verifyJavaScriptKillRecovery(page);
    report.javascriptKillRecovery = "ok";

    await verifyPythonWatchdog(page);
    report.pythonWatchdogRecovery = "ok";

    await verifySqlitePersistence(page);
    report.sqlitePersistence = "ok";

    await verifyPglitePersistence(page);
    report.pglitePersistence = "ok";

    await page.screenshot({
      path: path.join(artifactsDir, "verify-claims-main-session.png"),
      fullPage: true,
    });

    await context.close();

    ({ context, page, consoleErrors: restartConsoleErrors } = await verifyBrowserRestartPersistence());
    await verifyRestartedState(page);
    report.browserRestartPersistence = "ok";
    report.serviceWorkerAfterRestart = await readServiceWorkerState(page);

    await page.screenshot({
      path: path.join(artifactsDir, "verify-claims-restart-session.png"),
      fullPage: true,
    });

    report.restartConsoleErrors = restartConsoleErrors;
    report.consoleErrors = [...sessionConsoleErrors, ...restartConsoleErrors];
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await context?.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
