const API_BASE = (process.env.NEXT_PUBLIC_PROFILE_API_URL || 'http://localhost:3100').trim();
const JWT_KEY = 'rush_profile_jwt';

let _jwt: string | null = null;

if (typeof window !== 'undefined') {
  try { _jwt = window.localStorage.getItem(JWT_KEY); } catch {}
}

export function setJwt(token: string | null) {
  _jwt = token;
  if (typeof window !== 'undefined') {
    try {
      if (token) window.localStorage.setItem(JWT_KEY, token);
      else window.localStorage.removeItem(JWT_KEY);
    } catch {}
  }
}

export function getJwt(): string | null { return _jwt; }

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (_jwt) headers['Authorization'] = `Bearer ${_jwt}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, body.message || res.statusText);
  }
  return res.json();
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body: unknown) => apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
};

export async function uploadFile<T>(path: string, file: File, field = 'file'): Promise<T> {
  const form = new FormData();
  form.append(field, file);
  const headers: Record<string, string> = {};
  if (_jwt) headers['Authorization'] = `Bearer ${_jwt}`;
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', body: form, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, body.message || res.statusText);
  }
  return res.json();
}
