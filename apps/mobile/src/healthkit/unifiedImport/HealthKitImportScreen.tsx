import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import type { HealthKitFeature } from '../types';
import { AppText as Text } from '../../layout/AppText';
import { AppButton } from '../../layout/AppButton';
import { AppSymbol } from '../../layout/AppSymbol';
import { appColors } from '../../layout/appColors';
import { t } from '../../i18n';
import { useNavigationContentInset } from '../../navigation/useNavigationContentInset';
import { useNavigationPrimaryAction } from '../../navigation/useNavigationPrimaryAction';
import type { NavigationPrimaryAction } from '../../navigation/NavigationActionBar';
import { useNavigationLeaveStateRegistration } from '../../navigation';
import { EventKitImportSection } from './EventKitImportSection';
import { HealthKitProviderCard } from './HealthKitProviderCard';
import { createUnifiedImportCoordinator } from './coordinator';
import { useUnifiedImportScreen } from './useUnifiedImportScreen';
import { unifiedImportStyles as styles } from './unifiedImportStyles';
import type {
  UnifiedFeatureStatus,
  UnifiedImportMeasurement,
  UnifiedImportStatus,
} from './types';

export interface HealthKitImportScreenCopy {
  readonly title: string;
  readonly description: string;
  readonly localOnly: string;
  readonly readAuthorization: string;
  readonly importButton: string;
  readonly cancelButton: string;
  readonly featureNames: Readonly<Record<HealthKitFeature, string>>;
  readonly featureStatuses: Readonly<Record<UnifiedFeatureStatus, string>>;
  readonly phaseStatuses: Readonly<Record<UnifiedImportStatus, string>>;
  readonly changeSummary: (imported: number, deleted: number) => string;
}

export type UnifiedImportCoordinator = ReturnType<
  typeof createUnifiedImportCoordinator
>;

interface HealthKitImportScreenProps {
  readonly copy: HealthKitImportScreenCopy;
  readonly coordinator: UnifiedImportCoordinator;
  readonly onBack?: () => void;
  readonly onMeasurement?: (measurement: UnifiedImportMeasurement) => void;
  readonly onRunStarted?: () => void;
}

/** Presents actual provider outcomes under the same safe-area and action ownership as the rest of the app. */
export function HealthKitImportScreen({
  copy,
  coordinator,
  onBack,
  onMeasurement,
  onRunStarted,
}: HealthKitImportScreenProps) {
  const state = useUnifiedImportScreen(
    coordinator,
    onMeasurement,
    onRunStarted,
  );
  const inset = useNavigationContentInset();
  const [candidateAction, setCandidateAction] =
    useState<NavigationPrimaryAction>();
  const [candidateSaving, setCandidateSaving] = useState(false);
  const { selected, eventKitSelected, progress, run, isRunning } = state;
  const phase = progress?.phase ?? 'queued';
  const hasSelection = selected.size > 0 || eventKitSelected;
  const reviewingCalendar =
    eventKitSelected &&
    Boolean(progress?.eventKit.candidates.length) &&
    !progress?.eventKit.appointmentConfirmed;
  const importAction: NavigationPrimaryAction = isRunning
    ? {
        label: copy.cancelButton,
        accessibilityLabel: copy.cancelButton,
        testID: 'unified-import-cancel',
        disabled: phase === 'cancelling',
        onPress: () => run?.cancel(),
      }
    : {
        label: copy.importButton,
        accessibilityLabel: copy.importButton,
        testID: 'unified-import-start',
        disabled: !hasSelection,
        onPress: state.startImport,
      };
  const hasSharedAction = useNavigationPrimaryAction(
    candidateAction ?? importAction,
  );
  useNavigationLeaveStateRegistration({
    canLeave: !candidateSaving,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: isRunning,
    revision: state.revision,
    inputRevision: state.revision,
  });

  return (
    <ScrollView
      contentContainerStyle={[styles.container, inset]}
      style={styles.scroll}
      testID="unified-import-scroll"
    >
      {onBack && !hasSharedAction ? (
        <AppButton
          onPress={onBack}
          testID="healthkit-unified-import-back"
          title={t('healthkit.unifiedImport.back')}
          variant="secondary"
        />
      ) : null}
      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.title}>
          {reviewingCalendar
            ? t('healthkit.unifiedImport.reviewTitle')
            : copy.title}
        </Text>
        <Text style={styles.description}>
          {reviewingCalendar ? t('calendar.confirmPrompt') : copy.description}
        </Text>
      </View>
      {!reviewingCalendar || selected.size > 0 ? (
        <HealthKitProviderCard
          copy={copy}
          selected={selected}
          progress={progress}
          disabled={isRunning || candidateSaving}
          onToggle={state.toggleHealthKit}
          onToggleFeature={state.toggleFeature}
        />
      ) : null}
      <EventKitImportSection
        reviewing={reviewingCalendar}
        disabled={isRunning}
        onToggle={state.toggleEventKit}
        progress={progress?.eventKit ?? null}
        run={run}
        selected={eventKitSelected}
        onPrimaryActionChange={hasSharedAction ? setCandidateAction : undefined}
        onSavingChange={setCandidateSaving}
      />
      <View style={styles.notice}>
        <AppSymbol name="lock.shield" size={18} color={appColors.secondary} />
        <Text style={styles.noticeText}>{copy.localOnly}</Text>
      </View>
      <Text style={styles.caption} testID="unified-import-read-authorization">
        {copy.readAuthorization}
      </Text>
      {!hasSharedAction ? (
        <>
          <AppButton
            accessibilityState={{ busy: isRunning }}
            disabled={!hasSelection || isRunning}
            onPress={state.startImport}
            title={copy.importButton}
            testID="unified-import-start"
          />
          {run && isRunning ? (
            <AppButton
              onPress={() => run.cancel()}
              title={copy.cancelButton}
              testID="unified-import-cancel"
              variant="secondary"
            />
          ) : null}
        </>
      ) : null}
      <Text
        accessibilityLiveRegion="polite"
        style={styles.status}
        testID="unified-import-status"
      >
        {copy.phaseStatuses[phase]}
      </Text>
    </ScrollView>
  );
}
