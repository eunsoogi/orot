import { useColorScheme, View } from 'react-native';
import { createNextVisitQuestionsTheme } from '../aiFeatures/integration/nextVisitQuestionsRoutePresentation';
import { QuestionCard } from '../nextVisitQuestions/QuestionCard';
import type { GeneratedVisitQuestion } from './types';

const noAction = () => {};

/** Reuse the Conversation question card without importing its editable review session. */
export function GeneratedVisitQuestions({
  questions,
}: {
  readonly questions: readonly GeneratedVisitQuestion[];
}) {
  const theme = createNextVisitQuestionsTheme(useColorScheme() === 'dark');
  return (
    <View style={{ gap: theme.tokens.spacing.sm }}>
      {questions.map(({ id, questionText, rationale, priority }, index) => (
        <QuestionCard
          key={id}
          question={{ questionText, rationale, priority, citations: [] }}
          index={index}
          count={questions.length}
          editable={false}
          disabled
          readOnlyArchive
          theme={theme}
          onUpdate={noAction}
          onMove={noAction}
          onRemove={noAction}
          onOpenSource={noAction}
        />
      ))}
    </View>
  );
}
