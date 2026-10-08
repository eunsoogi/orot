import { Text, View } from 'react-native';
import { nextVisitQuestionsCopy as copy } from './copy';
import { EvidenceCaveats } from './EvidenceCaveats';
import { ActionButton } from './NextVisitComponents';
import { QuestionCard } from './QuestionCard';
import { createNextVisitStyles } from './styles';
import type {
  EvidenceCaveat,
  NextVisitEvidenceReference,
  NextVisitQuestion,
  NextVisitQuestionsTheme,
} from './types';

/** Renders the caller's current-visit snapshot; missing restore data stays separate from evidence. */
export function SavedQuestionsSection<
  TReference extends NextVisitEvidenceReference,
>({
  caveats,
  errorMessage,
  isReviewing,
  onEdit,
  onOpenSource,
  onRetry,
  questions,
  restorationNotice,
  status,
  theme,
}: {
  readonly caveats: readonly EvidenceCaveat[];
  readonly errorMessage?: string;
  readonly isReviewing: boolean;
  readonly onEdit: () => void;
  readonly onOpenSource: (reference: TReference) => void;
  readonly onRetry: () => void;
  readonly questions: readonly NextVisitQuestion<TReference>[];
  readonly restorationNotice?: string;
  readonly status: 'hidden' | 'loading' | 'error' | 'ready';
  readonly theme: NextVisitQuestionsTheme;
}) {
  const styles = createNextVisitStyles(theme);

  return (
    <>
      {restorationNotice ? (
        <Text
          accessibilityLiveRegion="polite"
          style={styles.muted}
          testID="next-visit-saved-restoration-notice"
        >
          {restorationNotice}
        </Text>
      ) : null}

      {status === 'loading' ? (
        <Text
          accessibilityLiveRegion="polite"
          style={styles.muted}
          testID="next-visit-saved-loading"
        >
          {copy.saved.loading}
        </Text>
      ) : status === 'error' ? (
        <View style={styles.section}>
          <Text
            accessibilityRole="alert"
            style={styles.error}
            testID="next-visit-saved-error"
          >
            {errorMessage ?? copy.saved.error}
          </Text>
          <ActionButton
            label={copy.saved.retry}
            onPress={onRetry}
            theme={theme}
            variant="secondary"
            testID="next-visit-saved-retry"
          />
        </View>
      ) : questions.length > 0 && !isReviewing ? (
        <View style={styles.section} testID="next-visit-saved-list">
          <Text accessibilityRole="header" style={styles.sectionHeading}>
            {copy.saved.heading}
          </Text>
          <EvidenceCaveats caveats={caveats} theme={theme} />
          {questions.map((question, index) => (
            <QuestionCard
              count={questions.length}
              editable={false}
              index={index}
              key={`saved-${index}`}
              onMove={() => undefined}
              onOpenSource={onOpenSource}
              onRemove={() => undefined}
              onUpdate={() => undefined}
              question={question}
              theme={theme}
              disabled={false}
            />
          ))}
          <ActionButton
            label={copy.saved.edit}
            onPress={onEdit}
            theme={theme}
            variant="secondary"
            testID="next-visit-saved-edit"
          />
        </View>
      ) : status === 'ready' && !isReviewing ? (
        <Text style={styles.muted} testID="next-visit-saved-empty">
          {copy.saved.empty}
        </Text>
      ) : null}
    </>
  );
}
