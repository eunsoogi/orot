import { Button, StyleSheet, Text, View } from 'react-native';
import { t } from '../i18n';
import { providerSelectionText } from '../providers/selection/text';

interface WelcomeHomeScreenProps {
  readonly hasStarted: boolean;
  readonly selectedRecommendationProvider: string;
  readonly onOpenProviderSelection: () => void;
  readonly onGetStarted: () => void;
  readonly onOpenAppointments: () => void;
  readonly onOpenCommonObservations: () => void;
  readonly onOpenBloodPressure: () => void;
  readonly onOpenUnifiedImport: () => void;
  readonly onOpenRecording: () => void;
}

/** Keeps entry points together while the unified screen owns its provider workflow. */
export function WelcomeHomeScreen({
  hasStarted,
  selectedRecommendationProvider,
  onOpenProviderSelection,
  onGetStarted,
  onOpenAppointments,
  onOpenCommonObservations,
  onOpenBloodPressure,
  onOpenUnifiedImport,
  onOpenRecording,
}: WelcomeHomeScreenProps) {
  return (
    <View style={styles.container}>
      <Text
        accessibilityRole="header"
        style={styles.title}
        testID="welcome-title"
      >
        {t('app.welcome.title')}
      </Text>
      <Text style={styles.message}>
        {hasStarted ? t('app.welcome.started') : t('app.welcome.message')}
      </Text>
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

const styles = StyleSheet.create({
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
