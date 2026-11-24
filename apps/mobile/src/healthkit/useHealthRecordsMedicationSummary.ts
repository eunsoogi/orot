import { useCallback, useEffect, useRef, useState } from 'react';
import { healthRecordPeriodStart } from './healthRecordsLibraryModel';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../storage/localDataClearEvents';
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
      const toInclusive = new Date().toISOString();
      const fromInclusive = healthRecordPeriodStart(
        'month',
        toInclusive,
      )!.toISOString();
      const next = await load({
        fromInclusive,
        toInclusive,
        monthlyTakenOnly: true,
      });
      if (request !== generation.current) return;
      const accepted = next.monthlyTaken;
      setData({
        ...emptyHealthRecordsMedicationData,
        monthlyTaken:
          accepted?.fromInclusive === fromInclusive &&
          accepted.toInclusive === toInclusive
            ? accepted
            : { fromInclusive, toInclusive, status: 'unverified' },
      });
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
  useEffect(() => {
    const invalidate = () => {
      // Never let an older read restore medication data after a deletion.
      generation.current += 1;
      setData(emptyHealthRecordsMedicationData);
      reload();
    };
    const unsubscribeClear = subscribeLocalDataClear(invalidate);
    const unsubscribeDeletion = subscribeLocalSourceDeletion(invalidate);
    return () => {
      unsubscribeClear();
      unsubscribeDeletion();
    };
  }, [reload]);
  return { data, status, reload };
}
