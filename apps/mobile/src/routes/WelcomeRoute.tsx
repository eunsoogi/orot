import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FeatureEntryScreen } from '../aiFeatures/FeatureEntryScreen';
import BackupStatusRecovery from '../backup/BackupStatusRecovery';
import { t } from '../i18n';
import { providerSelectionText } from '../providers/selection/text';
import { appColors } from '../layout/appColors';
import { useNavigationLeaveStateRegistration } from '../navigation';

interface WelcomeRouteProps {
  selectedRecommendationProvider: string;
  onOpenProviderSelection: () => void;
  onOpenVisitQuestions: () => void;
  onOpenDiseaseHypotheses: () => void;
  onOpenRagConversation: () => void;
  onOpenExternalEvidence: () => void;
  onOpenAppointments: () => void;
  onOpenCommonObservations: () => void;
  onOpenBloodPressure: () => void;
  onOpenRecording: () => void;
}

// Content grows downward so the first action stays visible on a compact phone.
export const appRouteStyles = StyleSheet.create({
  container: {
    flexGrow: 1,
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 32,
    backgroundColor: appColors.background,
  },
  title: {
    color: appColors.text,
    fontSize: 30,
    fontWeight: '700',
  },
  message: {
    color: appColors.secondary,
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 12,
  },
});

export default function WelcomeRoute({
  selectedRecommendationProvider,
  onOpenProviderSelection,
  onOpenVisitQuestions,
  onOpenDiseaseHypotheses,
  onOpenRagConversation,
  onOpenExternalEvidence,
  onOpenAppointments,
  onOpenCommonObservations,
  onOpenBloodPressure,
  onOpenRecording,
}: WelcomeRouteProps) {
  // Home has no draft to protect, so its shared core action remains available.
  useNavigationLeaveStateRegistration({
    canLeave: true,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision: 0,
    inputRevision: 0,
  });

  return (
    <View style={appRouteStyles.container}>
      <Text
        accessibilityRole="header"
        style={appRouteStyles.title}
        testID="welcome-title"
      >
        {t('app.welcome.title')}
      </Text>
      <Text style={appRouteStyles.message}>{t('app.welcome.message')}</Text>
      <FeatureEntryScreen
        embedded
        onOpenVisitQuestions={onOpenVisitQuestions}
        onOpenDiseaseHypotheses={onOpenDiseaseHypotheses}
        onOpenRagConversation={onOpenRagConversation}
        onOpenExternalEvidence={onOpenExternalEvidence}
      />
      {selectedRecommendationProvider ? (
        <Text testID="selected-recommendation-provider">
          {providerSelectionText.selectedPrefix}{' '}
          {selectedRecommendationProvider}
        </Text>
      ) : null}
      <HomeAction
        onPress={onOpenProviderSelection}
        testID="open-provider-selection"
        title={providerSelectionText.title}
      />
      <HomeAction
        onPress={onOpenAppointments}
        testID="open-appointments"
        title={t('app.actions.appointments')}
      />
      <HomeAction
        onPress={onOpenCommonObservations}
        testID="open-common-observations"
        title={t('healthkit.commonObservations.open')}
      />
      <HomeAction
        onPress={onOpenBloodPressure}
        testID="open-blood-pressure-import"
        title={t('healthkit.bloodPressure.open')}
      />
      <HomeAction
        onPress={onOpenRecording}
        testID="open-recording"
        title={t('app.actions.recording')}
      />
      {/* Backup preparation is a secondary setting, separate from everyday record actions. */}
      <View style={homeStyles.backup}>
        <BackupStatusRecovery />
      </View>
    </View>
  );
}

function HomeAction({
  onPress,
  testID,
  title,
}: {
  onPress: () => void;
  testID: string;
  title: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={homeStyles.action}
      testID={testID}
    >
      <Text style={homeStyles.label}>{title}</Text>
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={homeStyles.chevron}
      >
        ›
      </Text>
    </Pressable>
  );
}

const homeStyles = StyleSheet.create({
  action: {
    backgroundColor: appColors.surface,
    borderRadius: 20,
    padding: 20,
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  label: { color: appColors.text, fontSize: 17, fontWeight: '600', flex: 1 },
  chevron: { color: appColors.secondary, fontSize: 24 },
  backup: {
    backgroundColor: appColors.surface,
    borderRadius: 20,
    padding: 20,
    marginTop: 12,
  },
});
