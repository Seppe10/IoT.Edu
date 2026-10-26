export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = "request_failed",
    readonly detail: unknown = null,
  ) {
    super(message);
  }
}

type ErrorBody = {
  message?: string;
  error?: { message?: string; code?: string; detail?: unknown } | string;
  statusCode?: number;
} | null;

export function apiErrorFromResponse(status: number, body: ErrorBody): ApiError {
  const nested = body?.error && typeof body.error === "object" ? body.error : null;
  const routeMissing = typeof body?.error === "string";
  return new ApiError(
    nested?.message ?? (routeMissing ? body?.message : null) ?? `Request failed (${status})`,
    status,
    nested?.code ?? (routeMissing ? "route_not_found" : "request_failed"),
    nested?.detail ?? null,
  );
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body != null && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers,
  });
  const body = (await response.json()) as T & { error?: { message?: string; code?: string; detail?: unknown } };
  if (response.status === 401 && !path.startsWith("/api/auth/") && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("iotedu-session-ended"));
  }
  if (!response.ok) {
    throw apiErrorFromResponse(response.status, body);
  }
  return body;
}
