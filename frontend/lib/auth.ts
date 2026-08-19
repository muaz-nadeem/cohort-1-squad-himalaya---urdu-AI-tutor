"use client";

import type { Session } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";
import { clearStudent, setStudentId, setStudentName } from "./student";

function setSignedInCookie(on: boolean) {
  if (typeof document === "undefined") return;
  if (on) {
    document.cookie = "uraan_signed_in=1; path=/; SameSite=Lax; max-age=2592000";
  } else {
    document.cookie = "uraan_signed_in=; path=/; Max-Age=0";
  }
}

/**
 * Where confirmation / recovery emails should send the student afterwards.
 *
 * Without this, Supabase uses the project's Site URL — which is still the
 * default `http://localhost:3000` unless someone changed it in the dashboard.
 * Window origin is the live host when they signed up from production.
 */
export function publicOrigin(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin.replace(/\/$/, "");
  }
  return (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
}

export function authCallbackUrl(): string | undefined {
  const origin = publicOrigin();
  return origin ? `${origin}/auth/callback` : undefined;
}

/**
 * supabase.auth.getSession() takes a cross-tab Web Lock and re-parses storage on
 * every call, which serialised every API request behind it. Mirror the session in
 * memory instead and let onAuthStateChange keep it honest.
 */
let cachedSession: Session | null = null;
let sessionListenerReady = false;
let inflightSession: Promise<Session | null> | null = null;
let inflightSyncPromise: Promise<string | null> | null = null;

/** Treat a token as unusable this long before it actually expires. */
const EXPIRY_SKEW_MS = 60_000;

function rememberSession(session: Session | null) {
  cachedSession = session;
}

function startSessionListener() {
  if (sessionListenerReady || typeof window === "undefined") return;
  sessionListenerReady = true;
  // Fires immediately with INITIAL_SESSION, then on every refresh/sign-out.
  getSupabase().auth.onAuthStateChange((_event, session) => {
    rememberSession(session);
  });
}

function usableCachedSession(): Session | null {
  const session = cachedSession;
  if (!session?.access_token) return null;
  const expiresAt = session.expires_at ? session.expires_at * 1000 : 0;
  if (expiresAt && expiresAt - Date.now() < EXPIRY_SKEW_MS) return null;
  return session;
}

/** Drop the memo so the next read goes back to Supabase (used after a 401). */
export function invalidateSessionCache() {
  cachedSession = null;
}

export async function getSession(): Promise<Session | null> {
  startSessionListener();
  const cached = usableCachedSession();
  if (cached) return cached;
  // Collapse concurrent misses into a single Supabase read.
  if (!inflightSession) {
    inflightSession = getSupabase()
      .auth.getSession()
      .then(({ data, error }) => {
        if (error) throw error;
        rememberSession(data.session);
        return data.session;
      })
      .finally(() => {
        inflightSession = null;
      });
  }
  return inflightSession;
}

/** Non-blocking token read — null when nothing valid is memoised yet. */
export function peekAccessToken(): string | null {
  startSessionListener();
  return usableCachedSession()?.access_token ?? null;
}

export async function getAccessToken(): Promise<string | null> {
  const fast = peekAccessToken();
  if (fast) return fast;
  const session = await getSession();
  return session?.access_token ?? null;
}

export async function getUserId(): Promise<string | null> {
  const session = await getSession();
  return session?.user?.id ?? null;
}

export async function requireUserId(): Promise<string> {
  const id = await getUserId();
  if (!id) throw new Error("Not signed in");
  return id;
}

function backendUrl(): string {
  return (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(
    /\/$/,
    ""
  );
}

function loginErrorMessage(status: number, bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as { detail?: unknown };
    if (typeof parsed.detail === "string" && parsed.detail.trim()) {
      return parsed.detail;
    }
  } catch {
    /* not JSON */
  }
  if (status === 401) return "Invalid email or password.";
  if (status >= 500) {
    return "Can't reach the server. Wait a few seconds and try again.";
  }
  return bodyText || "Login failed. Check your email and password.";
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export async function signIn(email: string, password: string) {
  startSessionListener();
  const trimmed = email.trim();

  try {
    const { data, error } = await withTimeout(
      getSupabase().auth.signInWithPassword({
        email: trimmed,
        password,
      }),
      20_000,
      "Sign-in timed out. Check your connection and try again."
    );
    if (error) {
      const raw = `${error.message} ${error.code || ""}`.toLowerCase();
      if (raw.includes("email not confirmed") || raw.includes("email_not_confirmed")) {
        throw new Error("Confirm your email before signing in.");
      }
      if (raw.includes("invalid login") || raw.includes("invalid_credentials")) {
        throw new Error("Invalid email or password.");
      }
      throw new Error(error.message || "Login failed. Check your email and password.");
    }
    rememberSession(data.session);
    inflightSyncPromise = null;
    const user = data.user;
    if (user?.id) {
      setStudentId(user.id);
      setStudentName(
        (user.user_metadata?.name as string | undefined) ||
          user.email?.split("@")[0] ||
          "Student"
      );
      setSignedInCookie(true);
    }
    return data;
  } catch (clientErr) {
    const msg = clientErr instanceof Error ? clientErr.message : "";
    // Timeouts / lock deadlocks — try the backend once, then give up.
    const worthBackend =
      /timed out|failed to fetch|networkerror|lock/i.test(msg) ||
      (clientErr instanceof TypeError);
    if (!worthBackend) throw clientErr;
    return signInViaBackend(trimmed, password);
  }
}

async function signInViaBackend(email: string, password: string) {
  const url = `${backendUrl()}/api/auth/login`;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(loginErrorMessage(res.status, text));
      }
      const session = JSON.parse(text) as {
        access_token: string;
        refresh_token: string;
        user?: { id?: string; email?: string; name?: string };
      };
      const { data: setData, error } = await withTimeout(
        getSupabase().auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        }),
        12_000,
        "Could not save your session. Try signing in again."
      );
      if (error) throw error;
      rememberSession(setData.session);
      const userId = session.user?.id;
      inflightSyncPromise = null;
      if (userId) {
        setStudentId(userId);
        setStudentName(
          session.user?.name ||
            session.user?.email?.split("@")[0] ||
            "Student"
        );
        setSignedInCookie(true);
      }
      return session;
    } catch (e) {
      lastError = e;
      const isAbort = (e as Error)?.name === "AbortError";
      const isNetwork =
        e instanceof TypeError &&
        /failed to fetch|networkerror|load failed/i.test(e.message);
      if (isAbort) {
        throw new Error(
          "Login timed out. The backend may be waking from sleep — wait a few seconds and try again."
        );
      }
      if (isNetwork && attempt < 3) {
        await new Promise((r) => setTimeout(r, 1500 * attempt));
        continue;
      }
      if (isNetwork) {
        throw new Error(
          "Can't reach the server. Check that the backend is running and try again."
        );
      }
      throw e;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Login failed.");
}

export async function signUp(
  email: string,
  password: string,
  name?: string
) {
  const emailRedirectTo = authCallbackUrl();
  const { data, error } = await getSupabase().auth.signUp({
    email: email.trim(),
    password,
    options: {
      data: { name: name || undefined },
      ...(emailRedirectTo ? { emailRedirectTo } : {}),
    },
  });
  if (error) throw error;
  rememberSession(data.session);
  // Unconfirmed sign-up returns a user but no session — don't pretend they're in.
  if (data.session?.user) {
    setStudentId(data.session.user.id);
    setStudentName(name || data.session.user.email?.split("@")[0] || "Student");
    setSignedInCookie(true);
  }
  return data;
}

export async function signOut() {
  invalidateSessionCache();
  inflightSyncPromise = null;
  await getSupabase().auth.signOut();
  clearStudent();
  setSignedInCookie(false);
}

/**
 * Finish an email-confirm / recovery redirect. Exchanges `?code=` (PKCE) or
 * lets detectSessionInUrl pick up hash tokens, then mirrors the session into
 * the local student cache.
 */
export async function completeAuthFromUrl(): Promise<string | null> {
  invalidateSessionCache();
  inflightSyncPromise = null;
  if (typeof window === "undefined") return null;

  const params = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const code = params.get("code");
  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");

  const work = (async () => {
    if (code) {
      const { data, error } = await getSupabase().auth.exchangeCodeForSession(
        code
      );
      if (error && !/already|verifier/i.test(error.message)) {
        throw error;
      }
      if (data?.session) rememberSession(data.session);
    } else if (accessToken && refreshToken) {
      const { data, error } = await getSupabase().auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) throw error;
      if (data.session) rememberSession(data.session);
    }
    return syncStudentCacheFromSession();
  })();

  try {
    return await withTimeout(
      work,
      8_000,
      "Confirmation finished, but the session didn't attach in time."
    );
  } catch {
    // The verify click already confirmed the email. Send them to sign in
    // rather than leaving this page spinning.
    return null;
  }
}

/** Sync local display cache from the current Supabase session. */
export async function syncStudentCacheFromSession(): Promise<string | null> {
  // Pages mount and re-mount often; one verification per session is enough.
  if (inflightSyncPromise) return inflightSyncPromise;
  inflightSyncPromise = (async () => {
    const session = await getSession();
    if (!session?.user) {
      clearStudent();
      setSignedInCookie(false);
      // Don't memoise a signed-out answer — the user may log in next.
      inflightSyncPromise = null;
      return null;
    }
    setStudentId(session.user.id);
    const name =
      (session.user.user_metadata?.name as string | undefined) ||
      session.user.email?.split("@")[0] ||
      "Student";
    setStudentName(name);
    setSignedInCookie(true);
    return session.user.id;
  })();
  return inflightSyncPromise;
}
