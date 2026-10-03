import { useCallback, useEffect, useState } from 'react';
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native';
import ManualHistoryEntryDetails from './ManualHistoryEntryDetails';
import ManualHistoryForm from './ManualHistoryForm';
import type { ManualHistoryScreenDraft, ManualHistoryScreenRecord, ManualHistoryScreenRepository } from './types';

interface ManualHistoryScreenProps {
  repository: ManualHistoryScreenRepository;
  onBack: () => void;
}

const KIND_LABELS: Record<ManualHistoryScreenRecord['kind'], string> = {
  diagnosis_history: 'Diagnosis or history',
  procedure: 'Procedure',
  medication_context: 'Medication context',
  note: 'Free-form note',
};

function entryStatus(entry: ManualHistoryScreenRecord): string {
  const review = entry.reviewState.status === 'unreviewed'
    ? 'Unreviewed'
    : entry.reviewState.status === 'needs_review'
      ? 'Needs review'
      : 'Reviewed';
  return 'User entered · ' + review;
}

function dateLabel(entry: ManualHistoryScreenRecord): string {
  return entry.effectiveDate.status === 'known'
    ? 'Effective date: ' + entry.effectiveDate.date
    : 'Effective date unknown';
}

export default function ManualHistoryScreen({ repository, onBack }: ManualHistoryScreenProps) {
  const [entries, setEntries] = useState<ManualHistoryScreenRecord[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<ManualHistoryScreenRecord | null>(null);
  const [history, setHistory] = useState<ManualHistoryScreenRecord[]>([]);
  const [formEntry, setFormEntry] = useState<ManualHistoryScreenRecord | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setEntries(await repository.list());
    } catch {
      setError('Medical history could not be loaded. Try again.');
    } finally {
      setLoading(false);
    }
  }, [repository]);

  useEffect(() => {
    reload().catch(() => undefined);
  }, [reload]);

  function startNewEntry() {
    setFormEntry(null);
    setError('');
    setNotice('');
    setFormOpen(true);
  }

  function startCorrection(entry: ManualHistoryScreenRecord) {
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
      setError('Correction history could not be loaded. Try again.');
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
      setError('Medical history could not be saved. Try again.');
      setSaving(false);
      return;
    }

    setFormOpen(false);
    setFormEntry(null);
    setNotice(previous ? 'Correction saved. Earlier versions are preserved.' : 'Medical history saved.');
    if (previous) {
      setSelectedEntry(saved);
      setHistory([]);
    }
    await reload();
    if (previous) {
      try {
        setHistory(await repository.history(saved.id));
      } catch {
        setError('Correction saved, but correction history could not be loaded. Reopen the entry to retry.');
      }
    }
    setSaving(false);
  }

  const initialValue = formEntry
    ? {
        kind: formEntry.kind,
        title: formEntry.title,
        details: formEntry.details,
        effectiveDate: formEntry.effectiveDate,
      }
    : undefined;

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" testID="manual-history-scroll">
      <View style={styles.topBar}>
        <Text accessibilityRole="header" style={styles.title} testID="manual-history-title">
          Medical history
        </Text>
        <Button onPress={onBack} testID="manual-history-back" title="Back" />
      </View>
      <Text style={styles.message}>Keep important health history on this device.</Text>
      <Text style={styles.provenanceNote}>Entries are user-entered and unreviewed.</Text>
      {notice ? <Text accessibilityLiveRegion="polite">{notice}</Text> : null}
      {error ? <Text accessibilityRole="alert" testID="manual-history-error">{error}</Text> : null}

      {loading ? (
        <Text testID="manual-history-loading">Loading medical history…</Text>
      ) : error && entries.length === 0 ? (
        <Button onPress={reload} testID="manual-history-retry" title="Try again" />
      ) : entries.length === 0 ? (
        <Text testID="manual-history-empty">No medical history entries yet.</Text>
      ) : (
        entries.map(entry => (
          <View key={entry.id} style={styles.card} testID={'manual-history-entry-' + entry.id}>
            <Text style={styles.entryTitle}>{entry.title}</Text>
            <Text>{KIND_LABELS[entry.kind]}</Text>
            <Text testID={'manual-history-date-' + entry.id}>{dateLabel(entry)}</Text>
            <Text>{entryStatus(entry)}</Text>
            <Button
              onPress={() => openDetails(entry)}
              testID={'manual-history-details-' + entry.id}
              title="Details and correction history"
            />
          </View>
        ))
      )}

      {selectedEntry ? (
        <ManualHistoryEntryDetails
          entry={selectedEntry}
          history={history}
          onClose={() => {
            setSelectedEntry(null);
            setHistory([]);
          }}
          onCorrect={() => startCorrection(selectedEntry)}
        />
      ) : null}
      {!formOpen ? (
        <Button onPress={startNewEntry} testID="manual-history-add" title="Add medical history" />
      ) : (
        <ManualHistoryForm
          initialValue={initialValue}
          isCorrection={formEntry !== null}
          onClose={() => setFormOpen(false)}
          onSave={saveEntry}
          saving={saving}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12, padding: 20, backgroundColor: '#f7f8fa', minHeight: '100%' },
  topBar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  title: { color: '#17212b', fontSize: 24, fontWeight: '700' },
  message: { color: '#45515f', fontSize: 15 },
  provenanceNote: { color: '#45515f', fontSize: 13 },
  card: { backgroundColor: 'white', borderRadius: 10, gap: 8, padding: 14 },
  entryTitle: { color: '#17212b', fontSize: 18, fontWeight: '600' },
});
