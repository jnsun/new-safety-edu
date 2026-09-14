export type ApiEnvelope<T> = { data: T };

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "include", ...init, headers: { ...(init?.body !== undefined && !(init.body instanceof FormData) ? { "content-type": "application/json" } : {}), ...init?.headers } });
  if (response.status === 204) return undefined as T;
  const body = await response.json() as ApiEnvelope<T> | { error: { message: string } };
  if (!response.ok || !("data" in body)) throw new Error("error" in body ? body.error.message : "请求失败");
  return body.data;
}

export const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
