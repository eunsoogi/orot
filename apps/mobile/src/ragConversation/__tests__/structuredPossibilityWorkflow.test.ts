import { ragConversationTask } from '../task';
import { parseConversationReport } from '../conversationReportTemplate';
import { runRagConversationTurn } from '../service';
import { fixture, response } from '../testSupport/conversationEnvelopeFixtures';
import {
  answer,
  input,
} from '../testSupport/structuredPossibilityReportFixture';

jest.mock('../../storage/secureDatabase', () => ({
  openLocalStorage: async () => ({
    listDeletedSourceReferenceIds: async () => [],
    get: async () => null,
    hasStoredRecordId: async () => true,
  }),
}));

test.each(['synthetic-evidence', 'missing'])(
  'real runtime validates %s before a structured report reaches the conversation',
  async citation => {
    const f = fixture();
    f.generate.mockReset().mockResolvedValue(
      response({
        type: 'result',
        value: { answerKind: 'grounded', answer },
        citations: [citation],
      }),
    );
    const result = await runRagConversationTurn({
      ...f.options,
      question: input.request,
    });
    if (citation === 'missing') {
      expect(result.status).not.toBe('answer');
      return;
    }
    expect(result.status).toBe('answer');
    if (result.status !== 'answer') throw new Error('Expected report');
    expect(parseConversationReport(result.answer)?.sections).toHaveLength(5);
  },
);

test('one format correction converts prose to a report, never publishes the rejected prose', async () => {
  const f = fixture();
  f.generate
    .mockReset()
    .mockResolvedValueOnce(
      response({
        type: 'result',
        value: {
          answerKind: 'grounded',
          answer: 'Unstructured synthetic answer.',
        },
        citations: ['synthetic-evidence'],
      }),
    )
    .mockResolvedValueOnce(
      response({
        type: 'result',
        value: { answerKind: 'grounded', answer },
        citations: ['synthetic-evidence'],
      }),
    );
  const result = await runRagConversationTurn({
    ...f.options,
    question: input.request,
  });
  expect(f.generate).toHaveBeenCalledTimes(2);
  expect(result.status).toBe('answer');
  if (result.status !== 'answer') throw new Error('Expected report');
  expect(parseConversationReport(result.answer)?.sections).toHaveLength(5);
  expect(result.answer).not.toContain('Unstructured synthetic answer');
});

test('repeated malformed structure fails after one correction; clinical failures do not request formatting repair', async () => {
  const f = fixture();
  f.generate.mockReset().mockResolvedValue(
    response({
      type: 'result',
      value: {
        answerKind: 'grounded',
        answer: 'Unstructured synthetic answer.',
      },
      citations: ['synthetic-evidence'],
    }),
  );
  const result = await runRagConversationTurn({
    ...f.options,
    question: input.request,
  });
  expect(f.generate).toHaveBeenCalledTimes(2);
  expect(result.status).not.toBe('answer');
  expect(
    ragConversationTask.correctionInstructionForInvalidResult!(
      'The answer contained a definitive clinical claim.',
    ),
  ).toBeUndefined();
});

test('cancelled format correction cannot publish a late report', async () => {
  const f = fixture();
  const controller = new AbortController();
  let release!: (value: ReturnType<typeof response>) => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => {
    entered = resolve;
  });
  f.generate
    .mockReset()
    .mockResolvedValueOnce(
      response({
        type: 'result',
        value: {
          answerKind: 'grounded',
          answer: 'Unstructured synthetic answer.',
        },
        citations: ['synthetic-evidence'],
      }),
    )
    .mockImplementationOnce(() => {
      entered();
      return new Promise(resolve => {
        release = resolve;
      });
    });
  const pending = runRagConversationTurn(
    { ...f.options, question: input.request },
    { signal: controller.signal },
  );
  await started;
  controller.abort();
  release(
    response({
      type: 'result',
      value: { answerKind: 'grounded', answer },
      citations: ['synthetic-evidence'],
    }),
  );
  expect((await pending).status).not.toBe('answer');
  expect(f.generate).toHaveBeenCalledTimes(2);
});
