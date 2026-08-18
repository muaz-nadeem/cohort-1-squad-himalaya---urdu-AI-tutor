"use client";

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

export async function getSession() {
  const { data, error } = await getSupabase().auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getAccessToken(): Promise<string | null> {
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

export async function signIn(email: string, password: string) {
  const url = `${backendUrl()}/api/auth/login`;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
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
      const { error } = await getSupabase().auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });
      if (error) throw error;
      const userId = session.user?.id;
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
  const { data, error } = await getSupabase().auth.signUp({
    email: email.trim(),
    password,
    options: {
      data: { name: name || undefined },
    },
  });
  if (error) throw error;
  const user = data.user;
  if (user) {
    setStudentId(user.id);
    setStudentName(name || user.email?.split("@")[0] || "Student");
    setSignedInCookie(true);
  }
  return data;
}

export async function signOut() {
  await getSupabase().auth.signOut();
  clearStudent();
  setSignedInCookie(false);
}

/** Sync local display cache from the current Supabase session. */
export async function syncStudentCacheFromSession(): Promise<string | null> {
  const session = await getSession();
  if (!session?.user) {
    clearStudent();
    setSignedInCookie(false);
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
}
