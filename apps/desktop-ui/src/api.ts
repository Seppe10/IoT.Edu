export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body != null && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    headers,
  });
  const body = (await response.json()) as T & { error?: { message: string } };
  if (!response.ok) {
    throw new ApiError(body.error?.message ?? `Request failed (${response.status})`, response.status);
  }
  return body;
}
