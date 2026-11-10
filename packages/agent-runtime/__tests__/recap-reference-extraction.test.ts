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
      recordingSourceId: input.recordingSourceId,
      appointmentId: input.appointmentId,
      chunkIndex: payload.chunkIndex,
      questions: [
        {
          questionId: input.questions[0].id,
          status: 'evidence_found',
          questionSufficiency: 'complete',
          questionRefs: [payload.transcript[0].ref],
          answers: [
            {
              refs: [payload.transcript[1].ref],
              utteranceRole: 'response',
              association: 'clear',
              summary: '그대로 복용하라는 응답',
              inferredRole: 'uncertain',
              speakerUncertainty: '발화자 미확인',
            },
          ],
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
