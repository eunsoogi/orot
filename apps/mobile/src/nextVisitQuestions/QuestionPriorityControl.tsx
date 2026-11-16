import { Pressable, Text } from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { CheckboxIndicator } from '../layout/CheckboxIndicator';
import { t } from '../i18n';
import { nextVisitQuestionsCopy as copy } from './copy';
import { createQuestionCardStyles } from './questionCardStyles';
import type { NextVisitQuestion, NextVisitQuestionsTheme } from './types';

/** Inline review reserves checkboxes for saving; importance stays a separate, named edit action. */
export function QuestionPriorityControl({
  question,
  index,
  disabled,
  theme,
  onUpdate,
  compact = false,
}: {
  readonly question: Pick<NextVisitQuestion, 'priority'>;
  readonly index: number;
  readonly disabled: boolean;
  readonly theme: NextVisitQuestionsTheme;
  readonly onUpdate: (update: { priority: 'important' | 'routine' }) => void;
  readonly compact?: boolean;
}) {
  const important = question.priority === 'important';
  const styles = createQuestionCardStyles(theme);
  return (
    <Pressable
      accessibilityRole={compact ? 'button' : 'checkbox'}
      accessibilityLabel={
        important ? copy.review.markRoutine : copy.review.markImportant
      }
      accessibilityState={
        compact
          ? { selected: important, disabled }
          : { checked: important, disabled }
      }
      disabled={disabled}
      onPress={() =>
        onUpdate({ priority: important ? 'routine' : 'important' })
      }
      style={[
        compact ? styles.actionButton : styles.priority,
        disabled && styles.disabled,
      ]}
      testID={`next-visit-question-priority-${index}`}
    >
      {compact ? (
        <>
          <AppSymbol
            name={important ? 'star.fill' : 'star'}
            color={theme.colors.accentText}
          />
          <Text style={styles.actionText}>
            {t(
              important
                ? 'visitQuestions.review.question.priority.important'
                : 'visitQuestions.review.question.priority.routine',
            )}
          </Text>
        </>
      ) : (
        <CheckboxIndicator
          checked={important}
          color={theme.colors.accentText}
          disabled={disabled}
          testID={`next-visit-question-priority-indicator-${index}`}
        />
      )}
    </Pressable>
  );
}
