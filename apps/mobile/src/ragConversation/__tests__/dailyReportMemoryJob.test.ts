import type { SqlDatabase } from '@orot/storage';
import { AppState } from 'react-native';
import {
  captureDailyReportMemoryTap,
  publishDailyReportMemoryTap,
} from '../../storage/dailyReportMemoryTap';
import {
  dailyReportMemoryTapFor,
  stageDailyReportMemory,
  startDisplayedDailyReportMemory,
} from '../conversationDailyReportMemoryJobs';
import { createConversationSessions } from '../conversationSessions';
import type { PendingTurn } from '../conversationSessionTypes';
import { startConversationReportTurn } from '../startConversationReportTurn';

test('a held or failing optional writer cannot block display and cannot duplicate', async () => {
  jest.useFakeTimers();
  try {
    const request = { committed: true } as PendingTurn;
    let release!: () => void;
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    const observations: string[] = [];
    let current: (() => boolean) | undefined;
    const write = jest.fn(async (owns: () => boolean) => {
      current = owns;
      observations.push('writer started');
      await held;
      if (owns()) observations.push('commit');
      return owns();
    });
    stageDailyReportMemory(request, write);
    expect(write).not.toHaveBeenCalled();
    observations.push('answer published');
    startDisplayedDailyReportMemory(request);
    startDisplayedDailyReportMemory(request);
    expect(observations).toEqual(['answer published']);
    await jest.advanceTimersByTimeAsync(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(current?.()).toBe(true);
    expect(observations).toEqual(['answer published', 'writer started']);
    await jest.advanceTimersByTimeAsync(30_000);
    release();
    await Promise.resolve();
    expect(current?.()).toBe(false);
    expect(observations).not.toContain('commit');
  } finally {
    jest.useRealTimers();
  }
});

test('granting during a held direct send cannot authorize the old tap', async () => {
  const previous = AppState.currentState;
  AppState.currentState = 'active';
  const store = createConversationSessions();
  const tap = {
    database: {} as SqlDatabase,
    sqlGeneration: 1,
    deviceGeneration: 'synthetic',
    current: () => true,
  };
  const captures: unknown[] = [];
  const send: Parameters<typeof startConversationReportTurn>[2] = async (
    _text,
    _history,
    _signal,
    observer,
  ) => {
    captures.push(dailyReportMemoryTapFor(observer));
    return { status: 'answer', answer: 'Synthetic', citations: [] };
  };
  try {
    publishDailyReportMemoryTap();
    const earlier = startConversationReportTurn(
      store,
      () => true,
      send,
      undefined,
      'direct-user-tap',
    );
    // The conversation adapter has not yet dispatched under the old tap.
    expect(captures).toEqual([]);
    publishDailyReportMemoryTap(tap);
    await earlier;
    expect(captures).toEqual([undefined]);
    const verifiedTap = captureDailyReportMemoryTap();
    expect(verifiedTap).toMatchObject({ sqlGeneration: tap.sqlGeneration });
    await startConversationReportTurn(
      store,
      () => true,
      send,
      undefined,
      'direct-user-tap',
    );
    expect(captures).toEqual([undefined, verifiedTap]);
    publishDailyReportMemoryTap();
    expect(verifiedTap?.current()).toBe(false);
  } finally {
    publishDailyReportMemoryTap();
    AppState.currentState = previous;
    store.dispose();
  }
});
