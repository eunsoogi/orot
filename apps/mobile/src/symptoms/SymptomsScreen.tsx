import { useState } from 'react';
import {
  Button,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from 'react-native';
import type { SymptomEntry } from '@orot/storage';
import SymptomEntryCard from './SymptomEntryCard';
import SymptomFilters from './SymptomFilters';
import SymptomForm from './SymptomForm';
import styles from './SymptomsScreen.styles';
import type { NewSymptomDraft, SymptomEdit, SymptomFilter } from './types';

interface SymptomsScreenProps {
  entries: SymptomEntry[];
  filter?: SymptomFilter;
  loading?: boolean;
  onBack: () => void;
  onFilterChange: (filter: SymptomFilter) => Promise<void> | void;
  onCreate: (draft: NewSymptomDraft) => Promise<void> | void;
  onUpdate: (id: string, changes: SymptomEdit) => Promise<void> | void;
  onResolve: (id: string) => Promise<void> | void;
}

export default function SymptomsScreen({
  entries,
  filter = {},
  loading = false,
  onBack,
  onFilterChange,
  onCreate,
  onUpdate,
  onResolve,
}: SymptomsScreenProps) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SymptomEntry | null>(null);
  const [error, setError] = useState('');

  async function resolve(entry: SymptomEntry) {
    setError('');
    try {
      await onResolve(entry.id);
    } catch {
      setError('The symptom could not be marked resolved. Try again.');
    }
  }

  function renderEntry(entry: SymptomEntry) {
    if (editing?.id === entry.id) {
      return (
        <SymptomForm
          entry={entry}
          key={entry.id}
          mode="edit"
          onCancel={() => setEditing(null)}
          onCreate={onCreate}
          onUpdate={async (id, changes) => {
            await onUpdate(id, changes);
            setEditing(null);
          }}
        />
      );
    }
    return (
      <SymptomEntryCard
        entry={entry}
        key={entry.id}
        onEdit={() => setEditing(entry)}
        onResolve={() => {
          resolve(entry);
        }}
      />
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.keyboardAvoider}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        testID="symptoms-scroll"
      >
        <View style={styles.topBar}>
          <Text
            accessibilityRole="header"
            style={styles.title}
            testID="symptoms-title"
          >
            Symptoms
          </Text>
          <Button onPress={onBack} testID="symptoms-back" title="Back" />
        </View>
        <Text style={styles.message}>
          Record what you notice in your own words.
        </Text>
        <Text style={styles.hint}>
          Journal entries are user-entered and not clinician-confirmed.
        </Text>
        {error ? (
          <Text accessibilityRole="alert" testID="symptoms-error">
            {error}
          </Text>
        ) : null}
        <SymptomFilters filter={filter} onFilterChange={onFilterChange} />
        {loading ? (
          <Text testID="symptoms-loading">Loading symptoms…</Text>
        ) : entries.length === 0 ? (
          <Text testID="symptoms-empty">
            No symptom entries match these filters.
          </Text>
        ) : (
          entries.map(renderEntry)
        )}
        {creating ? (
          <SymptomForm
            key="new-symptom"
            mode="create"
            onCancel={() => setCreating(false)}
            onCreate={async draft => {
              await onCreate(draft);
              setCreating(false);
            }}
            onUpdate={onUpdate}
          />
        ) : !editing ? (
          <Button
            onPress={() => setCreating(true)}
            testID="symptom-add"
            title="Add symptom"
          />
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
