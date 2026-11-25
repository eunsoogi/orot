import { View } from 'react-native';
import { AppText } from '../layout/AppText';
import type { VisitBookmarkQuestion } from '../storage/archivedVisitBookmarkAccess';

/** Read-only rendering shared by retained originals and an explicit cold preview. */
export function GeneratedVisitQuestionPreview({
  questions,
}: {
  questions: readonly VisitBookmarkQuestion[];
}) {
  return questions.map(question => (
    <View key={question.id}>
      <AppText selectable>{question.questionText}</AppText>
      {question.rationale ? (
        <AppText selectable>{question.rationale}</AppText>
      ) : null}
    </View>
  ));
}
