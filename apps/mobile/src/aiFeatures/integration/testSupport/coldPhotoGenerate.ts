import { providerSuccess } from '@orot/model-runtime';

// Deliberately inert result: this fixture observes exact provider invocation counts.
export const coldPhotoGenerate = () =>
  jest.fn(async () =>
    providerSuccess({
      text: JSON.stringify({
        type: 'result',
        value: {
          answerKind: 'conversation',
          answer: '어떤 점이 궁금하신가요?',
        },
        citations: [],
      }),
      finishReason: 'complete' as const,
      toolCalls: [],
    }),
  );
