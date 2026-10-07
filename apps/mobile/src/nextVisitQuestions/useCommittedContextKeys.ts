import { useLayoutEffect, useRef } from 'react';

/** Publishes committed keys so abandoned renders cannot affect pending replies. */
export function useCommittedContextKeys(appointment: string, provider: string) {
  const current = useRef({ appointment, provider });

  useLayoutEffect(() => {
    current.current = { appointment, provider };
  }, [appointment, provider]);

  return current;
}
