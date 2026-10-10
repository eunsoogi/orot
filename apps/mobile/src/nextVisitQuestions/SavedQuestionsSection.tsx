import { Text, View } from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
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
  hasSharedAction = false,
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
  readonly hasSharedAction?: boolean;
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
          <View style={styles.savedHeading}>
            <Text accessibilityRole="header" style={styles.sectionHeading}>
              {copy.saved.heading}
            </Text>
            <Text style={styles.muted}>{questions.length}개</Text>
            <View style={styles.savedStatus}>
              <AppSymbol
                name="checkmark.circle.fill"
                size={18}
                color={theme.colors.success}
              />
              <Text style={styles.savedStatusText}>{copy.saved.status}</Text>
            </View>
          </View>
          {/* Standalone consumers retain an edit action when no route shell owns it. */}
          {!hasSharedAction ? (
            <ActionButton
              label={copy.saved.edit}
              onPress={onEdit}
              theme={theme}
              variant="secondary"
              testID="next-visit-saved-edit"
            />
          ) : null}
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
          <EvidenceCaveats caveats={caveats} theme={theme} />
        </View>
      ) : status === 'ready' && !isReviewing ? (
        <Text style={styles.muted} testID="next-visit-saved-empty">
          {copy.saved.empty}
        </Text>
      ) : null}
    </>
  );
}
