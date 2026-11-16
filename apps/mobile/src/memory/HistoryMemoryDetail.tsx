import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { t } from '../i18n';
import { AppText as Text } from '../layout/AppText';
import { AppButton } from '../layout/AppButton';
import ManualHistoryEntryDetails from '../manualHistory/ManualHistoryEntryDetails';
import ManualHistoryForm from '../manualHistory/ManualHistoryForm';
import {
  manualHistoryCorrectionDraft,
  useManualHistoryDraftState,
} from '../manualHistory/useManualHistoryDraftState';
import type {
  ManualHistoryScreenFormDraft,
  ManualHistoryScreenDraft,
  ManualHistoryScreenRecord,
  ManualHistoryScreenRepository,
} from '../manualHistory/types';

/** Existing originals retain their correction lineage and explicit destructive confirmation.
 * No create operation is exposed. The parent unmounts this content at every privacy boundary. */
export function HistoryMemoryDetail({
  record,
  onChanged,
  openRepository = openHistoryRepository,
}: {
  readonly record: ManualHistoryScreenRecord;
  readonly onChanged: (id: string) => void;
  readonly openRepository?: () => Promise<ManualHistoryScreenRepository>;
}) {
  const [repository, setRepository] =
    useState<ManualHistoryScreenRepository | null>(null);
  const [history, setHistory] = useState<ManualHistoryScreenRecord[]>([]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const busy = useRef(false);
  const { getDraft, recordDraft, clearDraft } =
    useManualHistoryDraftState(saving);
  const key = 'correction:' + record.id;
  const saveDraft = useCallback(
    (draft: ManualHistoryScreenFormDraft) => {
      recordDraft(key, draft, record);
    },
    [key, record, recordDraft],
  );
  useEffect(() => {
    alive.current = true;
    setError('');
    let current = true;
    async function load() {
      try {
        const repo = await openRepository();
        if (!current) return;
        const versions = await repo.history(record.id);
        if (!current) return;
        setRepository(repo);
        setHistory(versions);
      } catch {
        if (current) setError(t('manualHistory.error.history'));
      }
    }
    load();
    return () => {
      current = false;
      alive.current = false;
    };
  }, [record.id, openRepository, revision]);

  async function mutate(input?: ManualHistoryScreenDraft) {
    if (!repository || busy.current || !alive.current) return;
    busy.current = true;
    setSaving(true);
    setError('');
    try {
      // Reuse repository source/deletion fences; never recreate a missing original.
      if (input) {
        const saved = await repository.correct(record.id, input);
        if (alive.current) {
          clearDraft(key);
          setEditing(false);
          onChanged('manual-history:' + saved.id);
        }
      } else {
        const removed = await repository.delete(record.id);
        if (!removed) throw new Error('Original unavailable');
        if (alive.current) onChanged('manual-history:' + record.id);
      }
    } catch {
      if (alive.current)
        setError(
          t(input ? 'manualHistory.error.save' : 'manualHistory.error.delete'),
        );
    } finally {
      busy.current = false;
      if (alive.current) setSaving(false);
    }
  }
  return (
    <View testID="history-memory-detail">
      <Text>{t('manualHistory.provenance')}</Text>
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      {!repository && error ? (
        <AppButton
          title={t('savedMemory.retry')}
          onPress={() => setRevision(value => value + 1)}
        />
      ) : null}
      {!repository && !error ? <Text>{t('savedMemory.loading')}</Text> : null}
      {repository &&
        (editing ? (
          <ManualHistoryForm
            isCorrection
            initialValue={getDraft(key) ?? manualHistoryCorrectionDraft(record)}
            onDraftChange={saveDraft}
            onSave={mutate}
            onClose={() => {
              if (!busy.current) setEditing(false);
            }}
            saving={saving}
          />
        ) : (
          <>
            <Text selectable>{record.title}</Text>
            <ManualHistoryEntryDetails
              entry={record}
              history={history}
              deleting={saving}
              onCorrect={() => {
                if (!busy.current) setEditing(true);
              }}
              onDelete={() => mutate()}
            />
            {getDraft(key) ? (
              <AppButton
                title={t('manualHistory.form.correctTitle')}
                onPress={() => setEditing(true)}
              />
            ) : null}
          </>
        ))}
    </View>
  );
}

/** Defer native database modules until a protected original detail is actually opened. */
async function openHistoryRepository() {
  const { openLocalManualHistoryRepository } =
    require('../manualHistory/localRepository') as typeof import('../manualHistory/localRepository');
  return openLocalManualHistoryRepository();
}
