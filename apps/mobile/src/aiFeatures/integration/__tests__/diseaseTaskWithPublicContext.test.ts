import { diseaseTaskWithPublicContext } from '../diseaseTaskWithPublicContext';
import {
  evidence,
  hypothesis,
  reference,
} from '../../../diseaseHypotheses/taskTestSupport';

test('requires local support for a personal possibility and suppresses an unsupported preview', () => {
  const external = {
    ...reference,
    sourceKind: 'external_medical' as const,
    sourceId: 'public-web',
  };
  const externalEvidence = {
    ...evidence,
    items: [{ ...external, content: 'General health information' }],
  };
  const value = {
    hypotheses: [hypothesis({ supportingEvidence: [external] })],
  };
  const context = {
    request: '가능성을 살펴봐 주세요',
    evidence: externalEvidence,
  };
  expect(
    diseaseTaskWithPublicContext.validateResult(value, context).status,
  ).toBe('invalid');
  expect(
    diseaseTaskWithPublicContext.projectStreamedText(
      JSON.stringify({ value }),
      context,
    ),
  ).toBeUndefined();
  expect(
    diseaseTaskWithPublicContext.validateResult(
      { hypotheses: [hypothesis()] },
      { ...context, evidence },
    ).status,
  ).toBe('valid');
});
