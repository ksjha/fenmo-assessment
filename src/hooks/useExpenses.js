import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, listExpenses } from '../api.js';

// Fetches the full expense list (server-sorted newest-first) and exposes
// loading/error + a refetch() callback. Filtering is done client-side in the
// caller so that toggling the category dropdown doesn't require a round-trip
// and the server's integer-summed total is never divided across two fetches.
//
// Race handling: if refetch is called rapidly (e.g. burst of creates), a
// request-id guard ensures an older in-flight response cannot overwrite a
// newer one. AbortController cancels the stale fetch.
export function useExpenses() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const requestIdRef = useRef(0);
  const controllerRef = useRef(null);

  const fetch = useCallback(async ({ showLoading = true } = {}) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const reqId = ++requestIdRef.current;
    if (showLoading) {
      setLoading(true);
      setError(null);
    }
    try {
      const result = await listExpenses({ signal: controller.signal });
      if (reqId === requestIdRef.current) {
        setData(result);
        setError(null);
        setLoading(false);
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
      if (reqId === requestIdRef.current) {
        setError(err instanceof ApiError ? err : new ApiError({
          status: 0, code: 'unknown_error', message: String(err?.message ?? err),
        }));
        setLoading(false);
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      void fetch({ showLoading: false });
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      controllerRef.current?.abort();
    };
  }, [fetch]);

  return { data, loading, error, refetch: fetch };
}
