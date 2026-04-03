import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "..");
const artifactsDir = path.join(workspaceRoot, "artifacts");
const baseUrl = process.env.WASMFORGE_VERIFY_URL || "http://localhost:5173";
const verificationWorkspace = "playwright-verify";
const mobileFilename = "mobile-verify.ts";

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

  await page.getByPlaceholder("sql-practice").fill(verificationWorkspace);
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
  const input = page.getByPlaceholder("new-file.py");
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

async function main() {
  await ensureArtifactsDir();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 430, height: 932 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
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
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.getByRole("button", { name: "Explorer", exact: true }).waitFor({ timeout: 60000 });
    await page.waitForTimeout(1500);

    await page.getByRole("button", { name: "Explorer", exact: true }).click();
    await ensureVerificationWorkspace(page);
    await createFile(page, mobileFilename);

    await page.getByRole("button", { name: "Search" }).click();
    await page.getByPlaceholder("Search files in this workspace").fill("mobile");
    await page.getByPlaceholder("Search files in this workspace").waitFor();

    await page.getByRole("button", { name: "Editor" }).click();
    await setEditorValue(page, 'const square = (value: number) => value * value;\nconsole.log("ts-mobile", square(7));\n');

    await page.getByLabel("Run current file").waitFor({ timeout: 20000 });
    await page.getByLabel("Run current file").click();
    await page.waitForFunction(
      () => document.querySelector(".xterm-rows")?.textContent?.includes("ts-mobile 49"),
      undefined,
      { timeout: 20000 },
    );

    await page.screenshot({
      path: path.join(artifactsDir, "verify-mobile-editor.png"),
      fullPage: true,
    });

    await page.getByRole("button", { name: "Console" }).click();
    await page.getByText("TERMINAL", { exact: true }).waitFor();
    await page.getByText("OUTPUT", { exact: true }).waitFor();

    await page.screenshot({
      path: path.join(artifactsDir, "verify-mobile-ui.png"),
      fullPage: true,
    });

    console.log(JSON.stringify({
      baseUrl,
      workspace: verificationWorkspace,
      mobileNavigation: "ok",
      mobileSearch: "ok",
      mobileRun: "ok",
      mobileConsole: "ok",
      consoleErrors,
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
