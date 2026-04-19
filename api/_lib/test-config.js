import { timingSafeEqual } from "node:crypto";

export function getTestBackendConfig(env = process.env) {
  const databaseUrl = String(env.DATABASE_URL ?? "").trim();
  const teacherPin = String(env.WASMFORGE_TEACHER_PIN ?? "").trim();

  return {
    databaseUrl,
    teacherPin,
    databaseUrlConfigured: databaseUrl.length > 0,
    teacherPinConfigured: teacherPin.length > 0,
    configured: databaseUrl.length > 0 && teacherPin.length > 0,
  };
}

export function getBackendConfigState(config = getTestBackendConfig()) {
  return {
    databaseUrlConfigured: Boolean(config.databaseUrlConfigured),
    teacherPinConfigured: Boolean(config.teacherPinConfigured),
  };
}

export function verifyTeacherPin(providedPin, expectedPin) {
  const left = Buffer.from(String(providedPin ?? ""), "utf8");
  const right = Buffer.from(String(expectedPin ?? ""), "utf8");

  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}
