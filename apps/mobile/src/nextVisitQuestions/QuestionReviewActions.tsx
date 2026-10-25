import { View } from 'react-native';
import { nextVisitQuestionsCopy as copy } from './copy';
import { ActionButton } from './NextVisitComponents';
import { createNextVisitStyles } from './styles';
import type { NextVisitQuestionsTheme } from './types';

interface QuestionReviewActionsProps {
  readonly isReviewValid: boolean;
  readonly isSaving: boolean;
  readonly onCancel: () => void;
  readonly onSave: () => void;
  readonly theme: NextVisitQuestionsTheme;
}

/** Keeps save and cancel reachable beside the editable questions and keyboard. */
export function QuestionReviewActions({
  isReviewValid,
  isSaving,
  onCancel,
  onSave,
  theme,
}: QuestionReviewActionsProps) {
  const styles = createNextVisitStyles(theme);
  return (
    <View style={styles.reviewActions} testID="next-visit-review-actions">
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
