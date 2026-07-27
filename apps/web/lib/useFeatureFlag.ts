"use client";
import { useEffect, useState } from "react";
import { listFeatureFlags } from "./api";
import { useAuth } from "./useAuth";

/**
 * Reads a site-wide feature flag set by the general platform admin
 * (/admin → Feature Toggles). Defaults to `true` (feature ON) while loading
 * or if the flag was never created — an admin opts a feature OFF explicitly,
 * rather than every new flag silently disabling something nobody configured.
 */
export function useFeatureFlag(key: string): { enabled: boolean; loading: boolean } {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    listFeatureFlags()
      .then(({ flags }) => {
        if (cancelled) return;
        const flag = flags.find((f) => f.key === key);
        setEnabled(flag ? flag.enabled : true);
      })
      .catch(() => {
        if (!cancelled) setEnabled(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, key]);

  return { enabled, loading };
}
