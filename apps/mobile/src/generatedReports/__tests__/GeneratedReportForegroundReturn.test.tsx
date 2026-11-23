import { act, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { NavigationMotionContext } from '../../navigation/NavigationMotionContext';
import { GeneratedReportDetailDestination } from '../GeneratedReportDetailDestination';
import { openGeneratedReportReader } from '../readers';
import type { GeneratedReportDetail, GeneratedReportRow } from '../types';
import {
  notifyLocalDataCleared,
  notifyLocalSourceDeleted,
} from '../../storage/localDataClearEvents';

jest.mock('../readers', () => ({ openGeneratedReportReader: jest.fn() }));

const row: GeneratedReportRow = {
  id: 'synthetic-daily',
  key: 'conversation:syn',
  origin: 'conversation',
  kind: 'daily_report',
  createdAt: '2035-01-03T12:00:00.000Z',
  unavailable: false,
};

function Detail({
  ownership,
}: Pick<Parameters<typeof GeneratedReportDetailDestination>[0], 'ownership'>) {
  return (
    <NavigationMotionContext.Provider value={true}>
      <GeneratedReportDetailDestination
        active
        row={row}
        ownership={ownership}
      />
    </NavigationMotionContext.Provider>
  );
}

function harness() {
  let listener: ((status: AppStateStatus) => void) | undefined;
  const previous = AppState.currentState;
  AppState.currentState = 'active';
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, next) => {
      listener = next;
      return {
        remove: () => {
          listener = undefined;
        },
      };
    });
  const read = jest.fn<
    Promise<GeneratedReportDetail | null>,
    [GeneratedReportRow, AbortSignal]
  >();
  jest.mocked(openGeneratedReportReader).mockResolvedValue({
    list: jest.fn(),
    read,
    readBookmarkedDiseasePossibilities: jest.fn(),
  });
  return {
    read,
    phase: async (phase: AppStateStatus) => {
      await act(() => {
        AppState.currentState = phase;
        listener?.(phase);
      });
    },
    restore: () => {
      AppState.currentState = previous;
      jest.restoreAllMocks();
    },
  };
}

function hold<T>() {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>(done => {
      resolve = done;
    }),
    resolve: (value: T) => resolve(value),
  };
}

test.each(['inactive-only', 'background'] as const)(
  'same exact saved Daily Report renews locally once after %s',
  async mode => {
    const fixture = harness();
    fixture.read.mockResolvedValueOnce({
      paragraphs: ['first protected report'],
    });
    const fresh = hold<GeneratedReportDetail>();
    fixture.read.mockReturnValueOnce(fresh.promise);
    const view = await render(<Detail />);
    try {
      await screen.findByText('first protected report');
      await fixture.phase('inactive');
      if (mode === 'background') await fixture.phase('background');
      expect(fixture.read.mock.calls[0]?.[1].aborted).toBe(true);
      expect(screen.queryByText('first protected report')).toBeNull();
      expect(fixture.read).toHaveBeenCalledTimes(1);
      await fixture.phase('active');
      await waitFor(() => expect(fixture.read).toHaveBeenCalledTimes(2));
      expect(screen.queryByText('현재 열 수 없는 자료예요.')).toBeNull();
      expect(fixture.read.mock.calls[1]?.[0]).toBe(row);
      expect(
        screen.getByTestId('generated-material-detail-loading'),
      ).toBeVisible();
      await fixture.phase('active');
      await act(() =>
        fresh.resolve({ paragraphs: ['renewed protected report'] }),
      );
      expect(await screen.findByText('renewed protected report')).toBeVisible();
      expect(fixture.read).toHaveBeenCalledTimes(2);
    } finally {
      await view.unmount();
      fixture.restore();
    }
  },
);

test.each([
  ['late cancelled read and missing result', undefined],
  ['actual source deletion', notifyLocalSourceDeleted],
  ['actual local clear', notifyLocalDataCleared],
] as const)(
  '%s does not expose old protected material',
  async (_name, revoke) => {
    const fixture = harness();
    const old = hold<GeneratedReportDetail>();
    fixture.read.mockReturnValueOnce(old.promise).mockResolvedValueOnce(null);
    const view = await render(<Detail />);
    try {
      await waitFor(() => expect(fixture.read).toHaveBeenCalledTimes(1));
      await fixture.phase('background');
      expect(fixture.read.mock.calls[0]?.[1].aborted).toBe(true);
      if (revoke) await act(() => revoke());
      await fixture.phase('active');
      if (!revoke)
        await waitFor(() => expect(fixture.read).toHaveBeenCalledTimes(2));
      await act(() =>
        old.resolve({ paragraphs: ['late cancelled protected report'] }),
      );
      expect(
        await screen.findByText('현재 열 수 없는 자료예요.'),
      ).toBeVisible();
      expect(screen.queryByText('late cancelled protected report')).toBeNull();
      expect(fixture.read).toHaveBeenCalledTimes(revoke ? 1 : 2);
    } finally {
      await view.unmount();
      fixture.restore();
    }
  },
);

test('a route that loses ownership while suspended cannot renew on a later active event', async () => {
  const fixture = harness();
  fixture.read.mockResolvedValue({ paragraphs: ['prior synthetic body'] });
  let owned = true;
  let routeChanged: (() => void) | undefined;
  const ownership = {
    isCurrent: () => owned,
    subscribe(listener: () => void) {
      routeChanged = listener;
      return () => {
        routeChanged = undefined;
      };
    },
  };
  const view = await render(<Detail ownership={ownership} />);
  try {
    await screen.findByText('prior synthetic body');
    await fixture.phase('background');
    await act(() => {
      owned = false;
      routeChanged?.();
      owned = true;
      routeChanged?.();
    });
    await fixture.phase('active');
    expect(await screen.findByText('현재 열 수 없는 자료예요.')).toBeVisible();
    expect(screen.queryByText('prior synthetic body')).toBeNull();
    expect(fixture.read).toHaveBeenCalledTimes(1);
  } finally {
    await view.unmount();
    fixture.restore();
  }
});
