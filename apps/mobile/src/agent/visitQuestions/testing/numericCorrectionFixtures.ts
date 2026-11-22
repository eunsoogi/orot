import { visitHealthFixture } from './healthContextFixture';
import { hasUnsupportedDateOrValue } from '../questionFacts';

export const supported =
  '기간 평균 심박수 72회/분을 바탕으로 다음 진료 전 어떤 변화를 기록하면 좋을까요?';
export const unsupported =
  '기간 평균 심박수 72회/초를 바탕으로 다음 진료 전 어떤 변화를 기록하면 좋을까요?';

export function output(
  first: string,
  secondId = 'evidence-1',
  lastReason = '측정한 시각과 함께 기록할 내용을 정할 수 있어요.',
) {
  return JSON.stringify({
    type: 'result',
    citations: ['evidence-1'],
    value: {
      status: 'suggestions',
      questions: [
        {
          questionText: first,
          rationale: '기간 심박수 기록을 의료진과 함께 검토할 수 있어요.',
          priority: 'routine',
          evidenceIds: ['evidence-1'],
        },
        {
          questionText:
            '심박수 측정 조건 중 진료에서 함께 확인할 점은 무엇인가요?',
          rationale:
            '측정 조건에 따른 해석의 차이를 의료진과 확인할 수 있어요.',
          priority: 'routine',
          evidenceIds: [secondId],
        },
        {
          questionText:
            '심박수 기록과 함께 어떤 증상 변화를 기록하면 좋을까요?',
          rationale: lastReason,
          priority: 'routine',
          evidenceIds: ['evidence-1'],
        },
      ],
    },
  });
}

export async function fixture() {
  const f = await visitHealthFixture();
  expect(hasUnsupportedDateOrValue(supported, [f.item])).toBe(false);
  return {
    ...f,
    context: {
      ...f.prepared,
      evidence: {
        ...f.prepared.evidence,
        batch: {
          ...f.prepared.evidence.batch,
          items: [f.item],
          coverage: [
            {
              sourceKind: 'personal_record' as const,
              searchedSourceIds: [f.item.sourceId],
              gaps: [],
              truncated: false,
              resultLimit: 1,
              returnedCount: 1,
            },
          ],
        },
      },
    },
  };
}
