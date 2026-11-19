// Live API client. Same contract as the dashboard: the dashboard token lives
// in localStorage and rides on every /api call; chat completions use the
// unified key over /v1 with SSE streaming.

const TOKEN_KEY = 'omnipix_dashboard_token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Private mode: the session just doesn't persist.
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing to clear.
  }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function errorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && 'error' in data) {
    const err = (data as { error: unknown }).error;
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
      return (err as { message: string }).message;
    }
  }
  return fallback;
}

export async function apiFetch<T>(path: string, init?: RequestInit & { body?: string }): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(path, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) } });
  if (res.status === 401) {
    clearToken();
    try {
      window.dispatchEvent(new Event('omnipix:unauthorized'));
    } catch {
      // Non-DOM context (tests): the thrown error still surfaces.
    }
    throw new ApiError(401, 'Session expired — sign in again.');
  }
  const data = (await res.json().catch(() => null)) as T | null;
  if (!res.ok) throw new ApiError(res.status, errorMessage(data, `Request failed (${res.status})`));
  return data as T;
}

export interface AuthStatus {
  needsSetup: boolean;
  authenticated: boolean;
  email: string | null;
  desktop: boolean;
}

/** POST an SSE endpoint and stream content deltas. Resolves with full text. */
export async function streamChat(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as unknown;
    throw new ApiError(res.status, errorMessage(data, `Chat failed (${res.status})`));
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error('Streaming is not supported by this response.');
  const decoder = new TextDecoder();
  let full = '';
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: unknown }; message?: { content?: unknown } }>;
        };
        const delta = json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.message?.content;
        if (typeof delta === 'string' && delta) {
          full += delta;
          onDelta(full);
        }
      } catch {
        // Partial chunk — the remainder arrives with the next read.
      }
    }
  }
  return full;
}
