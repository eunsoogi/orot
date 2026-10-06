import { Pressable, Text, TextInput, View } from 'react-native';
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

/** Renders one editable question while the parent owns ordered-list state. */
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
          질문 {index + 1}
        </Text>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`질문 ${index + 1} 위로 이동`}
            accessibilityState={{ disabled: index === 0 || saving }}
            disabled={index === 0 || saving}
            onPress={() => onMove(-1)}
            style={styles.smallButton}
            testID={`visit-question-move-up-${index}`}
          >
            <Text style={styles.buttonText}>위로</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`질문 ${index + 1} 아래로 이동`}
            accessibilityState={{ disabled: index === count - 1 || saving }}
            disabled={index === count - 1 || saving}
            onPress={() => onMove(1)}
            style={styles.smallButton}
            testID={`visit-question-move-down-${index}`}
          >
            <Text style={styles.buttonText}>아래로</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`질문 ${index + 1} 삭제`}
            disabled={saving}
            onPress={onRemove}
            style={styles.smallButton}
            testID={`visit-question-remove-${index}`}
          >
            <Text style={styles.buttonText}>삭제</Text>
          </Pressable>
        </View>
      </View>

      <TextInput
        accessibilityLabel={`질문 ${index + 1}`}
        editable={!saving}
        multiline
        onChangeText={questionText =>
          onUpdate(current => ({ ...current, questionText }))
        }
        style={styles.questionInput}
        value={question.questionText}
      />
      <TextInput
        accessibilityLabel={`질문 ${index + 1} 이유`}
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
        accessibilityLabel={`질문 ${index + 1} 우선순위`}
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
          {question.priority === 'important' ? '중요 질문' : '일반 질문'} ·
          우선순위 변경
        </Text>
      </Pressable>

      <Text style={styles.evidenceHeading}>근거</Text>
      {question.citations.map(citation => (
        <View
          key={`${citation.sourceKind}:${citation.sourceId}:${citation.evidenceId}`}
          style={styles.evidence}
        >
          <Text style={styles.evidenceSource}>
            {citation.sourceKind === 'reviewed_memory'
              ? '이전 검토 메모'
              : '건강 기록'}
            {citation.effectiveTime ? ` · ${citation.effectiveTime}` : ''}
          </Text>
          <Text style={styles.evidenceContent}>{citation.content}</Text>
        </View>
      ))}
    </View>
  );
}
