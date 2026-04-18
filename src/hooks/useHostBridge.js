import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_BRIDGE_URL = "http://127.0.0.1:4173";
const BRIDGE_URL_STORAGE_KEY = "wasmforge:host-bridge-url";
const RUN_POLL_INTERVAL_MS = 180;

function normalizeBridgeUrl(value = DEFAULT_BRIDGE_URL) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return DEFAULT_BRIDGE_URL;
  }

  return trimmed.replace(/\/+$/u, "");
}

function readStoredBridgeUrl() {
  if (typeof window === "undefined") {
    return DEFAULT_BRIDGE_URL;
  }

  try {
    return normalizeBridgeUrl(window.localStorage.getItem(BRIDGE_URL_STORAGE_KEY) || DEFAULT_BRIDGE_URL);
  } catch {
    return DEFAULT_BRIDGE_URL;
  }
}

function persistBridgeUrl(url) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(BRIDGE_URL_STORAGE_KEY, normalizeBridgeUrl(url));
  } catch {
    // Ignore storage failures and keep the in-memory URL.
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createDisconnectedState(url) {
  return {
    url,
    connected: false,
    status: "Host bridge offline",
    lastError: "",
    capabilities: null,
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const rawText = await response.text();
  let payload = null;

  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = { error: rawText };
    }
  }

  if (!response.ok) {
    const message =
      payload?.error ||
      payload?.message ||
      `${response.status} ${response.statusText}`.trim();
    throw new Error(message || "Bridge request failed");
  }

  return payload;
}

function normalizeCapabilities(payload, url) {
  const runners = Array.isArray(payload?.runners)
    ? payload.runners.map((runner) => ({
        id: String(runner?.id || "").trim(),
        label: String(runner?.label || runner?.language || "Host runtime").trim(),
        language: String(runner?.language || runner?.label || "Host runtime").trim(),
        command: String(runner?.command || "").trim(),
        extensions: Array.isArray(runner?.extensions)
          ? runner.extensions.map((extension) => String(extension || "").trim().toLowerCase()).filter(Boolean)
          : [],
        toolchain: String(runner?.toolchain || runner?.command || "").trim(),
      })).filter((runner) => runner.id && runner.extensions.length > 0)
    : [];

  const toolchains = Array.isArray(payload?.toolchains)
    ? payload.toolchains.map((toolchain) => ({
        id: String(toolchain?.id || toolchain?.command || "").trim(),
        label: String(toolchain?.label || toolchain?.command || toolchain?.id || "").trim(),
        available: Boolean(toolchain?.available),
        resolvedPath: String(toolchain?.resolvedPath || "").trim(),
      }))
    : [];

  return {
    url,
    version: String(payload?.version || "").trim(),
    platform: String(payload?.platform || "").trim(),
    nodeVersion: String(payload?.nodeVersion || "").trim(),
    runners,
    toolchains,
  };
}

function getFileExtension(filename = "") {
  return filename.includes(".")
    ? filename.split(".").pop()?.toLowerCase() || ""
    : "";
}

export function useHostBridge({
  onStdout,
  onStderr,
  onStatus,
} = {}) {
  const onStdoutRef = useRef(onStdout);
  const onStderrRef = useRef(onStderr);
  const onStatusRef = useRef(onStatus);
  const activeRunRef = useRef(null);
  const unmountedRef = useRef(false);
  const [bridgeState, setBridgeState] = useState(() => createDisconnectedState(readStoredBridgeUrl()));
  const [isRunning, setIsRunning] = useState(false);
  const [lastRun, setLastRun] = useState(null);

  useEffect(() => {
    onStdoutRef.current = onStdout;
  }, [onStdout]);

  useEffect(() => {
    onStderrRef.current = onStderr;
  }, [onStderr]);

  useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);

  const emitStatus = useCallback((message = "") => {
    if (!message) {
      return;
    }
    onStatusRef.current?.(message);
  }, []);

  const applyHealthPayload = useCallback((payload, url) => {
    const normalizedUrl = normalizeBridgeUrl(url);
    const capabilities = normalizeCapabilities(payload, normalizedUrl);
    persistBridgeUrl(normalizedUrl);
    setBridgeState({
      url: normalizedUrl,
      connected: true,
      status: payload?.status || "Host bridge ready",
      lastError: "",
      capabilities,
    });
    return capabilities;
  }, []);

  const refresh = useCallback(async ({ url = bridgeState.url, silent = false } = {}) => {
    const normalizedUrl = normalizeBridgeUrl(url);
    if (!silent) {
      setBridgeState((previous) => ({
        ...previous,
        url: normalizedUrl,
        status: "Connecting to host bridge...",
        lastError: "",
      }));
    }

    try {
      const payload = await fetchJson(`${normalizedUrl}/health`, { method: "GET", headers: {} });
      return applyHealthPayload(payload, normalizedUrl);
    } catch (error) {
      if (!unmountedRef.current) {
        setBridgeState((previous) => ({
          ...createDisconnectedState(normalizedUrl),
          lastError: error?.message || String(error),
        }));
      }
      if (!silent) {
        throw error;
      }
      return null;
    }
  }, [applyHealthPayload, bridgeState.url]);

  useEffect(() => {
    unmountedRef.current = false;
    void refresh({ silent: true });

    return () => {
      unmountedRef.current = true;
    };
  }, [refresh]);

  const connect = useCallback(async (url = bridgeState.url) => {
    const capabilities = await refresh({ url, silent: false });
    emitStatus("Host bridge ready");
    return capabilities;
  }, [bridgeState.url, emitStatus, refresh]);

  const disconnect = useCallback(() => {
    if (activeRunRef.current) {
      throw new Error("Stop the active host process before disconnecting the bridge.");
    }

    setBridgeState((previous) => createDisconnectedState(previous.url));
  }, []);

  const getRunnerForFilename = useCallback((filename = "") => {
    const extension = getFileExtension(filename);
    if (!extension) {
      return null;
    }

    return bridgeState.capabilities?.runners?.find((runner) => runner.extensions.includes(extension)) || null;
  }, [bridgeState.capabilities]);

  const killRun = useCallback(async () => {
    const activeRun = activeRunRef.current;
    if (!activeRun) {
      return { ok: false, killed: false };
    }

    await fetchJson(`${bridgeState.url}/runs/${encodeURIComponent(activeRun.id)}/kill`, {
      method: "POST",
      body: JSON.stringify({}),
    });

    emitStatus("Stopping host process...");
    return { ok: true, killed: true };
  }, [bridgeState.url, emitStatus]);

  const runSnapshot = useCallback(async ({
    entrypoint,
    files,
  }) => {
    if (!bridgeState.connected) {
      throw new Error("Host bridge is not connected.");
    }

    if (activeRunRef.current) {
      throw new Error("A host process is already running.");
    }

    const runner = getRunnerForFilename(entrypoint);
    if (!runner) {
      throw new Error(`No host runner is available for ${entrypoint}.`);
    }

    setIsRunning(true);
    setLastRun(null);
    emitStatus(`Running ${runner.label}...`);

    const payload = await fetchJson(`${bridgeState.url}/runs`, {
      method: "POST",
      body: JSON.stringify({
        entrypoint,
        files,
      }),
    });

    const runId = String(payload?.runId || "").trim();
    if (!runId) {
      setIsRunning(false);
      throw new Error("The host bridge did not return a run id.");
    }

    activeRunRef.current = {
      id: runId,
      cursor: 0,
    };

    try {
      while (true) {
        const activeRun = activeRunRef.current;
        if (!activeRun || activeRun.id !== runId) {
          throw new Error("Host run was interrupted.");
        }

        const result = await fetchJson(
          `${bridgeState.url}/runs/${encodeURIComponent(runId)}?cursor=${activeRun.cursor}`,
          { method: "GET", headers: {} },
        );

        const events = Array.isArray(result?.events) ? result.events : [];
        for (const event of events) {
          const kind = String(event?.kind || "").trim();
          const data = String(event?.data || "");

          if (kind === "stdout") {
            onStdoutRef.current?.(data);
            continue;
          }

          if (kind === "stderr") {
            onStderrRef.current?.(data);
            continue;
          }

          if (kind === "status") {
            emitStatus(data);
          }
        }

        activeRun.cursor = Number.isFinite(result?.nextCursor)
          ? Number(result.nextCursor)
          : activeRun.cursor + events.length;

        if (result?.done) {
          const summary = {
            runId,
            durationMs: Number.isFinite(result?.durationMs) ? Number(result.durationMs) : null,
            exitCode: Number.isFinite(result?.exitCode) ? Number(result.exitCode) : null,
            killed: Boolean(result?.killed),
            runnerLabel: String(result?.runnerLabel || runner.label || "Host runtime").trim(),
            commandPreview: String(result?.commandPreview || "").trim(),
            error: String(result?.error || "").trim(),
          };
          setLastRun(summary);
          emitStatus(summary.error ? "Host run failed" : "Host bridge ready");
          return summary;
        }

        await delay(RUN_POLL_INTERVAL_MS);
      }
    } finally {
      activeRunRef.current = null;
      setIsRunning(false);
    }
  }, [bridgeState.connected, bridgeState.url, emitStatus, getRunnerForFilename]);

  const availableLanguages = useMemo(() => (
    bridgeState.capabilities?.runners?.map((runner) => runner.label) || []
  ), [bridgeState.capabilities]);

  return {
    bridgeUrl: bridgeState.url,
    connected: bridgeState.connected,
    status: bridgeState.status,
    lastError: bridgeState.lastError,
    capabilities: bridgeState.capabilities,
    availableLanguages,
    isRunning,
    lastRun,
    connect,
    disconnect,
    refresh,
    runSnapshot,
    killRun,
    getRunnerForFilename,
  };
}
