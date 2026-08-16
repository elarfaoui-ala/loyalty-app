const BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  'http://localhost:3000/api/v1';

const ACCESS_KEY = 'loyalty_access_token';
const REFRESH_KEY = 'loyalty_refresh_token';

let refreshing: Promise<boolean> | null = null;

export interface BusinessMe {
  id: string;
  name: string;
  slug: string;
  email: string;
  stampThreshold: number;
  rewardType: 'PERCENT_OFF' | 'FIXED_OFF' | 'FREE_ITEM';
  rewardValue: number;
  rewardExpiryDays: number;
  stampCooldownSec: number;
  brandColor: string;
  logoUrl?: string;
  onboardingStep: number;
  hasApiKey: boolean;
  apiKeyPrefix: string;
}

export interface Stats {
  totalCards: number;
  totalStamps: number;
  pendingRewards: number;
  redeemedRewards: number;
}

export function isAuthed(): boolean {
  return !!localStorage.getItem(ACCESS_KEY);
}

function clearStoredTokens(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

/** Signs out locally and revokes the refresh token server-side (best effort). */
export async function logout(): Promise<void> {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  clearStoredTokens();
  if (!refreshToken) return;
  try {
    await fetch(`${BASE}/auth/business/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    // local session is already cleared
  }
}

export function storeTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem(ACCESS_KEY, accessToken);
  localStorage.setItem(REFRESH_KEY, refreshToken);
}

async function refreshTokens(): Promise<boolean> {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${BASE}/auth/business/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      clearStoredTokens();
      return false;
    }
    const body = await res.json();
    storeTokens(body.accessToken, body.refreshToken);
    return true;
  } catch {
    clearStoredTokens();
    return false;
  }
}

async function doFetch(path: string, options: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  const accessToken = localStorage.getItem(ACCESS_KEY);
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let res = await fetch(`${BASE}${path}`, { ...options, headers });

  if (res.status === 401 && accessToken && !path.endsWith('/login') && !path.endsWith('/register')) {
    refreshing = refreshing ?? refreshTokens();
    const ok = await refreshing;
    refreshing = null;
    if (ok) {
      headers.Authorization = `Bearer ${localStorage.getItem(ACCESS_KEY)}`;
      res = await fetch(`${BASE}${path}`, { ...options, headers });
    }
  }
  return res;
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await doFetch(path, {
    method: options.method ?? 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      (body as { message?: string } | null)?.message ?? `Request failed (${res.status})`,
    );
  }
  return res.json() as Promise<T>;
}

export const authApi = {
  login: (email: string, password: string) =>
    api<{ accessToken: string; refreshToken: string }>('/auth/business/login', {
      method: 'POST',
      body: { email, password },
    }),
  register: (body: {
    name: string;
    email: string;
    password: string;
    stampThreshold?: number;
  }) => api<{ accessToken: string; refreshToken: string; apiKey: string }>(
    '/auth/business/register',
    { method: 'POST', body },
  ),
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    api<{ changed: boolean; accessToken: string; refreshToken: string }>(
      '/auth/business/change-password',
      { method: 'POST', body },
    ),
};

/** Persists the number of onboarding steps completed (0..4). */
export async function setOnboardingStep(step: number): Promise<void> {
  await api<{ onboardingStep: number }>('/businesses/me/onboarding', {
    method: 'POST',
    body: { step },
  });
}