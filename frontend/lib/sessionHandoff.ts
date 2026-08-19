"use client";

import type { SessionSummary } from "./api";

/**
 * Hands the in-flight "end session" request from /session to /summary.
 *
 * Everything the summary screen shows above the fold (score, accuracy, review
 * list) is already known on the client, so there's no reason to make the
 * student watch a spinner while the server writes the session out. We navigate
 * on the locally computed numbers and let the authoritative response land a
 * moment later.
 */
let pending: Promise<SessionSummary> | null = null;

export function setPendingSummary(promise: Promise<SessionSummary>) {
  pending = promise;
  // Nobody is listening yet if the student closes the tab — swallow rejections
  // so this never surfaces as an unhandled promise error.
  promise.catch(() => {});
}

export function takePendingSummary(): Promise<SessionSummary> | null {
  const p = pending;
  pending = null;
  return p;
}
