import { StyleSheet, View } from 'react-native';
import type { SavedVisitQuestionsLoadState } from '../aiFeatures/integration/savedVisitQuestions';
import { AppText as Text } from '../layout/AppText';
import { AppButton } from '../layout/AppButton';
import { hubSpacing } from '../layout/hubSpacing';
import { t } from '../i18n';
import type { LibraryLoadState } from './useAppOverviewData';

/** Saved preparation is local, reviewed content; missing questions describe a real visit's next action. */
export function OverviewPreparationQuestions({
  questions,
  state,
  onRetry,
}: {
  readonly questions: SavedVisitQuestionsLoadState | null;
  readonly state: LibraryLoadState;
  readonly onRetry: () => void;
}) {
  return (
    <View style={styles.section} testID="overview-preparation-questions">
      {state === 'loading' ? (
        <Text>{t('overview.preparationLoading')}</Text>
      ) : state === 'failed' ? (
        <>
          <Text accessibilityRole="alert">
            {t('overview.preparationError')}
          </Text>
          <AppButton
            title={t('appointments.retry')}
            onPress={onRetry}
            testID="overview-questions-retry"
          />
        </>
      ) : (
        <Text testID="overview-preparation-pending">
          {t('overview.savedQuestionCount', {
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
