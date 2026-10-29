import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView } from 'react-native';
import { AppButton as Button } from '../layout/AppButton';
import { ManualHistoryHeader } from './ManualHistoryHeader';
import { styles } from './manualHistoryScreenStyles';
import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import { t } from '../i18n';
import { ManualHistoryEntryBrowser } from './ManualHistoryEntryBrowser';
import ManualHistoryForm from './ManualHistoryForm';
import {
  manualHistoryCorrectionDraft,
  useManualHistoryDraftState,
} from './useManualHistoryDraftState';
import type {
  ManualHistoryScreenDraft,
  ManualHistoryScreenFormDraft,
  ManualHistoryScreenRecord,
  ManualHistoryScreenRepository,
} from './types';

interface ManualHistoryScreenProps {
  repository: ManualHistoryScreenRepository;
  onBack: () => void;
}

/** Keeps unsaved form values by target so closing a form does not discard its draft. */
export default function ManualHistoryScreen({
  repository,
  onBack,
}: ManualHistoryScreenProps) {
  const navigationInset = useNavigationContentInset();
  const savingRef = useRef(false);
  const [entries, setEntries] = useState<ManualHistoryScreenRecord[]>([]);
  const [selectedEntry, setSelectedEntry] =
    useState<ManualHistoryScreenRecord | null>(null);
  const [history, setHistory] = useState<ManualHistoryScreenRecord[]>([]);
  const [formEntry, setFormEntry] = useState<ManualHistoryScreenRecord | null>(
    null,
  );
  const [formKey, setFormKey] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const { clearDraft, getDraft, recordDraft } =
    useManualHistoryDraftState(saving);

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setEntries(await repository.list());
    } catch {
      setError(t('manualHistory.error.load'));
    } finally {
      setLoading(false);
    }
  }, [repository]);

  useEffect(() => {
    reload().catch(() => undefined);
  }, [reload]);

  function startNewEntry() {
    if (savingRef.current) return;
    setFormKey('new');
    setFormEntry(null);
    setError('');
    setNotice('');
    setFormOpen(true);
  }

  function startCorrection(entry: ManualHistoryScreenRecord) {
    if (savingRef.current) return;
    setFormKey('correction:' + entry.id);
    setFormEntry(entry);
    setError('');
    setNotice('');
    setFormOpen(true);
  }

  async function openDetails(entry: ManualHistoryScreenRecord) {
    if (savingRef.current) return;
    setError('');
    try {
      setSelectedEntry(entry);
      setHistory(await repository.history(entry.id));
    } catch {
      setError(t('manualHistory.error.history'));
    }
  }

  async function saveEntry(input: ManualHistoryScreenDraft) {
    // A ref closes the same-event gap before React publishes the disabled state.
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    const previous = formEntry;
    let saved: ManualHistoryScreenRecord;
    try {
      saved = previous
        ? await repository.correct(previous.id, input)
        : await repository.create(input);
    } catch {
      setError(t('manualHistory.error.save'));
      savingRef.current = false;
      setSaving(false);
      return;
    }

    setFormOpen(false);
    if (formKey) {
      clearDraft(formKey);
    }
    setFormKey(null);
    setFormEntry(null);
    setNotice(
      previous
        ? t('manualHistory.notice.corrected')
        : t('manualHistory.notice.saved'),
    );
    if (previous) {
      setSelectedEntry(saved);
      setHistory([]);
    }
    await reload();
    if (previous) {
      try {
        setHistory(await repository.history(saved.id));
      } catch {
        setError(t('manualHistory.error.correctedHistory'));
      }
    }
    savingRef.current = false;
    setSaving(false);
  }

  const saveFormDraft = useCallback(
    (draft: ManualHistoryScreenFormDraft) => {
      if (formKey) recordDraft(formKey, draft, formEntry);
    },
    [formEntry, formKey, recordDraft],
  );

  async function deleteEntry() {
    if (!selectedEntry || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const deleted = await repository.delete(selectedEntry.id);
      if (!deleted) throw new Error('The entry is no longer available.');
      setSelectedEntry(null);
      setHistory([]);
      setNotice(t('manualHistory.notice.deleted'));
      await reload();
    } catch {
      setError(t('manualHistory.error.delete'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const initialValue = formKey ? getDraft(formKey) : undefined;

  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={[styles.container, navigationInset]}
      keyboardShouldPersistTaps="handled"
      testID="manual-history-scroll"
    >
      <ManualHistoryHeader
        onBack={onBack}
        saving={saving}
        error={error}
        notice={notice}
      />

      {!formOpen ? (
        <Button
          variant="secondary"
          disabled={saving}
          onPress={startNewEntry}
          testID="manual-history-add"
          title={t('manualHistory.add')}
        />
      ) : (
        <ManualHistoryForm
          // Replace field state when switching entries, then restore that entry's saved draft.
          key={formKey ?? 'new'}
          initialValue={initialValue ?? manualHistoryCorrectionDraft(formEntry)}
          isCorrection={formEntry !== null}
          onClose={() => {
            if (!savingRef.current) setFormOpen(false);
          }}
          onDraftChange={saveFormDraft}
          onSave={saveEntry}
          saving={saving}
        />
      )}
      <ManualHistoryEntryBrowser
        deleting={saving}
        entries={entries}
        errorWithoutEntries={Boolean(error) && entries.length === 0}
        history={history}
        loading={loading}
        onCloseDetails={() => {
          setSelectedEntry(null);
          setHistory([]);
        }}
        onCorrect={() => {
          if (selectedEntry) startCorrection(selectedEntry);
        }}
        onDelete={deleteEntry}
        onOpenDetails={openDetails}
        onRetry={reload}
        selectedEntry={selectedEntry}
      />
    </ScrollView>
  );
}
