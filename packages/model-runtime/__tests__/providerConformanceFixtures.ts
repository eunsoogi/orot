import type {
  LanguageModelRequest,
  LanguageModelResponse,
  ToolCall,
  ToolDefinition,
} from '../src/contracts';

// Keep provider fixtures synthetic so provenance tests never depend on patient records.
export const visitQuestionText = '선생님, 최근 수면 변화에 관해 무엇을 확인하면 좋을까요?';

export const visitQuestionOutput = {
  question: { text: visitQuestionText },
  source: { id: 'synthetic-source-42' },
} as const;

export const completionResponse: LanguageModelResponse = {
  text: visitQuestionText,
  toolCalls: [],
  finishReason: 'complete',
};

export const structuredOutputResponse: LanguageModelResponse = {
  text: JSON.stringify(visitQuestionOutput),
  structuredOutput: visitQuestionOutput,
  toolCalls: [],
  finishReason: 'complete',
};

export const visitQuestionToolCall: ToolCall = {
  id: 'tool-call-synthetic-1',
  name: 'lookup_source',
  arguments: { sourceId: 'synthetic-source-42' },
};

export const toolCallResponse: LanguageModelResponse = {
  text: '',
  toolCalls: [visitQuestionToolCall],
  finishReason: 'tool_calls',
};

export const completionRequest: LanguageModelRequest = {
  messages: [
    {
      role: 'user',
      content:
        '실습용 기록 synthetic-source-42를 바탕으로 다음 진료에서 물어볼 질문을 제안해 주세요.',
    },
  ],
};

export const structuredOutputRequest: LanguageModelRequest = {
  ...completionRequest,
  responseFormat: {
    name: 'visit_question',
    schema: {
      type: 'object',
      properties: {
        question: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
          additionalProperties: false,
        },
        source: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
          additionalProperties: false,
        },
      },
      required: ['question', 'source'],
      additionalProperties: false,
    },
  },
};

export const visitQuestionTool: ToolDefinition = {
  name: 'lookup_source',
  description: 'Look up one synthetic source.',
  inputSchema: {
    type: 'object',
    properties: { sourceId: { type: 'string' } },
    required: ['sourceId'],
    additionalProperties: false,
  },
};

export const toolCallRequest: LanguageModelRequest = {
  ...completionRequest,
  tools: [visitQuestionTool],
};

export const unsupportedImageRequest: LanguageModelRequest = {
  messages: [
    {
      role: 'user',
      content: [{ type: 'image', data: new Uint8Array([1]), mediaType: 'image/png' }],
    },
  ],
};
