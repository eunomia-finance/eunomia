// One fetch for every SEP endpoint of an anchor. SEP errors come back as {"error": "..."},
// and that sentence is the anchor telling the user what to fix ("amount above the limit",
// "unsupported asset_code") — it is surfaced as-is, never flattened to "request failed".

export class AnchorError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AnchorError";
    this.status = status;
  }
}

export interface AnchorRequest {
  method?: "GET" | "POST" | "PUT";
  /** SEP-10 JWT. Sent as a Bearer token when present. */
  token?: string;
  query?: Record<string, string>;
  body?: unknown;
}

export async function anchorJson<T>(
  url: string,
  { method = "GET", token, query, body }: AnchorRequest = {},
  fetchFn: typeof fetch = fetch,
): Promise<T> {
  const target = query ? `${url}?${new URLSearchParams(query)}` : url;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetchFn(target, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new AnchorError(`The anchor answered ${res.status} with something that is not JSON.`, res.status);
  }
  if (!res.ok) {
    const said = (parsed as { error?: unknown }).error;
    throw new AnchorError(
      typeof said === "string" && said ? said : `The anchor answered ${res.status}.`,
      res.status,
    );
  }
  return parsed as T;
}
