import { Alert } from 'react-native';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { openSqliteTestDatabase } from '../../../packages/storage/__tests__/sqliteTestDatabase';
import { DailyReportRestartProbe } from '../e2e/DailyReportRestartProbe';
import { createDailyReportRestartSession } from '../e2e/dailyReportRestartSession';

// The same opt-in native fixture renders the actual card/Alert callback and coordinator.
// SQLite is real; lease events and model responses are synthetic, never remote execution.
test.each(['confirm', 'changed-day', 'route-cancel'] as const)(
  'explicit daily replacement respects %s',
  async boundary => {
    const db = openSqliteTestDatabase(':memory:');
    const session = await createDailyReportRestartSession(db.database);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const view = await render(<DailyReportRestartProbe session={session} />);
    try {
      expect(session.snapshot().runs).toBe(0);
      await fireEvent.press(screen.getByText('Start synthetic report'));
      await waitFor(() =>
        expect(JSON.stringify(session.snapshot())).toContain('"waiting":true'),
      );
      await fireEvent.press(screen.getByText('Interrupt synthetic model'));
      await waitFor(() => expect(screen.getByText('다시 요청')).toBeTruthy());
      expect(session.snapshot()).toMatchObject({
        runs: 1,
        send: 1,
        scopePreserved: true,
      });
      const before = session.snapshot();
      await fireEvent.press(screen.getByText('다시 요청'));
      expect(alert.mock.calls.at(-1)?.[1]).toContain('추가 API 비용');
      await act(async () => {
        alert.mock.calls.at(-1)?.[2]?.[0]?.onPress?.();
      });
      expect(session.snapshot()).toEqual(before);
      await fireEvent.press(screen.getByText('다시 요청'));
      if (boundary === 'changed-day')
        await fireEvent.press(screen.getByText('Select next synthetic day'));
      if (boundary === 'route-cancel')
        await fireEvent.press(screen.getByText('Leave synthetic route'));
      await act(async () => {
        const confirm = alert.mock.calls.at(-1)?.[2]?.[1]?.onPress;
        confirm?.();
        confirm?.();
      });
      await waitFor(() =>
        expect(session.snapshot().runs).toBe(boundary === 'confirm' ? 2 : 1),
      );
      if (boundary === 'confirm')
        await waitFor(() => expect(session.snapshot().settled).toBe(2));
      expect(session.snapshot().scopePreserved).toBe(true);
      expect(session.snapshot().report - before.report).toBe(
        boundary === 'confirm' ? 1 : 0,
      );
      expect(session.snapshot().opening - before.opening).toBe(
        boundary === 'confirm' ? 1 : 0,
      );
    } finally {
      await view.unmount();
      session.dispose();
      alert.mockRestore();
      db.close();
    }
  },
);
