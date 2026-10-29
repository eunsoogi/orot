import { useCallback, useEffect, useRef, useState } from 'react';
import type { HealthObservation } from '@orot/domain';
import type {
  HealthObservationCursor,
  HealthObservationPageLoader,
} from '@orot/storage';
import {
  classifyHealthObservation,
  healthRecordPeriodStart,
} from './healthRecordsLibraryModel';
import type { HealthObservationCategory } from './healthRecordsLibraryModel';

export const observationCategories: readonly HealthObservationCategory[] = [
  'blood_pressure',
  'heart_rate',
  'steps',
  'body_mass',
  'sleep',
  'other',
];
interface CategoryPage {
  readonly retryCursor?: HealthObservationCursor | null;
  readonly records: readonly HealthObservation[];
  readonly cursor: HealthObservationCursor | null;
  readonly loadState: 'loading' | 'ready' | 'failed';
}
const initialPage: CategoryPage = {
  records: [],
  cursor: null,
  loadState: 'loading',
};

/** Each card reads its own indexed month page; dense types cannot hide sparse ones. */
export function useHealthRecordCategoryPages(
  loadObservations: HealthObservationPageLoader,
  refreshRevision = 0,
) {
  const [pages, setPages] = useState<
    Partial<Record<HealthObservationCategory, CategoryPage>>
  >({});
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const pending = useRef(new Set<HealthObservationCategory>());
  const reference = useRef({
    revision: refreshRevision,
    now: new Date().toISOString(),
  });
  if (reference.current.revision !== refreshRevision) {
    // Include newly imported measurements through return time, not the original mount time.
    reference.current = {
      revision: refreshRevision,
      now: new Date().toISOString(),
    };
  }
  const now = reference.current.now;
  const from = healthRecordPeriodStart('month', now)!.toISOString();
  const reload = useCallback(
    async (
      category: HealthObservationCategory,
      after: HealthObservationCursor | null = null,
    ) => {
      if (pending.current.has(category)) return;
      pending.current.add(category);
      const request = generation.current;
      setPages(current => ({
        ...current,
        [category]: {
          ...(current[category] ?? initialPage),
          loadState: 'loading',
          retryCursor: after,
        },
      }));
      try {
        const page = await loadObservations(after, {
          category,
          fromInclusive: from,
          toInclusive: now,
        });
        if (request !== generation.current) return;
        // Injected fixture readers may return mixed records. Production filters in
        // SQL; this guard keeps those records on their own cards as well.
        const records = page.records.filter(
          record => classifyHealthObservation(record) === category,
        );
        setPages(current => ({
          ...current,
          [category]: {
            records: after
              ? [
                  ...new Map(
                    [...(current[category]?.records ?? []), ...records].map(
                      record => [record.id, record],
                    ),
                  ).values(),
                ]
              : records,
            cursor: page.nextCursor,
            loadState: 'ready',
          },
        }));
      } catch {
        if (request === generation.current)
          setPages(current => ({
            ...current,
            [category]: {
              ...(current[category] ?? initialPage),
              loadState: 'failed',
            },
          }));
      } finally {
        if (request === generation.current) {
          pending.current.delete(category);
          setRevision(value => value + 1);
        }
      }
    },
    [loadObservations, from, now],
  );

  useEffect(() => {
    generation.current += 1;
    pending.current.clear();
    // Keep the retained page visible while refreshing after import; failure is not empty.
    for (const category of observationCategories) reload(category);
    return () => {
      generation.current += 1;
    };
  }, [reload]);

  return {
    read: (category: HealthObservationCategory) =>
      pages[category] ?? initialPage,
    reload,
    revision,
  };
}
