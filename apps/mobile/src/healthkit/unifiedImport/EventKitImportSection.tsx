import { useEffect, useState } from 'react';
import { Button, Pressable, Text, View } from 'react-native';
import { t } from '../../i18n';
import { formatCalendarEventRange } from '../../calendar/dateTime';
import type { CalendarEvent } from '../../calendar/types';
import type { UnifiedEventKitProgress, UnifiedImportRun } from './types';

interface EventKitImportSectionProps {
  selected: boolean;
  disabled: boolean;
  progress: UnifiedEventKitProgress | null;
  run: UnifiedImportRun | null;
  onToggle: () => void;
}

/** Shows EventKit candidates in the selected import flow and saves only a confirmed choice. */
export function EventKitImportSection({
  selected,
  disabled,
  progress,
  run,
  onToggle,
}: EventKitImportSectionProps) {
  const [selectedCandidateKey, setSelectedCandidateKey] = useState<
    string | null
  >(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const candidates = progress?.candidates ?? [];
  const selectedCandidate = candidates.find(
    event => candidateKey(event) === selectedCandidateKey,
  );

  useEffect(() => {
    if (!selected || progress === null || candidates.length === 0) {
      setSelectedCandidateKey(null);
      setSaveError(false);
    }
  }, [candidates.length, progress, selected]);

  async function confirmCandidate() {
    if (!selectedCandidate || !run || saving) return;
    setSaving(true);
    setSaveError(false);
    try {
      await run.confirmCalendarEvent(selectedCandidate);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected, disabled }}
        disabled={disabled}
        onPress={onToggle}
        testID="unified-import-toggle-eventKit"
      >
        <Text>
          {`${selected ? '☑' : '☐'} ${t('healthkit.unifiedImport.calendarLabel')}`}
        </Text>
      </Pressable>
      {selected && progress ? (
        <Text
          accessibilityLiveRegion="polite"
          testID="unified-import-eventkit-status"
        >
          {statusMessage(progress)}
        </Text>
      ) : null}
      {selected && !progress?.appointmentConfirmed
        ? candidates.map((event, index) => (
            <View
              key={candidateKey(event)}
              testID={`unified-import-eventkit-candidate-${index}`}
            >
              <Text>
                {event.calendarEventSnapshot.title ||
                  t('calendar.eventNoTitle')}
              </Text>
              <Text>{formatCalendarEventRange(event)}</Text>
              <Button
                disabled={disabled || saving}
                onPress={() => setSelectedCandidateKey(candidateKey(event))}
                testID={`unified-import-eventkit-select-${index}`}
                title={t('calendar.selectEvent')}
              />
            </View>
          ))
        : null}
      {selectedCandidate && !progress?.appointmentConfirmed ? (
        <View testID="unified-import-eventkit-confirmation">
          <Text>{t('calendar.confirmPrompt')}</Text>
          <Text>
            {selectedCandidate.calendarEventSnapshot.title ||
              t('calendar.eventNoTitle')}
          </Text>
          <Text>{formatCalendarEventRange(selectedCandidate)}</Text>
          <Button
            disabled={saving || !run}
            onPress={confirmCandidate}
            testID="unified-import-eventkit-confirm"
            title={saving ? t('calendar.saving') : t('calendar.confirm')}
          />
          <Button
            disabled={saving}
            onPress={() => setSelectedCandidateKey(null)}
            title={t('calendar.cancelSelection')}
          />
        </View>
      ) : null}
      {saveError ? (
        <Text
          accessibilityRole="alert"
          testID="unified-import-eventkit-save-error"
        >
          {t('calendar.confirmError')}
        </Text>
      ) : null}
      {progress?.appointmentConfirmed ? (
        <Text
          accessibilityLiveRegion="polite"
          testID="unified-import-eventkit-confirmed"
        >
          {t('calendar.confirmed')}
        </Text>
      ) : null}
    </View>
  );
}

function statusMessage(progress: UnifiedEventKitProgress): string {
  switch (progress.status) {
    case 'notSelected':
      return '';
    case 'waitingAuthorization':
    case 'authorizing':
    case 'ready':
    case 'querying':
    case 'fullAccess':
      return t('calendar.loading');
    case 'complete':
      return t('calendar.candidateHint');
    case 'empty':
      return t('calendar.empty');
    case 'denied':
      return t('calendar.accessDenied');
    case 'restricted':
      return t('calendar.accessRestricted');
    case 'writeOnly':
      return t('calendar.fullAccessRequired');
    case 'notDetermined':
      return t('calendar.tryAgainAfterPermission');
    case 'cancelled':
      return t('healthkit.unifiedImport.eventKitCancelled');
    case 'failed':
      return t('calendar.loadError');
  }
}

function candidateKey(event: CalendarEvent): string {
  const snapshot = event.calendarEventSnapshot;
  return `${event.calendarEventIdentifier}\u0000${snapshot.occurrenceDate ?? snapshot.floatingOccurrenceAt ?? event.effectiveAt}`;
}
