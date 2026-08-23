"use client";

import type { QueryClient } from "@tanstack/react-query";
import { api } from "./api";

/**
 * Shared query definitions so a tab and anything that prefetches it agree on
 * the cache key. A mismatched key means the prefetch is thrown away and the
 * page refetches from scratch on arrival.
 */

/** Chapter catalogue — same list for every student, so cache it hard. */
export const CHAPTERS_QUERY = {
  queryKey: ["chapters"] as const,
  queryFn: () => api.getChapters(),
  staleTime: 60_000,
};

export const dashboardQuery = (studentId: string) => ({
  queryKey: ["dashboard", studentId] as const,
  queryFn: () => api.getDashboard(studentId),
});

export const weakSpotsQuery = (studentId: string) => ({
  queryKey: ["weak-spots", studentId] as const,
  queryFn: () => api.getWeakSpots(studentId),
});

export const TEXTBOOK_CHATS_QUERY = {
  queryKey: ["textbook-chats"] as const,
  queryFn: () => api.listTextbookChats(),
};

/** Pull a tab's data into cache before the student actually clicks it. */
export function prefetchForRoute(
  client: QueryClient,
  href: string,
  studentId: string | null
) {
  switch (href) {
    case "/dashboard":
      if (studentId) {
        void client.prefetchQuery(dashboardQuery(studentId));
        void client.prefetchQuery(weakSpotsQuery(studentId));
      }
      break;
    case "/practice":
      void client.prefetchQuery(CHAPTERS_QUERY);
      if (studentId) void client.prefetchQuery(dashboardQuery(studentId));
      break;
    case "/custom-quiz":
      void client.prefetchQuery(CHAPTERS_QUERY);
      break;
    case "/chat":
      void client.prefetchQuery(TEXTBOOK_CHATS_QUERY);
      break;
    default:
      break;
  }
}
