import 'react-native-get-random-values';
import { useEffect, useState } from 'react';
import { AppRegistry, Keyboard, StyleSheet, Text, View } from 'react-native';
import type { Appointment } from '@orot/domain';
import { InMemoryFakeLanguageModelProvider } from '@orot/model-runtime';
import App from '../App';
import { name as appName } from '../app.json';
import { NextVisitQuestionsRoute } from '../src/aiFeatures/integration/NextVisitQuestionsRoute';
import type { AiFeatureServiceDependencies } from '../src/aiFeatures/integration/featureServices';
import type { VisitQuestionsRenderInput } from '../src/aiFeatures/integration/AiFeatureFlowScreen';
import type { VisitQuestionRouteOperations } from '../src/aiFeatures/integration/visitQuestionsRouteOperations';
import type { VisitQuestionEvidenceItem } from '../src/agent/visitQuestions/taskContract';
import type {
  ProviderSelectionOption,
  ProviderSelectionStore,
} from '../src/providers/selection/types';
import type { NextVisitQuestion } from '../src/nextVisitQuestions/types';

// This entry keeps the normal App and NavigationRouteAdapter path while using only synthetic visit data.
const syntheticProvider = new InMemoryFakeLanguageModelProvider({
  id: 'synthetic-ai-feature-e2e',
  displayName: '합성 UI 검사 제공자',
});
const syntheticSelection = {
  providerId: syntheticProvider.id,
  modelId: 'synthetic-visit-question-model',
};
const syntheticOption: ProviderSelectionOption = {
  provider: syntheticProvider,
  modelId: syntheticSelection.modelId,
  displayName: '합성 UI 검사 제공자',
  privacyBoundary: 'on-device',
  availability: { status: 'available' },
};
const selectionStore: ProviderSelectionStore = {
  load: async () => syntheticSelection,
  save: async () => undefined,
  clear: async () => undefined,
};
const aiFeatureServiceDependencies: AiFeatureServiceDependencies = {
  selectedAi: {
    selectionStore,
    loadAppleOption: async () => syntheticOption,
  },
};

const syntheticAppointment: Appointment = {
  id: 'synthetic-appointment-ai-feature-e2e',
  effectiveAt: '2035-06-02T09:30:00.000Z',
  recordedAt: '2035-01-01T00:00:00.000Z',
  ingestedAt: '2035-01-01T00:00:00.000Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  status: 'scheduled',
  clinicLabel: '합성 진료 예약',
};
const syntheticCitation: VisitQuestionEvidenceItem = {
  sourceKind: 'personal_record',
  sourceId: 'synthetic-ai-feature-e2e-record',
  sourceRevision: 'revision-1',
  evidenceId: 'synthetic-ai-feature-e2e-span',
  evidenceRevision: 'revision-1',
  locator: { kind: 'synthetic-span', id: 'synthetic-ai-feature-e2e-span' },
  effectiveTime: '2035-05-20T09:00:00.000Z',
  reviewState: 'unreviewed',
  content: '합성 기록: 최근 증상 변화를 확인할 수 있어요.',
};
const syntheticQuestions: readonly NextVisitQuestion<VisitQuestionEvidenceItem>[] =
  [
    {
      questionText: '최근 증상 변화를 어떻게 정리할까요?',
      rationale: '합성 기록에서 확인할 시간과 변화를 정리합니다.',
      priority: 'routine',
      citations: [syntheticCitation],
    },
    {
      questionText: '언제 증상이 달라졌는지 어떻게 설명할까요?',
      rationale: '진료 전에 변화가 시작된 시점을 구분합니다.',
      priority: 'routine',
      citations: [syntheticCitation],
    },
    {
      questionText: '추가로 확인할 기록이 있을까요?',
      rationale: '현재 화면에서 다루지 못한 기록을 확인합니다.',
      priority: 'routine',
      citations: [syntheticCitation],
    },
  ];
const visitQuestionOperations: VisitQuestionRouteOperations = {
  loadAppointment: async () => syntheticAppointment,
  // Fixture output stops before provider inference, consent, and app-health storage are invoked.
  generate: async () => ({
    status: 'ready',
    questions: syntheticQuestions,
    caveats: [],
    validateSource: async (_reference, signal) => !signal.aborted,
  }),
  save: async ({ questions, caveats }) => ({
    questions,
    caveats,
    memoryStatus: 'saved',
    validateSource: async (_reference, signal) => !signal.aborted,
  }),
};

function renderVisitQuestions(input: VisitQuestionsRenderInput) {
  return (
    <NextVisitQuestionsRoute
      {...input}
      loadSavedVisitQuestions={async appointmentId => ({
        status: 'ready',
        appointmentId,
        questions: [],
        caveats: [],
        restorationNotice: '합성 질문 복원 안내',
      })}
      operations={visitQuestionOperations}
    />
  );
}

function AiFeatureVisitQuestionsProbeEntry() {
  const [keyboardFrame, setKeyboardFrame] = useState<{
    screenY: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    // The native keyboard event gives Detox a shared point frame for the fixed-action clearance assertion.
    const shown = Keyboard.addListener('keyboardDidShow', event =>
      setKeyboardFrame({
        screenY: event.endCoordinates.screenY,
        height: event.endCoordinates.height,
      }),
    );
    const hiding = Keyboard.addListener('keyboardWillHide', () =>
      setKeyboardFrame(null),
    );
    const hidden = Keyboard.addListener('keyboardDidHide', () =>
      setKeyboardFrame(null),
    );
    return () => {
      shown.remove();
      hiding.remove();
      hidden.remove();
    };
  }, []);

  return (
    <View style={styles.container}>
      <App
        aiFeatureServiceDependencies={aiFeatureServiceDependencies}
        renderVisitQuestions={renderVisitQuestions}
      />
      <View pointerEvents="none" style={styles.keyboardMarker}>
        <Text
          accessible
          accessibilityLabel={
            keyboardFrame
              ? `keyboard-visible:${keyboardFrame.screenY}:${keyboardFrame.height}`
              : 'keyboard-hidden'
          }
          style={styles.keyboardMarkerText}
          testID={
            keyboardFrame
              ? 'ai-feature-visit-questions-keyboard-visible'
              : 'ai-feature-visit-questions-keyboard-hidden'
          }
        >
          Keyboard {keyboardFrame ? 'visible' : 'hidden'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  keyboardMarker: { position: 'absolute', left: 0, top: 0 },
  keyboardMarkerText: { fontSize: 1 },
});

AppRegistry.registerComponent(appName, () => AiFeatureVisitQuestionsProbeEntry);
