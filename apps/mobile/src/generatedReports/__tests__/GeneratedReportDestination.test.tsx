import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AppState } from 'react-native';
import { GeneratedReportBrowser } from '../GeneratedReportBrowser';
import { notifyLocalSourceDeleted } from '../../storage/localDataClearEvents';
import type { GeneratedReportRow } from '../types';

const row = (id: string): GeneratedReportRow => ({
  key: id,
  id,
  origin: 'summary',
  kind: 'health_summary',
  createdAt: '2035-01-01T00:00:00Z',
  unavailable: false,
});

function routeOwner(isOwned = false) {
  const listeners = new Set<() => void>();
  return {
    isCurrent: () => isOwned,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(owned: boolean) {
      isOwned = owned;
      for (const listener of listeners) listener();
    },
  };
}

function hold<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  AppState.currentState = 'active';
});

test('waits for live destination admission and loads metadata once, resolving only the tapped row', async () => {
  const owner = routeOwner();
  const list = jest.fn(async () => [row('first'), row('second')]);
  const read = jest.fn(async (item: GeneratedReportRow) => ({
    paragraphs: [item.id + ' synthetic protected report'],
  }));
  const open = jest.fn(async () => ({ list, read }));
  const view = await render(
    <GeneratedReportBrowser destination ownership={owner} open={open} />,
  );
  expect(open).not.toHaveBeenCalled();
  expect(screen.queryByTestId('generated-report-open')).toBeNull();
  await act(() => owner.set(true));
  const second = await screen.findByTestId('generated-report-second');
  expect(screen.queryByTestId('generated-report-open')).toBeNull();
  expect(list).toHaveBeenCalledTimes(1);
  expect(read).not.toHaveBeenCalled();
  await view.rerender(
    <GeneratedReportBrowser destination ownership={owner} open={open} />,
  );
  expect(list).toHaveBeenCalledTimes(1);
  await fireEvent.press(second);
  await waitFor(() =>
    expect(screen.getByText('second synthetic protected report')).toBeVisible(),
  );
  expect(read).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledWith(row('second'), expect.any(AbortSignal));
  await view.unmount();
});

test('a stale Back result cannot overwrite fresh metadata or trigger an automatic detail read', async () => {
  const owner = routeOwner(true);
  const old = hold<GeneratedReportRow[]>();
  const fresh = hold<GeneratedReportRow[]>();
  const list = jest
    .fn()
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(fresh.promise);
  const read = jest.fn();
  const open = async () => ({ list, read });
  const view = await render(
    <GeneratedReportBrowser destination ownership={owner} open={open} />,
  );
  await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
  const loading = screen.getByText('저장한 결과를 확인하고 있어요.');
  expect(loading).toBeVisible();
  expect(loading.props.accessibilityLiveRegion).toBe('polite');
  expect(screen.queryByTestId('generated-report-open')).toBeNull();
  await act(() => owner.set(false));
  expect(screen.queryByTestId('generated-report-browser')).toBeNull();
  await act(() => owner.set(true));
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  await act(() => old.resolve([row('stale')]));
  expect(screen.queryByTestId('generated-report-stale')).toBeNull();
  await act(() => fresh.resolve([row('new')]));
  expect(screen.getByTestId('generated-report-new')).toBeVisible();
  expect(screen.queryByText('저장한 결과를 확인하고 있어요.')).toBeNull();
  expect(read).not.toHaveBeenCalled();
  await view.unmount();
});

test('retry after list failure is deliberate; later source invalidation reopens only metadata', async () => {
  const owner = routeOwner(true);
  const list = jest
    .fn()
    .mockRejectedValueOnce(new Error('synthetic protected list failure'))
    .mockResolvedValueOnce([row('recovered')])
    .mockResolvedValueOnce([]);
  const read = jest.fn();
  const view = await render(
    <GeneratedReportBrowser
      destination
      ownership={owner}
      open={async () => ({ list, read })}
    />,
  );
  expect(await screen.findByRole('alert')).toBeVisible();
  expect(list).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('generated-report-open')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: '다시 확인' }));
  expect(await screen.findByTestId('generated-report-recovered')).toBeVisible();
  await act(() => notifyLocalSourceDeleted());
  expect(
    await screen.findByText('저장된 보고서나 진료 질문이 없어요.'),
  ).toBeVisible();
  expect(list).toHaveBeenCalledTimes(3);
  expect(read).not.toHaveBeenCalled();
  expect(screen.queryByTestId('generated-report-open')).toBeNull();
  await view.unmount();
});

test('inactive scenes never open storage and Back during a held open cannot read its catalog', async () => {
  const owner = routeOwner(true);
  const list = jest.fn(async () => [row('obsolete')]);
  const read = jest.fn();
  const pendingOpen = hold<{ list: typeof list; read: typeof read }>();
  const open = jest.fn(() => pendingOpen.promise);
  const view = await render(
    <GeneratedReportBrowser
      destination
      active={false}
      ownership={owner}
      open={open}
    />,
  );
  expect(open).not.toHaveBeenCalled();
  await view.rerender(
    <GeneratedReportBrowser destination active ownership={owner} open={open} />,
  );
  await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
  await act(() => owner.set(false));
  await act(() => pendingOpen.resolve({ list, read }));
  expect(list).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
  expect(screen.queryByTestId('generated-report-browser')).toBeNull();
  await view.unmount();
});
