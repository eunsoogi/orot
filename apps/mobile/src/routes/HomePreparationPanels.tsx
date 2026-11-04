import { StyleSheet, View } from 'react-native';
import type { SavedVisitQuestionsLoadState } from '../aiFeatures/integration/savedVisitQuestions';
import { AppText as Text } from '../layout/AppText';
import { AppButton } from '../layout/AppButton';
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
      ) : (
        <Text testID="home-preparation-pending">
          {t('home.savedQuestionCount', {
            count: questions?.questions.length ?? 0,
          })}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: hubSpacing.item, minWidth: 0 },
});
