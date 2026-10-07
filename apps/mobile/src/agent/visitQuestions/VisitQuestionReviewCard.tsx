import { Pressable, Text, TextInput, View } from 'react-native';
import { t } from '../../i18n';
import type { VisitQuestionCandidate } from './taskContract';
import { visitQuestionReviewStyles as styles } from './VisitQuestionReview.styles';

export interface VisitQuestionReviewCardProps {
  readonly question: VisitQuestionCandidate;
  readonly index: number;
  readonly count: number;
  readonly saving: boolean;
  readonly onUpdate: (
    update: (question: VisitQuestionCandidate) => VisitQuestionCandidate,
  ) => void;
  readonly onMove: (offset: -1 | 1) => void;
  readonly onRemove: () => void;
}

/** Renders one editable question while the parent owns order and evidence remains read-only. */
export function VisitQuestionReviewCard({
  question,
  index,
  count,
  saving,
  onUpdate,
  onMove,
  onRemove,
}: VisitQuestionReviewCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeading}>
        <Text accessibilityRole="header" style={styles.questionNumber}>
          {t('visitQuestions.review.question.number', { number: index + 1 })}
        </Text>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('visitQuestions.review.question.moveUp', {
              number: index + 1,
            })}
            accessibilityState={{ disabled: index === 0 || saving }}
            disabled={index === 0 || saving}
            onPress={() => onMove(-1)}
            style={styles.smallButton}
            testID={`visit-question-move-up-${index}`}
          >
            <Text style={styles.buttonText}>
              {t('visitQuestions.review.question.moveUpAction')}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('visitQuestions.review.question.moveDown', {
              number: index + 1,
            })}
            accessibilityState={{ disabled: index === count - 1 || saving }}
            disabled={index === count - 1 || saving}
            onPress={() => onMove(1)}
            style={styles.smallButton}
            testID={`visit-question-move-down-${index}`}
          >
            <Text style={styles.buttonText}>
              {t('visitQuestions.review.question.moveDownAction')}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('visitQuestions.review.question.remove', {
              number: index + 1,
            })}
            disabled={saving}
            onPress={onRemove}
            style={styles.smallButton}
            testID={`visit-question-remove-${index}`}
          >
            <Text style={styles.buttonText}>
              {t('visitQuestions.review.question.removeAction')}
            </Text>
          </Pressable>
        </View>
      </View>

      <TextInput
        accessibilityLabel={t('visitQuestions.review.question.label', {
          number: index + 1,
        })}
        editable={!saving}
        multiline
        onChangeText={questionText =>
          onUpdate(current => ({ ...current, questionText }))
        }
        style={styles.questionInput}
        value={question.questionText}
      />
      <TextInput
        accessibilityLabel={t('visitQuestions.review.question.rationale', {
          number: index + 1,
        })}
        editable={!saving}
        multiline
        onChangeText={rationale =>
          onUpdate(current => ({ ...current, rationale }))
        }
        style={styles.rationaleInput}
        value={question.rationale}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('visitQuestions.review.question.priorityLabel', {
          number: index + 1,
        })}
        accessibilityState={{
          selected: question.priority === 'important',
          disabled: saving,
        }}
        disabled={saving}
        onPress={() =>
          onUpdate(current => ({
            ...current,
            priority:
              current.priority === 'important' ? 'routine' : 'important',
          }))
        }
        style={styles.priorityButton}
        testID={`visit-question-priority-${index}`}
      >
        <Text style={styles.buttonText}>
          {t('visitQuestions.review.question.priorityStatus', {
            status: t(
              question.priority === 'important'
                ? 'visitQuestions.review.question.priority.important'
                : 'visitQuestions.review.question.priority.routine',
            ),
          })}
        </Text>
      </Pressable>

      <Text style={styles.evidenceHeading}>
        {t('visitQuestions.review.evidence.heading')}
      </Text>
      {question.citations.map(citation => (
        <View
          key={`${citation.sourceKind}:${citation.sourceId}:${citation.evidenceId}`}
          style={styles.evidence}
        >
          <Text style={styles.evidenceSource}>
            {citation.sourceKind === 'reviewed_memory'
              ? t('visitQuestions.review.evidence.source.reviewedMemory')
              : t('visitQuestions.review.evidence.source.personalRecord')}
            {citation.effectiveTime ? ` · ${citation.effectiveTime}` : ''}
          </Text>
          <Text style={styles.evidenceContent}>{citation.content}</Text>
        </View>
      ))}
    </View>
  );
}
