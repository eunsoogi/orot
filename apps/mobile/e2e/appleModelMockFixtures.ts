import type { LanguageModelRequest } from '@orot/model-runtime';
import type { MockAppleStep } from './appleModelMockBridge';

function requireFormat(request: LanguageModelRequest, name: string) {
  if (request.responseFormat?.name !== name)
    throw new Error(
      'Unexpected model request format: ' + request.responseFormat?.name,
    );
}

/** Citation IDs come from the request's supplied evidence, including real Europe PMC results; the answer is a declared fixture. */
function citationIds(request: LanguageModelRequest): string[] {
  requireFormat(request, 'task_response');
  const schema = request.responseFormat!.schema as unknown as {
    anyOf: readonly {
      properties: { citations?: { items: { enum?: string[] } } };
    }[];
  };
  const ids = schema.anyOf.flatMap(
    choice => choice.properties.citations?.items.enum ?? [],
  );
  if (!ids.length)
    throw new Error('A grounded mock response requires supplied citation IDs');
  return ids;
}

const calendar =
  (count: number): MockAppleStep =>
  request => {
    const ids = citationIds(request);
    if (
      ids.length !== count ||
      ids.some((id, index) => id !== 'calendar-candidate-' + (index + 1))
    )
      throw new Error(
        'Calendar fixture must classify every original candidate exactly once',
      );
    const classifications = ids.map((candidateId, index) => ({
      candidateId,
      classification:
        index === 0 ? 'medical' : index === 1 ? 'non_medical' : 'uncertain',
      reason:
        index === 0
          ? '합성 일정에 진료가 명시되어 있어요.'
          : '합성 일정의 제목에 따른 테스트 분류예요.',
      uncertainty: index === 2 ? 'high' : 'low',
    }));
    return {
      text: JSON.stringify({
        type: 'result',
        value: { classifications },
        citations: ids,
      }),
    };
  };

const visit: MockAppleStep = request => {
  const ids = citationIds(request);
  if (ids.length !== 1)
    throw new Error('Visit fixture requires its one synthetic source');
  const questions = [
    '선생님, 최근 수면 변화와 관련해 무엇을 확인하면 좋을까요?',
    '선생님, 다음 진료까지 수면 기록에 어떤 내용을 남기면 좋을까요?',
    '선생님, 잠에서 일찍 깨는 변화를 상담할 때 무엇을 말씀드리면 좋을까요?',
  ].map(questionText => ({
    questionText,
    rationale: '합성 기록에 최근 수면 변화가 있어요.',
    priority: 'routine',
    evidenceIds: ids,
  }));
  return {
    text: JSON.stringify({
      type: 'result',
      value: { status: 'suggestions', questions },
      citations: ids,
    }),
  };
};

/** Fixed scripts model outcomes; they do not assess Apple model quality or decide application assertions. */
export function appleModelMockScript(
  operation: string,
): readonly MockAppleStep[] {
  if (operation === 'apple-model')
    return [
      request => {
        requireFormat(request, 'visit_question');
        return {
          text: JSON.stringify({
            question: {
              text: '선생님, 최근 수면 변화와 관련해 무엇을 확인하면 좋을까요?',
            },
            source: { id: 'synthetic-source-42' },
          }),
        };
      },
      () => ({
        text: 'This delayed mock response must be cancelled.',
        delayMs: 250,
      }),
    ];
  if (operation === 'calendar-classification')
    return [calendar(3), calendar(3)];
  if (operation === 'apple-workflow')
    return [
      calendar(1),
      visit,
      request => ({ ...visit(request), delayMs: 250 }),
    ];
  if (operation === 'rag-workflow')
    return [
      request => {
        requireFormat(request, 'task_response');
        return {
          text: JSON.stringify({
            type: 'request_evidence',
            need: 'missing_coverage',
          }),
        };
      },
      request => {
        requireFormat(request, 'evidence_research_plan');
        return {
          text: JSON.stringify({
            toolId: 'europe-pmc-publication-search',
            sourceKind: 'external_medical',
            input: { query: 'sleep duration adults' },
          }),
        };
      },
      request => ({
        text: JSON.stringify({
          type: 'result',
          value: {
            answer:
              '검색된 공개 문헌에서 성인의 수면 시간에 관한 자료를 확인했어요. 이 응답은 앱 흐름 검증을 위한 고정 mock 문구이며, 검색 결과 일부에 한정되고 개인의 진료를 대신하지 않아요.',
          },
          citations: citationIds(request).slice(0, 1),
        }),
      }),
    ];
  throw new Error('Unknown Foundation Models mock operation: ' + operation);
}
