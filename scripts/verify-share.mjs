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
const sourceWorkspace = "playwright-share-source";
const shareFilename = "shared-demo.ts";
const shareCode = 'const square = (value: number) => value * value;\nconsole.log("share-ok", square(7));\n';

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

async function ensureWorkspace(page, workspaceName) {
  await openWorkspaceMenu(page);
  const workspaceButton = page.getByRole("button", {
    name: new RegExp(`^${escapeRegExp(workspaceName)}$`),
  });

  if (await workspaceButton.count()) {
    await workspaceButton.click();
    return;
  }

  await page.getByPlaceholder("workspace-name").fill(workspaceName);
  await page.getByRole("button", { name: "Add" }).click();
  await page.locator(`button[title="${workspaceName}"]`).first().waitFor();
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

async function waitForTerminalText(page, text, timeout = 20000) {
  await page.waitForFunction(
    ({ selector, expected }) => {
      const element = document.querySelector(selector);
      return Boolean(element?.textContent?.includes(expected));
    },
    { selector: ".xterm-rows", expected: text },
    { timeout },
  );
}

async function ensureIdeLoaded(page) {
  await page.goto(ideUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByRole("button", { name: /Run/ }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
}

async function readClipboard(page) {
  return page.evaluate(async () => navigator.clipboard.readText());
}

async function waitForEditorText(page, text, timeout = 20000) {
  await page.waitForFunction(
    (expected) => document.querySelector(".view-lines")?.textContent?.includes(expected),
    text,
    { timeout },
  );
}

async function main() {
  await ensureArtifactsDir();
  const browser = await chromium.launch({ headless: true });
  const sourceContext = await browser.newContext({ viewport: { width: 1600, height: 980 } });
  const sourceOrigin = new URL(baseUrl).origin;
  await sourceContext.grantPermissions(["clipboard-read", "clipboard-write"], { origin: sourceOrigin });
  const sourcePage = await sourceContext.newPage();
  const sourceConsoleErrors = [];

  sourcePage.on("console", (message) => {
    if (message.type() === "error") {
      sourceConsoleErrors.push(message.text());
    }
  });
  sourcePage.on("pageerror", (error) => {
    sourceConsoleErrors.push(String(error));
  });

  let receiverContext;
  let receiverPage;
  const receiverConsoleErrors = [];

  try {
    await ensureIdeLoaded(sourcePage);
    await ensureWorkspace(sourcePage, sourceWorkspace);
    await createFile(sourcePage, shareFilename);
    await setEditorValue(sourcePage, shareCode);

    await sourcePage.getByRole("button", { name: "Copy share link" }).click();
    const shareUrl = await readClipboard(sourcePage);
    if (!shareUrl.includes("#share=")) {
      throw new Error("Expected clipboard share URL to contain a #share payload");
    }

    const sourceActiveWorkspace = await sourcePage.evaluate(() => window.localStorage.getItem("wasmforge:active-workspace"));
    if (sourceActiveWorkspace !== sourceWorkspace) {
      throw new Error(`Expected source workspace to remain "${sourceWorkspace}", got "${sourceActiveWorkspace}"`);
    }

    receiverContext = await browser.newContext({ viewport: { width: 1600, height: 980 } });
    receiverPage = await receiverContext.newPage();

    receiverPage.on("console", (message) => {
      if (message.type() === "error") {
        receiverConsoleErrors.push(message.text());
      }
    });
    receiverPage.on("pageerror", (error) => {
      receiverConsoleErrors.push(String(error));
    });

    await receiverPage.goto(shareUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await receiverPage.getByRole("button", { name: /Run/ }).waitFor({ timeout: 60000 });
    await receiverPage.waitForTimeout(1800);
    await receiverPage.getByText(shareFilename, { exact: true }).first().waitFor({ timeout: 20000 });
    await waitForEditorText(receiverPage, "share-ok");

    const sharedWorkspace = await receiverPage.evaluate(() => window.localStorage.getItem("wasmforge:active-workspace"));
    if (!/^shared-/u.test(sharedWorkspace || "")) {
      throw new Error(`Expected a dedicated shared workspace, got "${sharedWorkspace}"`);
    }

    await clickRun(receiverPage);
    await waitForTerminalText(receiverPage, "share-ok 49");

    await receiverPage.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await receiverPage.getByRole("button", { name: /Run/ }).waitFor({ timeout: 60000 });
    await receiverPage.waitForTimeout(1200);
    await receiverPage.getByText(shareFilename, { exact: true }).first().click();
    await clickRun(receiverPage);
    await waitForTerminalText(receiverPage, "share-ok 49");

    await receiverPage.screenshot({
      path: path.join(artifactsDir, "verify-share.png"),
      fullPage: true,
    });

    console.log(JSON.stringify({
      baseUrl,
      ideUrl,
      sourceWorkspace,
      sharedWorkspace,
      shareCopy: "ok",
      shareImport: "ok",
      shareExecution: "ok",
      shareReloadPersistence: "ok",
      consoleErrors: [...sourceConsoleErrors, ...receiverConsoleErrors],
    }, null, 2));
  } finally {
    await receiverContext?.close().catch(() => undefined);
    await sourceContext.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
