"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { setUnauthorizedHandler } from "@/lib/api/client";
import { queryKeys } from "@/lib/query/keys";
import { queryRetryDelay, shouldRetryQuery } from "@/lib/query/retry";

export function AppQueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: shouldRetryQuery,
            retryDelay: queryRetryDelay,
            refetchOnWindowFocus: false
          },
          mutations: {
            retry: 0
          }
        }
      })
  );

  useEffect(() => {
    // Any 401 from an authenticated endpoint means the session is gone: drop the cached user
    // so navbar/guards react immediately instead of showing stale identity.
    setUnauthorizedHandler(() => {
      if (client.getQueryData(queryKeys.currentUser)) {
        client.setQueryData(queryKeys.currentUser, null);
      }
    });
    return () => setUnauthorizedHandler(null);
  }, [client]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
