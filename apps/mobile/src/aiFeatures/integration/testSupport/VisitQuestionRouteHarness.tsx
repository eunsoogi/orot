import { useLayoutEffect, useRef, useState } from 'react';
import { Button, Text, View } from 'react-native';
import type { EvidenceItem } from '@orot/agent-runtime';
import type { VisitQuestionsRouteState } from '../AiFeatureFlowScreen';

export interface VisitQuestionHarnessProps {
  readonly reference: EvidenceItem;
  readonly onBack: () => void;
  readonly onOpenProviderSelection: () => void;
  readonly onOpenSource: (reference: EvidenceItem) => void;
  readonly onRouteStateChange: (state: VisitQuestionsRouteState) => void;
  readonly loadSavedVisitQuestions: (appointmentId: string) => Promise<unknown>;
}

export type VisitQuestionRenderInput = Omit<
  VisitQuestionHarnessProps,
  'reference'
> & {
  readonly resolveSelectedAi: () => Promise<unknown>;
  readonly selectedAiRevision: number;
};

/** Keeps an editable draft so the route test detects provider-selection unmounts. */
export function VisitQuestionHarness({
  reference,
  onBack,
  onOpenProviderSelection,
  onOpenSource,
  onRouteStateChange,
  loadSavedVisitQuestions,
}: VisitQuestionHarnessProps) {
  const [draft, setDraft] = useState('기존 질문 초안');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const revision = useRef(0);

  // This harness reports edit state through the same route contract as production.
  useLayoutEffect(() => {
    onRouteStateChange({
      hasUnsavedChanges,
      isSaving: false,
      isGenerating: false,
      revision: revision.current,
    });
  }, [hasUnsavedChanges, onRouteStateChange]);

  return (
    <View>
      <Text testID="visit-question-route">다음 진료 질문 화면</Text>
      <Text testID="visit-question-loader">
        {typeof loadSavedVisitQuestions}
      </Text>
      <Text testID="visit-question-draft">{draft}</Text>
      <Button
        onPress={() => {
          revision.current += 1;
          setDraft('수정한 질문 초안');
          setHasUnsavedChanges(true);
        }}
        testID="visit-question-edit"
        title="초안 수정"
      />
      <Button
        onPress={onOpenProviderSelection}
        testID="visit-question-select-provider"
        title="AI 선택"
      />
      <Button onPress={onBack} testID="visit-question-back" title="뒤로" />
      <Button
        onPress={() => onOpenSource(reference)}
        testID="visit-question-source"
        title="근거 열기"
      />
    </View>
  );
}
