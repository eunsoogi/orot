import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HealthObservationCursor } from '@orot/storage';
import type { HealthRecordPeriod } from './healthRecordsLibraryModel';
import { healthRecordPeriodStart } from './healthRecordsLibraryModel';
import { buildHealthRecordsMedicationDetailRows } from './healthRecordsMedicationDetailModel';
import type { HealthRecordsMedicationLoader } from './healthRecordsMedicationLibrary';
import {
  emptyHealthRecordsMedicationData,
  loadEmptyHealthRecordsMedicationData,
} from './healthRecordsMedicationLibrary';

export type HealthRecordsMedicationDetailLoadState =
  'loading' | 'ready' | 'failed';

/** Keeps the existing period-bounded storage reads and cursor paging on the owning route. */
export function useHealthRecordsMedicationDetailData(
  period: HealthRecordPeriod,
  loadMedicationData: HealthRecordsMedicationLoader = loadEmptyHealthRecordsMedicationData,
) {
  const [data, setData] = useState(emptyHealthRecordsMedicationData);
  const [loadState, setLoadState] =
    useState<HealthRecordsMedicationDetailLoadState>('loading');
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const pending = useRef(false);
  const [cursor, setCursor] = useState<HealthObservationCursor | null>(null);
  const now = useRef(new Date().toISOString()).current;
  const rows = useMemo(
    () => buildHealthRecordsMedicationDetailRows(data, period, now),
    [data, now, period],
  );

  const reload = useCallback(
    async (after: HealthObservationCursor | null = null) => {
      if (pending.current) return;
      pending.current = true;
      const request = ++generation.current;
      setLoadState('loading');
      try {
        const start = healthRecordPeriodStart(period, now)?.toISOString();
        const next = await loadMedicationData({
          cursor: after,
          fromInclusive: start,
          toInclusive: now,
          includeTotals: false,
        });
        if (request !== generation.current) return;
        // Append only distinct rows, retaining the exact loaded page and its bounded cursor.
        setData(previous =>
          after
            ? {
                ...next,
                definitions: [
                  ...new Map(
                    [...previous.definitions, ...next.definitions].map(item => [
                      item.id,
                      item,
                    ]),
                  ).values(),
                ],
                doseEvents: [
                  ...new Map(
                    [...previous.doseEvents, ...next.doseEvents].map(item => [
                      item.id,
                      item,
                    ]),
                  ).values(),
                ],
              }
            : next,
        );
        setCursor(next.nextCursor ?? null);
        setLoadState('ready');
      } catch {
        if (request === generation.current) setLoadState('failed');
      } finally {
        if (request === generation.current) {
          pending.current = false;
          setRevision(value => value + 1);
        }
      }
    },
    [loadMedicationData, now, period],
  );

  useEffect(() => {
    reload().catch(() => undefined);
    return () => {
      // Ignore pages returned after this period's route has left the screen.
      generation.current += 1;
      pending.current = false;
    };
  }, [reload]);

  return { cursor, data, loadState, now, reload, revision, rows };
}
