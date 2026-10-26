import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { AppointmentRepository } from '@orot/storage';
import { t } from '../i18n';
import { AppButton } from '../layout/AppButton';
import SafeAreaLayout from '../layout/SafeAreaLayout';
import { BottomNavigationMenu } from '../navigation/BottomNavigationMenu';
import { navigationText } from '../i18n/navigation';
import { appRouteStyles } from '../routes/WelcomeRoute';
import CalendarLinkingScreen from './CalendarLinkingScreen';
import type { CalendarBridge } from './types';

interface CalendarAppRouteProps {
  readonly appointmentRepository: AppointmentRepository | null;
  readonly bridge: CalendarBridge;
  readonly appointmentError: string;
  readonly loadingAppointments: boolean;
  readonly onBack: () => void;
  readonly onOpenCalendar: () => void | Promise<void>;
  readonly onOpenRecording: () => void;
}

/** Keeps Calendar loading and linked-event states within one safe-area route. */
export function CalendarAppRoute({
  appointmentRepository,
  bridge,
  appointmentError,
  loadingAppointments,
  onBack,
  onOpenCalendar,
  onOpenRecording,
}: CalendarAppRouteProps) {
  if (appointmentRepository) {
    return (
      <SafeAreaLayout>
        <CalendarLinkingScreen
          repository={appointmentRepository}
          bridge={bridge}
          onBack={onBack}
          onHome={onBack}
          onOpenRecording={onOpenRecording}
        />
      </SafeAreaLayout>
    );
  }

  return (
    <SafeAreaLayout>
      <View style={styles.fill}>
        <ScrollView contentContainerStyle={appRouteStyles.container}>
          <Text accessibilityRole="header" style={appRouteStyles.title}>
            {t('calendar.title')}
          </Text>
          <Text
            accessibilityRole={appointmentError ? 'alert' : undefined}
            testID="calendar-app-opening"
          >
            {appointmentError ||
              (loadingAppointments ? t('appointments.opening') : '')}
          </Text>
          {appointmentError ? (
            <AppButton
              onPress={onOpenCalendar}
              testID="calendar-app-retry"
              title={t('appointments.retry')}
            />
          ) : null}
        </ScrollView>
        <BottomNavigationMenu
          onBack={onBack}
          onHome={onBack}
          primaryAction={{
            label: navigationText.recording.label,
            accessibilityLabel: navigationText.recording.accessibilityLabel,
            testID: 'navigation-recording',
            onPress: onOpenRecording,
          }}
          testID="calendar-app-back"
        />
      </View>
    </SafeAreaLayout>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
