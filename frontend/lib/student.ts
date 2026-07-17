"use client";

const ID_KEY = "mdcat_student_id";
const NAME_KEY = "mdcat_student_name";

export function getStudentId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ID_KEY);
}

export function setStudentId(id: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ID_KEY, id);
}

export function getStudentName(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(NAME_KEY);
}

export function setStudentName(name: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(NAME_KEY, name);
}

export function clearStudent(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ID_KEY);
  window.localStorage.removeItem(NAME_KEY);
}

// Legacy compat
export function clearStudentId(): void {
  clearStudent();
}
