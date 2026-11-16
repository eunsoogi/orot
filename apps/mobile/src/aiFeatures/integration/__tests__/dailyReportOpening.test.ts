import { providerSuccess } from '@orot/model-runtime';
import { standardSearchFixture } from '../../../../../../packages/agent-runtime/__tests__/multiAgent-standard-search-fixtures';
import {
  generateDailyReportOpening,
  withDailyReportOpening,
} from '../dailyReportOpening';
import type {
  DailyReportRunInput,
  DailyReportServiceRequest,
} from '../dailyReportTypes';
import type { SelectedAiResolution } from '../provider';

/** Synthetic model and review responses: no record content is needed by the opening. */
test.each(['ALLOW', 'DENY'])(
  'report opening %s reuses exact consent and emits only reviewed model text',
  async verdict => {
    const f = standardSearchFixture(true);
    f.provider.generate
      .mockReset()
      .mockResolvedValueOnce(
        providerSuccess({
          text: '오늘의 보고서를 함께 살펴볼게요.',
          toolCalls: [],
          finishReason: 'complete',
        }),
      )
      .mockResolvedValueOnce(
        providerSuccess({
          text: verdict,
          toolCalls: [],
          finishReason: 'complete',
        }),
      );
    const authorize = jest.fn(async () => 'authorized' as const);
    const onTaskStreamEvent = jest.fn();
    const selected = {
      status: 'ready',
      provider: f.provider,
      modelId: f.options.execution.modelId,
      recipient: f.options.execution.recipient,
      remoteProcessing: true,
    } as unknown as Extract<SelectedAiResolution, { status: 'ready' }>;
    const request = {
      signal: new AbortController().signal,
      observer: { onTaskStreamEvent },
    } as unknown as DailyReportServiceRequest;
    const events: string[] = [];
    const run = jest.fn(async () => {
      events.push('main-start');
      return 'final';
    });
    const result = await withDailyReportOpening(
      { consent: { authorize } } as unknown as DailyReportRunInput,
      request,
      selected,
      false,
      run,
    );
    expect(result).toBe('final');
    expect(run).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['main-start']);
    expect(f.provider.generate).toHaveBeenCalledTimes(2);
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(onTaskStreamEvent).toHaveBeenCalledTimes(
      verdict === 'ALLOW' ? 1 : 0,
    );
    if (verdict === 'ALLOW')
      expect(onTaskStreamEvent.mock.calls[0]![0]).toMatchObject({
        type: 'initial_response',
        text: '오늘의 보고서를 함께 살펴볼게요.',
      });
    for (const [authorization] of authorize.mock.calls as unknown as [
      { payload: unknown; consentScope: unknown; allowedScope: unknown },
    ][]) {
      expect(authorization.consentScope).toEqual({
        purpose: 'daily_report',
        dataCategories: ['health_records'],
        policyVersion: 'daily-report-analysis-v2',
      });
      expect(authorization.allowedScope).toEqual({
        sourceKinds: ['personal_record'],
      });
      expect(JSON.stringify(authorization.payload)).not.toContain(
        'synthetic secret health record',
      );
    }
    expect(f.search).not.toHaveBeenCalled();
  },
);

test('lookup-only or stopped report runs make no opening calls', async () => {
  const f = standardSearchFixture(true);
  const controller = new AbortController();
  const input = {} as unknown as DailyReportRunInput;
  const selected = {
    status: 'ready',
    provider: f.provider,
  } as unknown as Extract<SelectedAiResolution, { status: 'ready' }>;
  await generateDailyReportOpening(
    input,
    { signal: controller.signal } as unknown as DailyReportServiceRequest,
    selected,
    false,
  );
  controller.abort();
  await generateDailyReportOpening(
    input,
    {
      signal: controller.signal,
      observer: { onTaskStreamEvent: jest.fn() },
    } as unknown as DailyReportServiceRequest,
    selected,
    false,
  );
  expect(f.provider.generate).not.toHaveBeenCalled();
});
