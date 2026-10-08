import { Button, StyleSheet, Text, View } from 'react-native';
import BackupStatusRecovery from '../backup/BackupStatusRecovery';
import { t } from '../i18n';
import { providerSelectionText } from '../providers/selection/text';

interface WelcomeRouteProps {
  hasStarted: boolean;
  selectedRecommendationProvider: string;
  onOpenProviderSelection: () => void;
  onGetStarted: () => void;
  onOpenAppointments: () => void;
  onOpenCommonObservations: () => void;
  onOpenBloodPressure: () => void;
  onOpenUnifiedImport: () => void;
  onOpenRecording: () => void;
}

// Keep startup backup recovery and explicit import actions on the welcome route.
export const appRouteStyles = StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
    backgroundColor: '#f7f8fa',
  },
  title: {
    color: '#17212b',
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
  message: {
    color: '#45515f',
    fontSize: 16,
    textAlign: 'center',
  },
});

export default function WelcomeRoute({
  hasStarted,
  selectedRecommendationProvider,
  onOpenProviderSelection,
  onGetStarted,
  onOpenAppointments,
  onOpenCommonObservations,
  onOpenBloodPressure,
  onOpenUnifiedImport,
  onOpenRecording,
}: WelcomeRouteProps) {
  return (
    <View style={appRouteStyles.container}>
      <Text
        accessibilityRole="header"
        style={appRouteStyles.title}
        testID="welcome-title"
      >
        {t('app.welcome.title')}
      </Text>
      <Text style={appRouteStyles.message}>
        {hasStarted ? t('app.welcome.started') : t('app.welcome.message')}
      </Text>
      {/* This route prepares local data; the app cannot verify an OS backup result. */}
      <BackupStatusRecovery />
      {selectedRecommendationProvider ? (
        <Text testID="selected-recommendation-provider">
          {providerSelectionText.selectedPrefix}{' '}
          {selectedRecommendationProvider}
        </Text>
      ) : null}
      <Button
        onPress={onOpenProviderSelection}
        testID="open-provider-selection"
        title={providerSelectionText.title}
      />
      <Button
        onPress={onGetStarted}
        testID="get-started"
        title={t('app.actions.getStarted')}
      />
      <Button
        onPress={onOpenAppointments}
        testID="open-appointments"
        title={t('app.actions.appointments')}
      />
      <Button
        onPress={onOpenCommonObservations}
        testID="open-common-observations"
        title={t('healthkit.commonObservations.open')}
      />
      <Button
        onPress={onOpenBloodPressure}
        testID="open-blood-pressure-import"
        title={t('healthkit.bloodPressure.open')}
      />
      <Button
        onPress={onOpenUnifiedImport}
        testID="open-unified-health-import"
        title={t('healthkit.unifiedImport.open')}
      />
      <Button
        onPress={onOpenRecording}
        testID="open-recording"
        title={t('app.actions.recording')}
      />
    </View>
  );
}
