"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type BreadcrumbCtx = {
  label: string | null;
  setLabel: (l: string | null) => void;
};

const BreadcrumbContext = createContext<BreadcrumbCtx>({
  label: null,
  setLabel: () => {},
});

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [label, setLabel] = useState<string | null>(null);
  return (
    <BreadcrumbContext.Provider value={{ label, setLabel }}>
      {children}
    </BreadcrumbContext.Provider>
  );
}

export function useBreadcrumbLabel(): string | null {
  return useContext(BreadcrumbContext).label;
}

// Pages call this to publish a dynamic label for the last breadcrumb segment
// (e.g. a subscription's name). Cleared automatically when the page unmounts.
export function useSetBreadcrumbLabel(label: string | null) {
  const { setLabel } = useContext(BreadcrumbContext);
  useEffect(() => {
    setLabel(label);
    return () => setLabel(null);
  }, [label, setLabel]);
}
