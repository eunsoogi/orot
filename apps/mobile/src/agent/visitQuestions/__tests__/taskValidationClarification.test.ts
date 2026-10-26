import { createVisitQuestionTaskResponder } from '../taskContract';
import type { VisitQuestionResponderInput } from '../taskContract';

const responder = createVisitQuestionTaskResponder();
const input: VisitQuestionResponderInput = {
  request: '다음 진료에서 확인할 질문을 준비해 주세요.',
  context: { effectiveAt: '2026-11-01T09:00:00+09:00' },
  evidence: { items: [], coverage: [], conflicts: [] },
};

describe('visit-question clarification validation', () => {
  it('preserves a safe, specific medication-conflict clarification', () => {
    const message =
      '현재 복용 기록이 서로 달라요. 어떤 복용 정보를 의료진과 확인할까요?';
    const validation = responder.validateResult(
      { status: 'needs_clarification', message },
      input,
    );

    expect(validation).toEqual({
      status: 'valid',
      value: { status: 'needs_clarification', message },
    });
  });

  it('preserves the unobserved date and topic recorded in a coverage gap', () => {
    const message =
      '2030-04-22 기록에서 현재 혈압 값이 확인되지 않았어요. 진료에서 현재 값을 확인해도 될까요?';
    const evidence = {
      ...input.evidence,
      coverage: [
        {
          sourceKind: 'personal_record' as const,
          searchedSourceIds: [],
          gaps: [
            'No synthetic blood-pressure reading is recorded for 2030-04-22.',
          ],
          truncated: false,
          resultLimit: 5,
          returnedCount: 0,
        },
      ],
    };
    const validation = responder.validateResult(
      { status: 'needs_clarification', message },
      { ...input, evidence },
    );

    expect(validation).toEqual({
      status: 'valid',
      value: { status: 'needs_clarification', message },
    });

    const dateWithoutGap = responder.validateResult(
      { status: 'needs_clarification', message },
      input,
    );
    expect(dateWithoutGap).toMatchObject({
      status: 'valid',
      value: { status: 'needs_clarification' },
    });
    expect(JSON.stringify(dateWithoutGap)).not.toContain('2030-04-22');
  });

  it('does not treat a numeric value in a coverage gap as evidence', () => {
    const message = '2030-04-22 혈압 기록이 130/80 mmHg인지 확인해 주세요?';
    const evidence = {
      ...input.evidence,
      coverage: [
        {
          sourceKind: 'personal_record' as const,
          searchedSourceIds: [],
          gaps: [
            'No blood-pressure reading is recorded for 2030-04-22 at 130/80 mmHg.',
          ],
          truncated: false,
          resultLimit: 5,
          returnedCount: 0,
        },
      ],
    };
    const validation = responder.validateResult(
      { status: 'needs_clarification', message },
      { ...input, evidence },
    );

    expect(validation).toMatchObject({
      status: 'valid',
      value: { status: 'needs_clarification' },
    });
    expect(JSON.stringify(validation)).not.toContain('130/80');
  });
});
