import { getBackendConfigState, getTestBackendConfig } from "../_lib/test-config.js";
import { upsertTestSubmission } from "../_lib/test-db.js";
import { getMethod, methodNotAllowed, readJsonBody, sendJson } from "../_lib/test-http.js";
import { validateSubmissionRequest } from "../_lib/test-validation.js";

export default async function handler(req, res) {
  if (getMethod(req) !== "POST") {
    return methodNotAllowed(req, res, ["POST"]);
  }

  const config = getTestBackendConfig();
  if (!config.configured) {
    return sendJson(res, 503, {
      ok: false,
      error: "backend_not_configured",
      message: "Test submission sync is unavailable because backend environment variables are missing.",
      config: getBackendConfigState(config),
    });
  }

  let body;

  try {
    body = await readJsonBody(req);
  } catch (error) {
    return sendJson(res, 400, {
      ok: false,
      error: "invalid_json",
      message: String(error?.message || error || "Request body must be valid JSON."),
    });
  }

  let validated;

  try {
    validated = validateSubmissionRequest(body);
  } catch (error) {
    return sendJson(res, 400, {
      ok: false,
      error: "invalid_submission",
      message: String(error?.message || error || "Submission payload is invalid."),
    });
  }

  try {
    const stored = await upsertTestSubmission({
      id: validated.submission.id,
      roomCode: validated.submission.roomCode,
      studentName: validated.submission.studentName,
      attemptId: validated.submission.attemptId,
      score: validated.submission.score,
      maxScore: validated.submission.maxScore,
      late: validated.submission.late,
      payload: validated.submission,
      clientCreatedAtIso: validated.clientCreatedAtIso,
    }, config);

    return sendJson(res, 200, {
      ok: true,
      status: "synced",
      created: stored.inserted === true,
      updated: stored.inserted === false,
      submissionId: stored.id,
      roomCode: stored.roomCode,
      receivedAt: stored.receivedAt,
      payloadBytes: validated.payloadBytes,
      submission: stored,
    });
  } catch (error) {
    return sendJson(res, 503, {
      ok: false,
      error: "database_unavailable",
      message: String(error?.message || error || "Failed to store submission."),
    });
  }
}
