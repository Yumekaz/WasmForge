const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

export function getMethod(req) {
  return String(req?.method || "GET").toUpperCase();
}

export function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);

  if (typeof res?.status === "function") {
    res.status(statusCode);
  }

  if (res) {
    res.statusCode = statusCode;
  }

  if (typeof res?.setHeader === "function") {
    res.setHeader("content-type", JSON_CONTENT_TYPE);
    res.setHeader("cache-control", "no-store");
  }

  if (typeof res?.json === "function") {
    return res.json(payload);
  }

  if (typeof res?.send === "function") {
    return res.send(body);
  }

  if (typeof res?.end === "function") {
    return res.end(body);
  }

  return payload;
}

export function methodNotAllowed(req, res, allowedMethods) {
  if (typeof res?.setHeader === "function") {
    res.setHeader("allow", allowedMethods.join(", "));
  }

  return sendJson(res, 405, {
    ok: false,
    error: "method_not_allowed",
    message: `${getMethod(req)} is not allowed for this endpoint.`,
    allowedMethods,
  });
}

export function getHeader(req, name) {
  if (!req?.headers || !name) {
    return "";
  }

  const target = String(name).toLowerCase();

  for (const [key, value] of Object.entries(req.headers)) {
    if (String(key).toLowerCase() !== target) {
      continue;
    }

    if (Array.isArray(value)) {
      return String(value[0] ?? "");
    }

    return String(value ?? "");
  }

  return "";
}

export function getQueryParam(req, name) {
  if (!name) {
    return "";
  }

  const fromQuery = req?.query?.[name];
  if (Array.isArray(fromQuery)) {
    return String(fromQuery[0] ?? "");
  }

  if (fromQuery != null) {
    return String(fromQuery);
  }

  const url = String(req?.url || "");
  if (!url) {
    return "";
  }

  try {
    const parsed = new URL(url, "http://localhost");
    return parsed.searchParams.get(name) ?? "";
  } catch {
    return "";
  }
}

export async function readJsonBody(req) {
  if (req?.body != null) {
    if (typeof req.body === "string") {
      return parseJsonText(req.body);
    }

    if (Buffer.isBuffer(req.body)) {
      return parseJsonText(req.body.toString("utf8"));
    }

    return req.body;
  }

  if (!req || typeof req[Symbol.asyncIterator] !== "function") {
    return null;
  }

  const chunks = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }

  if (chunks.length === 0) {
    return null;
  }

  return parseJsonText(Buffer.concat(chunks).toString("utf8"));
}

function parseJsonText(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}
