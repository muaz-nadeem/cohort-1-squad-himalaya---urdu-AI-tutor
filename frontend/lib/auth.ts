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

export async function signIn(email: string, password: string) {
  const { data, error } = await getSupabase().auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) throw error;
  const user = data.user;
  if (user) {
    setStudentId(user.id);
    const name =
      (user.user_metadata?.name as string | undefined) ||
      user.email?.split("@")[0] ||
      "Student";
    setStudentName(name);
    setSignedInCookie(true);
  }
  return data;
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
