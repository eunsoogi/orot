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
) {
  const [pages, setPages] = useState<
    Partial<Record<HealthObservationCategory, CategoryPage>>
  >({});
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const pending = useRef(new Set<HealthObservationCategory>());
  const now = useRef(new Date().toISOString()).current;
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
              ? [...(current[category]?.records ?? []), ...records]
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
    setPages({});
    for (const category of observationCategories) void reload(category);
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
