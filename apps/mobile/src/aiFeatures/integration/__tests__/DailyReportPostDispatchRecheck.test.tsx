import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { dailyReportCalendarInterval } from '@orot/domain';
import { t } from '../../../i18n';
import { DailyReportRoute } from '../DailyReportRoute';
import { todayIdentity } from '../dailyReportTodayIdentity';
import type { createDailyReportFeature } from '../dailyReportFeature';

type Feature = ReturnType<typeof createDailyReportFeature>;
type Lookup = Awaited<ReturnType<Feature['lookup']>>;
type Saved = Extract<Lookup, { status: 'saved' }>;
type Result = Awaited<
  Extract<ReturnType<Feature['start']>, { status: 'started' }>['result']
>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

test.each(['attached', 'explicit', 'cancelled'] as const)(
  'preserves the exact saved revision after a %s report operation',
  async path => {
    const identity = todayIdentity()!;
    const interval = dailyReportCalendarInterval(
      identity.localDate,
      identity.timeZone,
    );
    if (!interval) throw new Error('Expected the current civil day to exist.');
    const generationCutoff = new Date(
      Date.parse(interval.fromInclusive) + 120_000,
    ).toISOString();
    const generatedAt = new Date(
      Date.parse(generationCutoff) + 60_000,
    ).toISOString();
    const reference = {
      source: 'health_observation',
      recordId: 'synthetic-source',
    };
    const revision = 'synthetic-record-revision';
    const saved: Saved = {
      status: 'saved',
      runId: 'previous',
      revision: 3,
      context: {
        kind: 'daily_report_context',
        schemaVersion: 1,
        identity,
        interval,
        generationCutoff,
        effectiveCutoff: generationCutoff,
        sourceSnapshot: {
          revision: 'synthetic-snapshot-revision',
          mutationGeneration: 1,
          deletionGeneration: 0,
          records: [
            {
              ...reference,
              revision,
              occurrence: { startInclusive: interval.fromInclusive },
              ingestedAt: interval.fromInclusive,
            },
          ],
          coverage: [],
        },
        provider: {
          providerId: 'synthetic-provider',
          modelId: 'synthetic-model',
        },
      },
      lineage: [
        {
          ...reference,
          kind: 'health_observation',
          localId: reference.recordId,
          revision,
        },
      ],
      report: {
        schemaVersion: 1,
        identity,
        generatedAt,
        observations: [
          { text: '보존된 합성 기록', sourceReferences: [reference] },
        ],
        supportedContext: [],
        followUpQuestions: [],
        coverage: [],
      },
    };
    const result = deferred<Result>();
    const recheck = deferred<Lookup>();
    const operation = {
      status: 'started' as const,
      cancel: jest.fn(),
      result: result.promise,
    };
    const lookup = jest
      .fn()
      .mockResolvedValueOnce(saved)
      .mockReturnValue(recheck.promise);
    const preview = jest.fn(async () => ({ status: 'not_today' as const }));
    const start = jest.fn(() => operation);
    const feature = {
      lookup,
      preview,
      start,
      active: jest.fn(() => null),
      retain: jest.fn(() => () => {}),
    } as unknown as Feature;
    await render(
      <DailyReportRoute
        feature={feature}
        initialIdentity={identity}
        initialOperation={path === 'explicit' ? undefined : operation}
        expectedReport={{ identity, runId: 'previous', revision: 3 }}
        providerSelection={null}
        onBack={jest.fn()}
        onChat={jest.fn()}
      />,
    );

    await screen.findByText('저장된 버전 3');
    expect(start).not.toHaveBeenCalled();
    if (path === 'explicit') {
      await fireEvent.press(screen.getByText('다시 요약하기'));
      expect(start).toHaveBeenCalledWith(identity, {
        kind: 'revise',
        expectedRunId: 'previous',
      });
    }

    await act(async () => {
      result.resolve({
        status: 'failed',
        code:
          path === 'cancelled'
            ? 'cancelled'
            : 'source_unconfirmed_after_dispatch',
      });
    });
    if (path === 'cancelled') {
      await screen.findByText('보고서 생성을 취소했어요.');
      expect(screen.getByText('저장된 버전 3')).toBeTruthy();
      expect(lookup).toHaveBeenCalledTimes(1);
      expect(preview).toHaveBeenCalledTimes(1);
    } else {
      await screen.findByText(t('dailyReport.failure.retryCurrent'));
      await waitFor(() => expect(lookup).toHaveBeenCalledTimes(2));
      expect(lookup).toHaveBeenNthCalledWith(2, identity);
      expect(preview).toHaveBeenCalledTimes(2);
      expect(screen.queryByText('저장된 버전 3')).toBeNull();
      await act(async () => {
        recheck.resolve(saved);
      });
      await screen.findByText('저장된 버전 3');
    }
    await fireEvent.press(screen.getByText('근거 기록 보기'));
    expect(screen.getByText('보존된 합성 기록')).toBeTruthy();
    expect(start).toHaveBeenCalledTimes(path === 'explicit' ? 1 : 0);
  },
);
