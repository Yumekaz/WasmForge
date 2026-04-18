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
const nestedSeedFilename = "python/nested_demo.py";
const nestedSeedSource = 'print("nested seed from granted folder")\n';
const editedNestedSeedSource = 'print("edited nested file through Monaco")\n';
const detachedSeedSource = 'print("detached local change wins")\n';
const divergedDiskSeedSource = 'print("disk changed outside WasmForge during detach")\n';

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
  const maybeRow = page.getByText(displayName(filename), { exact: true });
  if (await maybeRow.count()) {
    await selectFile(page, filename);
    return;
  }

  await page.getByTitle("Create file").click();
  const input = page.getByPlaceholder("new-file.txt");
  await input.fill(filename);
  await input.press("Enter");
  await page.getByText(displayName(filename), { exact: true }).first().waitFor();
  await selectFile(page, filename);
}

async function selectFile(page, filename) {
  await page.getByText(displayName(filename), { exact: true }).first().click();
  await page.getByLabel(`Close ${filename}`).waitFor({ timeout: 20000 });
  await page.waitForTimeout(350);
}

async function openAirlockPanel(page) {
  const explicitButton = page.getByLabel(/Open Airlock panel/).first();
  if (await explicitButton.count()) {
    await explicitButton.click();
  } else {
    await page.getByRole("button", { name: /^Airlock$/ }).first().click();
  }

  await page.getByText("Airlock Sync", { exact: true }).first().waitFor({ timeout: 20000 });
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
  try {
    await page.waitForFunction(
      ({ selector, expected }) => {
        const element = document.querySelector(selector);
        return Boolean(element?.textContent?.includes(expected));
      },
      { selector: ".xterm-rows", expected: text },
      { timeout },
    );
  } catch (error) {
    const terminalText = await page.locator(".xterm-rows").textContent().catch(() => "");
    throw new Error(`Timed out waiting for terminal text "${text}". Terminal contained:\n${terminalText}`, {
      cause: error,
    });
  }
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

async function writeGrantedFile(page, filePath, content) {
  await page.evaluate(
    async ({ folderName, filePath: selectedPath, content: nextContent }) => {
      const root = await navigator.storage.getDirectory();
      let current = await root.getDirectoryHandle(folderName);
      const parts = selectedPath.split("/").filter(Boolean);
      for (const segment of parts.slice(0, -1)) {
        current = await current.getDirectoryHandle(segment, { create: true });
      }
      const fileHandle = await current.getFileHandle(parts.at(-1), { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(nextContent);
      await writable.close();
    },
    { folderName: grantedFolderName, filePath, content },
  );
}

function displayName(filePath) {
  return String(filePath).split("/").filter(Boolean).at(-1) || filePath;
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
    async ({
      folderName,
      seedText,
      seedFilename: grantedSeedFilename,
      seedSource: grantedSeedSource,
      nestedSeedFilename: grantedNestedSeedFilename,
      nestedSeedSource: grantedNestedSeedSource,
    }) => {
      const writeTextFile = async (directory, selectedPath, text) => {
        const parts = selectedPath.split("/").filter(Boolean);
        let current = directory;
        for (const segment of parts.slice(0, -1)) {
          current = await current.getDirectoryHandle(segment, { create: true });
        }
        const fileHandle = await current.getFileHandle(parts.at(-1), { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(text);
        await writable.close();
      };

      window.showDirectoryPicker = async () => {
        const root = await navigator.storage.getDirectory();
        const directory = await root.getDirectoryHandle(folderName, { create: true });

        for await (const [name, handle] of directory.entries()) {
          await directory.removeEntry(name, { recursive: handle.kind === "directory" }).catch(() => undefined);
        }

        await writeTextFile(directory, "input.txt", seedText);
        await writeTextFile(directory, grantedSeedFilename, grantedSeedSource);
        await writeTextFile(directory, grantedNestedSeedFilename, grantedNestedSeedSource);
        await writeTextFile(directory, ".vscode/settings.json", '{"editor.tabSize": 2}\n');
        await directory.getDirectoryHandle("empty-folder", { create: true });
        await writeTextFile(directory, "important.zip", "not really a zip in this mock");

        return directory;
      };
    },
    {
      folderName: grantedFolderName,
      seedText: inputValue,
      seedFilename,
      seedSource,
      nestedSeedFilename,
      nestedSeedSource,
    },
  );
}

async function renameFileFromTree(page, currentName, nextName) {
  await page.getByLabel(`More actions for ${currentName}`).click({ force: true });
  await page.getByRole("button", { name: "Rename" }).click();
  const renameInput = page.locator("input:focus").first();
  await renameInput.fill(nextName);
  await renameInput.press("Enter");
  await page.getByText(displayName(nextName), { exact: true }).first().waitFor({ timeout: 20000 });
}

async function deleteFileFromTree(page, filename) {
  await page.getByLabel(`More actions for ${filename}`).click({ force: true });
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByText(displayName(filename), { exact: true }).first().waitFor({ state: "detached", timeout: 20000 });
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
  await page.getByText("Linked real folder", { exact: true }).first().waitFor({ timeout: 20000 });
  await page.getByText(seedFilename, { exact: true }).first().waitFor({ timeout: 20000 });
  await page.getByText("input.txt", { exact: true }).first().waitFor({ timeout: 20000 });
  await page.getByText("python", { exact: true }).first().waitFor({ timeout: 20000 });
  await page.getByText(".vscode", { exact: true }).first().waitFor({ timeout: 20000 });
  await page.getByText("empty-folder", { exact: true }).first().waitFor({ timeout: 20000 });
  await page.getByText("important.zip", { exact: true }).first().waitFor({ timeout: 20000 });
  await page.getByText("nested_demo.py", { exact: true }).first().waitFor({ timeout: 20000 });

  await selectFile(page, seedFilename);
  await setEditorValue(page, editedSeedSource);
  await waitForGrantedFileText(page, seedFilename, "edited through Monaco");

  await selectFile(page, nestedSeedFilename);
  await setEditorValue(page, editedNestedSeedSource);
  await waitForGrantedFileText(page, nestedSeedFilename, "edited nested file");

  await createFile(page, "python/created-nested.py");
  if (!(await grantedFileExists(page, "python/created-nested.py"))) {
    throw new Error("Expected python/created-nested.py to be created in the granted folder.");
  }

  await renameFileFromTree(page, "python/created-nested.py", "python/renamed-nested.py");
  if (!(await grantedFileExists(page, "python/renamed-nested.py"))) {
    throw new Error("Expected python/renamed-nested.py to exist in the granted folder.");
  }
  await deleteFileFromTree(page, "python/renamed-nested.py");
  if (await grantedFileExists(page, "python/renamed-nested.py")) {
    throw new Error("Expected python/renamed-nested.py to be deleted from the granted folder.");
  }

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

async function verifyNaturalPythonLocalFolder(page) {
  await page.getByRole("button", { name: "Clear" }).click();
  await createFile(page, "local-fs-python-natural.py");
  await setEditorValue(
    page,
    `import os
from pathlib import Path

input_text = Path("input.txt").read_text()
print("natural-input-read", input_text)

file = open("plain-open.txt", "w")
wrote = file.write("plain-open:" + input_text)
file.close()
print("natural-open-write-return", wrote)
exec('with open("context-open.txt", "w") as context_file:\\n    context_file.write("context-open")\\n')

nested_file = open("python/plain-nested.txt", "w")
nested_file.write("plain-nested")
nested_file.close()

Path("pathlib-write.txt").write_text("pathlib-write")
Path("python/pathlib-nested.txt").write_text("pathlib-nested")

print("natural-list-has-input", "input.txt" in os.listdir())
print("natural-list-has-python", "python" in os.listdir("."))
print("natural-list-has-nested-seed", "nested_demo.py" in os.listdir("python"))
print("natural-cwd", os.getcwd())
print("natural-pathlib-read", Path("plain-open.txt").read_text())
print("natural-context-read", Path("context-open.txt").read_text())
print("natural-pathlib-nested-read", Path("python/pathlib-nested.txt").read_text())
`,
  );

  await clickRun(page);
  await waitForTerminalText(page, `natural-input-read ${inputValue}`);
  await waitForTerminalText(page, `natural-open-write-return ${`plain-open:${inputValue}`.length}`);
  await waitForTerminalText(page, "natural-list-has-input True");
  await waitForTerminalText(page, "natural-list-has-python True");
  await waitForTerminalText(page, "natural-list-has-nested-seed True");
  await waitForTerminalText(page, "natural-cwd /local");
  await waitForTerminalText(page, `natural-pathlib-read plain-open:${inputValue}`);
  await waitForTerminalText(page, "natural-context-read context-open");
  await waitForTerminalText(page, "natural-pathlib-nested-read pathlib-nested");

  const plainOpenResult = await readGrantedFile(page, "plain-open.txt");
  if (plainOpenResult !== `plain-open:${inputValue}`) {
    throw new Error(`Expected natural Python open() write in granted folder, got "${plainOpenResult}"`);
  }

  const plainNestedResult = await readGrantedFile(page, "python/plain-nested.txt");
  if (plainNestedResult !== "plain-nested") {
    throw new Error(`Expected natural Python nested open() write in granted folder, got "${plainNestedResult}"`);
  }

  const contextResult = await readGrantedFile(page, "context-open.txt");
  if (contextResult !== "context-open") {
    throw new Error(`Expected context-manager open() write in granted folder, got "${contextResult}"`);
  }

  const pathlibResult = await readGrantedFile(page, "pathlib-write.txt");
  if (pathlibResult !== "pathlib-write") {
    throw new Error(`Expected pathlib write in granted folder, got "${pathlibResult}"`);
  }

  const pathlibNestedResult = await readGrantedFile(page, "python/pathlib-nested.txt");
  if (pathlibNestedResult !== "pathlib-nested") {
    throw new Error(`Expected nested pathlib write in granted folder, got "${pathlibNestedResult}"`);
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

async function verifyDetachAndReattach(page) {
  await openAirlockPanel(page);
  await page.getByRole("button", { name: "Turn Sync Off" }).click();
  await page.getByText("Detached local shadow", { exact: true }).first().waitFor({ timeout: 20000 });

  const snapshotCountBeforeManualSave = await page.getByRole("button", { name: "Restore" }).count();
  await page.getByRole("button", { name: "Save Snapshot" }).click();
  await page.getByRole("button", { name: "Restore" }).nth(snapshotCountBeforeManualSave).waitFor({ timeout: 20000 });

  await selectFile(page, seedFilename);
  await setEditorValue(page, detachedSeedSource);
  await page.waitForTimeout(600);
  const diskSeedWhileDetached = await readGrantedFile(page, seedFilename);
  if (diskSeedWhileDetached !== editedSeedSource) {
    throw new Error(`Expected detached edits to stay out of the granted folder while sync is off. Saw ${JSON.stringify(diskSeedWhileDetached)} instead of ${JSON.stringify(editedSeedSource)}.`);
  }

  await createFile(page, "shadow-only.py");
  await setEditorValue(page, 'print("shadow only file")\n');
  await page.waitForTimeout(600);
  if (await grantedFileExists(page, "shadow-only.py")) {
    throw new Error("Expected detached shadow-only.py to stay out of the granted folder.");
  }

  await createFile(page, "local-fs-after-detach.py");
  await setEditorValue(
    page,
    `import os
from wasmforge_fs import is_connected

print("fs-after-detach", is_connected())
print("cwd-after-detach", os.getcwd())
open("sandbox-only.txt", "w", encoding="utf-8").write("sandbox")
`,
  );

  await clickRun(page);
  await waitForTerminalText(page, "fs-after-detach False");
  await waitForTerminalText(page, "cwd-after-detach /workspace");

  if (await grantedFileExists(page, "sandbox-only.txt")) {
    throw new Error("Expected normal open() after detach to stay in the browser workspace, not the granted folder.");
  }

  await writeGrantedFile(page, seedFilename, divergedDiskSeedSource);
  await openAirlockPanel(page);
  await page.getByRole("button", { name: "Turn Sync On" }).click();
  await page.getByText("Conflict Center", { exact: true }).first().waitFor({ timeout: 20000 });

  await page.getByRole("button", { name: "Keep Local" }).first().click();

  await page.getByRole("button", { name: "Complete Reattach" }).click();
  await page.getByText("Linked real folder", { exact: true }).first().waitFor({ timeout: 20000 });

  const seedAfterReattach = await readGrantedFile(page, seedFilename);
  if (seedAfterReattach !== detachedSeedSource) {
    throw new Error("Expected Keep Local to push the detached version back to disk.");
  }
  if (!(await grantedFileExists(page, "shadow-only.py"))) {
    throw new Error("Expected shadow-only.py to be pushed to disk during reattach.");
  }
}

async function verifyUnlink(page) {
  await openAirlockPanel(page);
  await page.getByRole("button", { name: "Unlink" }).click();
  await page.getByText("Airlock shadow workspace saved locally", { exact: true }).first().waitFor({ timeout: 20000 });

  await createFile(page, "local-fs-after-unlink.py");
  await setEditorValue(
    page,
    `from wasmforge_fs import is_connected

print("fs-after-unlink", is_connected())
`,
  );

  await clickRun(page);
  await waitForTerminalText(page, "fs-after-unlink False");

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
    await page.getByRole("button", { name: "Link local folder" }).first().click();
    await page.getByText(`Airlock sync on: ${grantedFolderName}`, { exact: false }).first().waitFor({ timeout: 20000 });
    await verifyExplorerBridge(page);
    await verifyPythonBridge(page);
    await verifyNaturalPythonLocalFolder(page);
    await verifyJavaScriptBridge(page);
    await verifyTypeScriptBridge(page);
    await verifyDetachAndReattach(page);
    await verifyUnlink(page);

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
      naturalPythonLocalFolder: "ok",
      javascriptBridge: "ok",
      typescriptBridge: "ok",
      detachReattach: "ok",
      unlink: "ok",
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
