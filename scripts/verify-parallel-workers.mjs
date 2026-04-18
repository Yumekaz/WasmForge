import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const baseUrl = process.env.WASMFORGE_VERIFY_URL || "http://localhost:5173";
const ideUrl = new URL("/ide", baseUrl).toString();
const artifactsDir = path.resolve(__dirname, "..", "artifacts");
const verificationWorkspace = "playwright-parallel-workers";

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

async function waitForTerminalText(page, text, timeout = 90000) {
  await page.waitForFunction(
    ({ selector, expected }) => {
      const element = document.querySelector(selector);
      return Boolean(element?.textContent?.includes(expected));
    },
    { selector: ".xterm-rows", expected: text },
    { timeout },
  );
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
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
    await fs.mkdir(artifactsDir, { recursive: true });
    await page.goto(ideUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.getByRole("button", { name: /Run/ }).waitFor({ timeout: 60000 });
    await page.waitForTimeout(1200);
    await ensureVerificationWorkspace(page);

    await createFile(page, "verify-parallel.py");
    await setEditorValue(
      page,
      `from wasmforge_parallel import parallel_map

TASK = 'def work(x):\\n    return {"input": x, "square": x * x}\\n'

results = await parallel_map(TASK, "work", list(range(6)), workers=2)
print("parallel-ok", len(results), results[3]["square"], results[-1]["input"])

empty = await parallel_map(TASK, "work", [], workers=4)
print("parallel-empty-ok", empty)
`,
    );

    await clickRun(page);
    await waitForTerminalText(page, "[Parallel] 2 local Python workers used");
    await waitForTerminalText(page, "parallel-ok 6 9 5");
    await waitForTerminalText(page, "parallel-empty-ok []");
    await waitForTerminalText(page, "[Local runtime] Executed on this device in ");

    await createFile(page, "verify-parallel-error.py");
    await setEditorValue(
      page,
      `from wasmforge_parallel import parallel_map

await parallel_map("def bad(x):\\n    return {x}", "bad", [1], workers=1)
`,
    );
    await clickRun(page);
    await waitForTerminalText(page, "parallel_map failed", 90000);

    await setEditorValue(page, 'print("parallel-recovery-ok")\n');
    await clickRun(page);
    await waitForTerminalText(page, "parallel-recovery-ok", 30000);

    console.log(JSON.stringify({
      baseUrl,
      ideUrl,
      workspace: verificationWorkspace,
      pythonParallelWorkers: "ok",
      failureRecovery: "ok",
      consoleErrors,
    }, null, 2));
  } catch (error) {
    const terminalText = await page.locator(".xterm-rows").textContent().catch(() => "");
    await fs.writeFile(path.join(artifactsDir, "verify-parallel-terminal.txt"), terminalText || "");
    await page.screenshot({
      path: path.join(artifactsDir, "verify-parallel-failure.png"),
      fullPage: true,
    }).catch(() => undefined);
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
