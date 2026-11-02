import { StyleSheet, View } from 'react-native';
import type { SymptomEntry } from '@orot/storage';
import type { SavedVisitQuestionsLoadState } from '../aiFeatures/integration/savedVisitQuestions';
import { AppText as Text } from '../layout/AppText';
import { AppButton } from '../layout/AppButton';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { hubSpacing } from '../layout/hubSpacing';
import { formatDateTime, t } from '../i18n';
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

/** The summary links to the journal without exposing edit controls or changing the journal's retained filter. */
export function HomeOngoingSymptoms({
  symptoms,
  updates,
  state,
  onRetry,
  onOpen,
}: {
  readonly symptoms: readonly SymptomEntry[];
  readonly updates: Readonly<Record<string, string | null>>;
  readonly state: LibraryLoadState;
  readonly onRetry: () => void;
  readonly onOpen: () => void;
}) {
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
          {symptoms.length === 0 && <Text>{t('home.noSymptoms')}</Text>}
          {symptoms.map(symptom => (
            <View key={symptom.id} style={styles.symptomCard}>
              <AppSymbol name="heart.text.square" color={appColors.purple} />
              <Text
                style={styles.symptomCopy}
                testID={'home-symptom-' + symptom.id}
              >
                {symptom.description} ·{' '}
                {t('home.symptomStart', {
                  time: formatDateTime(new Date(symptom.effectiveAt)),
                })}{' '}
                ·{' '}
                {updates[symptom.id]
                  ? t('home.symptomUpdated', {
                      time: formatDateTime(new Date(updates[symptom.id]!)),
                    })
                  : t('home.updatedUnknown')}
                {symptom.severity === undefined
                  ? ''
                  : ` · ${t('home.symptomSeverity', { severity: symptom.severity })}`}
              </Text>
            </View>
          ))}
          <AppButton
            title={t('home.openSymptoms')}
            variant="text"
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
  symptomCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: appColors.surface,
    borderRadius: 16,
    padding: 14,
  },
  symptomCopy: { flex: 1, color: appColors.text },
});
