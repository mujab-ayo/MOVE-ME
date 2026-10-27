// In-memory API call log
export const apiLog = [];
const listeners = new Set();

export function onApiCall(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function getApiLog() {
  return apiLog;
}

function sanitizeBody(body) {
  if (body === null || body === undefined) return null;
  if (typeof body !== "object") return body;
  if (Array.isArray(body)) {
    return body.map(sanitizeBody);
  }
  const clean = {};
  for (const [key, val] of Object.entries(body)) {
    if (typeof key === "string" && /password/i.test(key)) {
      clean[key] = "***";
    } else if (typeof val === "object" && val !== null) {
      clean[key] = sanitizeBody(val);
    } else {
      clean[key] = val;
    }
  }
  return clean;
}

export async function api(method, path, body) {
  const url = path.startsWith("/") ? path : `/${path}`;
  const headers = {};

  const token = sessionStorage.getItem("token");
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const fetchOptions = {
    method: method.toUpperCase(),
    headers,
  };

  if (body !== undefined && body !== null) {
    headers["Content-Type"] = "application/json";
    fetchOptions.body = JSON.stringify(body);
  }

  const startTime = performance.now();
  const time = new Date().toISOString();
  let status = 0;
  let ok = false;
  let data = null;

  try {
    const res = await fetch(url, fetchOptions);
    status = res.status;
    ok = res.ok;

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      try {
        data = await res.json();
      } catch {
        data = null;
      }
    } else {
      const text = await res.text();
      data = text ? { message: text } : null;
    }
  } catch (err) {
    status = 0;
    ok = false;
    data = { error: err.message || "Network request failed" };
  }

  const duration = Math.round(performance.now() - startTime);

  const logEntry = {
    time,
    method: method.toUpperCase(),
    path,
    status,
    duration,
    requestBody: sanitizeBody(body),
    responseBody: data,
  };

  apiLog.push(logEntry);

  for (const listener of listeners) {
    try {
      listener(logEntry);
    } catch {
      // Ignore listener errors
    }
  }

  return { status, ok, data };
}

export default api;
