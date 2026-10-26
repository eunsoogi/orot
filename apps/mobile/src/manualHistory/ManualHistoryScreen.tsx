import { useCallback, useEffect, useState } from 'react';
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native';
import { t } from '../i18n';
import { ManualHistoryEntryBrowser } from './ManualHistoryEntryBrowser';
import ManualHistoryForm from './ManualHistoryForm';
import { useManualHistoryDraftState } from './useManualHistoryDraftState';
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
    setFormKey('new');
    setFormEntry(null);
    setError('');
    setNotice('');
    setFormOpen(true);
  }

  function startCorrection(entry: ManualHistoryScreenRecord) {
    setFormKey('correction:' + entry.id);
    setFormEntry(entry);
    setError('');
    setNotice('');
    setFormOpen(true);
  }

  async function openDetails(entry: ManualHistoryScreenRecord) {
    setError('');
    try {
      setSelectedEntry(entry);
      setHistory(await repository.history(entry.id));
    } catch {
      setError(t('manualHistory.error.history'));
    }
  }

  async function saveEntry(input: ManualHistoryScreenDraft) {
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
    setSaving(false);
  }

  const saveFormDraft = useCallback(
    (draft: ManualHistoryScreenFormDraft) => {
      if (formKey) recordDraft(formKey, draft, formEntry);
    },
    [formEntry, formKey, recordDraft],
  );

  async function deleteEntry() {
    if (!selectedEntry) return;
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
      setSaving(false);
    }
  }

  const initialValue = formKey ? getDraft(formKey) : undefined;
  const correctionInitialValue: ManualHistoryScreenFormDraft | undefined =
    formEntry
      ? {
          kind: formEntry.kind,
          title: formEntry.title,
          details: formEntry.details,
          effectiveDateText:
            formEntry.effectiveDate.status === 'known'
              ? formEntry.effectiveDate.date
              : '',
          dateUnknown: formEntry.effectiveDate.status === 'unknown',
          correctionNote: '',
        }
      : undefined;

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      testID="manual-history-scroll"
    >
      <View style={styles.topBar}>
        <Text
          accessibilityRole="header"
          style={styles.title}
          testID="manual-history-title"
        >
          {t('manualHistory.title')}
        </Text>
        <Button
          onPress={onBack}
          testID="manual-history-back"
          title={t('manualHistory.back')}
        />
      </View>
      <Text style={styles.message}>{t('manualHistory.subtitle')}</Text>
      <Text style={styles.provenanceNote}>{t('manualHistory.provenance')}</Text>
      {notice ? <Text accessibilityLiveRegion="polite">{notice}</Text> : null}
      {error ? (
        <Text accessibilityRole="alert" testID="manual-history-error">
          {error}
        </Text>
      ) : null}

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
      {!formOpen ? (
        <Button
          onPress={startNewEntry}
          testID="manual-history-add"
          title={t('manualHistory.add')}
        />
      ) : (
        <ManualHistoryForm
          // Replace field state when switching entries, then restore that entry's saved draft.
          key={formKey ?? 'new'}
          initialValue={initialValue ?? correctionInitialValue}
          isCorrection={formEntry !== null}
          onClose={() => setFormOpen(false)}
          onDraftChange={saveFormDraft}
          onSave={saveEntry}
          saving={saving}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
    padding: 20,
    backgroundColor: '#f7f8fa',
    minHeight: '100%',
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  title: { color: '#17212b', fontSize: 24, fontWeight: '700' },
  message: { color: '#45515f', fontSize: 15 },
  provenanceNote: { color: '#45515f', fontSize: 13 },
});
