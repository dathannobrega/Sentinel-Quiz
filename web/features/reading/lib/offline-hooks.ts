"use client";

import { useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { emptyIndex, isOfflineStoreSupported, OfflineStore } from "@/features/reading/lib/offline-store";
import { queryKeys } from "@/lib/query/keys";

let store: OfflineStore | null = null;

/** Shared store instance (null where Cache Storage is unavailable, e.g. insecure contexts). */
export function getOfflineStore(): OfflineStore | null {
  if (!isOfflineStoreSupported()) {
    return null;
  }
  store ??= new OfflineStore();
  return store;
}

const noopSubscribe = () => () => {};

/**
 * The offline store, resolved on the client only. During server rendering and hydration this is
 * `undefined` ("not known yet"): rendering "unsupported" there would stick after hydration, since
 * Cache Storage does not exist on the server. `null` means the browser really lacks it.
 */
export function useOfflineStore(): OfflineStore | null | undefined {
  return useSyncExternalStore(noopSubscribe, () => getOfflineStore(), () => undefined);
}

/** The index of downloaded chapters (local only; never touches the API). */
export function useOfflineIndexQuery() {
  return useQuery({
    queryKey: queryKeys.readingOffline,
    queryFn: async () => {
      const current = getOfflineStore();
      return current ? current.readIndex() : emptyIndex();
    },
    staleTime: Number.POSITIVE_INFINITY,
    networkMode: "always"
  });
}

export function useRefreshOfflineIndex() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: queryKeys.readingOffline });
}
