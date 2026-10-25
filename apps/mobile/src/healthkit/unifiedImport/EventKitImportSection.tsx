import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { AppText as Text } from '../../layout/AppText';
import { AppButton as Button } from '../../layout/AppButton';
import { AppSymbol } from '../../layout/AppSymbol';
import { CheckboxIndicator } from '../../layout/CheckboxIndicator';
import { appColors } from '../../layout/appColors';
import type { NavigationPrimaryAction } from '../../navigation/NavigationActionBar';
import { unifiedImportStyles as styles } from './unifiedImportStyles';
import { t } from '../../i18n';
import { formatCalendarEventRange } from '../../calendar/dateTime';
import type { UnifiedEventKitProgress, UnifiedImportRun } from './types';
import { candidateKey, statusMessage } from './eventKitImportPresentation';

interface EventKitImportSectionProps {
  selected: boolean;
  reviewing?: boolean;
  disabled: boolean;
  progress: UnifiedEventKitProgress | null;
  run: UnifiedImportRun | null;
  onToggle: () => void;
  onPrimaryActionChange?: (action: NavigationPrimaryAction | undefined) => void;
  onSavingChange?: (saving: boolean) => void;
}

interface SaveErrorOwner {
  readonly run: UnifiedImportRun;
  readonly candidateKey: string;
}

/** Shows EventKit candidates in the selected import flow and saves only a confirmed choice. */
export function EventKitImportSection({
  selected,
  reviewing = false,
  disabled,
  progress,
  run,
  onToggle,
  onPrimaryActionChange,
  onSavingChange,
}: EventKitImportSectionProps) {
  const [selectedCandidateKey, setSelectedCandidateKey] = useState<
    string | null
  >(null);
  const [saving, setSaving] = useState(false);
  const [saveErrorOwner, setSaveErrorOwner] = useState<SaveErrorOwner | null>(
    null,
  );
  const candidates = progress?.candidates ?? [];
  const selectedCandidate = candidates.find(
    event => candidateKey(event) === selectedCandidateKey,
  );
  // A late save error is visible only while its run and candidate still own this section.
  const saveError =
    selected &&
    run !== null &&
    selectedCandidate !== undefined &&
    saveErrorOwner !== null &&
    saveErrorOwner.run === run &&
    saveErrorOwner.candidateKey === candidateKey(selectedCandidate);

  useEffect(() => {
    if (!selected || progress === null || candidates.length === 0) {
      setSelectedCandidateKey(null);
      setSaveErrorOwner(null);
    }
  }, [candidates.length, progress, selected]);

  async function confirmCandidate() {
    if (!selectedCandidate || !run || saving) return;
    const confirmationRun = run;
    const confirmationCandidateKey = candidateKey(selectedCandidate);
    setSaving(true);
    setSaveErrorOwner(null);
    try {
      await confirmationRun.confirmCalendarEvent(selectedCandidate);
    } catch {
      setSaveErrorOwner({
        run: confirmationRun,
        candidateKey: confirmationCandidateKey,
      });
    } finally {
      setSaving(false);
    }
  }

  const confirmRef = useRef(confirmCandidate);
  confirmRef.current = confirmCandidate;
  useLayoutEffect(() => {
    onSavingChange?.(saving);
  }, [onSavingChange, saving]);
  useLayoutEffect(() => {
    if (!onPrimaryActionChange) return;
    onPrimaryActionChange(
      selectedCandidate && !progress?.appointmentConfirmed
        ? {
            label: saving ? t('calendar.saving') : t('calendar.confirm'),
            accessibilityLabel: t('calendar.confirm'),
            testID: 'unified-import-eventkit-confirm',
            disabled: disabled || saving || !run,
            onPress: () => confirmRef.current(),
          }
        : undefined,
    );
    return () => onPrimaryActionChange(undefined);
  }, [
    onPrimaryActionChange,
    selectedCandidate,
    progress?.appointmentConfirmed,
    run,
    saving,
    disabled,
  ]);

  return (
    <View style={styles.card}>
      {!reviewing ? (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{
            checked: selected,
            disabled: disabled || saving,
          }}
          disabled={disabled || saving}
          onPress={onToggle}
          style={styles.provider}
          testID="unified-import-toggle-eventKit"
        >
          <View style={styles.providerIcon}>
            <AppSymbol name="calendar" color={appColors.primaryText} />
          </View>
          <View style={styles.providerText}>
            <Text style={styles.sectionTitle}>캘린더</Text>
            <Text style={styles.caption}>
              {t('healthkit.unifiedImport.calendarLabel')}
            </Text>
          </View>
          <CheckboxIndicator
            checked={selected}
            disabled={disabled || saving}
            testID="unified-import-indicator-eventKit"
          />
        </Pressable>
      ) : (
        <Text style={styles.caption}>
          {t('healthkit.unifiedImport.reviewSource')}
        </Text>
      )}
      {selected && progress ? (
        <Text
          accessibilityLiveRegion="polite"
          style={styles.status}
          testID="unified-import-eventkit-status"
        >
          {statusMessage(progress)}
        </Text>
      ) : null}
      {selected && !progress?.appointmentConfirmed
        ? candidates.map((event, index) => (
            <View
              style={[
                styles.candidate,
                candidateKey(event) === selectedCandidateKey &&
                  styles.selectedCandidate,
              ]}
              key={candidateKey(event)}
              testID={`unified-import-eventkit-candidate-${index}`}
            >
              <Text style={styles.sectionTitle}>
                {event.calendarEventSnapshot.title ||
                  t('calendar.eventNoTitle')}
              </Text>
              <Text style={styles.caption}>
                {formatCalendarEventRange(event)}
              </Text>
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
        <View
          style={styles.section}
          testID="unified-import-eventkit-confirmation"
        >
          <Text>{t('calendar.confirmPrompt')}</Text>
          <Text>
            {selectedCandidate.calendarEventSnapshot.title ||
              t('calendar.eventNoTitle')}
          </Text>
          <Text>{formatCalendarEventRange(selectedCandidate)}</Text>
          {!onPrimaryActionChange ? (
            <Button
              accessibilityState={{ busy: saving }}
              disabled={saving || !run}
              onPress={() => {
                confirmCandidate();
              }}
              testID="unified-import-eventkit-confirm"
              title={saving ? t('calendar.saving') : t('calendar.confirm')}
            />
          ) : null}
          <Button
            disabled={saving}
            variant="secondary"
            onPress={() => setSelectedCandidateKey(null)}
            title={t('calendar.cancelSelection')}
          />
        </View>
      ) : null}
      {saveError ? (
        <Text
          accessibilityRole="alert"
          style={styles.error}
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
