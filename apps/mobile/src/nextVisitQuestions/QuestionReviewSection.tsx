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

interface QuestionReviewSectionProps<
  TReference extends NextVisitEvidenceReference,
> {
  readonly questions: readonly NextVisitQuestion<TReference>[];
  readonly caveats: readonly EvidenceCaveat[];
  readonly saveMessage: string | null;
  readonly isSaving: boolean;
  readonly isReviewValid: boolean;
  readonly theme: NextVisitQuestionsTheme;
  readonly onUpdate: (
    index: number,
    update: Partial<
      Pick<
        NextVisitQuestion<TReference>,
        'questionText' | 'rationale' | 'priority'
      >
    >,
  ) => void;
  readonly onMove: (index: number, offset: -1 | 1) => void;
  readonly onRemove: (index: number) => void;
  readonly onOpenSource: (reference: TReference) => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
}

/** Keeps caveats next to the editable list so review does not hide evidence limits. */
export function QuestionReviewSection<
  TReference extends NextVisitEvidenceReference,
>({
  questions,
  caveats,
  saveMessage,
  isSaving,
  isReviewValid,
  theme,
  onUpdate,
  onMove,
  onRemove,
  onOpenSource,
  onCancel,
  onSave,
}: QuestionReviewSectionProps<TReference>) {
  const styles = createNextVisitStyles(theme);
  return (
    <View style={styles.section} testID="next-visit-review-list">
      <Text accessibilityRole="header" style={styles.sectionHeading}>
        {copy.review.heading}
      </Text>
      <Text style={styles.muted}>{copy.review.helper}</Text>
      <EvidenceCaveats caveats={caveats} theme={theme} />
      <Text style={styles.muted}>{copy.review.count(questions.length)}</Text>
      {questions.length === 0 ? (
        <Text style={styles.warning}>{copy.review.empty}</Text>
      ) : (
        questions.map((question, index) => (
          <QuestionCard
            count={questions.length}
            editable
            index={index}
            key={`draft-${index}`}
            onMove={offset => onMove(index, offset)}
            onOpenSource={onOpenSource}
            onRemove={() => onRemove(index)}
            onUpdate={update => onUpdate(index, update)}
            question={question}
            theme={theme}
            disabled={isSaving}
          />
        ))
      )}
      {saveMessage ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {saveMessage}
        </Text>
      ) : null}
      <View style={styles.row}>
        <ActionButton
          disabled={isSaving}
          label={copy.review.cancel}
          onPress={onCancel}
          theme={theme}
          variant="secondary"
          testID="next-visit-review-cancel"
        />
        <ActionButton
          disabled={!isReviewValid || isSaving}
          label={isSaving ? copy.review.saving : copy.review.save}
          onPress={onSave}
          theme={theme}
          testID="next-visit-review-save"
        />
      </View>
    </View>
  );
}
