import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { nextVisitQuestionsCopy as copy } from './copy';
import type {
  NextVisitEvidenceReference,
  NextVisitQuestion,
  NextVisitQuestionsTheme,
} from './types';
import { createQuestionCardStyles } from './questionCardStyles';

interface QuestionCardProps<TReference extends NextVisitEvidenceReference> {
  readonly question: NextVisitQuestion<TReference>;
  readonly index: number;
  readonly count: number;
  readonly editable: boolean;
  readonly disabled: boolean;
  readonly theme: NextVisitQuestionsTheme;
  readonly onUpdate: (
    update: Partial<
      Pick<
        NextVisitQuestion<TReference>,
        'questionText' | 'rationale' | 'priority'
      >
    >,
  ) => void;
  readonly onMove: (offset: -1 | 1) => void;
  readonly onRemove: () => void;
  readonly onOpenSource: (reference: TReference) => void;
}

/** Keeps evidence read-only while the person edits the question and its wording. */
export function QuestionCard<TReference extends NextVisitEvidenceReference>({
  question,
  index,
  count,
  editable,
  disabled,
  theme,
  onUpdate,
  onMove,
  onRemove,
  onOpenSource,
}: QuestionCardProps<TReference>) {
  const styles = createQuestionCardStyles(theme);
  const number = index + 1;
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <View style={styles.card} testID={`next-visit-question-${index}`}>
      <View style={styles.headingRow}>
        <View style={styles.numberBadge}>
          <Text style={styles.heading}>{number}</Text>
        </View>
        {editable ? (
          <TextInput
            accessibilityLabel={copy.review.questionLabel(number)}
            editable={!disabled}
            multiline
            onChangeText={questionText => onUpdate({ questionText })}
            style={styles.questionInput}
            testID={`next-visit-question-text-${index}`}
            value={question.questionText}
          />
        ) : (
          <Text style={styles.questionText}>{question.questionText}</Text>
        )}
        {editable ? (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel={
              question.priority === 'important'
                ? copy.review.markRoutine
                : copy.review.markImportant
            }
            accessibilityState={{
              checked: question.priority === 'important',
              disabled,
            }}
            disabled={disabled}
            testID={`next-visit-question-priority-${index}`}
            onPress={() =>
              onUpdate({
                priority:
                  question.priority === 'important' ? 'routine' : 'important',
              })
            }
            style={styles.priority}
          >
            <AppSymbol
              name={
                question.priority === 'important'
                  ? 'checkmark.square.fill'
                  : 'square'
              }
              color={theme.colors.accentText}
            />
          </Pressable>
        ) : null}
      </View>
      {editable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: detailsOpen }}
          onPress={() => setDetailsOpen(open => !open)}
          style={styles.detailToggle}
          testID={`next-visit-question-details-${index}`}
        >
          <AppSymbol
            name="slider.horizontal.3"
            size={16}
            color={theme.colors.textMuted}
          />
          <Text style={styles.sourceText}>세부 수정</Text>
        </Pressable>
      ) : null}
      {editable && detailsOpen ? (
        <View style={styles.actions}>
          <ActionButton
            accessibilityLabel={copy.review.moveUp(number)}
            disabled={disabled || index === 0}
            onPress={() => onMove(-1)}
            theme={theme}
            testID={`next-visit-question-up-${index}`}
            title="위로"
          />
          <ActionButton
            accessibilityLabel={copy.review.moveDown(number)}
            disabled={disabled || index === count - 1}
            onPress={() => onMove(1)}
            theme={theme}
            testID={`next-visit-question-down-${index}`}
            title="아래로"
          />
          <ActionButton
            accessibilityLabel={copy.review.remove(number)}
            disabled={disabled}
            onPress={onRemove}
            theme={theme}
            testID={`next-visit-question-remove-${index}`}
            title="삭제"
          />
        </View>
      ) : null}
      {editable && detailsOpen ? (
        <View style={styles.inputGroup}>
          {/* Keep the editable rationale field understandable without relying on VoiceOver alone. */}
          <Text style={styles.inputLabel}>
            {copy.review.rationaleLabel(number)}
          </Text>
          <TextInput
            accessibilityLabel={copy.review.rationaleLabel(number)}
            editable={!disabled}
            multiline
            onChangeText={rationale => onUpdate({ rationale })}
            style={styles.rationaleInput}
            testID={`next-visit-question-rationale-${index}`}
            value={question.rationale}
          />
        </View>
      ) : null}
      {question.citations.map((reference, citationIndex) => (
        <Pressable
          accessibilityRole="button"
          disabled={disabled}
          key={`${reference.sourceKind}:${reference.sourceId}:${reference.effectiveTime ?? citationIndex}`}
          onPress={() => onOpenSource(reference)}
          style={[styles.sourceButton, disabled && styles.disabled]}
          testID={`next-visit-source-${index}-${citationIndex}`}
        >
          <AppSymbol name="doc.text" color={theme.colors.textMuted} />
          <Text style={styles.openSource}>{copy.evidence.open}</Text>
          <AppSymbol
            name="chevron.right"
            size={14}
            color={theme.colors.textMuted}
          />
        </Pressable>
      ))}
    </View>
  );
}

function ActionButton({
  accessibilityLabel,
  disabled,
  onPress,
  theme,
  testID,
  title,
}: {
  accessibilityLabel: string;
  disabled: boolean;
  onPress: () => void;
  theme: NextVisitQuestionsTheme;
  testID: string;
  title: string;
}) {
  const styles = createQuestionCardStyles(theme);
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.actionButton, disabled && styles.disabled]}
      testID={testID}
    >
      <Text style={styles.actionText}>{title}</Text>
    </Pressable>
  );
}
