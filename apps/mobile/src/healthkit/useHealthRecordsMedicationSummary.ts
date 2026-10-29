import { useCallback, useEffect, useRef, useState } from 'react';
import {
  emptyHealthRecordsMedicationData,
  loadEmptyHealthRecordsMedicationData,
  type HealthRecordsMedicationLoader,
} from './healthRecordsMedicationLibrary';

/** Route-owned summary survives category virtualization and keeps rows during a failed refresh. */
export function useHealthRecordsMedicationSummary(
  load: HealthRecordsMedicationLoader = loadEmptyHealthRecordsMedicationData,
  refreshRevision = 0,
) {
  const [data, setData] = useState(emptyHealthRecordsMedicationData);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>(
    'loading',
  );
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const request = ++generation.current;
    setStatus('loading');
    try {
      const next = await load();
      if (request !== generation.current) return;
      setData(next);
      setStatus('ready');
    } catch {
      if (request === generation.current) setStatus('failed');
    }
  }, [load]);
  useEffect(() => {
    reload();
    return () => {
      generation.current += 1;
    };
  }, [reload, refreshRevision]);
  return { data, status, reload };
}
