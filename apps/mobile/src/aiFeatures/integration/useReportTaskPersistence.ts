import { useEffect, useRef, useState } from 'react';
import type { DailyReportIdentity } from '@orot/domain';

/** A report request waits for its session-owned date to be retained. */
export function useReportTaskPersistence(
  identity: DailyReportIdentity | null,
  save?: (identity: DailyReportIdentity) => Promise<void>,
) {
  const saveRef = useRef(save);
  saveRef.current = save;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; ok: boolean } | null>(
    null,
  );
  const required = Boolean(save);
  useEffect(() => {
    if (!identity || !required) return;
    let current = true;
    setResult(null);
    saveRef.current!(identity).then(
      () => {
        if (current) setResult({ key: identity.key, ok: true });
      },
      () => {
        if (current) setResult({ key: identity.key, ok: false });
      },
    );
    return () => {
      current = false;
    };
  }, [identity, required, attempt]);
  const status =
    !required || !identity
      ? 'ready'
      : result?.key !== identity.key
        ? 'pending'
        : result.ok
          ? 'ready'
          : 'failed';
  return { status, retry: () => setAttempt(value => value + 1) } as const;
}
