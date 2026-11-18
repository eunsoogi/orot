import {
  render,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react-native';
import { createDailyReportIdentity } from '@orot/domain';
import { openSqliteTestDatabase } from '../../../packages/storage/__tests__/sqliteTestDatabase';
import { createDailyRecoveryNativeSession } from '../e2e/dailyRecoveryNativeSession';
import { DailyRecoveryConsumerProbe } from '../e2e/DailyRecoveryConsumerProbe';
import { DailyReportLocalRecovery } from '../src/aiFeatures/integration/DailyReportLocalRecovery';
import type { ConsentAuthorityState } from '../src/agent/execution/consentAuthority';
import type { ProviderSelection } from '../src/providers/selection/types';

jest.mock('../src/agent/execution/consentGeneration', () => ({
  createConsentGeneration: () => 'b'.repeat(64),
}));
jest.mock('../src/aiFeatures/integration/provider', () => ({
  resolveSelectedAiProvider: () => {
    throw new Error('Provider forbidden');
  },
}));
jest.mock('../src/agent/execution/settingsConsentAuthorization', () => ({
  createSettingsConsentAuthorization: () => {
    throw new Error('Authorize forbidden');
  },
}));

// Real feature actions and component, synthetic protected ports and SQLite.
// The owner is validated normally; no provider/authorize or permissive mock owner.
test.each([
  'save',
  'double press',
  'cancel',
  'route replacement',
  'fixture entry',
] as const)(
  'actual isolated consumer protects explicit local save: %s',
  async mode => {
    const db = openSqliteTestDatabase(':memory:');
    let authority: ConsentAuthorityState | null = null;
    let selection: ProviderSelection | null = null;
    let credential: string | null = null;
    let pause = false,
      paused = false;
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const database: typeof db.database = {
      execute: (q, p) => db.database.execute(q, p),
      transaction: operation =>
        db.database.transaction(tx =>
          operation({
            ...tx,
            execute: async (q, p) => {
              if (
                pause &&
                q.startsWith('SELECT candidate_json FROM daily_report_pending')
              ) {
                pause = false;
                paused = true;
                await gate;
              }
              return tx.execute(q, p);
            },
          }),
        ),
    };
    const store = {
      database,
      authority: () => ({
        read: async () => authority,
        write: async (value: ConsentAuthorityState) => {
          authority = value;
        },
      }),
      selection: () => ({
        load: async () => selection,
        save: async (value: ProviderSelection) => {
          selection = value;
        },
        clear: async () => {
          selection = null;
        },
      }),
      recoveryCredential: {
        read: async () => credential,
        write: async (value: string) => {
          credential = value;
        },
      },
    };

    let view: Awaited<ReturnType<typeof render>> | undefined;
    try {
      await createDailyRecoveryNativeSession(store).stage();
      const restarted = createDailyRecoveryNativeSession(store);
      const identity = createDailyReportIdentity('2035-01-01', 'UTC');
      const actions = restarted.recoveryActions;
      const saved = jest.fn();
      view = await render(
        mode === 'fixture entry' ? (
          <DailyRecoveryConsumerProbe session={restarted} />
        ) : (
          <DailyReportLocalRecovery
            feature={actions}
            identity={identity}
            busy={false}
            revision={0}
            onBusy={() => {}}
            onSaved={saved}
          />
        ),
      );
      const button = await screen.findByText('2035-01-01 보고서 저장 재개');
      expect(await restarted.inspect()).toMatchObject({
        pendingCount: 1,
        savedStatus: 'missing',
      });
      expect(saved).not.toHaveBeenCalled();
      pause = true;
      await fireEvent.press(button);
      await waitFor(() => expect(paused).toBe(true));
      if (mode === 'double press') await fireEvent.press(button);
      if (mode === 'cancel')
        await fireEvent.press(screen.getByText('저장 재개 취소'));
      if (mode === 'route replacement') await view.unmount();
      release();
      if (mode === 'cancel' || mode === 'route replacement') {
        await waitFor(async () =>
          expect(await restarted.inspect()).toMatchObject({
            pendingCount: 0,
            savedStatus: 'missing',
          }),
        );
        expect(saved).not.toHaveBeenCalled();
      } else {
        if (mode === 'fixture entry') {
          await waitFor(() =>
            expect(
              screen.getByTestId('daily-recovery-consumer-status').props
                .children,
            ).toContain('"savedRevision":1'),
          );
        } else await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
        expect(await restarted.inspect()).toMatchObject({
          pendingCount: 0,
          savedStatus: 'saved',
          savedRevision: 1,
        });
      }
      const reopened = createDailyRecoveryNativeSession(store);
      expect(
        await reopened.recoveryActions.pendingRecovery(
          identity,
          new AbortController().signal,
        ),
      ).toEqual([]);
    } finally {
      release();
      await view?.unmount();
      db.close();
    }
  },
);
