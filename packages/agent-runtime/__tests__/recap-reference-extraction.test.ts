import { providerSuccess } from '@orot/model-runtime';
import { extractTranscriptRecap } from '../src/recap/extract';
import { extractionFixture, recapInput } from './recap-fixtures';

it('derives quotations from selected source units without asking the model for offsets', async () => {
  const input = recapInput('이 약 계속 먹나요? 네, 그대로 드세요.');
  const { options, generate } = extractionFixture(input);
  options.provider = {
    ...options.provider,
    capabilities: { ...options.provider.capabilities, structuredOutput: false },
  };
  generate.mockImplementation(async (request) => {
    const payload = JSON.parse(String(request.messages[1].content));
    const output = {
      requestRef: payload.requestRef,
      items: [
        {
          kind: 'question',
          preparedQuestionRef: payload.questions[0].preparedQuestionRef,
          status: 'evidence_found',
          speechRefs: [payload.transcript[0].speechRef],
        },
        {
          kind: 'answer',
          preparedQuestionRef: payload.questions[0].preparedQuestionRef,
          speechRefs: [payload.transcript[1].speechRef],
          utteranceRole: 'response',
          association: 'clear',
          summary: '그대로 복용하라는 응답',
          inferredRole: 'uncertain',
          speakerUncertainty: '발화자 미확인',
        },
      ],
    };
    return providerSuccess({
      text: JSON.stringify(output),
      toolCalls: [],
      finishReason: 'complete',
    });
  });
  const result = await extractTranscriptRecap({ ...options, evidenceMode: 'references' });
  const firstRequestRef = JSON.parse(
    String(generate.mock.calls[0][0].messages[1].content),
  ).requestRef;
  await extractTranscriptRecap({ ...options, evidenceMode: 'references' });
  const secondRequestRef = JSON.parse(
    String(generate.mock.calls[1][0].messages[1].content),
  ).requestRef;
  expect(firstRequestRef).not.toBe(secondRequestRef);
  expect(firstRequestRef.length).toBeLessThan(50);
  expect(result).toMatchObject({
    status: 'result',
    value: {
      questions: [
        {
          status: 'evidence_found',
          answers: [{ quotation: ' 네, 그대로 드세요.', speaker: 'unknown' }],
        },
      ],
    },
  });
});
