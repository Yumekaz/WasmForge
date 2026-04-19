import { getBackendConfigState, getTestBackendConfig, verifyTeacherPin } from "../_lib/test-config.js";
import { listTestSubmissions } from "../_lib/test-db.js";
import { getHeader, getMethod, getQueryParam, methodNotAllowed, sendJson } from "../_lib/test-http.js";
import { requireRoomCode } from "../_lib/test-validation.js";

export default async function handler(req, res) {
  if (getMethod(req) !== "GET") {
    return methodNotAllowed(req, res, ["GET"]);
  }

  const config = getTestBackendConfig();
  if (!config.configured) {
    return sendJson(res, 503, {
      ok: false,
      error: "backend_not_configured",
      message: "Cloud collection is not connected; use the local collection view for this demo.",
      config: getBackendConfigState(config),
    });
  }

  const providedPin = getHeader(req, "x-wasmforge-teacher-pin");
  if (!providedPin) {
    return sendJson(res, 401, {
      ok: false,
      error: "missing_teacher_pin",
      message: "x-wasmforge-teacher-pin is required.",
    });
  }

  if (!verifyTeacherPin(providedPin, config.teacherPin)) {
    return sendJson(res, 403, {
      ok: false,
      error: "invalid_teacher_pin",
      message: "The provided teacher PIN is incorrect.",
    });
  }

  let roomCode;

  try {
    roomCode = requireRoomCode(getQueryParam(req, "roomCode"));
  } catch (error) {
    return sendJson(res, 400, {
      ok: false,
      error: "invalid_room_code",
      message: String(error?.message || error || "roomCode is invalid."),
    });
  }

  try {
    const submissions = await listTestSubmissions(roomCode, config);

    return sendJson(res, 200, {
      ok: true,
      roomCode,
      count: submissions.length,
      submissions,
    });
  } catch (error) {
    return sendJson(res, 503, {
      ok: false,
      error: "database_unavailable",
      message: String(error?.message || error || "Failed to load submissions."),
      roomCode,
    });
  }
}
