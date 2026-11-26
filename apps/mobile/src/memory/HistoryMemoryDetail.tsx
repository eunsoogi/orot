import { traceSavedMemoryDeletion } from './savedMemoryDeletionDiagnostics';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { appColors } from '../layout/appColors';
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
  onDeleted,
  isReadCurrent,
  openRepository = openHistoryRepository,
}: {
  readonly record: ManualHistoryScreenRecord;
  readonly onChanged: (id: string) => void;
  readonly onDeleted: () => void;
  readonly isReadCurrent?: () => boolean;
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
  useLayoutEffect(() => {
    alive.current = true;
    setError('');
    let mounted = true;
    const current = () => mounted && (isReadCurrent?.() ?? true);
    async function load() {
      if (!current()) return;
      try {
        const repo = await openRepository();
        if (!current()) return;
        const versions = await repo.history(record.id);
        if (!current()) return;
        setRepository(repo);
        setHistory(versions);
      } catch {
        if (current()) setError(t('manualHistory.error.history'));
      }
    }
    load();
    return () => {
      mounted = false;
      alive.current = false;
    };
  }, [record.id, openRepository, revision, isReadCurrent]);

  async function mutate(input?: ManualHistoryScreenDraft) {
    // Native Back/lock can revoke the ready read before React removes this
    // button or form. Never let its already queued callback edit an old row.
    const current = () => alive.current && (isReadCurrent?.() ?? true);
    if (!repository || busy.current || !current()) return;
    busy.current = true;
    setSaving(true);
    setError('');
    try {
      // Reuse repository source/deletion fences; never recreate a missing original.
      if (input) {
        const saved = await repository.correct(record.id, input);
        if (current()) {
          clearDraft(key);
          setEditing(false);
          onChanged('manual-history:' + saved.id);
        }
      } else {
        traceSavedMemoryDeletion('saved_memory_delete_confirmation', 'started');
        const removed = await repository.delete(record.id);
        if (!removed) throw new Error('Original unavailable');
        // Receipt marks publication to the owning detail, not a measured native frame.
        if (current()) {
          onDeleted();
          traceSavedMemoryDeletion('saved_memory_delete_receipt', 'completed');
        } else {
          traceSavedMemoryDeletion('saved_memory_delete_receipt', 'cancelled');
        }
      }
    } catch {
      if (!input)
        traceSavedMemoryDeletion('saved_memory_delete_receipt', 'failed');
      if (current())
        setError(
          t(input ? 'manualHistory.error.save' : 'manualHistory.error.delete'),
        );
    } finally {
      busy.current = false;
      if (current()) setSaving(false);
    }
  }
  return (
    <View style={styles.content} testID="history-memory-detail">
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
            <Text
              selectable
              style={styles.title}
              testID="manual-history-current-title"
            >
              {record.title}
            </Text>
            <ManualHistoryEntryDetails
              readingLayout
              provenanceNote={t('manualHistory.provenance')}
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
      {(!repository || editing) && (
        <Text style={styles.provenance}>{t('manualHistory.provenance')}</Text>
      )}
    </View>
  );
}

/** Defer native database modules until a protected original detail is actually opened. */
async function openHistoryRepository() {
  const { openLocalManualHistoryRepository } =
    require('../manualHistory/localRepository') as typeof import('../manualHistory/localRepository');
  return openLocalManualHistoryRepository(traceSavedMemoryDeletion);
}

const styles = StyleSheet.create({
  content: { gap: 14, minWidth: 0 },
  title: {
    color: appColors.secondary,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  provenance: { color: appColors.secondary, fontSize: 14, lineHeight: 20 },
});
