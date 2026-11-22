import { bindDailyReportMemoryTap } from '../../../ragConversation/conversationDailyReportMemoryJobs';
import type { SqlDatabase } from '@orot/storage';
import { createDailyReportIdentity } from '@orot/domain';
import { createConversationDailyReport } from '../conversationDailyReport';
import type { RagConversationObserver } from '../../../ragConversation/conversationObserver';

type Ports = Parameters<typeof createConversationDailyReport>[0];
const identity = createDailyReportIdentity('2035-01-01', 'UTC');
const target = { identity, runId: 'synthetic-run', revision: 1 };

it.each([
  ['direct, original owner, new commit', true, true, true, false, false, true],
  ['scheduled/restored default', false, true, true, false, false, false],
  ['joined another operation', true, false, true, false, false, false],
  ['lookup found an old report', true, true, true, true, false, false],
  ['storage reused existing run', true, true, false, false, false, false],
  ['artifact failed to commit', true, true, true, false, true, false],
] as const)(
  '%s controls the exact local post-commit callback',
  async (
    _description,
    direct,
    ownsRun,
    fresh,
    existing,
    failedWrite,
    expected,
  ) => {
    const saved = {
      status: 'saved',
      ...target,
      context: {
        identity,
        generationCutoff: '2035-01-01T12:00:00.000Z',
        provider: { providerId: 'synthetic-local', modelId: 'synthetic' },
      },
      report: {
        coverage: [],
        supportedContext: [],
        observations: [],
        followUpQuestions: [],
      },
    };
    const calls: string[] = [];
    const remember = jest.fn(async () => {
      calls.push('bookmark');
      return true;
    });
    const admitDailyReportMemory = jest.fn(() => remember);
    const observer = {
      admitDailyReportMemory,
      onRetentionCandidate: async () => {
        if (failedWrite) throw new Error('Synthetic write failure.');
        calls.push('committed');
      },
    } satisfies RagConversationObserver;
    bindDailyReportMemoryTap(observer, {
      database: {} as SqlDatabase,
      sqlGeneration: 1,
      deviceGeneration: 'synthetic',
      current: () => true,
    });
    const feature = {
      lookup: jest
        .fn()
        .mockResolvedValueOnce(existing ? saved : { status: 'missing' })
        .mockResolvedValue(saved),
      start: () => ({
        status: 'started',
        ...(ownsRun ? { startedByCaller: true } : {}),
        result: Promise.resolve({
          status: 'completed',
          runId: target.runId,
          freshCommit: fresh,
        }),
        cancel: () => {},
      }),
      retain: () => () => {},
    } as unknown as Ports['feature'];
    const report = createConversationDailyReport({
      feature,
      sources: async () => ({ status: 'current', sources: [] }),
      registry: {} as Ports['registry'],
    });
    await expect(
      report(
        'Synthetic request',
        identity,
        new AbortController().signal,
        observer,
        direct,
      ),
    ).resolves.toMatchObject({ status: 'answer', dailyReport: target });
    if (expected) {
      expect(remember).toHaveBeenCalledTimes(1);
      expect(remember).toHaveBeenCalledWith(target);
      expect(calls).toEqual(['committed', 'bookmark']);
    } else {
      expect(remember).not.toHaveBeenCalled();
    }
    expect(admitDailyReportMemory).toHaveBeenCalledTimes(
      direct && !existing ? 1 : 0,
    );
  },
);
