import type {
  VisitQuestionCandidate,
  VisitQuestionEvidenceItem,
} from '../taskContract';
import { validateVisitQuestionPresentation } from '../presentation';

const citation: VisitQuestionEvidenceItem = {
  sourceKind: 'personal_record',
  sourceId: 'source-1',
  sourceRevision: 'source-r1',
  evidenceId: 'evidence-1',
  evidenceRevision: 'evidence-r1',
  locator: { kind: 'structured_record', recordId: 'evidence-1' },
  effectiveTime: '2026-10-01T00:00:00Z',
  reviewState: 'reviewed',
  content: 'Synthetic reviewed evidence',
};

const questions: readonly VisitQuestionCandidate[] = [
  {
    questionText: '이 기록을 어떻게 확인하면 좋을까요?',
    rationale: '최근 기록을 의료진과 확인할 수 있어요.',
    priority: 'routine',
    citations: [citation],
  },
];

describe('visit-question presentation validation', () => {
  it('returns suggestions only after current appointment and evidence are revalidated', async () => {
    const revalidate = jest.fn(
      async (citations: readonly VisitQuestionEvidenceItem[]) =>
        citations.length === 1 && citations[0] === citation,
    );
    const result = await validateVisitQuestionPresentation(
      { status: 'suggestions', questions },
      revalidate,
    );

    expect(result).toEqual({ status: 'ready', questions });
    expect(revalidate).toHaveBeenCalledWith([citation]);
  });

  it('keeps stale suggestions out of the review screen', async () => {
    const result = await validateVisitQuestionPresentation(
      { status: 'suggestions', questions },
      async () => false,
    );

    expect(result.status).toBe('refresh_required');
  });

  it('does not reread sources when the model asks for clarification', async () => {
    const revalidate = jest.fn();
    const result = await validateVisitQuestionPresentation(
      { status: 'needs_clarification', message: '기록 사이에 차이가 있어요.' },
      revalidate,
    );

    expect(result).toEqual({
      status: 'needs_clarification',
      message: '기록 사이에 차이가 있어요.',
    });
    expect(revalidate).not.toHaveBeenCalled();
  });
});
