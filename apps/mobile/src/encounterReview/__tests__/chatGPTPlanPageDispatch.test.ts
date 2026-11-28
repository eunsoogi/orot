import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import { bindChatGPTPlanPageDispatch } from '../chatGPTPlanPageDispatch';

function fixture() {
  const controller = new AbortController();
  let valid = true;
  let resolve: (value: { text: string }) => void = () => {};
  const terminal = new Promise<{ text: string }>(done => {
    resolve = done;
  });
  const stop = jest.fn();
  const submit = jest.fn(() => ({ stop, terminal }));
  const prepare = jest.fn(async () => ({
    cancel: stop,
    admitAndSubmit: submit,
  }));
  const authorize = jest.fn(async () => 'authorized' as const);
  const r: OutboundProcessingRequest = {
    operationRunId: 'generated:page:8',
    providerId: 'synthetic-plan',
    modelId: 'selected',
    recipient: 'generated-recipient',
    remoteProcessing: true,
    allowedScope: {
      sourceKinds: ['personal_record'],
      sourceIds: ['recording'],
    },
    consentScope: {
      purpose: 'encounter_transcript_review',
      dataCategories: ['selected_recording_transcript'],
      policyVersion: 'single-recording-v1',
    },
    payload: {
      messages: [
        { role: 'system', content: 'instruction' },
        { role: 'user', content: 'last generated segment' },
        { role: 'user', content: 'citations' },
        { role: 'user', content: 'schema' },
      ],
    },
    signal: controller.signal,
  };
  const page = bindChatGPTPlanPageDispatch({
    consent: {
      authorize,
      isAuthorizationCurrent: request => request === r && valid,
      subscribeAuthorizationInvalidation: () => () => {},
    },
    account: 'selected-account',
    model: r.modelId,
    recipient: r.recipient,
    providerId: r.providerId,
    operation: r.operationRunId,
    isCurrent: () => valid,
    native: { prepare },
    transcript: {
      sourceId: 'recording',
      segments: [
        {
          id: 'last-segment',
          transcriptId: 'last-transcript',
          revision: 3,
          text: 'generated',
          effectiveAt: '2026-01-01T00:00:00Z',
          audioRange: { startMs: 0, endMs: 1000 },
        },
      ],
    },
  });
  return {
    page,
    r,
    submit,
    prepare,
    stop,
    authorize,
    resolve,
    controller,
    revoke: () => {
      valid = false;
    },
  };
}

test('consumes a single exact Plan grant and accepts only its current terminal', async () => {
  const f = fixture();
  expect((await f.page.generate(f.r.payload, { signal: f.r.signal })).ok).toBe(
    false,
  );
  expect(await f.page.consent.authorize(f.r)).toBe('authorized');
  expect(f.page.consent.isAuthorizationCurrent?.({ ...f.r })).toBe(false);
  const substituted = {
    ...f.r.payload,
    messages: f.r.payload.messages.map(message => ({
      ...message,
      content: 'substitution',
    })),
  };
  expect((await f.page.generate(substituted, { signal: f.r.signal })).ok).toBe(
    false,
  );
  const result = f.page.generate(f.r.payload, { signal: f.r.signal });
  await Promise.resolve();
  expect(f.submit).toHaveBeenCalledTimes(1);
  expect(f.prepare).toHaveBeenCalledWith(
    expect.objectContaining({
      account: 'selected-account',
      model: 'selected',
      source: 'recording',
      revisions: [{ id: 'last-segment', revision: 3 }],
      wire: expect.objectContaining({ transcript: 'last generated segment' }),
    }),
    expect.anything(),
  );
  expect((await f.page.generate(f.r.payload, { signal: f.r.signal })).ok).toBe(
    false,
  );
  expect(f.authorize).toHaveBeenCalledTimes(1);
  f.resolve({ text: 'generated final' });
  expect(await result).toMatchObject({
    ok: true,
    value: { text: 'generated final' },
  });
});

test.each(['stop', 'retired'] as const)(
  'denies a late terminal after %s',
  async mode => {
    const f = fixture();
    expect(await f.page.consent.authorize(f.r)).toBe('authorized');
    const result = f.page.generate(f.r.payload, { signal: f.r.signal });
    await Promise.resolve();
    if (mode === 'stop') f.controller.abort();
    else f.revoke();
    f.resolve({ text: 'must not appear' });
    expect((await result).ok).toBe(false);
    expect(f.submit).toHaveBeenCalledTimes(1);
    if (mode === 'stop') expect(f.stop).toHaveBeenCalledTimes(1);
  },
);

test('a page revoked while native prepares is cancelled before synchronous submission', async () => {
  const f = fixture();
  let release: () => void = () => {};
  const wait = new Promise<void>(resolve => {
    release = resolve;
  });
  f.prepare.mockImplementationOnce(async () => {
    await wait;
    return { cancel: f.stop, admitAndSubmit: f.submit };
  });
  expect(await f.page.consent.authorize(f.r)).toBe('authorized');
  const result = f.page.generate(f.r.payload, { signal: f.r.signal });
  expect(f.prepare).toHaveBeenCalledTimes(1);
  f.revoke();
  release();
  expect((await result).ok).toBe(false);
  expect(f.stop).toHaveBeenCalledTimes(1);
  expect(f.submit).not.toHaveBeenCalled();
});
