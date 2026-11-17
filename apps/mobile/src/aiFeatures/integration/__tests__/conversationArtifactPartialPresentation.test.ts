import { presentEvidenceSource } from '../evidenceSourcePresentation';

test('legacy partial history keeps source caveats without a separate coverage label', () => {
  const sections = presentEvidenceSource({
    sourceKind: 'generated_artifact',
    metadata: {
      type: 'conversation_turn',
      id: 'saved',
      originFeature: 'record_conversation',
      originSession: 'session',
      createdAt: '2026-10-05T00:00:00.000Z',
      eventTime: null,
      revision: 'revision',
      providerId: 'provider',
      modelId: 'model',
      completion: 'partial',
      review: 'unreviewed',
    },
    conversation: { question: 'question', answer: 'answer' },
    sources: [],
    sourceStatus: 'current',
  });
  expect(sections[0]?.rows).not.toContainEqual({
    label: '완료 상태',
    value: '일부만 생성된 답변',
  });
  expect(sections[0]?.rows).toContainEqual({
    label: '출처 상태',
    value: '현재 출처와 일치',
  });
});
