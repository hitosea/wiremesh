"use client";

import { createContext, useContext, useEffect, useState } from "react";

type PublicUrlCheckValue = {
  mismatch: boolean;
  publicUrl: string | null;
  currentOrigin: string;
};

const PublicUrlCheckContext = createContext<PublicUrlCheckValue>({
  mismatch: false,
  publicUrl: null,
  currentOrigin: "",
});

function normalizeOrigin(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return url.replace(/\/+$/, "");
  }
}

export function PublicUrlCheckProvider({ children }: { children: React.ReactNode }) {
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/config/public-url")
      .then((res) => (res.ok ? res.json() : null))
      .then((res) => {
        if (res?.data) setPublicUrl(res.data.publicUrl ?? null);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const currentOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const normalizedPublic = normalizeOrigin(publicUrl);
  const mismatch =
    loaded &&
    !!normalizedPublic &&
    !!currentOrigin &&
    normalizedPublic !== currentOrigin;

  return (
    <PublicUrlCheckContext.Provider
      value={{ mismatch, publicUrl: normalizedPublic, currentOrigin }}
    >
      {children}
    </PublicUrlCheckContext.Provider>
  );
}

export function usePublicUrlCheck() {
  return useContext(PublicUrlCheckContext);
}
