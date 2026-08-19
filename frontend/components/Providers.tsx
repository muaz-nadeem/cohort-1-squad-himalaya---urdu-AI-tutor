"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

export default function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Revisiting a tab paints from cache straight away; anything older
            // than this revalidates quietly in the background behind the data
            // that's already on screen.
            staleTime: 2 * 60_000,
            // Keep entries around long enough that moving between tabs never
            // drops back to a spinner.
            gcTime: 30 * 60_000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            retry: 1,
          },
        },
      })
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
