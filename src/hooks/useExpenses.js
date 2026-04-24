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

  const fetch = useCallback(async () => {
    const reqId = ++requestIdRef.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    try {
      const result = await listExpenses({ signal: controller.signal });
      if (reqId === requestIdRef.current) {
        setData(result);
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
    }
    return () => controller.abort();
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  return { data, loading, error, refetch: fetch };
}
