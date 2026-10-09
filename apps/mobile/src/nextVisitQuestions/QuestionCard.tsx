import { Pressable, Text, TextInput, View } from 'react-native';
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
  const priorityLabel =
    question.priority === 'important'
      ? copy.review.important
      : copy.review.routine;

  return (
    <View style={styles.card} testID={`next-visit-question-${index}`}>
      <View style={styles.headingRow}>
        <Text accessibilityRole="header" style={styles.heading}>
          {copy.review.questionLabel(number)}
        </Text>
        {editable ? (
          <View style={styles.actions}>
            <ActionButton
              accessibilityLabel={copy.review.moveUp(number)}
              disabled={disabled || index === 0}
              onPress={() => onMove(-1)}
              theme={theme}
              testID={`next-visit-question-up-${index}`}
              title="↑"
            />
            <ActionButton
              accessibilityLabel={copy.review.moveDown(number)}
              disabled={disabled || index === count - 1}
              onPress={() => onMove(1)}
              theme={theme}
              testID={`next-visit-question-down-${index}`}
              title="↓"
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
      ) : (
        <Text style={styles.rationale}>{question.rationale}</Text>
      )}
      {editable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{
            selected: question.priority === 'important',
            disabled,
          }}
          disabled={disabled}
          onPress={() =>
            onUpdate({
              priority:
                question.priority === 'important' ? 'routine' : 'important',
            })
          }
          style={[styles.priority, disabled && styles.disabled]}
          testID={`next-visit-question-priority-${index}`}
        >
          <Text style={styles.actionText}>
            {question.priority === 'important'
              ? copy.review.markRoutine
              : copy.review.markImportant}
          </Text>
        </Pressable>
      ) : (
        <Text style={styles.priorityLabel}>{priorityLabel}</Text>
      )}
      <Text style={styles.evidenceHeading}>근거</Text>
      {question.citations.map((reference, citationIndex) => (
        <Pressable
          accessibilityRole="button"
          disabled={disabled}
          key={`${reference.sourceKind}:${reference.sourceId}:${reference.effectiveTime ?? citationIndex}`}
          onPress={() => onOpenSource(reference)}
          style={[styles.sourceButton, disabled && styles.disabled]}
          testID={`next-visit-source-${index}-${citationIndex}`}
        >
          <Text style={styles.sourceText}>
            {sourceLabel(reference.sourceKind)}
            {reference.effectiveTime
              ? ` · ${formatSourceTime(reference.effectiveTime)}`
              : ''}
          </Text>
          <Text numberOfLines={3} style={styles.sourceContent}>
            {reference.content}
          </Text>
          <Text style={styles.openSource}>{copy.evidence.open}</Text>
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

function sourceLabel(kind: NextVisitEvidenceReference['sourceKind']): string {
  switch (kind) {
    case 'personal_record':
      return copy.evidence.personalRecord;
    case 'reviewed_memory':
      return copy.evidence.reviewedMemory;
    case 'external_medical':
      return copy.evidence.externalMedical;
  }
}

function formatSourceTime(value: string): string {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return copy.evidence.noDate;
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(instant);
}
