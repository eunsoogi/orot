import { classifyCalendarEvents } from '../../medicalAppointments/classificationWorkflow';
import {
  input,
  event,
} from '../../medicalAppointments/classificationWorkflowTestFixtures';
import { NativeModules } from 'react-native';
import { createCalendarDecisionsOption } from '../decisionsProvider';
import { createAppointmentClassificationTask } from '../../medicalAppointments/classificationTask';
import { voiceSettingsStore } from '../../voiceSettings/voiceSettingsStore';
import type { LanguageModelRequest } from '@orot/model-runtime';
jest.mock('../../voiceSettings/voiceSettingsStore', () => ({
  voiceSettingsStore: {
    classificationCredentials: jest.fn(async () => 'synthetic-key'),
    accountStatus: jest.fn(async () => ({ connected: true, revision: 7 })),
    accountRevisionMatches: jest.fn(() => true),
    subscribe: jest.fn(() => jest.fn()),
  },
}));
const candidate = {
  candidateId: 'calendar-candidate-1',
  event: {
    candidateId: 'calendar-candidate-1',
    title: 'Synthetic clinic',
    startsAt: '2026-11-18T10:00:00Z',
    endsAt: '2026-11-18T11:00:00Z',
    isAllDay: false,
    timeZone: 'UTC',
  },
};
const request: LanguageModelRequest = {
  messages: [
    { role: 'system', content: 'Calendar classification task' },
    {
      role: 'user',
      content: JSON.stringify({
        request:
          'Classify every Calendar candidate in this batch for medical appointment relevance.',
        candidates: [candidate],
      }),
    },
    {
      role: 'user',
      content:
        'Allowed citation references (return citations as their evidenceId strings; do not invent IDs):\n["calendar-candidate-1"]',
    },
  ],
  responseFormat: {
    name: 'task_response',
    schema: {
      properties: {
        value: createAppointmentClassificationTask(['calendar-candidate-1'])
          .resultSchema,
      },
    },
  },
};
const post = jest.fn();
const cancel = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  NativeModules.CalendarDecisionsTransport = { post, cancel };
  post.mockResolvedValue(
    JSON.stringify({
      model: 'gpt-6-luna',
      answers: [
        { type: 'choice', name: 'calendar-candidate-1', choice: 'medical_low' },
      ],
    }),
  );
  jest
    .mocked(voiceSettingsStore.accountStatus)
    .mockResolvedValue({ connected: true, revision: 7 });
  jest.mocked(voiceSettingsStore.accountRevisionMatches).mockReturnValue(true);
});
it('returns the existing cited runtime envelope without tool or streaming claims', async () => {
  const option = createCalendarDecisionsOption('gpt-6-luna', 7);
  expect(option.displayName).toBe('Decisions · GPT-6 Luna');
  expect(option.modelId).toBe('gpt-6-luna');
  expect(option.provider.id).toBe('openai-api-decisions');
  expect(option.provider.capabilities).toMatchObject({
    toolCalling: false,
    streaming: false,
    structuredOutput: true,
  });
  expect(await option.provider.generate(request)).toMatchObject({
    ok: true,
    value: {
      structuredOutput: { type: 'result', citations: ['calendar-candidate-1'] },
    },
  });
  expect(post).toHaveBeenCalledWith(
    expect.any(String),
    'synthetic-key',
    expect.stringMatching(/^calendar-decisions-/),
  );
});
it('rejects generic messages before reading credentials or posting evidence', async () => {
  expect(
    (
      await createCalendarDecisionsOption('gpt-6-luna', 7).provider.generate({
        messages: [{ role: 'user', content: 'chat instead' }],
      })
    ).ok,
  ).toBe(false);
  expect(post).not.toHaveBeenCalled();
  expect(voiceSettingsStore.classificationCredentials).not.toHaveBeenCalled();
});
it('fences changed accounts and never exposes native error details', async () => {
  jest
    .mocked(voiceSettingsStore.accountStatus)
    .mockResolvedValue({ connected: true, revision: 8 });
  expect(
    (
      await createCalendarDecisionsOption('gpt-6-luna', 7).provider.generate(
        request,
      )
    ).ok,
  ).toBe(false);
  post.mockRejectedValue(new Error('secret-and-calendar-title'));
  expect(
    JSON.stringify(
      await createCalendarDecisionsOption('gpt-6-luna', 7).provider.generate(
        request,
      ),
    ),
  ).not.toContain('secret');
});
it('cancels an in-flight native request and rejects its late response', async () => {
  const controller = new AbortController();
  post.mockImplementationOnce(async () => {
    controller.abort();
    return JSON.stringify({ model: 'gpt-6-luna', answers: [] });
  });
  expect(
    (
      await createCalendarDecisionsOption('gpt-6-luna', 7).provider.generate(
        request,
        { signal: controller.signal },
      )
    ).ok,
  ).toBe(false);
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('preserves the real runtime consent and freshness gate before calendar API transmission', async () => {
  const option = createCalendarDecisionsOption('gpt-6-luna', 7);
  const authorize = jest.fn(async () => 'authorized' as const);
  const result = await classifyCalendarEvents(
    input([event(0)], {
      provider: option.provider,
      modelId: option.modelId,
      consent: { authorize },
    }),
  );
  expect(result.status).toBe('complete');
  expect(authorize).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledTimes(1);
  post.mockClear();
  const denied = await classifyCalendarEvents(
    input([event(0)], {
      provider: option.provider,
      modelId: option.modelId,
      consent: { authorize: async () => 'renewal_required' as const },
    }),
  );
  expect(denied.status).toBe('unavailable');
  expect(post).not.toHaveBeenCalled();
});
it('aborts native transport immediately when the credential revision changes', async () => {
  post.mockImplementationOnce(async () => {
    jest
      .mocked(voiceSettingsStore.accountRevisionMatches)
      .mockReturnValue(false);
    jest.mocked(voiceSettingsStore.subscribe).mock.calls.at(-1)![0]();
    return JSON.stringify({
      model: 'gpt-6-luna',
      answers: [
        { type: 'choice', name: 'calendar-candidate-1', choice: 'medical_low' },
      ],
    });
  });
  expect(
    (
      await createCalendarDecisionsOption('gpt-6-luna', 7).provider.generate(
        request,
      )
    ).ok,
  ).toBe(false);
  expect(cancel).toHaveBeenCalledTimes(1);
});
it('does not transmit calendar evidence that changed before runtime validation', async () => {
  const option = createCalendarDecisionsOption('gpt-6-luna', 7);
  const options = input([event(0)], {
    provider: option.provider,
    modelId: option.modelId,
  });
  jest
    .spyOn(options.bridge, 'findEvent')
    .mockResolvedValue({ access: 'fullAccess', event: null });
  expect((await classifyCalendarEvents(options)).status).toBe('unavailable');
  expect(post).not.toHaveBeenCalled();
});
