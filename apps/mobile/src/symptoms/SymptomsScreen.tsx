import { useState } from 'react';
import {
  Button,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
} from 'react-native';
import type { SymptomEntry } from '@orot/storage';
import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import { useNavigationLeaveStateRegistration } from '../navigation';
import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import SymptomEntryCard from './SymptomEntryCard';
import SymptomForm from './SymptomForm';
import SymptomListPanel from './SymptomListPanel';
import SymptomSelectionSummary from './SymptomSelectionSummary';
import styles from './SymptomsScreen.styles';
import useSymptomScrollDiagnostics from './useSymptomScrollDiagnostics';
import useSymptomFocusReveal from './useSymptomFocusReveal';
import { SymptomFocusRevealContext } from './SymptomTextInput';
import type { NewSymptomDraft, SymptomEdit, SymptomFilter } from './types';

interface SymptomsScreenProps {
  entries: SymptomEntry[];
  filter?: SymptomFilter;
  loadError?: string;
  loading?: boolean;
  canWrite?: boolean;
  onBack: () => void;
  onRetry: () => Promise<void> | void;
  onFilterChange: (filter: SymptomFilter) => Promise<void> | void;
  onCreate: (draft: NewSymptomDraft) => Promise<void> | void;
  onUpdate: (id: string, changes: SymptomEdit) => Promise<void> | void;
  onResolve: (id: string) => Promise<void> | void;
}

export default function SymptomsScreen({
  entries,
  filter = {},
  loadError = '',
  loading = false,
  canWrite = true,
  onBack,
  onRetry,
  onFilterChange,
  onCreate,
  onUpdate,
  onResolve,
}: SymptomsScreenProps) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SymptomEntry | null>(null);
  // Keep the selected entry local so reflow changes only the panel geometry.
  const [selectedSymptomId, setSelectedSymptomId] = useState<string | null>(
    null,
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [inputRevision, setInputRevision] = useState(0);
  const navigationInset = useNavigationContentInset();
  const { diagnosticScroll, observeScroll, observeScrollEvent, observeTouch } =
    useSymptomScrollDiagnostics();
  const focusReveal = useSymptomFocusReveal(
    diagnosticScroll,
    navigationInset.paddingBottom,
  );
  const hasSharedNavigation = useNavigationLeaveStateRegistration({
    canLeave: !saving,
    hasUnsavedChanges: creating || editing !== null,
    hasOngoingOperation: saving,
    isRecording: false,
    revision: Number(creating) + Number(editing !== null) + Number(saving),
    inputRevision,
  });
  const selectedSymptom =
    entries.find(entry => entry.id === selectedSymptomId) ?? null;
  // New typing invalidates a pending discard confirmation from the shared toolbar.
  const draftChanged = () => setInputRevision(value => value + 1);

  async function resolve(entry: SymptomEntry) {
    setError('');
    setSaving(true);
    try {
      await onResolve(entry.id);
    } catch {
      setError('The symptom could not be marked resolved. Try again.');
    } finally {
      setSaving(false);
    }
  }

  function renderEntry(entry: SymptomEntry) {
    if (editing?.id === entry.id) {
      return (
        <SymptomForm
          entry={entry}
          key={entry.id}
          mode="edit"
          onDraftChange={draftChanged}
          onSavingChange={setSaving}
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
        disabled={saving || creating || editing !== null}
        entry={entry}
        key={entry.id}
        onSelect={() => setSelectedSymptomId(entry.id)}
        selected={entry.id === selectedSymptomId}
        onEdit={() => setEditing(entry)}
        onResolve={() => {
          resolve(entry);
        }}
      />
    );
  }

  return (
    <KeyboardAvoidingView
      enabled={!hasSharedNavigation}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.keyboardAvoider}
    >
      <SymptomFocusRevealContext.Provider value={focusReveal}>
        <ScrollView
          ref={diagnosticScroll}
          onLayout={event => {
            observeScroll('layout', { layout: event.nativeEvent.layout });
            focusReveal.revealFocused();
          }}
          onContentSizeChange={(width, height) =>
            observeScroll('content-size', { width, height })
          }
          onTouchStart={observeTouch}
          onTouchEnd={observeTouch}
          onResponderGrant={observeTouch}
          onScrollBeginDrag={observeScrollEvent}
          onScroll={event => {
            observeScrollEvent(event);
            focusReveal.onScroll(event);
          }}
          onScrollEndDrag={observeScrollEvent}
          contentContainerStyle={[styles.container, navigationInset]}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          testID="symptoms-scroll"
        >
          {/* Both panels stay mounted so selection survives geometry changes. */}
          <AdaptiveColumns
            primary={
              <SymptomListPanel
                backButtonVisible={!hasSharedNavigation}
                disabled={creating || editing !== null || saving}
                error={error}
                filter={filter}
                onBack={onBack}
                onFilterChange={onFilterChange}
              >
                {loadError ? (
                  <>
                    <Text
                      accessibilityRole="alert"
                      style={styles.error}
                      testID="symptoms-load-error"
                    >
                      {loadError}
                    </Text>
                    <Button
                      disabled={loading}
                      onPress={onRetry}
                      testID="symptoms-retry-list"
                      title="Try again"
                    />
                  </>
                ) : loading ? (
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
                    onDraftChange={draftChanged}
                    onSavingChange={setSaving}
                    onCancel={() => setCreating(false)}
                    onCreate={async draft => {
                      await onCreate(draft);
                      setCreating(false);
                    }}
                    onUpdate={onUpdate}
                  />
                ) : !editing ? (
                  <Button
                    disabled={loading || !canWrite || saving}
                    onPress={() => setCreating(true)}
                    testID="symptom-add"
                    title="Add symptom"
                  />
                ) : null}
              </SymptomListPanel>
            }
            routeKey="symptoms"
            secondary={<SymptomSelectionSummary entry={selectedSymptom} />}
            testID="symptoms-layout"
          />
        </ScrollView>
      </SymptomFocusRevealContext.Provider>
    </KeyboardAvoidingView>
  );
}
