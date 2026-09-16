export type ApiEnvelope<T> = { data: T };

const cookieValue = (name: string) => document.cookie.split("; ").find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);

async function csrfToken() {
  const existing = cookieValue("safety_csrf");
  if (existing) return decodeURIComponent(existing);
  const response = await fetch("/api/auth/csrf", { credentials: "include" });
  if (!response.ok) return undefined;
  const body = await response.json() as ApiEnvelope<{ token: string }>;
  return body.data.token;
}

export async function api<T>(path: string, init?: RequestInit, refreshed = false): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase(); const unsafe = !["GET", "HEAD", "OPTIONS"].includes(method); const token = unsafe && !new Headers(init?.headers).has("authorization") ? await csrfToken() : undefined;
  const response = await fetch(path, { credentials: "include", ...init, headers: { ...(unsafe && !(init?.body instanceof FormData) ? { "content-type": "application/json" } : {}), ...(token ? { "x-csrf-token": token } : {}), ...init?.headers } });
  if (response.status === 401 && !refreshed && !["/api/auth/login", "/api/auth/refresh"].includes(path)) {
    const refreshToken = await csrfToken(); const refresh = await fetch("/api/auth/refresh", { method: "POST", credentials: "include", headers: { "content-type": "application/json", ...(refreshToken ? { "x-csrf-token": refreshToken } : {}) }, body: "{}" });
    if (refresh.ok) return api<T>(path, init, true);
  }
  if (response.status === 204) return undefined as T;
  const body = await response.json() as ApiEnvelope<T> | { error: { message: string } };
  if (!response.ok || !("data" in body)) throw new Error("error" in body ? body.error.message : "请求失败");
  return body.data;
}

export const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
