import { getBackendConfigState, getTestBackendConfig } from "../_lib/test-config.js";
import { checkTestDatabaseReadiness } from "../_lib/test-db.js";
import { getMethod, methodNotAllowed, sendJson } from "../_lib/test-http.js";

export default async function handler(req, res) {
  if (getMethod(req) !== "GET") {
    return methodNotAllowed(req, res, ["GET"]);
  }

  const config = getTestBackendConfig();
  const env = getBackendConfigState(config);
  const database = await checkTestDatabaseReadiness(config);
  const ok = config.configured && database.ready;

  return sendJson(res, ok ? 200 : 503, {
    ok,
    status: ok
      ? "ready"
      : (!config.configured ? "backend_not_configured" : "database_unavailable"),
    env,
    database,
  });
}
