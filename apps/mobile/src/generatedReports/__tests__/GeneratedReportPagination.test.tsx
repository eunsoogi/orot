import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { AppState } from 'react-native';
import { GeneratedReportBrowser } from '../GeneratedReportBrowser';
import { NavigationRouteScrollView } from '../../navigation/NavigationRouteScrollView';
import { notifyLocalSourceDeleted } from '../../storage/localDataClearEvents';
import type { GeneratedReportRow } from '../types';

function row(index: number): GeneratedReportRow {
  return {
    key: `result-${index}`,
    id: `report-${index}`,
    origin: 'summary',
    kind: 'health_summary',
    createdAt: new Date(Date.UTC(2035, 0, 1, 0, -index)).toISOString(),
    unavailable: false,
  };
}

function heldPage() {
  let resolve!: (page: readonly GeneratedReportRow[]) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<readonly GeneratedReportRow[]>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const first = Array.from({ length: 20 }, (_, index) => row(index));
const rowId = (item: GeneratedReportRow) => `generated-report-${item.key}`;
const cursor = { createdAt: first[19].createdAt, key: first[19].key };

beforeEach(() => {
  AppState.currentState = 'active';
});

test('keeps the same scroll owner and row instances through Load More success', async () => {
  const second = heldPage();
  const list = jest
    .fn()
    .mockResolvedValueOnce(first)
    .mockReturnValueOnce(second.promise);
  const read = jest.fn();
  await render(
    <NavigationRouteScrollView>
      <GeneratedReportBrowser destination open={async () => ({ list, read })} />
    </NavigationRouteScrollView>,
  );
  const anchor = await screen.findByTestId(rowId(first[17]));
  const host = screen.getByTestId('navigation-route-scroll');
  const group = screen.getByTestId('generated-report-rows');
  const action = screen.getByRole('button', { name: '더 보기' });
  await fireEvent.press(action);
  expect(list.mock.calls).toEqual([[undefined], [cursor]]);
  expect(screen.getByTestId(rowId(first[17]))).toBe(anchor);
  expect(screen.getByTestId('navigation-route-scroll')).toBe(host);
  expect(screen.getByTestId('generated-report-rows')).toBe(group);
  const loading = screen.getByRole('button', { name: '더 불러오는 중' });
  expect(loading).toBeDisabled();
  await fireEvent.press(loading);
  expect(list).toHaveBeenCalledTimes(2);
  expect(read).not.toHaveBeenCalled();

  const next = [row(20), row(21)];
  await act(() => second.resolve(next));
  expect(screen.getByTestId('navigation-route-scroll')).toBe(host);
  expect(screen.getByTestId('generated-report-rows')).toBe(group);
  expect(screen.getByTestId(rowId(first[17]))).toBe(anchor);
  expect(
    within(group)
      .getAllByRole('button')
      .map(node => node.props.testID),
  ).toEqual([...first, ...next].map(rowId));
  expect(screen.queryByRole('button', { name: '더 보기' })).toBeNull();
  expect(screen.getByText('저장한 결과를 모두 불러왔어요.')).toBeVisible();
  expect(read).not.toHaveBeenCalled();
});

test('a failed next page preserves existing rows and retries its cursor, not page one', async () => {
  const second = heldPage();
  const list = jest
    .fn()
    .mockResolvedValueOnce(first)
    .mockReturnValueOnce(second.promise)
    .mockResolvedValueOnce([]);
  const read = jest.fn();
  await render(
    <GeneratedReportBrowser destination open={async () => ({ list, read })} />,
  );
  const anchor = await screen.findByTestId(rowId(first[19]));
  await fireEvent.press(screen.getByRole('button', { name: '더 보기' }));
  await act(() => second.reject(new Error('synthetic page failure')));
  expect(screen.getByTestId(rowId(first[19]))).toBe(anchor);
  expect(screen.getByRole('alert')).toHaveTextContent(
    '다음 결과를 불러오지 못했어요.',
  );
  await fireEvent.press(screen.getByRole('button', { name: '다시 더 보기' }));
  expect(list.mock.calls).toEqual([[undefined], [cursor], [cursor]]);
  expect(screen.getByTestId(rowId(first[19]))).toBe(anchor);
  expect(screen.getByText('저장한 결과를 모두 불러왔어요.')).toBeVisible();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(read).not.toHaveBeenCalled();
});

test('source invalidation drops both old rows and the held page before restoring the first page', async () => {
  const second = heldPage();
  const fresh = row(400);
  const list = jest
    .fn()
    .mockResolvedValueOnce(first)
    .mockReturnValueOnce(second.promise)
    .mockResolvedValueOnce([fresh]);
  const read = jest.fn();
  await render(
    <GeneratedReportBrowser destination open={async () => ({ list, read })} />,
  );
  await screen.findByTestId(rowId(first[19]));
  await fireEvent.press(screen.getByRole('button', { name: '더 보기' }));
  await act(() => notifyLocalSourceDeleted());
  await waitFor(() => expect(screen.getByTestId(rowId(fresh))).toBeVisible());
  await act(() => second.resolve([row(20)]));
  expect(list.mock.calls).toEqual([[undefined], [cursor], [undefined]]);
  expect(screen.queryByTestId(rowId(first[0]))).toBeNull();
  expect(screen.queryByTestId(rowId(row(20)))).toBeNull();
  expect(read).not.toHaveBeenCalled();
});

test('opening a current row wins over pagination; the late page is discarded and can be requested again', async () => {
  const second = heldPage();
  const list = jest
    .fn()
    .mockResolvedValueOnce(first)
    .mockReturnValueOnce(second.promise)
    .mockResolvedValueOnce([row(20)]);
  const read = jest.fn(async () => ({
    paragraphs: ['Exact synthetic selected report'],
  }));
  await render(
    <GeneratedReportBrowser destination open={async () => ({ list, read })} />,
  );
  const selected = first[19];
  await screen.findByTestId(rowId(selected));
  await fireEvent.press(screen.getByRole('button', { name: '더 보기' }));
  await fireEvent.press(screen.getByTestId(rowId(selected)));
  await waitFor(() =>
    expect(screen.getByText('Exact synthetic selected report')).toBeVisible(),
  );
  expect(read).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledWith(selected, expect.any(AbortSignal));
  await act(() => second.resolve([row(99)]));
  expect(screen.getByText('Exact synthetic selected report')).toBeVisible();
  await fireEvent.press(screen.getByRole('button', { name: '목록으로' }));
  expect(screen.queryByTestId(rowId(row(99)))).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: '더 보기' }));
  expect(list.mock.calls).toEqual([[undefined], [cursor], [cursor]]);
  expect(await screen.findByTestId(rowId(row(20)))).toBeVisible();
});
