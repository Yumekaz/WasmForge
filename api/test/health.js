import { getBackendConfigState, getTestBackendConfig } from "../_lib/test-config.js";
import { checkTestDatabaseReadiness } from "../_lib/test-db.js";
import { getMethod, methodNotAllowed, sendJson } from "../_lib/test-http.js";

export default async function handler(req, res) {
  if (getMethod(req) !== "GET") {
    return methodNotAllowed(req, res, ["GET"]);
  }

  const config = getTestBackendConfig();
  const env = getBackendConfigState(config);

  if (!config.configured) {
    return sendJson(res, 200, {
      ok: true,
      status: "local_collection_mode",
      configured: false,
      collectionMode: "local",
      message: "Local collection mode active.",
      env,
      database: {
        ready: false,
        error: null,
        checkedAt: null,
      },
    });
  }

  const database = await checkTestDatabaseReadiness(config);
  const ok = database.ready;

  return sendJson(res, ok ? 200 : 503, {
    ok,
    status: ok ? "ready" : "database_unavailable",
    env,
    database,
  });
}
