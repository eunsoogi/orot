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
import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import { t } from '../i18n';
import { useNavigationLeaveStateRegistration } from '../navigation';
import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import SymptomJournalEntries from './SymptomJournalEntries';
import SymptomEntryCard from './SymptomEntryCard';
import SymptomForm from './SymptomForm';
import SymptomListPanel from './SymptomListPanel';
import symptomFormStyles from './SymptomForm.styles';
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
  // Selection stays route-owned while inline detail and editor geometry reflow.
  const [selectedSymptomId, setSelectedSymptomId] = useState<string | null>(
    null,
  );
  const [error, setError] = useState('');
  const [failedResolution, setFailedResolution] = useState<string | null>(null);
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
  // New typing invalidates a pending discard confirmation from the shared toolbar.
  const draftChanged = () => setInputRevision(value => value + 1);

  async function resolve(entry: SymptomEntry) {
    setError('');
    setSaving(true);
    try {
      await onResolve(entry.id);
      setFailedResolution(null);
    } catch {
      setFailedResolution(entry.id);
      setError(t('symptoms.journal.resolveError'));
    } finally {
      setSaving(false);
    }
  }

  function renderEntry(entry: SymptomEntry) {
    return (
      <SymptomEntryCard
        disabled={saving || creating || editing !== null}
        entry={entry}
        resolutionFailed={failedResolution === entry.id}
        key={entry.id}
        onSelect={() =>
          setSelectedSymptomId(current =>
            current === entry.id ? null : entry.id,
          )
        }
        selected={entry.id === selectedSymptomId}
        onEdit={() => {
          setEditing(entry);
          diagnosticScroll.current?.scrollTo({ y: 0, animated: false });
        }}
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
          {/* The editor replaces browsing; its draft is never remounted by reflow. */}
          <View style={creating || editing ? styles.hidden : undefined}>
            <AdaptiveColumns
              primary={
                <SymptomListPanel
                  backButtonVisible={!hasSharedNavigation}
                  disabled={creating || editing !== null || saving}
                  error={error}
                  filter={filter}
                  onBack={onBack}
                  onFilterChange={onFilterChange}
                  canAdd={!loading && canWrite && !saving}
                  onAdd={() => {
                    setCreating(true);
                    diagnosticScroll.current?.scrollTo({
                      y: 0,
                      animated: false,
                    });
                  }}
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
                        title={t('symptoms.journal.retry')}
                      />
                    </>
                  ) : loading ? (
                    <Text testID="symptoms-loading">
                      {t('symptoms.journal.loading')}
                    </Text>
                  ) : entries.length === 0 ? (
                    <Text testID="symptoms-empty">
                      {t('symptoms.journal.empty')}
                    </Text>
                  ) : (
                    <SymptomJournalEntries
                      entries={entries}
                      renderEntry={renderEntry}
                    />
                  )}
                </SymptomListPanel>
              }
              routeKey="symptoms"
              testID="symptoms-layout"
            />
          </View>
          {creating || editing ? (
            // Keep the active editor outside either adaptive panel's width clamp.
            <View
              style={symptomFormStyles.fullContentLane}
              testID="symptoms-form-lane"
            >
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
              ) : editing ? (
                <SymptomForm
                  entry={editing}
                  key={editing.id}
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
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      </SymptomFocusRevealContext.Provider>
    </KeyboardAvoidingView>
  );
}
