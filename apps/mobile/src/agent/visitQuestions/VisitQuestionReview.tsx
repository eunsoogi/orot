import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { t } from '../../i18n';
import type { VisitQuestionCandidate } from './taskContract';
import { visitQuestionReviewStyles as styles } from './VisitQuestionReview.styles';
import { VisitQuestionReviewCard } from './VisitQuestionReviewCard';

export interface VisitQuestionReviewProps {
  readonly appointmentLabel: string;
  readonly questions: readonly VisitQuestionCandidate[];
  readonly memoryStatus?:
    'available' | 'no_matching_current_memory' | 'local_memory_unavailable';
  readonly message?: string;
  readonly saving?: boolean;
  readonly onConfirm: (
    questions: readonly VisitQuestionCandidate[],
  ) => void | Promise<void>;
  readonly onCancel?: () => void;
}

function copyQuestions(
  questions: readonly VisitQuestionCandidate[],
): VisitQuestionCandidate[] {
  return questions.map(question => ({
    ...question,
    citations: [...question.citations],
  }));
}

function hasCompleteDraft(
  questions: readonly VisitQuestionCandidate[],
): boolean {
  return (
    questions.length > 0 &&
    questions.length <= 5 &&
    questions.every(
      question =>
        question.questionText.trim().length > 1 &&
        question.rationale.trim().length > 1 &&
        question.citations.length > 0,
    )
  );
}

function moveQuestion(
  questions: readonly VisitQuestionCandidate[],
  index: number,
  offset: -1 | 1,
): VisitQuestionCandidate[] {
  const target = index + offset;
  if (target < 0 || target >= questions.length) return [...questions];
  const moved = [...questions];
  [moved[index], moved[target]] = [moved[target]!, moved[index]!];
  return moved;
}

function memoryMessage(
  status: VisitQuestionReviewProps['memoryStatus'],
): string | null {
  if (status === 'available')
    return t('visitQuestions.review.memory.available');
  if (status === 'no_matching_current_memory')
    return t('visitQuestions.review.memory.none');
  if (status === 'local_memory_unavailable') {
    return t('visitQuestions.review.memory.unavailable');
  }
  return null;
}

/** Holds editable draft state until confirmation; app-owned review copy comes from the Korean catalog. */
export function VisitQuestionReview({
  appointmentLabel,
  questions,
  memoryStatus,
  message,
  saving = false,
  onConfirm,
  onCancel,
}: VisitQuestionReviewProps) {
  const [drafts, setDrafts] = useState(() => copyQuestions(questions));
  useEffect(() => {
    setDrafts(copyQuestions(questions));
  }, [questions]);

  const updateQuestion = (
    index: number,
    update: (question: VisitQuestionCandidate) => VisitQuestionCandidate,
  ) => {
    setDrafts(current =>
      current.map((question, itemIndex) =>
        itemIndex === index ? update(question) : question,
      ),
    );
  };
  const ready = hasCompleteDraft(drafts) && !saving;

  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        {t('visitQuestions.review.title')}
      </Text>
      <Text style={styles.appointment}>{appointmentLabel}</Text>
      {memoryMessage(memoryStatus) ? (
        <Text accessibilityRole="text" style={styles.notice}>
          {memoryMessage(memoryStatus)}
        </Text>
      ) : null}
      {message ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {message}
        </Text>
      ) : null}

      {drafts.map((question, index) => (
        <VisitQuestionReviewCard
          key={`${index}:${question.citations.map(citation => citation.evidenceId).join(',')}`}
          question={question}
          index={index}
          count={drafts.length}
          saving={saving}
          onMove={offset =>
            setDrafts(current => moveQuestion(current, index, offset))
          }
          onRemove={() =>
            setDrafts(current =>
              current.filter((_, itemIndex) => itemIndex !== index),
            )
          }
          onUpdate={update => updateQuestion(index, update)}
        />
      ))}

      {drafts.length === 0 ? (
        <Text style={styles.notice}>{t('visitQuestions.review.empty')}</Text>
      ) : null}
      <View style={styles.footer}>
        {onCancel ? (
          <Pressable
            accessibilityRole="button"
            disabled={saving}
            onPress={onCancel}
            style={styles.secondaryButton}
            testID="visit-question-cancel"
          >
            <Text style={styles.buttonText}>
              {t('visitQuestions.review.actions.cancel')}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !ready }}
          disabled={!ready}
          onPress={() =>
            onConfirm(
              copyQuestions(drafts).map(question => ({
                ...question,
                questionText: question.questionText.trim(),
                rationale: question.rationale.trim(),
              })),
            )
          }
          style={[styles.confirmButton, !ready && styles.disabledButton]}
          testID="visit-question-confirm"
        >
          <Text style={styles.confirmText}>
            {saving
              ? t('visitQuestions.review.actions.saving')
              : t('visitQuestions.review.actions.confirm')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
