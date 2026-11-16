import { createDailyReportIdentity } from '@orot/domain';
import { createConversationDailyReport } from '../conversationDailyReport';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';

const identity = createDailyReportIdentity('2035-01-01', 'UTC')!;
function setup() {
  const release = jest.fn();
  const cancel = jest.fn();
  const saved = {
    status: 'saved',
    runId: 'synthetic-report',
    revision: 1,
    context: {
      identity,
      generationCutoff: '2035-01-01T12:00:00Z',
      provider: { providerId: 'local', modelId: 'synthetic' },
    },
    report: {
      coverage: [],
      followUpQuestions: [],
      supportedContext: [{ text: 'Synthetic analysis' }],
      observations: [{ text: 'Synthetic observation' }],
    },
  };
  const feature = {
    retain: jest.fn(() => release),
    start: jest.fn(() => ({
      status: 'started',
      cancel,
      result: Promise.resolve({
        status: 'generated',
        runId: 'synthetic-report',
      }),
    })),
    lookup: jest.fn().mockResolvedValue(saved),
  };
  const sources = jest
    .fn()
    .mockResolvedValue({ status: 'current', sources: [] });
  const run = createConversationDailyReport({
    feature: feature as unknown as Parameters<
      typeof createConversationDailyReport
    >[0]['feature'],
    sources,
    registry: new LocalEvidenceReferenceRegistry(),
  });
  return { run, feature, sources, release, cancel };
}

test('report uses the shared observer and retains its exact revision as an assistant turn', async () => {
  const { run, feature, release } = setup();
  const observer = {
    onRetentionCandidate: jest.fn().mockResolvedValue(undefined),
  };
  const result = await run(
    'Synthetic request',
    identity,
    new AbortController().signal,
    observer,
  );
  expect(feature.start).toHaveBeenCalledWith(
    identity,
    { kind: 'reuse_or_generate' },
    observer,
  );
  expect(result).toMatchObject({
    status: 'answer',
    dailyReport: { identity, runId: 'synthetic-report', revision: 1 },
  });
  if (result.status !== 'answer') throw new Error('Expected answer');
  expect(result.answer).toContain('Synthetic analysis');
  expect(result.answer).toContain('Synthetic observation');
  expect(observer.onRetentionCandidate).toHaveBeenCalledWith(
    expect.objectContaining({
      answer: result.answer,
      dailyReport: result.dailyReport,
    }),
    expect.any(AbortSignal),
  );
  expect(release).toHaveBeenCalledTimes(1);
});

test('changed report lineage never produces a normal answer or retained turn', async () => {
  const { run, sources, release } = setup();
  sources.mockResolvedValue({ status: 'stale' });
  const observer = { onRetentionCandidate: jest.fn() };
  expect(
    await run(
      'Synthetic request',
      identity,
      new AbortController().signal,
      observer,
    ),
  ).toEqual({ status: 'failure', kind: 'stale_evidence' });
  expect(observer.onRetentionCandidate).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalled();
});

test('cancellation stops the owned report and never presents a late result', async () => {
  const { run, feature, cancel, release } = setup();
  let finish!: (value: unknown) => void;
  feature.start.mockReturnValue({
    status: 'started',
    cancel,
    result: new Promise(resolve => {
      finish = resolve;
    }),
  } as never);
  const controller = new AbortController();
  const pending = run('Synthetic request', identity, controller.signal);
  await Promise.resolve();
  controller.abort();
  finish({ status: 'generated', runId: 'synthetic-report' });
  expect(await pending).toEqual({ status: 'failure', kind: 'cancelled' });
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(feature.lookup).toHaveBeenCalledTimes(1);
  expect(release).toHaveBeenCalledTimes(1);
});

test('consent refusal stays a shared conversation failure without lookup or retention', async () => {
  const { run, feature } = setup();
  feature.start.mockReturnValue({
    status: 'started',
    cancel: jest.fn(),
    result: Promise.resolve({ status: 'failed', code: 'consent_required' }),
  } as never);
  const observer = { onRetentionCandidate: jest.fn() };
  expect(
    await run(
      'Synthetic request',
      identity,
      new AbortController().signal,
      observer,
    ),
  ).toEqual({ status: 'failure', kind: 'consent_required' });
  expect(feature.lookup).toHaveBeenCalledTimes(1);
  expect(observer.onRetentionCandidate).not.toHaveBeenCalled();
});

test('a failed turn save is reported without rerunning the report', async () => {
  const { run, feature } = setup();
  const observer = {
    onRetentionCandidate: jest
      .fn()
      .mockRejectedValue(new Error('Synthetic storage failure')),
    onRetentionFailure: jest.fn(),
  };
  expect(
    await run(
      'Synthetic request',
      identity,
      new AbortController().signal,
      observer,
    ),
  ).toMatchObject({ status: 'answer' });
  expect(observer.onRetentionFailure).toHaveBeenCalledTimes(1);
  expect(feature.start).toHaveBeenCalledTimes(1);
});
