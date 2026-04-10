import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "..");
const artifactsDir = path.join(workspaceRoot, "artifacts");
const baseUrl = process.env.WASMFORGE_VERIFY_URL || "http://localhost:5173";
const ideUrl = new URL("/ide", baseUrl).toString();
const verificationWorkspace = "playwright-verify";

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
  const workspaceButton = page.getByRole("button", { name: new RegExp(`^${escapeRegExp(verificationWorkspace)}$`) });
  if (await workspaceButton.count()) {
    await workspaceButton.click();
    return;
  }

  await page.getByPlaceholder("workspace-name").fill(verificationWorkspace);
  await page.getByRole("button", { name: "Add" }).click();
  await page.locator(`button[title="${verificationWorkspace}"]`).first().waitFor();
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

async function waitForTerminalText(page, text) {
  const locator = page.locator(".xterm-rows");
  await page.waitForFunction(
    ({ selector, expected }) => {
      const element = document.querySelector(selector);
      return Boolean(element?.textContent?.includes(expected));
    },
    { selector: ".xterm-rows", expected: text },
    { timeout: 20000 },
  );
  return locator.textContent();
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

async function verifyPython(page) {
  await createFile(page, "verify.py");
  await setEditorValue(page, 'name = input("Name: ")\nprint(f"py-ok {name}")\n');
  await clickRun(page);
  await waitForTerminalText(page, "Name:");
  await page.keyboard.insertText("WasmForge");
  await page.keyboard.press("Enter");
  await waitForTerminalText(page, "py-ok WasmForge");
  await waitForTerminalText(page, "[Local runtime] Executed on this device in ");
  await page.getByText(/^Local run /).first().waitFor({ timeout: 20000 });
  await verifyPythonExecutionProof(page);
}

async function verifyPythonMultiFileImports(page) {
  await createFile(page, "helper_module.py");
  await setEditorValue(
    page,
    'import numpy as np\n\n\ndef describe(name):\n    return f"import-ok v1 {name} {int(np.arange(4).sum())}"\n',
  );

  await createFile(page, "imports_main.py");
  await setEditorValue(
    page,
    'from helper_module import describe\n\nprint(describe("alpha"))\n',
  );

  await clickRun(page);
  await waitForTerminalText(page, "import-ok v1 alpha 6");

  await page.getByText("helper_module.py", { exact: true }).first().click();
  await setEditorValue(
    page,
    'import numpy as np\n\n\ndef describe(name):\n    return f"import-ok v2 {name} {int(np.arange(5).sum())}"\n',
  );

  await page.getByText("imports_main.py", { exact: true }).first().click();
  await clickRun(page);
  await waitForTerminalText(page, "import-ok v2 alpha 10");
  await waitForTerminalText(page, "[Local runtime] Executed on this device in ");
}

async function verifyJavaScript(page) {
  await createFile(page, "verify.js");
  await setEditorValue(page, 'console.log("js-ok");\nsetTimeout(() => console.log("js-async"), 20);\n');
  await clickRun(page);
  await waitForTerminalText(page, "js-ok");
  await waitForTerminalText(page, "js-async");
}

async function verifyTypeScript(page) {
  await createFile(page, "verify.ts");
  await setEditorValue(page, 'const add = (a: number, b: number) => a + b;\nconsole.log("ts-ok", add(2, 3));\n');
  await clickRun(page);
  await waitForTerminalText(page, "ts-ok 5");
}

async function verifyMatplotlib(page) {
  await createFile(page, "verify-plot.py");
  await setEditorValue(
    page,
    'import matplotlib.pyplot as plt\nplt.plot([1, 2, 3], [1, 4, 9])\nplt.title("WasmForge Plot")\nplt.xlabel("x")\nplt.ylabel("y")\nplt.show()\n',
  );
  await clickRun(page);
  await page.getByText("Python Output", { exact: true }).waitFor({ timeout: 60000 });
  await page.locator('img[alt*="Figure"]').first().waitFor({ timeout: 60000 });
  await verifyPythonExecutionProof(page);
}

async function verifySqlite(page) {
  await createFile(page, "verify.sql");
  await setEditorValue(page, "create table if not exists people (name text);\ndelete from people;\ninsert into people (name) values ('Ada');\nselect name from people;\n");
  await clickRun(page);
  await page.getByText("Query Results", { exact: true }).waitFor();
  await page.getByText("Ada", { exact: true }).waitFor({ timeout: 20000 });
  await page.getByText("Schema Inspector", { exact: true }).waitFor();
}

async function verifyPglite(page) {
  await createFile(page, "verify.pg");
  await setEditorValue(page, "create table if not exists members (name text);\ntruncate table members;\ninsert into members (name) values ('Linus');\nselect name from members;\n");
  await clickRun(page);
  await page.getByText("Query Results", { exact: true }).waitFor();
  await page.getByText("Linus", { exact: true }).waitFor({ timeout: 20000 });
}

async function verifyPersistence(page) {
  await page.getByText("verify.ts", { exact: true }).first().click();
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByRole("button", { name: /Run/ }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.getByText("verify.ts", { exact: true }).first().click();
  await page.waitForFunction(
    () => document.body.innerText.includes("verify.ts"),
    undefined,
    { timeout: 10000 },
  );
}

async function main() {
  await ensureArtifactsDir();
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

  try {
    await page.goto(ideUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.getByRole("button", { name: /Run/ }).waitFor({ timeout: 60000 });
    await page.waitForTimeout(1500);
    await ensureVerificationWorkspace(page);
    await verifyPython(page);
    await verifyPythonMultiFileImports(page);
    await verifyJavaScript(page);
    await verifyTypeScript(page);
    await verifyMatplotlib(page);
    await verifySqlite(page);
    await verifyPglite(page);
    await verifyPersistence(page);

    await page.screenshot({
      path: path.join(artifactsDir, "verify-ide.png"),
      fullPage: true,
    });

    const report = {
      baseUrl,
      ideUrl,
      workspace: verificationWorkspace,
      python: "ok",
      pythonExecutionProof: "ok",
      pythonMultiFileImports: "ok",
      javascript: "ok",
      typescript: "ok",
      matplotlib: "ok",
      sqlite: "ok",
      pglite: "ok",
      persistence: "ok",
      consoleErrors,
    };

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
