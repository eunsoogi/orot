import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppButton as Button } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import type { AppointmentRepository } from '@orot/storage';
import { resolveSelectedAiProvider } from '../aiFeatures/integration/provider';
import type {
  SelectedAiResolution,
  SelectedAiResolverOptions,
} from '../aiFeatures/integration/provider';
import type { CalendarBridge } from '../calendar/types';
import { t } from '../i18n';
import { useNavigationLeaveStateRegistration } from '../navigation';
import type { NavigationLeaveState } from '../navigation';
import ManualAppointmentScreen from './ManualAppointmentScreen';
import MedicalAppointmentClassificationScreen from './MedicalAppointmentClassificationScreen';
import { medicalAppointmentCopy as copy } from './copy.ko';

interface MedicalAppointmentRouteProps {
  readonly bridge: CalendarBridge;
  readonly loadAppointments: () => Promise<AppointmentRepository>;
  readonly selectedAiResolverOptions?: SelectedAiResolverOptions;
}

const styles = StyleSheet.create({
  status: {
    flex: 1,
    // Loading and recoverable errors follow the same top-aligned route shell as the working screen.
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    backgroundColor: appColors.background,
    gap: 16,
    padding: 24,
  },
  title: { fontSize: 30, fontWeight: '700' },
});

/** Boots local appointments and selected AI independently so provider failure cannot hide manual entry. */
export default function MedicalAppointmentRoute({
  bridge,
  loadAppointments,
  selectedAiResolverOptions,
}: MedicalAppointmentRouteProps) {
  const [repository, setRepository] = useState<AppointmentRepository | null>(
    null,
  );
  const [repositoryLoadError, setRepositoryLoadError] = useState(false);
  const [repositoryLoadAttempt, setRepositoryLoadAttempt] = useState(0);
  const [selectedAi, setSelectedAi] = useState<SelectedAiResolution | null>(
    null,
  );
  const [manualOpen, setManualOpen] = useState(false);

  // The manual page owns its return control; shared navigation becomes available after that path closes.
  useNavigationLeaveStateRegistration({
    canLeave: !manualOpen,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision: manualOpen ? 1 : 0,
    inputRevision: 0,
  } satisfies NavigationLeaveState);

  useEffect(() => {
    let active = true;
    setRepository(null);
    setRepositoryLoadError(false);
    Promise.resolve()
      .then(loadAppointments)
      .then(value => {
        if (active) setRepository(value);
      })
      .catch(() => {
        if (active) setRepositoryLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [loadAppointments, repositoryLoadAttempt]);

  useEffect(() => {
    let active = true;
    setSelectedAi(null);
    // Provider and account lookups are independent from the local manual repository.
    Promise.resolve()
      .then(() => resolveSelectedAiProvider(selectedAiResolverOptions))
      .then(value => {
        if (active) setSelectedAi(value);
      })
      .catch(() => {
        if (active) setSelectedAi({ status: 'unavailable' });
      });
    return () => {
      active = false;
    };
  }, [selectedAiResolverOptions]);

  if (repositoryLoadError) {
    return (
      <View style={styles.status}>
        <Text accessibilityRole="header" style={styles.title}>
          {copy.title}
        </Text>
        <Text accessibilityRole="alert">{t('appointments.openError')}</Text>
        <Button
          onPress={() => setRepositoryLoadAttempt(attempt => attempt + 1)}
          testID="medical-appointments-retry"
          title={t('appointments.retry')}
        />
      </View>
    );
  }

  if (!repository) {
    return (
      <View style={styles.status}>
        <Text accessibilityRole="header" style={styles.title}>
          {copy.title}
        </Text>
        <Text>{t('appointments.opening')}</Text>
      </View>
    );
  }

  if (manualOpen) {
    return (
      <ManualAppointmentScreen
        repository={repository}
        onBack={() => setManualOpen(false)}
      />
    );
  }

  if (!selectedAi) {
    return (
      <View style={styles.status}>
        <Text accessibilityRole="header" style={styles.title}>
          {copy.title}
        </Text>
        <Text>{copy.providerResolving}</Text>
        <Button
          onPress={() => setManualOpen(true)}
          testID="medical-appointment-manual"
          title={copy.manual}
        />
      </View>
    );
  }

  const resolvedAi = selectedAi.status === 'ready' ? selectedAi : null;
  return (
    <MedicalAppointmentClassificationScreen
      bridge={bridge}
      repository={repository}
      selectedProvider={resolvedAi?.option ?? null}
      recipient={resolvedAi?.recipient ?? null}
      selectedProviderUnavailable={selectedAi.status === 'unavailable'}
      onOpenManual={() => setManualOpen(true)}
    />
  );
}
