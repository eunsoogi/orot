import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { Linking } from 'react-native';
import type { SqlDatabase } from '@orot/storage';
import { openOpSqliteFileQueue } from '../../../test-support/opSqliteFileQueueFixture';
import { createHealthContextTool } from '../../conversationTools/healthContextTool';
import { createHealthContextReader } from '../../healthEvidence/healthContext/reader';
import { ConversationToolEvents } from '../../ragConversation/ConversationToolEvents';
import {
  acquireIndependentReadEpoch,
  guardedNativeDatabase,
} from '../../storage/protectedReadEpoch';
import { readIndependentOverviewSnapshot } from './independentOverviewSnapshot';
import {
  completedLiteratureSource,
  literatureOwner,
  paperTitle,
} from './testSupport/completedLiteratureSourceFixture';
import {
  gate,
  now,
  project,
  readonlyOpen,
  seed,
} from './testSupport/overviewReadOnlySnapshotFixture';

test('a completed literature source can be opened while an independent Overview read publishes during a clean tool hold', async () => {
  const f = openOpSqliteFileQueue();
  const entered = gate();
  const release = gate();
  let armed = false;
  let holding = false;
  const selectedCallSetup: string[] = [];
  let sourceSettled = false;
  let toolResult: Promise<unknown> | undefined;
  let selectionResult: Promise<unknown> | undefined;
  let epoch: ReturnType<typeof acquireIndependentReadEpoch>;
  let view: Awaited<ReturnType<typeof render>> | undefined;
  const stop = new AbortController();
  const browser = jest
    .spyOn(Linking, 'openURL')
    .mockRejectedValue(
      new Error('This fixture does not open external source links'),
    );
  const network = jest
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(
      new Error('This fixture cannot issue a network request'),
    );
  const observeSetup = (sql: string) => {
    if (
      holding &&
      sql.startsWith('CREATE TABLE IF NOT EXISTS tool_period_policy ')
    )
      selectedCallSetup.push('period-table');
    if (
      holding &&
      sql.startsWith('CREATE TRIGGER IF NOT EXISTS tool_period_policy_deleted ')
    )
      selectedCallSetup.push('period-trigger');
  };
  const native = {
    ...f.database,
    execute(sql: string, bindings?: Parameters<SqlDatabase['execute']>[1]) {
      observeSetup(sql);
      return f.database.execute(sql, bindings);
    },
    transaction: (work: Parameters<SqlDatabase['transaction']>[0]) =>
      f.database.transaction(tx =>
        work({
          ...tx,
          async execute(sql, bindings) {
            observeSetup(sql);
            const rows = await tx.execute(sql, bindings);
            // This exact SELECT runs inside the production report transaction
            // after preparation, before any potentially dirty statement.
            if (
              armed &&
              !holding &&
              sql ===
                'SELECT mutations, deletions FROM health_context_generation WHERE singleton = 1'
            ) {
              holding = true;
              entered.release();
              await release.reached;
            }
            return rows;
          },
        }),
      ),
  };
  const database = guardedNativeDatabase(native);
  try {
    await seed(f.database);
    const { event, registry, storage } =
      await completedLiteratureSource(database);
    const call = jest.spyOn(storage, 'readToolCall');
    const resolveSource = jest.fn(registry.resolveToolSource.bind(registry));
    const tool = createHealthContextTool(
      createHealthContextReader(database),
      registry,
      'rag',
    );
    armed = true;
    toolResult = tool.search({
      operationRunId: 'synthetic-new-turn',
      operationKey: 'synthetic-local-read',
      input: {
        topics: ['measurements'],
        window: {
          fromInclusive: '2026-01-01T00:00:00Z',
          toExclusive: now.toISOString(),
          timeZone: 'UTC',
        },
      },
      allowedScope: { sourceKinds: ['personal_record'] },
      resultLimit: 8,
      maxPayloadBytes: 1000000,
      executionLimits: 'unbounded',
      signal: stop.signal,
    });
    await Promise.race([entered.reached, toolResult]);
    expect(holding).toBe(true);
    epoch = acquireIndependentReadEpoch(database);
    expect(epoch?.current()).toBe(true);
    view = await render(
      <ConversationToolEvents
        events={[event]}
        messageId={literatureOwner.messageId}
        durableMessageId={literatureOwner.messageId}
        sessionId={literatureOwner.sessionId}
        resolveToolSource={resolveSource}
        onOpenSource={jest.fn()}
        onLinkError={jest.fn()}
        allowSourceActions
      />,
    );
    await fireEvent.press(
      screen.getByRole('button', { name: '의학 문헌 검색 완료' }),
    );
    await fireEvent.press(
      screen.getByRole('button', { name: '원문 출처 확인 · 공개 의학 문헌' }),
    );
    const sheet = screen.getByTestId('conversation-public-tool-source-sheet');
    expect(within(sheet).getByRole('progressbar')).toBeVisible();
    expect(within(sheet).queryByRole('link')).toBeNull();
    expect(resolveSource).not.toHaveBeenCalled();
    await fireEvent(sheet, 'show');
    expect(resolveSource).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith(
      literatureOwner.sessionId,
      literatureOwner.operationRunId,
      literatureOwner.callId,
      literatureOwner.messageId,
      undefined,
      expect.objectContaining({ aborted: false }),
    );
    selectionResult = resolveSource.mock.results[0]!.value.then(() => {
      sourceSettled = true;
    });

    // Do not make an already-initialized source read dirty the clean writer.
    expect(epoch?.current()).toBe(true);
    epoch?.dispose();
    epoch = acquireIndependentReadEpoch(database);
    expect(epoch?.current()).toBe(true);
    expect(selectedCallSetup).toEqual([]);
    const close = jest.fn();
    const publish = jest.fn(() => expect(close).toHaveBeenCalledTimes(1));
    await expect(
      readIndependentOverviewSnapshot(
        () => readonlyOpen(f.filename, close),
        () => epoch?.current() === true,
        async () => true,
        project,
        publish,
      ),
    ).resolves.toBe('published');
    expect(publish).toHaveBeenCalledWith({
      chart: expect.objectContaining({
        metrics: expect.objectContaining({ heartRate: expect.anything() }),
      }),
      selection: ['sleep', 'heartRate'],
    });
    expect(sourceSettled).toBe(false);
    expect(within(sheet).queryByRole('link')).toBeNull();
    epoch?.dispose();

    await act(async () => {
      release.release();
      await Promise.all([toolResult, selectionResult]);
    });
    const link = await within(sheet).findByRole('link', {
      name: '웹 출처 열기 · ' + paperTitle,
    });
    expect(link).toBeVisible();
    expect(call.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const owned of call.mock.calls) {
      expect(owned.slice(0, 5)).toEqual([
        literatureOwner.sessionId,
        literatureOwner.operationRunId,
        literatureOwner.callId,
        literatureOwner.messageId,
        undefined,
      ]);
      expect(owned[5]?.aborted).toBe(false);
    }
    expect(selectedCallSetup).toEqual([]);
    expect(browser).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  } finally {
    release.release();
    epoch?.dispose();
    stop.abort();
    await act(async () => {
      await view?.unmount();
      await Promise.allSettled([toolResult, selectionResult]);
    });
    jest.restoreAllMocks();
    await f.close();
  }
});
