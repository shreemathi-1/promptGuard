import { useState, useEffect, useCallback } from 'react';
import { fetchHealth } from '../api/client';

/**
 * Polls the /api/health endpoint every `intervalMs` milliseconds.
 * Returns { health, loading, error, refresh }.
 */
export function useHealth(intervalMs = 30_000) {
  const [health,  setHealth]  = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  // State is only set in the promise callbacks, so calling this from the
  // effect doesn't trigger a synchronous re-render
  const load = useCallback(() => fetchHealth()
    .then((data) => { setHealth(data); setError(null); })
    .catch((err) => { setError(err.message); setHealth(null); })
    .finally(() => setLoading(false)), []);

  // Manual refresh (from a click) shows the loading state
  const refresh = useCallback(() => {
    setLoading(true);
    return load();
  }, [load]);

  useEffect(() => {
    load();
    const id = setInterval(load, intervalMs);
    return () => clearInterval(id);
  }, [load, intervalMs]);

  return { health, loading, error, refresh };
}