import { fireEvent, render, screen } from '@testing-library/react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import { EvidenceSourceDetailScreen } from '../EvidenceSourceDetailScreen';
import type { EvidenceSourceReadResult } from '../evidenceRegistry';

const original: EvidenceReference = {
  sourceKind: 'personal_record',
  sourceId: 's1',
  sourceRevision: 'r1',
  evidenceId: 'e1',
  evidenceRevision: 'v1',
  locator: { kind: 'local-evidence', token: 'e1' },
  effectiveTime: null,
  reviewState: 'unreviewed',
};
const artifact: EvidenceReference = {
  ...original,
  sourceKind: 'generated_artifact',
  sourceId: 's2',
  evidenceId: 'e2',
};

test('opens the original source from a saved AI result and returns to that result', async () => {
  const readSource = jest.fn(
    async (reference: EvidenceReference): Promise<EvidenceSourceReadResult> =>
      reference.evidenceId === 'e2'
        ? {
            status: 'available',
            document: {
              sourceKind: 'generated_artifact',
              metadata: {
                type: 'symptom_summary',
                id: 'private',
                originFeature: 'symptom_summary',
                originSession: null,
                createdAt: '2035-01-01T00:00:00Z',
                eventTime: null,
                revision: '1',
                providerId: 'provider',
                modelId: 'model',
                completion: 'complete',
                review: 'unreviewed',
              },
              sourceStatus: 'current',
              analysis: {
                hypotheses: [
                  {
                    title: '이전 요약',
                    summary: '이전 생성 결과',
                    uncertainty: '',
                    missingData: [],
                    supportingEvidence: [original],
                    contraryEvidence: [],
                  },
                ],
              },
            },
          }
        : {
            status: 'available',
            document: {
              sourceKind: 'manual_history',
              evidence: {
                id: 'synthetic',
                sourceEntryId: 'private',
                kind: 'note',
                text: '직접 입력한 원본',
                effectiveDate: { status: 'unknown' },
                recordedAt: '2035-01-01T00:00:00Z',
                provenance: { origin: 'user_reported', sourceRecordIds: [] },
                reviewState: { status: 'unreviewed' },
              },
            },
          },
  );
  await render(
    <EvidenceSourceDetailScreen
      reference={artifact}
      onBack={() => {}}
      readSource={readSource}
    />,
  );
  await screen.findByText('이전 생성 결과');
  await fireEvent.press(screen.getByLabelText(/원문 근거 열기 · 건강 기록/));
  await screen.findByText('직접 입력한 원본');
  await fireEvent.press(screen.getByTestId('ai-feature-source-previous'));
  await screen.findByText('이전 생성 결과');
});
