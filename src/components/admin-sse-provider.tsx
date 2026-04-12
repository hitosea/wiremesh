"use client";

import { createContext, useContext, useEffect, useRef, useCallback } from "react";

type SSEListener = (data: Record<string, unknown>) => void;

type AdminSSEContextType = {
  subscribe: (event: string, listener: SSEListener) => () => void;
};

const AdminSSEContext = createContext<AdminSSEContextType | null>(null);

export function AdminSSEProvider({ children }: { children: React.ReactNode }) {
  const listenersRef = useRef(new Map<string, Set<SSEListener>>());
  const esRef = useRef<EventSource | null>(null);
  const knownEventsRef = useRef(new Set<string>());

  const attachEvent = useCallback((event: string) => {
    if (!esRef.current || knownEventsRef.current.has(event)) return;
    knownEventsRef.current.add(event);
    esRef.current.addEventListener(event, (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      const listeners = listenersRef.current.get(event);
      if (listeners) {
        for (const fn of listeners) fn(data);
      }
    });
  }, []);

  useEffect(() => {
    const es = new EventSource("/api/admin/sse");
    esRef.current = es;

    // Re-attach listeners for events already subscribed
    for (const event of listenersRef.current.keys()) {
      attachEvent(event);
    }

    // EventSource auto-reconnects on error; listeners persist on the same instance

    return () => {
      es.close();
      esRef.current = null;
      knownEventsRef.current.clear();
    };
  }, [attachEvent]);

  const subscribe = useCallback((event: string, listener: SSEListener) => {
    if (!listenersRef.current.has(event)) {
      listenersRef.current.set(event, new Set());
    }
    listenersRef.current.get(event)!.add(listener);
    attachEvent(event);

    return () => {
      const listeners = listenersRef.current.get(event);
      if (listeners) {
        listeners.delete(listener);
        if (listeners.size === 0) listenersRef.current.delete(event);
      }
    };
  }, [attachEvent]);

  return (
    <AdminSSEContext.Provider value={{ subscribe }}>
      {children}
    </AdminSSEContext.Provider>
  );
}

export function useAdminSSE(event: string, listener: SSEListener) {
  const ctx = useContext(AdminSSEContext);
  const listenerRef = useRef(listener);
  listenerRef.current = listener;

  useEffect(() => {
    if (!ctx) return;
    const stableListener: SSEListener = (data) => listenerRef.current(data);
    return ctx.subscribe(event, stableListener);
  }, [ctx, event]);
}
