import { providerSuccess } from '@orot/model-runtime';
import type {
  LanguageModelProvider,
  LanguageModelResponse,
} from '@orot/model-runtime';
import type { RagConversationObserver } from '../../../ragConversation/conversationObserver';
import { proposeConversationTemplate } from '../../../ragConversation/conversationTemplateProposal';
import {
  choice,
  fixture,
  question,
} from '../testSupport/conversationTemplateProposalFixture';
test.each([
  'daily-report',
  'health-summary',
  'possibilities',
  'visit-questions',
  'ordinary',
])(
  'one authorized tool-only proposal preserves the original prompt: %s',
  async intent => {
    const f = fixture(choice({ intent }));
    await expect(proposeConversationTemplate(f.input)).resolves.toEqual({
      intent,
      spent: true,
    });
    expect(f.generate).toHaveBeenCalledTimes(1);
    const [request] = f.generate.mock.calls[0]!;
    expect(
      request.messages.filter(message => message.role !== 'system'),
    ).toEqual([{ role: 'user', content: question }]);
    expect(request.tools).toHaveLength(1);
    expect(f.authorization).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: 'synthetic-selected-recipient',
        allowedScope: { sourceKinds: [] },
        consentScope: expect.objectContaining({
          purpose: 'record_conversation',
        }),
      }),
    );
    expect(f.input.observer.onProviderReceipt).not.toHaveBeenCalled();
    expect(f.input.observer.onTaskStreamEvent).not.toHaveBeenCalled();
  },
);

test.each([
  choice({ intent: 'visit-questions', appointmentId: 'forged' }),
  choice({ intent: 'unsupported' }),
  {
    text: '',
    finishReason: 'tool_calls',
    toolCalls: [
      ...choice({ intent: 'daily-report' }).toolCalls,
      ...choice({ intent: 'visit-questions' }).toolCalls,
    ],
  },
  { text: 'visit-questions', toolCalls: [], finishReason: 'complete' },
] satisfies LanguageModelResponse[])(
  'never accepts non-enum or model-owned targets: %j',
  async response => {
    const f = fixture(response);
    await expect(proposeConversationTemplate(f.input)).resolves.toEqual({
      intent: undefined,
      spent: true,
    });
  },
);

test('denied or retired owners do not dispatch a template proposal', async () => {
  const denied = fixture(choice({ intent: 'visit-questions' }), false);
  await expect(proposeConversationTemplate(denied.input)).resolves.toEqual({
    intent: undefined,
    spent: false,
  });
  expect(denied.generate).not.toHaveBeenCalled();

  const stale = fixture(choice({ intent: 'visit-questions' }));
  stale.current.mockReturnValue(false);
  await expect(
    proposeConversationTemplate(stale.input),
  ).resolves.toBeUndefined();
  expect(stale.input.select).not.toHaveBeenCalled();
  expect(stale.generate).not.toHaveBeenCalled();
});

test('photos and urgent turns never get a second model stage', async () => {
  const f = fixture(choice({ intent: 'daily-report' }));
  const photo = {
    ...f.input,
    observer: {
      ...f.input.observer,
      photoInput: {} as NonNullable<RagConversationObserver['photoInput']>,
    },
  };
  await expect(proposeConversationTemplate(photo)).resolves.toBeUndefined();
  await expect(
    proposeConversationTemplate({ ...f.input, question: '가슴 통증이 심해요' }),
  ).resolves.toBeUndefined();
  expect(f.input.select).not.toHaveBeenCalled();
  expect(f.generate).not.toHaveBeenCalled();
});

test('a late model proposal cannot revive a stopped owner', async () => {
  const f = fixture(choice({ intent: 'visit-questions' }));
  let returned!: (
    result: Awaited<ReturnType<LanguageModelProvider['generate']>>,
  ) => void;
  let started!: () => void;
  const dispatched = new Promise<void>(resolve => {
    started = resolve;
  });
  f.generate.mockImplementationOnce(async () => {
    started();
    return new Promise(resolve => {
      returned = resolve;
    });
  });
  const pending = proposeConversationTemplate(f.input);
  await dispatched;
  f.controller.abort();
  returned(providerSuccess(choice({ intent: 'visit-questions' })));
  await expect(pending).resolves.toEqual({ intent: undefined, spent: true });
  expect(f.generate).toHaveBeenCalledTimes(1);
});

test('a follow-up can route only with typed prior context; no visit contents or identifier are sent', async () => {
  const followup = '이 검사는 어떻게 진행하는지 궁금해. 질문으로 만들어줘.';
  const intent = 'visit-questions-followup';
  const noPrior = fixture(choice({ intent }));
  await expect(
    proposeConversationTemplate({ ...noPrior.input, question: followup }),
  ).resolves.toEqual({
    intent: undefined,
    spent: true,
  });

  const owned = fixture(choice({ intent }));
  owned.input.observer = {
    ...owned.input.observer,
    modelTemplateAdmission: {
      current: owned.current,
      today: null,
      visitFollowup: { appointmentId: 'secret-synthetic-appointment' },
    },
  };
  await expect(
    proposeConversationTemplate({ ...owned.input, question: followup }),
  ).resolves.toEqual({
    intent,
    spent: true,
  });
  const [request] = owned.generate.mock.calls[0]!;
  expect(request.messages.filter(message => message.role !== 'system')).toEqual(
    [{ role: 'user', content: followup }],
  );
  expect(JSON.stringify(request)).toContain(
    'active conversation just completed a Visit Questions template',
  );
  expect(JSON.stringify(request)).not.toContain('secret-synthetic-appointment');
  expect(owned.authorization).toHaveBeenCalledTimes(1);
  expect(owned.authorization).toHaveBeenCalledWith(
    expect.objectContaining({
      allowedScope: { sourceKinds: [] },
      consentScope: expect.objectContaining({ purpose: 'record_conversation' }),
    }),
  );
});
