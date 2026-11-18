import { fixture } from '../../../agent/execution/testSupport/dailyRecoveryOwnerFixture';
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from '@testing-library/react-native';
import { DailyReportLocalRecovery } from '../DailyReportLocalRecovery';
import { createDailyReportRecoveryActions } from '../dailyReportRecoveryActions';
import { createDailyReportRecoveryBridge } from '../dailyReportRecoveryBridge';
import type { createDailyReportFeature } from '../dailyReportFeature';
import type { SqlDatabase } from '@orot/storage';

test.each([
  'double press',
  'cancel',
  'new day',
  'unmount',
  'commit then cancel',
] as const)(
  'actual UI and actions preserve local-only save ownership during SQL read: %s',
  async mode => {
    const f = await fixture();
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let paused = false;
    let wait = false;
    const db: SqlDatabase = {
      execute: (q, p) => f.db.database.execute(q, p),
      transaction: async operation => {
        let saved = false;
        await f.db.database.transaction(tx =>
          operation({
            ...tx,
            execute: async (q, p) => {
              if (
                wait &&
                q.startsWith('SELECT candidate_json FROM daily_report_pending')
              ) {
                wait = false;
                paused = true;
                await gate;
              }
              if (q.startsWith('INSERT INTO daily_report_revisions'))
                saved = true;
              return tx.execute(q, p);
            },
          }),
        );
        if (mode === 'commit then cancel' && saved) {
          // The durable commit has completed, but its result has not reached the UI.
          paused = true;
          await gate;
        }
      },
    };
    const identity = f.candidate.context.identity;
    const actions = createDailyReportRecoveryActions({
      database: async () => db,
      currentIdentity: () => identity,
    });
    const resume = jest.spyOn(actions, 'resumeRecovery');
    const feature = actions as unknown as ReturnType<
      typeof createDailyReportFeature
    >;
    const onSaved = jest.fn(),
      onBusy = jest.fn();
    let view: Awaited<ReturnType<typeof render>> | undefined;
    try {
      expect(
        await createDailyReportRecoveryBridge(db)(
          f.candidate,
          f.scope.current().window,
          f.candidate.runId,
          new AbortController().signal,
        ),
      ).toBe(true);
      view = await render(
        <DailyReportLocalRecovery
          feature={feature}
          identity={identity}
          busy={false}
          revision={0}
          onBusy={onBusy}
          onSaved={onSaved}
        />,
      );
      const button = await screen.findByText('2035-01-01 보고서 저장 재개');
      expect(resume).not.toHaveBeenCalled();
      wait = mode !== 'commit then cancel';
      await fireEvent.press(button);
      if (mode === 'double press') await fireEvent.press(button);
      await waitFor(() => expect(paused).toBe(true));
      expect(resume).toHaveBeenCalledTimes(1);
      if (mode === 'cancel' || mode === 'commit then cancel')
        await fireEvent.press(screen.getByText('저장 재개 취소'));
      if (mode === 'new day')
        await view.rerender(
          <DailyReportLocalRecovery
            feature={feature}
            identity={{ ...identity, key: 'new-day' }}
            busy={true}
            revision={0}
            onBusy={onBusy}
            onSaved={onSaved}
          />,
        );
      if (mode === 'unmount') {
        await view.unmount();
        view = undefined;
      }
      await act(async () => {
        release();
        await resume.mock.results[0]!.value;
      });
      expect(onSaved).toHaveBeenCalledTimes(mode === 'double press' ? 1 : 0);
      expect(
        (await db.execute('SELECT run_id FROM daily_report_revisions')).rows,
      ).toHaveLength(
        mode === 'double press' || mode === 'commit then cancel' ? 1 : 0,
      );
      if (mode === 'commit then cancel') {
        expect(screen.queryByText('취소됨')).toBeNull();
        expect(screen.queryByText('저장하지 않았어요')).toBeNull();
      }
      if (mode !== 'double press')
        expect(
          await actions.pendingRecovery(identity, new AbortController().signal),
        ).toEqual([]);
    } finally {
      release();
      await view?.unmount();
      f.db.close();
    }
  },
);
