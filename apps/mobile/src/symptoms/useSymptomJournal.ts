import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { SymptomEntry, SymptomEntryFilter } from '@orot/storage';
import { t } from '../i18n';
import { openLocalSymptomJournal } from './localRepository';
import type { SymptomJournalRepository } from './localRepository';
import type { NewSymptomDraft, SymptomEdit } from './types';
import { SymptomFilterContext } from './SymptomFilterContext';

/** Keeps journal state in its retained route; failed reads clear stale results. */
export function useSymptomJournal(
  loadSymptoms: () => Promise<SymptomJournalRepository> = openLocalSymptomJournal,
) {
  const repository = useRef<SymptomJournalRepository | null>(null);
  const [entries, setEntries] = useState<SymptomEntry[]>([]);
  const retainedFilter = useContext(SymptomFilterContext);
  const [localFilter, setLocalFilter] = useState<SymptomEntryFilter>({});
  const { filter, setFilter } = retainedFilter ?? {
    filter: localFilter,
    setFilter: setLocalFilter,
  };
  const initialFilter = useRef(filter);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const request = useRef(0);
  const mounted = useRef(false);

  const reload = useCallback(
    async (nextFilter: SymptomEntryFilter = {}) => {
      const generation = ++request.current;
      setLoading(true);
      setError('');
      try {
        repository.current ??= await loadSymptoms();
        const result = await repository.current.list(nextFilter);
        // Late reads cannot overwrite a newer filter or an unmounted route.
        if (mounted.current && generation === request.current)
          setEntries(result);
      } catch {
        if (mounted.current && generation === request.current) {
          setEntries([]);
          setError(
            repository.current
              ? t('symptoms.journal.loadError')
              : t('symptoms.journal.openError'),
          );
        }
      } finally {
        if (mounted.current && generation === request.current)
          setLoading(false);
      }
    },
    [loadSymptoms],
  );

  useEffect(() => {
    mounted.current = true;
    reload(initialFilter.current);
    return () => {
      mounted.current = false;
      request.current += 1;
    };
  }, [reload]);

  function writer() {
    if (!repository.current)
      throw new Error('The symptom journal is not open.');
    return repository.current;
  }

  return {
    entries,
    filter,
    loading,
    error,
    canWrite: repository.current !== null,
    retry: () => reload(filter),
    async changeFilter(nextFilter: SymptomEntryFilter) {
      setFilter(nextFilter);
      await reload(nextFilter);
    },
    async create(draft: NewSymptomDraft) {
      await writer().create(draft);
      await reload(filter);
    },
    async update(id: string, changes: SymptomEdit) {
      if (!(await writer().update(id, changes)))
        throw new Error('The symptom entry no longer exists.');
      await reload(filter);
    },
    async resolve(id: string) {
      if (!(await writer().resolve(id)))
        throw new Error('The symptom entry no longer exists.');
      await reload(filter);
    },
  };
}
