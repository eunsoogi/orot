import { reference } from '../../diseaseHypotheses/taskTestSupport';
import { decodeConversationArtifact } from '../conversationArtifactCodec';

test('accepts only a visit reference backed by the exact appointment dependency', () => {
  const source = {
    ...reference,
    sourceKind: 'personal_record',
    sourceId: 'visit-a',
    evidenceId: 'visit-a',
  };
  const artifact = {
    id: 'turn',
    sessionId: 'session',
    createdAt: '2026-10-05T00:00:00.000Z',
    providerId: 'provider',
    modelId: 'model',
    status: 'complete',
    question: '질문',
    answer: '준비했어요',
    citations: [],
    sources: [
      {
        reference: source,
        records: [{ kind: 'appointment', id: 'visit-a', revision: 'revision' }],
      },
    ],
    visitQuestions: { appointmentId: 'visit-a', source, candidates: [] },
  };
  expect(
    decodeConversationArtifact(JSON.stringify(artifact))?.visitQuestions
      ?.appointmentId,
  ).toBe('visit-a');
  expect(
    decodeConversationArtifact(
      JSON.stringify({
        ...artifact,
        sources: [
          {
            reference: source,
            records: [
              { kind: 'appointment', id: 'visit-b', revision: 'revision' },
            ],
          },
        ],
      }),
    ),
  ).toBeNull();
  expect(
    decodeConversationArtifact(
      JSON.stringify({
        ...artifact,
        visitQuestions: { appointmentId: 'visit-b', source },
      }),
    ),
  ).toBeNull();
});
