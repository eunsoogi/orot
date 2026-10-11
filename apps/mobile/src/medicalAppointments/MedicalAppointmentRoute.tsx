import { NavigationRouteScrollView } from '../navigation/NavigationRouteScrollView';
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
import AppointmentsScreen from '../appointments/AppointmentsScreen';
import MedicalAppointmentClassificationScreen from './MedicalAppointmentClassificationScreen';
import { medicalAppointmentCopy as copy } from './copy.ko';

interface MedicalAppointmentRouteProps {
  readonly bridge: CalendarBridge;
  readonly manual: boolean;
  readonly onOpenManual: () => void;
  readonly loadAppointments: () => Promise<AppointmentRepository>;
  readonly selectedAiResolverOptions?: SelectedAiResolverOptions;
}

const styles = StyleSheet.create({
  status: {
    flexGrow: 1,
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
  manual,
  onOpenManual,
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
    if (manual) {
      // Manual entry is local-only and must not trigger provider/account reads.
      setSelectedAi(null);
      return;
    }

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
  }, [manual, selectedAiResolverOptions]);

  if (repositoryLoadError) {
    return (
      <NavigationRouteScrollView>
        <View style={styles.status}>
          <ClassificationLeaveState />
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
      </NavigationRouteScrollView>
    );
  }

  if (!repository) {
    return (
      <NavigationRouteScrollView>
        <View style={styles.status}>
          <ClassificationLeaveState />
          <Text accessibilityRole="header" style={styles.title}>
            {copy.title}
          </Text>
          <Text>{t('appointments.opening')}</Text>
        </View>
      </NavigationRouteScrollView>
    );
  }

  if (manual) {
    return <AppointmentsScreen repository={repository} />;
  }

  if (!selectedAi) {
    return (
      <NavigationRouteScrollView>
        <View style={styles.status}>
          <ClassificationLeaveState />
          <Text accessibilityRole="header" style={styles.title}>
            {copy.title}
          </Text>
          <Text>{copy.providerResolving}</Text>
          <Button
            onPress={onOpenManual}
            testID="medical-appointment-manual"
            title={copy.manual}
          />
        </View>
      </NavigationRouteScrollView>
    );
  }

  const resolvedAi = selectedAi.status === 'ready' ? selectedAi : null;
  return (
    <>
      <ClassificationLeaveState />
      <MedicalAppointmentClassificationScreen
        bridge={bridge}
        repository={repository}
        selectedProvider={resolvedAi?.option ?? null}
        recipient={resolvedAi?.recipient ?? null}
        selectedProviderUnavailable={selectedAi.status === 'unavailable'}
        onOpenManual={onOpenManual}
      />
    </>
  );
}

/** Only the active classification route registers a clean exit; the manual editor owns its own guard. */
function ClassificationLeaveState() {
  useNavigationLeaveStateRegistration({
    canLeave: true,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision: 0,
    inputRevision: 0,
  } satisfies NavigationLeaveState);
  return null;
}
