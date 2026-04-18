#!/usr/bin/env node

import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4173;
const RUN_CLEANUP_DELAY_MS = 90_000;
const MAX_TEXT_FILES = 512;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;

const toolchainCache = new Map();
const runs = new Map();

function parseCliArgs(argv) {
  const parsed = {
    host: process.env.WASMFORGE_BRIDGE_HOST || DEFAULT_HOST,
    port: Number.parseInt(process.env.WASMFORGE_BRIDGE_PORT || `${DEFAULT_PORT}`, 10) || DEFAULT_PORT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--host" && argv[index + 1]) {
      parsed.host = argv[index + 1];
      index += 1;
      continue;
    }

    if (token === "--port" && argv[index + 1]) {
      const nextPort = Number.parseInt(argv[index + 1], 10);
      if (Number.isFinite(nextPort) && nextPort > 0) {
        parsed.port = nextPort;
      }
      index += 1;
    }
  }

  return parsed;
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Private-Network": "true",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function normalizeSnapshotPath(value) {
  const normalized = String(value ?? "")
    .replace(/\\/gu, "/")
    .trim()
    .replace(/^\/+/u, "");

  if (!normalized) {
    throw new Error("Snapshot paths are required.");
  }

  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    throw new Error("Snapshot paths must stay inside the workspace.");
  }

  return parts.join("/");
}

function getFileExtension(filename = "") {
  return filename.includes(".")
    ? filename.split(".").pop()?.toLowerCase() || ""
    : "";
}

function quoteShellValue(value) {
  return /\s/u.test(value) ? `"${value}"` : value;
}

function createRunError(message, context = {}) {
  const error = new Error(message);
  Object.assign(error, context);
  return error;
}

function pushRunEvent(run, kind, data) {
  if (!data) {
    return;
  }

  run.events.push({
    index: run.events.length,
    kind,
    data: String(data),
  });
}

function scheduleRunCleanup(run) {
  if (run.cleanupTimer) {
    clearTimeout(run.cleanupTimer);
  }

  run.cleanupTimer = setTimeout(() => {
    void cleanupRun(run.id);
  }, RUN_CLEANUP_DELAY_MS);
}

async function cleanupRun(runId) {
  const run = runs.get(runId);
  if (!run) {
    return;
  }

  if (run.cleanupTimer) {
    clearTimeout(run.cleanupTimer);
  }

  runs.delete(runId);
  if (run.tempDirectory) {
    await fs.rm(run.tempDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const rawText = Buffer.concat(chunks).toString("utf8");
  if (!rawText.trim()) {
    return {};
  }

  try {
    return JSON.parse(rawText);
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

async function findCommand(command) {
  if (toolchainCache.has(command)) {
    return toolchainCache.get(command);
  }

  const locator = process.platform === "win32" ? "where.exe" : "which";
  const result = await new Promise((resolve) => {
    const child = spawn(locator, [command], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.on("error", () => {
      resolve(null);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }

      const firstMatch = stdout
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .find(Boolean);
      resolve(firstMatch || null);
    });
  });

  toolchainCache.set(command, result);
  return result;
}

async function detectCapabilities() {
  const toolchainDefs = [
    { id: "gcc", label: "gcc", command: "gcc" },
    { id: "clang", label: "clang", command: "clang" },
    { id: "g++", label: "g++", command: "g++" },
    { id: "clang++", label: "clang++", command: "clang++" },
    { id: "go", label: "Go", command: "go" },
    { id: "rustc", label: "rustc", command: "rustc" },
    { id: "javac", label: "javac", command: "javac" },
    { id: "java", label: "java", command: "java" },
    { id: "zig", label: "zig", command: "zig" },
  ];

  const toolchains = await Promise.all(toolchainDefs.map(async (toolchain) => {
    const resolvedPath = await findCommand(toolchain.command);
    return {
      ...toolchain,
      available: Boolean(resolvedPath),
      resolvedPath: resolvedPath || "",
    };
  }));

  const toolchainMap = new Map(toolchains.map((toolchain) => [toolchain.command, toolchain]));
  const available = (commands) => commands
    .map((command) => toolchainMap.get(command))
    .find((toolchain) => toolchain?.available) || null;

  const runners = [];
  const cCompiler = available(["gcc", "clang"]);
  if (cCompiler) {
    runners.push({
      id: "c",
      label: `C (${cCompiler.command})`,
      language: "C",
      command: cCompiler.command,
      toolchain: cCompiler.command,
      extensions: ["c"],
    });
  }

  const cppCompiler = available(["g++", "clang++"]);
  if (cppCompiler) {
    runners.push({
      id: "cpp",
      label: `C++ (${cppCompiler.command})`,
      language: "C++",
      command: cppCompiler.command,
      toolchain: cppCompiler.command,
      extensions: ["cc", "cpp", "cxx"],
    });
  }

  const go = available(["go"]);
  if (go) {
    runners.push({
      id: "go",
      label: "Go",
      language: "Go",
      command: go.command,
      toolchain: go.command,
      extensions: ["go"],
    });
  }

  const rustc = available(["rustc"]);
  if (rustc) {
    runners.push({
      id: "rust",
      label: "Rust",
      language: "Rust",
      command: rustc.command,
      toolchain: rustc.command,
      extensions: ["rs"],
    });
  }

  const javac = available(["javac"]);
  const java = available(["java"]);
  if (javac && java) {
    runners.push({
      id: "java",
      label: "Java",
      language: "Java",
      command: javac.command,
      toolchain: `${javac.command} + ${java.command}`,
      extensions: ["java"],
    });
  }

  const zig = available(["zig"]);
  if (zig) {
    runners.push({
      id: "zig",
      label: "Zig",
      language: "Zig",
      command: zig.command,
      toolchain: zig.command,
      extensions: ["zig"],
    });
  }

  return {
    version: "1",
    platform: process.platform,
    nodeVersion: process.version,
    toolchains,
    runners,
  };
}

async function createSnapshot(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("Host runs require at least one workspace file.");
  }

  if (files.length > MAX_TEXT_FILES) {
    throw new Error(`Host runs support at most ${MAX_TEXT_FILES} text files per snapshot.`);
  }

  let totalBytes = 0;
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "wasmforge-bridge-"));

  for (const file of files) {
    const normalizedPath = normalizeSnapshotPath(file?.path || file?.name);
    const content = String(file?.content ?? "");
    totalBytes += Buffer.byteLength(content, "utf8");

    if (totalBytes > MAX_TOTAL_BYTES) {
      await fs.rm(tempDirectory, { recursive: true, force: true }).catch(() => undefined);
      throw new Error(`Host runs support up to ${Math.round(MAX_TOTAL_BYTES / (1024 * 1024))}MB of text snapshot data.`);
    }

    const absolutePath = path.join(tempDirectory, normalizedPath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, "utf8");
  }

  return tempDirectory;
}

function collectSourceFiles(files, extensions, entrypoint) {
  const extensionSet = new Set(extensions);
  const normalizedEntrypoint = normalizeSnapshotPath(entrypoint);
  const sourceFiles = files
    .map((file) => normalizeSnapshotPath(file?.path || file?.name))
    .filter((filename) => extensionSet.has(getFileExtension(filename)));

  const deduped = Array.from(new Set(sourceFiles));
  deduped.sort((left, right) => left.localeCompare(right));

  if (deduped.includes(normalizedEntrypoint)) {
    return [normalizedEntrypoint, ...deduped.filter((filename) => filename !== normalizedEntrypoint)];
  }

  return deduped;
}

async function killProcessTree(pid) {
  if (!pid) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", `${pid}`, "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.on("error", () => resolve());
      killer.on("close", () => resolve());
    });
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Ignore processes that already exited.
    }
  }
}

function createCommandPreview(command, args) {
  return [command, ...args].map((value) => quoteShellValue(String(value))).join(" ");
}

async function runCommand(run, command, args, options = {}) {
  const commandPreview = createCommandPreview(command, args);
  pushRunEvent(run, "status", `${options.stageLabel || "Running"}: ${commandPreview}`);

  const child = spawn(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env || {}) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
  });

  run.child = child;
  run.commandPreview = commandPreview;

  child.stdout.on("data", (chunk) => {
    pushRunEvent(run, "stdout", chunk.toString("utf8"));
  });
  child.stderr.on("data", (chunk) => {
    pushRunEvent(run, "stderr", chunk.toString("utf8"));
  });

  const closeResult = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({ code, signal });
    });
  });

  run.child = null;

  if (run.killed) {
    return closeResult;
  }

  if (closeResult.code !== 0) {
    throw createRunError(
      `${options.failureLabel || "Command failed"}${Number.isFinite(closeResult.code) ? ` (exit ${closeResult.code})` : ""}`,
      {
        exitCode: closeResult.code,
        commandPreview,
      },
    );
  }

  return closeResult;
}

async function executeRunner(run, payload, capabilities) {
  const normalizedEntrypoint = normalizeSnapshotPath(payload.entrypoint);
  const snapshotFiles = Array.isArray(payload.files) ? payload.files : [];
  const entryExtension = getFileExtension(normalizedEntrypoint);
  const runner = capabilities.runners.find((candidate) => candidate.extensions.includes(entryExtension));

  if (!runner) {
    throw new Error(`No host runner is installed for .${entryExtension || "txt"} files.`);
  }

  run.runnerLabel = runner.label;
  run.tempDirectory = await createSnapshot(snapshotFiles);

  const executablePath = path.join(
    run.tempDirectory,
    process.platform === "win32" ? "wasmforge-host-run.exe" : "wasmforge-host-run",
  );

  switch (runner.id) {
    case "c": {
      const sourceFiles = collectSourceFiles(snapshotFiles, ["c"], normalizedEntrypoint);
      await runCommand(run, runner.command, [...sourceFiles, "-o", executablePath], {
        cwd: run.tempDirectory,
        stageLabel: "Compiling C",
        failureLabel: "C compilation failed",
      });
      await runCommand(run, executablePath, [], {
        cwd: run.tempDirectory,
        stageLabel: "Executing binary",
        failureLabel: "C program failed",
      });
      return;
    }

    case "cpp": {
      const sourceFiles = collectSourceFiles(snapshotFiles, ["cc", "cpp", "cxx"], normalizedEntrypoint);
      await runCommand(run, runner.command, [...sourceFiles, "-o", executablePath], {
        cwd: run.tempDirectory,
        stageLabel: "Compiling C++",
        failureLabel: "C++ compilation failed",
      });
      await runCommand(run, executablePath, [], {
        cwd: run.tempDirectory,
        stageLabel: "Executing binary",
        failureLabel: "C++ program failed",
      });
      return;
    }

    case "go":
      await runCommand(run, runner.command, ["run", normalizedEntrypoint], {
        cwd: run.tempDirectory,
        stageLabel: "Running Go",
        failureLabel: "Go program failed",
      });
      return;

    case "rust":
      await runCommand(run, runner.command, [normalizedEntrypoint, "-o", executablePath], {
        cwd: run.tempDirectory,
        stageLabel: "Compiling Rust",
        failureLabel: "Rust compilation failed",
      });
      await runCommand(run, executablePath, [], {
        cwd: run.tempDirectory,
        stageLabel: "Executing binary",
        failureLabel: "Rust program failed",
      });
      return;

    case "java": {
      const javaFiles = collectSourceFiles(snapshotFiles, ["java"], normalizedEntrypoint);
      await runCommand(run, "javac", javaFiles, {
        cwd: run.tempDirectory,
        stageLabel: "Compiling Java",
        failureLabel: "Java compilation failed",
      });

      const className = path.basename(normalizedEntrypoint, ".java");
      await runCommand(run, "java", ["-cp", run.tempDirectory, className], {
        cwd: run.tempDirectory,
        stageLabel: "Running Java",
        failureLabel: "Java program failed",
      });
      return;
    }

    case "zig":
      await runCommand(run, runner.command, ["run", normalizedEntrypoint], {
        cwd: run.tempDirectory,
        stageLabel: "Running Zig",
        failureLabel: "Zig program failed",
      });
      return;

    default:
      throw new Error(`Unsupported host runner "${runner.id}".`);
  }
}

async function startRun(payload) {
  const runId = randomUUID();
  const capabilities = await detectCapabilities();
  const run = {
    id: runId,
    events: [],
    child: null,
    commandPreview: "",
    runnerLabel: "",
    tempDirectory: "",
    exitCode: null,
    durationMs: null,
    error: "",
    done: false,
    killed: false,
    cleanupTimer: null,
    startedAt: Date.now(),
  };

  runs.set(runId, run);

  void (async () => {
    try {
      await executeRunner(run, payload, capabilities);
      run.exitCode = 0;
    } catch (error) {
      if (run.killed) {
        run.exitCode = typeof error?.exitCode === "number" ? error.exitCode : null;
      } else {
        run.error = error?.message || String(error);
        if (error?.commandPreview && !run.commandPreview) {
          run.commandPreview = error.commandPreview;
        }
        run.exitCode = typeof error?.exitCode === "number" ? error.exitCode : 1;
      }
    } finally {
      run.durationMs = Date.now() - run.startedAt;
      run.done = true;
      pushRunEvent(
        run,
        "status",
        run.killed
          ? "Host process stopped."
          : run.error
            ? `Host run failed: ${run.error}`
            : "Host run completed.",
      );
      scheduleRunCleanup(run);
    }
  })();

  return run;
}

function parseRunId(url) {
  const match = url.pathname.match(/^\/runs\/([^/]+?)(?:\/kill)?$/u);
  return match ? decodeURIComponent(match[1]) : "";
}

function serializeRun(run, cursor = 0) {
  const safeCursor = Math.max(0, Number.parseInt(`${cursor}`, 10) || 0);
  const events = run.events.slice(safeCursor);

  return {
    ok: true,
    runId: run.id,
    events,
    nextCursor: run.events.length,
    done: run.done,
    killed: run.killed,
    durationMs: run.durationMs,
    exitCode: run.exitCode,
    error: run.error,
    runnerLabel: run.runnerLabel,
    commandPreview: run.commandPreview,
  };
}

async function handleRequest(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host || `${DEFAULT_HOST}:${DEFAULT_PORT}`}`);

  if (request.method === "OPTIONS") {
    writeJson(response, 204, {});
    return;
  }

  try {
    if (request.method === "GET" && url.pathname === "/health") {
      const capabilities = await detectCapabilities();
      writeJson(response, 200, {
        ok: true,
        status: "Host bridge ready",
        ...capabilities,
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/runs") {
      const payload = await readJsonBody(request);
      const run = await startRun(payload);
      writeJson(response, 202, {
        ok: true,
        runId: run.id,
      });
      return;
    }

    if (request.method === "GET" && /^\/runs\/[^/]+$/u.test(url.pathname)) {
      const runId = parseRunId(url);
      const run = runs.get(runId);
      if (!run) {
        writeJson(response, 404, { error: `No run exists with id ${runId}.` });
        return;
      }

      writeJson(response, 200, serializeRun(run, url.searchParams.get("cursor")));
      return;
    }

    if (request.method === "POST" && /^\/runs\/[^/]+\/kill$/u.test(url.pathname)) {
      const runId = parseRunId(url);
      const run = runs.get(runId);
      if (!run) {
        writeJson(response, 404, { error: `No run exists with id ${runId}.` });
        return;
      }

      run.killed = true;
      pushRunEvent(run, "status", "Stopping host process...");
      await killProcessTree(run.child?.pid);
      writeJson(response, 200, { ok: true, runId });
      return;
    }

    writeJson(response, 404, { error: `Unknown endpoint: ${request.method} ${url.pathname}` });
  } catch (error) {
    writeJson(response, 400, { error: error?.message || String(error) });
  }
}

const config = parseCliArgs(process.argv.slice(2));
const server = http.createServer((request, response) => {
  void handleRequest(request, response);
});

server.listen(config.port, config.host, () => {
  const address = `http://${config.host}:${config.port}`;
  console.log(`[WasmForge Bridge] listening on ${address}`);
  console.log(`[WasmForge Bridge] start WasmForge, click Host Bridge, and run C/C++/Go/Rust/Java/Zig files against local toolchains.`);
});
