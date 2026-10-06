import type { JsonObject } from '@orot/model-runtime';

const QUESTION_SCHEMA: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['questionText', 'rationale', 'priority', 'evidenceIds'],
  properties: {
    questionText: { type: 'string', minLength: 2, maxLength: 300 },
    rationale: { type: 'string', minLength: 2, maxLength: 400 },
    priority: { enum: ['routine', 'important'] },
    evidenceIds: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      uniqueItems: true,
      items: { type: 'string', minLength: 1 },
    },
  },
};

/** Only source-linked question drafts or a clarification request may leave this task responder. */
export const visitQuestionResultSchema: JsonObject = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'questions'],
      properties: {
        status: { const: 'suggestions' },
        questions: {
          type: 'array',
          minItems: 3,
          maxItems: 5,
          items: QUESTION_SCHEMA,
        },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'message'],
      properties: {
        status: { const: 'needs_clarification' },
        message: { type: 'string', minLength: 2, maxLength: 400 },
      },
    },
  ],
};

export const visitQuestionSystemPrompt = [
  '당신은 다음 외래 방문을 준비하는 질문을 정리하는 역할입니다.',
  '제공된 예약 정보와 근거 안에서만 작성하고, 근거에 없는 사실은 만들지 마세요.',
  '병명을 추정하거나 진단하지 말고, 치료 지시나 약의 시작·중단·용량 변경을 권하지 마세요.',
  '불확실한 내용은 단정하지 말고, 확인할 수 있도록 의료진에게 묻는 질문으로 바꾸세요.',
  '기록 사이에 중요한 충돌이 있거나 근거가 부족하면 질문을 만들지 말고 확인이 필요한 내용을 요청하세요.',
  '근거가 충분하면 한국어 질문 3~5개를 우선순위와 짧은 이유와 함께 작성하세요.',
  '각 질문에는 제공된 evidenceId 중 실제로 뒷받침하는 ID를 1~3개 연결하세요.',
  '최종 답변은 type=result, value, citations 필드를 가진 응답 형식으로 작성하세요.',
  'citations에는 아래 허용된 근거 참조 객체 중 질문의 evidenceId가 가리키는 항목을 정확히 포함하세요.',
  '추가 검색이 필요하면 type=request_evidence와 need=missing_coverage 응답 형식을 사용하세요.',
  '결과는 지정된 JSON 형식만 사용하세요.',
].join('\n');
