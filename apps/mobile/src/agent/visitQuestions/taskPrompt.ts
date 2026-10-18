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
        '환자가 의사에게 할 질문 한 문장. 예: 이 변화와 함께 관찰할 증상은 무엇인가요? 또는 복용 후 어떤 변화를 기록하면 좋을까요? 수치, 용량, 날짜는 반복하지 말고 물음표 하나로 끝내세요.',
    },
    rationale: {
      type: 'string',
      minLength: 2,
      maxLength: 400,
      description:
        '질문이 필요한 이유를 30자 안팎의 한국어 한 문장으로 쓰세요. 수치, 용량, 날짜와 근거 ID는 반복하지 마세요.',
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
  '환자가 다음 외래 진료에서 의사에게 물어볼 질문 3개를 작성하세요.',
  '질문의 목적은 기록을 확인했는지 묻는 것이 아니라, 앞으로 무엇을 관찰하고 기록할지 의료진에게 도움을 구하는 것입니다.',
  '질문 문체 예시: 이 변화와 함께 관찰할 증상은 무엇인가요? 복용 후 어떤 변화를 기록하면 좋을까요? 측정값의 변화를 어떻게 기록하면 좋을까요?',
  '예시는 문체 참고이며 환자의 실제 기록은 아닙니다. 각 질문의 주제는 인용하는 기록에서 선택하세요.',
  '제공된 예약 정보와 근거 안에서만 작성하고, 근거에 없는 사실은 만들지 마세요.',
  '근거는 관련도순으로 고른 일부 기록입니다. 전체 병력이나 복용 목록이라고 단정하거나 검색에서 빠진 사실이 없다고 추론하지 마세요.',
  '병명을 추정하거나 진단하지 말고, 치료 지시나 약의 시작·중단·용량 변경을 권하지 마세요.',
  '불확실한 내용은 단정하지 말고, 확인할 수 있도록 의료진에게 묻는 질문으로 바꾸세요.',
  '기록 사이에 중요한 충돌이 있거나 근거가 부족하면 질문을 만들지 말고 확인이 필요한 내용을 요청하세요.',
  '각 질문은 짧은 한국어 의문문으로 쓰고 물음표 하나로 끝내세요. 확인했나요 또는 반영되었나요 같은 과거 사실 확인 질문은 쓰지 마세요.',
  'questionText는 40자 안팎, rationale은 30자 안팎의 한 문장으로 쓰세요. 근거 ID는 evidenceIds와 citations에만 쓰고 본문이나 이유에 넣지 마세요.',
  'questionText와 rationale에는 수치, 용량, 날짜를 반복하지 마세요. 복용 기록, 수면 변화, 측정값의 변화처럼 기록의 주제를 쓰세요. 정확한 수치는 사용자가 인용 원문에서 확인할 수 있습니다.',
  '각 질문에는 제공된 evidenceId 중 실제로 뒷받침하는 ID를 1~3개 연결하세요.',
  '근거가 아직 없거나 부족하면 제공된 로컬 검색 도구를 호출해 필요한 기록을 조회하세요. 검색하지 않은 상태를 검색 결과가 없는 상태로 해석하지 마세요.',
  '기록에 중요한 충돌이 이미 보이면 추가 검색으로 임의 선택하지 말고 needs_clarification 형식으로 확인을 요청하세요.',
  '최종 답변은 type=result, value, citations 필드를 가진 응답 형식으로 작성하세요.',
  'citations에는 실제 질문에서 사용한 evidenceIds의 합집합만 중복 없이 쓰세요. 사용하지 않은 ID는 빼세요.',
  '이미 있는 기록의 존재 여부를 되묻지 마세요. 진료에서 의료진과 확인할 의미, 관찰할 변화, 다음 방문까지 준비할 기록을 물어보세요.',
  '추가 근거가 필요하면 검색 도구를 호출하고, 반환된 결과를 확인한 뒤 답하세요.',
  '결과는 지정된 JSON 형식만 사용하세요.',
].join('\n');
