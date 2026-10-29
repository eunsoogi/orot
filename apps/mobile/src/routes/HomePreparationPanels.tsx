import { StyleSheet, View } from 'react-native';
import type { SymptomEntry } from '@orot/storage';
import type { SavedVisitQuestionsLoadState } from '../aiFeatures/integration/savedVisitQuestions';
import { AppText as Text } from '../layout/AppText';
import { AppButton } from '../layout/AppButton';
import { appColors } from '../layout/appColors';
import { hubSpacing } from '../layout/hubSpacing';
import { t } from '../i18n';
import type { LibraryLoadState } from './useAppHomeData';

/** Saved preparation is local, reviewed content; missing questions describe a real visit's next action. */
export function HomePreparationQuestions({
  questions,
  state,
  onRetry,
}: {
  readonly questions: SavedVisitQuestionsLoadState | null;
  readonly state: LibraryLoadState;
  readonly onRetry: () => void;
}) {
  return (
    <View style={styles.section} testID="home-preparation-questions">
      <Text accessibilityRole="header" style={styles.heading}>
        {t('home.preparationQuestions')}
      </Text>
      {state === 'loading' ? (
        <Text>{t('home.preparationLoading')}</Text>
      ) : state === 'failed' ? (
        <>
          <Text accessibilityRole="alert">{t('home.preparationError')}</Text>
          <AppButton
            title={t('appointments.retry')}
            onPress={onRetry}
            testID="home-questions-retry"
          />
        </>
      ) : questions?.questions.length ? (
        questions.questions
          .slice(0, 3)
          .map((question, index) => (
            <Text key={index}>{question.questionText}</Text>
          ))
      ) : (
        <Text testID="home-preparation-pending">
          {t('home.preparationPending')}
        </Text>
      )}
    </View>
  );
}

/** The summary links to the journal without exposing edit controls or changing the journal's retained filter. */
export function HomeOngoingSymptoms({
  symptoms,
  state,
  onRetry,
  onOpen,
}: {
  readonly symptoms: readonly SymptomEntry[];
  readonly state: LibraryLoadState;
  readonly onRetry: () => void;
  readonly onOpen: () => void;
}) {
  if (state === 'ready' && symptoms.length === 0) return null;
  return (
    <View style={styles.section} testID="home-ongoing-symptoms">
      <Text accessibilityRole="header" style={styles.heading}>
        {t('home.ongoingSymptoms')}
      </Text>
      {state === 'loading' ? (
        <Text>{t('home.symptomsLoading')}</Text>
      ) : state === 'failed' ? (
        <>
          <Text accessibilityRole="alert">{t('home.symptomsError')}</Text>
          <AppButton
            title={t('appointments.retry')}
            onPress={onRetry}
            testID="home-symptoms-retry"
          />
        </>
      ) : (
        <>
          {symptoms.slice(0, 3).map(symptom => (
            <Text key={symptom.id} testID={'home-symptom-' + symptom.id}>
              {symptom.description}
            </Text>
          ))}
          <AppButton
            title={t('home.openSymptoms')}
            onPress={onOpen}
            testID="home-open-symptoms"
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: hubSpacing.item, minWidth: 0 },
  heading: { color: appColors.text, fontSize: 17, fontWeight: '700' },
});
