import { normalizeQueue } from "./mockTest.js";

function createHealthState(overrides = {}) {
  return {
    ok: false,
    status: "unknown",
    configured: false,
    databaseReady: false,
    httpStatus: null,
    message: "",
    ...overrides,
  };
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function normalizeHealthPayload(response, payload) {
  const env = payload?.env && typeof payload.env === "object" ? payload.env : {};
  const rawStatus = String(payload?.status || "").trim().toLowerCase();
  const configured = rawStatus === "backend_not_configured"
    ? false
    : Boolean(
      payload?.configured ??
      (payload?.databaseConfigured && payload?.teacherPinConfigured) ??
      (env.databaseUrlConfigured && env.teacherPinConfigured) ??
      (payload?.database?.configured && payload?.teacherPin?.configured),
    );
  let databaseReady = false;
  if (typeof payload?.databaseReady === "boolean") {
    databaseReady = payload.databaseReady;
  } else if (typeof payload?.database?.ready === "boolean") {
    databaseReady = payload.database.ready;
  } else if (rawStatus === "ready") {
    databaseReady = true;
  } else {
    databaseReady = response.ok && configured;
  }
  const message = String(payload?.message || payload?.error || "").trim();

  return createHealthState({
    ok: response.ok,
    status:
      rawStatus === "backend_not_configured"
        ? "not_configured"
        : rawStatus === "database_unavailable"
          ? "degraded"
          : configured
            ? (databaseReady ? "ready" : "degraded")
            : "not_configured",
    configured,
    databaseReady,
    httpStatus: response.status,
    message,
  });
}

function createApiError(message, payload, response) {
  const error = new Error(
    String(
      payload?.message ||
      payload?.error ||
      message ||
      "Request failed",
    ),
  );

  error.code = payload?.code || payload?.error || "";
  error.httpStatus = response?.status ?? null;
  return error;
}

async function submitSingleSubmission(submission) {
  let response;
  try {
    response = await fetch("/api/test/submit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(submission),
    });
  } catch (error) {
    throw createApiError(error?.message || "Network request failed");
  }

  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw createApiError("Submission sync failed", payload, response);
  }

  return payload;
}

export async function fetchTestHealth() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return createHealthState({
      status: "offline",
      message: "Offline",
    });
  }

  try {
    const response = await fetch("/api/test/health", {
      headers: {
        accept: "application/json",
      },
    });
    const payload = await readJsonResponse(response);
    return normalizeHealthPayload(response, payload);
  } catch (error) {
    return createHealthState({
      status: "error",
      message: error?.message || "Health check failed",
    });
  }
}

export async function syncQueuedSubmissions(queue) {
  const nextQueue = normalizeQueue(queue).map((entry) => ({ ...entry }));
  const pendingEntries = nextQueue.filter((entry) => entry.status === "queued");

  if (pendingEntries.length === 0) {
    return {
      queue: nextQueue,
      syncedCount: 0,
      health: await fetchTestHealth(),
      lastError: "",
    };
  }

  const health = await fetchTestHealth();
  if (health.status === "offline" || !health.configured || !health.databaseReady) {
    return {
      queue: nextQueue,
      syncedCount: 0,
      health,
      lastError: health.message,
    };
  }

  let syncedCount = 0;
  let lastError = "";

  for (const entry of nextQueue) {
    if (entry.status !== "queued") {
      continue;
    }

    try {
      await submitSingleSubmission(entry.submission);
      entry.status = "synced";
      entry.syncedAt = Date.now();
      entry.lastError = "";
      syncedCount += 1;
    } catch (error) {
      entry.lastError = error?.message || "Submission sync failed";
      lastError = entry.lastError;

      if (error?.httpStatus === 503 || error?.code === "backend_not_configured") {
        return {
          queue: nextQueue,
          syncedCount,
          health: createHealthState({
            ok: false,
            status: "not_configured",
            configured: false,
            databaseReady: false,
            httpStatus: error?.httpStatus ?? 503,
            message: entry.lastError,
          }),
          lastError,
        };
      }

      return {
        queue: nextQueue,
        syncedCount,
        health: createHealthState({
          ok: false,
          status: "error",
          configured: true,
          databaseReady: true,
          httpStatus: error?.httpStatus ?? null,
          message: entry.lastError,
        }),
        lastError,
      };
    }
  }

  return {
    queue: nextQueue,
    syncedCount,
    health,
    lastError,
  };
}

export function getQueueCounts(queue) {
  return normalizeQueue(queue).reduce(
    (totals, entry) => ({
      queued: totals.queued + (entry.status === "queued" ? 1 : 0),
      synced: totals.synced + (entry.status === "synced" ? 1 : 0),
    }),
    {
      queued: 0,
      synced: 0,
    },
  );
}
