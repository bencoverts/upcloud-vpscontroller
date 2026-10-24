export class ApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 0, public readonly fields?: Array<{ path: string; message: string }>) {
    super(message);
    this.name = 'ApiError';
  }
}

let csrfToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;
export function setApiCsrf(token: string | null): void { csrfToken = token; }
export function setUnauthorizedHandler(handler: (() => void) | null): void { unauthorizedHandler = handler; }

type RequestOptions = { method?: string; body?: unknown; signal?: AbortSignal };
async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  let response: Response;
  try {
    response = await fetch(path, {
      method, credentials: 'same-origin', signal: options.signal,
      headers: {
        Accept: 'application/json',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(!['GET', 'HEAD'].includes(method) && csrfToken ? { 'x-csrf-token': csrfToken } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('CONNECTION_ERROR', 'Tidak dapat terhubung ke backend panel. Periksa koneksi atau reverse proxy.');
  }
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = payload?.error;
    if (response.status === 401 && error?.code === 'UNAUTHENTICATED') {
      setApiCsrf(null);
      unauthorizedHandler?.();
    }
    throw new ApiError(error?.code ?? `HTTP_${response.status}`, error?.message ?? 'Request tidak berhasil.', response.status, error?.fields);
  }
  return (payload && typeof payload === 'object' && 'data' in payload ? payload.data : payload) as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string, body?: unknown) => request<T>(path, { method: 'DELETE', body }),
};

export function queryString(values: Record<string, string | number | null | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const result = params.toString();
  return result ? `?${result}` : '';
}
