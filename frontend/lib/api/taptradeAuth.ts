"use client";

/**
 * SIWE auth + JWT cookie management + authed fetch helpers, scoped
 * to the TapTrade arena's `/trade` UX.
 *
 * The engine treats the `accessToken` cookie as opaque and only
 * trusts the bearer header on each request, so this module:
 *
 *  - runs the SIWE round-trip (`/auth/siwe/nonce` → user signs →
 *    `/auth/siwe/verify` → JWT)
 *  - stores the JWT in a `js-cookie`-style document cookie keyed
 *    `taptrade_access_token` (kept distinct from any cookie set by
 *    the rest of the Rush frontend so a logout here doesn't clobber
 *    the predict/tiles session)
 *  - exposes `authedFetch` which appends `Authorization: Bearer`
 *    on every authenticated TapTrade call
 *
 * **Not used here**: the existing `profile-kit/hooks/useAuth` —
 * that one talks to a different (predict/tiles) backend on
 * `/auth/nonce`. The engine endpoints live at `/auth/siwe/{nonce,
 * verify}`.
 */

const ENGINE_URL =
  process.env.NEXT_PUBLIC_RUSH_ENGINE_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:8080";
const COOKIE_NAME = "taptrade_access_token";

export interface SiweNonceResponse {
  nonce: string;
  expires_at: number;
}

export interface SiweVerifyResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: {
    id: string;
    wallet_address: string;
    username: string | null;
    deposited_wei: string;
    withdrawn_wei: string;
    realized_pnl_wei: string;
    locked_margin_wei: string;
    free_balance_wei: string;
  };
}

export interface UserBalance {
  /** Lowercased 0x-prefixed wallet of the JWT subject. The engine
   *  ships this on every balance response so the client can detect
   *  wallet-switch scenarios (MetaMask account swap) and force a
   *  fresh SIWE under the new identity. */
  wallet_address: string;
  deposited_wei: string;
  withdrawn_wei: string;
  realized_pnl_wei: string;
  locked_margin_wei: string;
  free_balance_wei: string;
  total_balance_wei: string;
}

// ── cookie helpers ─────────────────────────────────────────────────

function setCookie(name: string, value: string, expiresAtSec: number) {
  if (typeof document === "undefined") return;
  const expires = new Date(expiresAtSec * 1_000).toUTCString();
  // SameSite=Lax + Secure-when-https. Not HttpOnly because the
  // engine doesn't issue Set-Cookie for the access token (it
  // returns it in the JSON body), so JS has to plant it. The
  // engine will issue HttpOnly cookies from the server side once
  // the production deploy is behind HTTPS — that's a P1 follow-up.
  const secure =
    typeof window !== "undefined" && window.location.protocol === "https:"
      ? "; Secure"
      : "";
  document.cookie = `${name}=${encodeURIComponent(
    value
  )}; expires=${expires}; path=/; SameSite=Lax${secure}`;
}

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${name}=`;
  const found = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(prefix));
  return found ? decodeURIComponent(found.slice(prefix.length)) : null;
}

function clearCookie(name: string) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
}

// ── public surface ─────────────────────────────────────────────────

export function getAccessToken(): string | null {
  return getCookie(COOKIE_NAME);
}

export function setAccessToken(token: string, expiresInSec: number) {
  const expiresAt = Math.floor(Date.now() / 1_000) + Math.max(60, expiresInSec);
  setCookie(COOKIE_NAME, token, expiresAt);
}

export function clearAccessToken() {
  clearCookie(COOKIE_NAME);
}

export function isAuthenticated(): boolean {
  return !!getAccessToken();
}

/**
 * SIWE round-trip. Caller provides the wallet address + a function
 * that knows how to ask the wallet to sign (typically wagmi's
 * `signMessageAsync`). On success the JWT is planted in the cookie
 * and returned.
 */
export async function signInWithEthereum(opts: {
  address: string;
  chainId: number;
  signMessage: (args: { message: string }) => Promise<string>;
}): Promise<SiweVerifyResponse> {
  const { address, chainId, signMessage } = opts;

  // 1. Ask the engine for a fresh nonce scoped to this wallet.
  const nonceRes = await fetch(`${ENGINE_URL}/api/v1/auth/siwe/nonce`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet: address }),
  });
  if (!nonceRes.ok) {
    const txt = await nonceRes.text().catch(() => "");
    throw new Error(`SIWE nonce request failed (${nonceRes.status}): ${txt}`);
  }
  const { nonce } = (await nonceRes.json()) as SiweNonceResponse;

  // 2. Build the EIP-4361 message ourselves (avoids pulling the
  // `siwe` npm package — Rush already has it as a transitive but
  // we keep the dep surface small for the TapTrade slice).
  const issuedAt = new Date().toISOString();
  const domain =
    typeof window !== "undefined" ? window.location.host : "localhost:3000";
  const uri =
    typeof window !== "undefined"
      ? window.location.origin
      : "http://localhost:3000";
  const message =
    `${domain} wants you to sign in with your Ethereum account:\n` +
    `${address}\n` +
    `\n` +
    `Sign in to Rush Trade.\n` +
    `\n` +
    `URI: ${uri}\n` +
    `Version: 1\n` +
    `Chain ID: ${chainId}\n` +
    `Nonce: ${nonce}\n` +
    `Issued At: ${issuedAt}`;

  // 3. Wallet signs.
  const signature = await signMessage({ message });

  // 4. Send to engine for verification + JWT issuance.
  const verifyRes = await fetch(`${ENGINE_URL}/api/v1/auth/siwe/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, signature }),
  });
  if (!verifyRes.ok) {
    const txt = await verifyRes.text().catch(() => "");
    throw new Error(`SIWE verify failed (${verifyRes.status}): ${txt}`);
  }
  const auth = (await verifyRes.json()) as SiweVerifyResponse;
  setAccessToken(auth.access_token, auth.expires_in);
  return auth;
}

/**
 * Server-side revoke — best-effort. Local cookie is cleared
 * regardless so the UX always reflects the user's intent.
 */
export async function signOut(): Promise<void> {
  const token = getAccessToken();
  if (token) {
    try {
      await fetch(`${ENGINE_URL}/api/v1/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // Network failure: the cookie is the source of truth on the
      // client; clearing it below is enough to log the user out
      // visually.
    }
  }
  clearAccessToken();
}

/**
 * Fetch helper that adds `Authorization: Bearer <jwt>` when a
 * cookie is present. Throws on 401 so callers can prompt a
 * re-sign-in.
 */
export async function authedFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const token = getAccessToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Content-Type") && init?.body)
    headers.set("Content-Type", "application/json");
  const res = await fetch(`${ENGINE_URL}/api/v1${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  if (res.status === 401) {
    clearAccessToken();
    throw new Error("Unauthorized — sign in again");
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`${path} failed (${res.status}): ${txt}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchBalance(): Promise<UserBalance> {
  return authedFetch<UserBalance>("/user/balance");
}
