import type { JsonObject } from '@orot/model-runtime';

const QUESTION_SCHEMA: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['questionText', 'rationale', 'priority', 'evidenceIds'],
  properties: {
    questionText: {
      type: 'string',
      minLength: 2,
      maxLength: 300,
      description:
        '기록의 의미, 관찰할 변화, 다음 방문까지 준비할 점을 의료진에게 묻는 짧은 한국어 한 문장. 이미 적힌 사실의 여부를 되묻지 말고 ?로 끝내세요.',
    },
    rationale: {
      type: 'string',
      minLength: 2,
      maxLength: 400,
      description:
        '질문이 필요한 이유를 30자 안팎의 한국어 한 문장으로 쓰세요. 근거 ID는 쓰지 마세요.',
    },
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
  '근거는 관련도순으로 고른 일부 기록입니다. 전체 병력이나 복용 목록이라고 단정하거나 검색에서 빠진 사실이 없다고 추론하지 마세요.',
  '병명을 추정하거나 진단하지 말고, 치료 지시나 약의 시작·중단·용량 변경을 권하지 마세요.',
  '불확실한 내용은 단정하지 말고, 확인할 수 있도록 의료진에게 묻는 질문으로 바꾸세요.',
  '기록 사이에 중요한 충돌이 있거나 근거가 부족하면 질문을 만들지 말고 확인이 필요한 내용을 요청하세요.',
  '근거가 충분하면 질문 3개를 작성하세요. 각 질문은 짧은 한국어 의문문으로 반드시 ?로 끝내세요.',
  'questionText는 40자 안팎, rationale은 30자 안팎의 한 문장으로 쓰세요. 근거 ID는 evidenceIds와 citations에만 쓰고 본문이나 이유에 넣지 마세요.',
  '수치나 날짜를 질문에 반복할 필요는 없습니다. 쓴다면 해당 질문이 인용하는 원문에 있는 단위와 값을 그대로 쓰세요.',
  '각 질문에는 제공된 evidenceId 중 실제로 뒷받침하는 ID를 1~3개 연결하세요.',
  '초기 근거로 답을 뒷받침할 수 없지만 허용된 로컬 조사가 도움이 되면 request_evidence 형식으로 추가 검색을 요청하세요.',
  '기록에 중요한 충돌이 이미 보이면 추가 검색으로 임의 선택하지 말고 needs_clarification 형식으로 확인을 요청하세요.',
  '최종 답변은 type=result, value, citations 필드를 가진 응답 형식으로 작성하세요.',
  'citations에는 실제 질문에서 사용한 evidenceIds의 합집합만 중복 없이 쓰세요. 사용하지 않은 ID는 빼세요.',
  '이미 있는 기록의 존재 여부를 되묻지 마세요. 진료에서 의료진과 확인할 의미, 관찰할 변화, 다음 방문까지 준비할 기록을 물어보세요.',
  '추가 검색이 필요하면 type=request_evidence와 need=missing_coverage 응답 형식을 사용하세요.',
  '결과는 지정된 JSON 형식만 사용하세요.',
].join('\n');
