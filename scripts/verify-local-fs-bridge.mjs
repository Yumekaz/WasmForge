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
const verificationWorkspace = "playwright-local-fs";
const grantedFolderName = "playwright-granted-local-folder";
const inputValue = `bridge-input-${Date.now()}`;
const seedFilename = "bridge_seed.py";
const seedSource = 'print("seed from granted folder")\n';
const editedSeedSource = 'print("edited through Monaco into granted folder")\n';

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

async function readGrantedFile(page, filePath) {
  return page.evaluate(
    async ({ folderName, filePath: selectedPath }) => {
      const root = await navigator.storage.getDirectory();
      let current = await root.getDirectoryHandle(folderName);
      const parts = selectedPath.split("/").filter(Boolean);
      for (const segment of parts.slice(0, -1)) {
        current = await current.getDirectoryHandle(segment);
      }
      const fileHandle = await current.getFileHandle(parts.at(-1));
      return (await fileHandle.getFile()).text();
    },
    { folderName: grantedFolderName, filePath },
  );
}

async function grantedFileExists(page, filePath) {
  return page.evaluate(
    async ({ folderName, filePath: selectedPath }) => {
      try {
        const root = await navigator.storage.getDirectory();
        let current = await root.getDirectoryHandle(folderName);
        const parts = selectedPath.split("/").filter(Boolean);
        for (const segment of parts.slice(0, -1)) {
          current = await current.getDirectoryHandle(segment);
        }
        await current.getFileHandle(parts.at(-1));
        return true;
      } catch {
        return false;
      }
    },
    { folderName: grantedFolderName, filePath },
  );
}

async function waitForGrantedFileText(page, filePath, expectedText) {
  await page.waitForFunction(
    async ({ folderName, filePath: selectedPath, expected }) => {
      try {
        const root = await navigator.storage.getDirectory();
        let current = await root.getDirectoryHandle(folderName);
        const parts = selectedPath.split("/").filter(Boolean);
        for (const segment of parts.slice(0, -1)) {
          current = await current.getDirectoryHandle(segment);
        }
        const fileHandle = await current.getFileHandle(parts.at(-1));
        const text = await (await fileHandle.getFile()).text();
        return text.includes(expected);
      } catch {
        return false;
      }
    },
    { folderName: grantedFolderName, filePath, expected: expectedText },
    { timeout: 20000 },
  );
}

async function installDirectoryPickerMock(page) {
  await page.addInitScript(
    async ({ folderName, seedText, seedFilename: grantedSeedFilename, seedSource: grantedSeedSource }) => {
      window.showDirectoryPicker = async () => {
        const root = await navigator.storage.getDirectory();
        const directory = await root.getDirectoryHandle(folderName, { create: true });

        for await (const [name, handle] of directory.entries()) {
          await directory.removeEntry(name, { recursive: handle.kind === "directory" }).catch(() => undefined);
        }

        const inputHandle = await directory.getFileHandle("input.txt", { create: true });
        const inputWritable = await inputHandle.createWritable();
        await inputWritable.write(seedText);
        await inputWritable.close();

        const seedHandle = await directory.getFileHandle(grantedSeedFilename, { create: true });
        const seedWritable = await seedHandle.createWritable();
        await seedWritable.write(grantedSeedSource);
        await seedWritable.close();

        return directory;
      };
    },
    {
      folderName: grantedFolderName,
      seedText: inputValue,
      seedFilename,
      seedSource,
    },
  );
}

async function renameFileFromTree(page, currentName, nextName) {
  await page.getByLabel(`More actions for ${currentName}`).click({ force: true });
  await page.getByRole("button", { name: "Rename" }).click();
  const renameInput = page.locator("input:focus").first();
  await renameInput.fill(nextName);
  await renameInput.press("Enter");
  await page.getByText(nextName, { exact: true }).first().waitFor({ timeout: 20000 });
}

async function deleteFileFromTree(page, filename) {
  await page.getByLabel(`More actions for ${filename}`).click({ force: true });
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByText(filename, { exact: true }).first().waitFor({ state: "detached", timeout: 20000 });
}

async function verifyDefaultSandbox(page) {
  await createFile(page, "local-fs-default.py");
  await setEditorValue(
    page,
    `from wasmforge_fs import is_connected, read_text

print("fs-default-connected", is_connected())
exec('try:\\n    read_text("input.txt")\\nexcept RuntimeError as exc:\\n    print("fs-default-blocked", str(exc).split(".")[0])\\n')
`,
  );

  await clickRun(page);
  await waitForTerminalText(page, "fs-default-connected False");
  await waitForTerminalText(page, "fs-default-blocked No local folder connected");
}

async function verifyExplorerBridge(page) {
  await page.getByText("Selected local folder", { exact: true }).waitFor({ timeout: 20000 });
  await page.getByText(seedFilename, { exact: true }).first().waitFor({ timeout: 20000 });
  await page.getByText("input.txt", { exact: true }).first().waitFor({ timeout: 20000 });

  await page.getByText(seedFilename, { exact: true }).first().click();
  await setEditorValue(page, editedSeedSource);
  await waitForGrantedFileText(page, seedFilename, "edited through Monaco");

  await createFile(page, "created-from-explorer.py");
  if (!(await grantedFileExists(page, "created-from-explorer.py"))) {
    throw new Error("Expected created-from-explorer.py to be created in the granted folder.");
  }

  await renameFileFromTree(page, "created-from-explorer.py", "renamed-from-explorer.py");
  if (!(await grantedFileExists(page, "renamed-from-explorer.py"))) {
    throw new Error("Expected renamed-from-explorer.py to exist in the granted folder.");
  }
  if (await grantedFileExists(page, "created-from-explorer.py")) {
    throw new Error("Expected created-from-explorer.py to be removed after rename.");
  }

  await deleteFileFromTree(page, "renamed-from-explorer.py");
  if (await grantedFileExists(page, "renamed-from-explorer.py")) {
    throw new Error("Expected renamed-from-explorer.py to be deleted from the granted folder.");
  }
}

async function verifyPythonBridge(page) {
  await createFile(page, "local-fs-python.py");
  await setEditorValue(
    page,
    `from wasmforge_fs import is_connected, list_files, local_root, read_text, write_text

print("fs-connected", is_connected(), local_root())
value = read_text("input.txt")
print("fs-read", value)
print("fs-list-has-input", "input.txt" in list_files("."))
write_text("out/result.txt", "python:" + value)
exec('try:\\n    read_text("../escape.txt")\\nexcept ValueError as exc:\\n    print("fs-escape-blocked", type(exc).__name__)\\n')
`,
  );

  await clickRun(page);
  await waitForTerminalText(page, `fs-connected True ${grantedFolderName}`);
  await waitForTerminalText(page, `fs-read ${inputValue}`);
  await waitForTerminalText(page, "fs-list-has-input True");
  await waitForTerminalText(page, "[Local folder] Wrote out/result.txt");
  await waitForTerminalText(page, "fs-escape-blocked ValueError");

  const result = await readGrantedFile(page, "out/result.txt");
  if (result !== `python:${inputValue}`) {
    throw new Error(`Expected Python local file write, got "${result}"`);
  }
}

async function verifyJavaScriptBridge(page) {
  await createFile(page, "local-fs-js.js");
  await setEditorValue(
    page,
    `console.log("js-fs-connected", wasmforgeFS.isConnected(), wasmforgeFS.localRoot());
const value = await wasmforgeFS.readText("input.txt");
console.log("js-fs-read", value);
await wasmforgeFS.writeText("js-result.txt", "js:" + value);
try {
  await wasmforgeFS.readText("../escape.txt");
} catch (error) {
  console.log("js-escape-blocked", error.constructor.name);
}
`,
  );

  await clickRun(page);
  await waitForTerminalText(page, `js-fs-connected true ${grantedFolderName}`);
  await waitForTerminalText(page, `js-fs-read ${inputValue}`);
  await waitForTerminalText(page, "[Local folder] Wrote js-result.txt");
  await waitForTerminalText(page, "js-escape-blocked Error");

  const result = await readGrantedFile(page, "js-result.txt");
  if (result !== `js:${inputValue}`) {
    throw new Error(`Expected JavaScript local file write, got "${result}"`);
  }
}

async function verifyTypeScriptBridge(page) {
  await createFile(page, "local-fs-ts.ts");
  await setEditorValue(
    page,
    `const value: string = await wasmforgeFS.readText("input.txt");
await wasmforgeFS.writeText("ts-result.txt", "ts:" + value);
console.log("ts-fs-read", value);
`,
  );

  await clickRun(page);
  await waitForTerminalText(page, `ts-fs-read ${inputValue}`);
  await waitForTerminalText(page, "[Local folder] Wrote ts-result.txt");

  const result = await readGrantedFile(page, "ts-result.txt");
  if (result !== `ts:${inputValue}`) {
    throw new Error(`Expected TypeScript local file write, got "${result}"`);
  }
}

async function verifyDisconnect(page) {
  await page.getByRole("button", { name: new RegExp(`Disconnect local folder ${escapeRegExp(grantedFolderName)}`) }).click();
  await page.getByText("Sandboxed browser workspace", { exact: true }).waitFor({ timeout: 20000 });

  await createFile(page, "local-fs-after-disconnect.py");
  await setEditorValue(
    page,
    `from wasmforge_fs import is_connected

print("fs-after-disconnect", is_connected())
`,
  );

  await clickRun(page);
  await waitForTerminalText(page, "fs-after-disconnect False");
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
    await installDirectoryPickerMock(page);
    await page.goto(ideUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.getByRole("button", { name: /Run/ }).waitFor({ timeout: 60000 });
    await page.waitForTimeout(1500);
    await ensureWorkspace(page, verificationWorkspace);

    await verifyDefaultSandbox(page);
    await page.getByRole("button", { name: "Connect local folder" }).click();
    await page.getByText(`Local folder: ${grantedFolderName}`, { exact: false }).waitFor({ timeout: 20000 });
    await waitForTerminalText(page, `Connected "${grantedFolderName}"`);
    await verifyExplorerBridge(page);
    await verifyPythonBridge(page);
    await verifyJavaScriptBridge(page);
    await verifyTypeScriptBridge(page);
    await verifyDisconnect(page);

    await page.screenshot({
      path: path.join(artifactsDir, "verify-local-fs-bridge.png"),
      fullPage: true,
    });

    console.log(JSON.stringify({
      baseUrl,
      ideUrl,
      workspace: verificationWorkspace,
      grantedFolder: grantedFolderName,
      defaultSandbox: "ok",
      explorerBridge: "ok",
      pythonBridge: "ok",
      javascriptBridge: "ok",
      typescriptBridge: "ok",
      disconnect: "ok",
      consoleErrors,
    }, null, 2));
  } catch (error) {
    const terminalText = await page.locator(".xterm-rows").textContent().catch(() => "");
    await fs.writeFile(path.join(artifactsDir, "verify-local-fs-terminal.txt"), terminalText || "");
    await page.screenshot({
      path: path.join(artifactsDir, "verify-local-fs-failure.png"),
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
