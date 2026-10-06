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

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchHealth();
      setHealth(data);
    } catch (err) {
      setError(err.message);
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs]);

  return { health, loading, error, refresh };
}