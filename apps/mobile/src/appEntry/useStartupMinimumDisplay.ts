import { useEffect, useState } from 'react';

/** Start after the in-app startup surface is committed, not at process launch. */
export function useStartupMinimumDisplay(enabled: boolean) {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => setElapsed(true), 2_000);
    return () => clearTimeout(timer);
  }, [enabled]);
  return enabled && !elapsed;
}
