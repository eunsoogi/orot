import { AppState } from 'react-native';
beforeEach(() => {
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
});
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { GeneratedReportBrowser } from '../GeneratedReportBrowser';
import { notifyLocalSourceDeleted } from '../../storage/localDataClearEvents';
import type {
  GeneratedReportReader,
  GeneratedReportDetail,
  GeneratedReportRow,
} from '../types';
jest.mock('../readers', () => ({ openGeneratedReportReader: jest.fn() }));
const row = (id: string): GeneratedReportRow => ({
  key: id,
  id,
  origin: 'summary',
  kind: 'health_summary',
  createdAt: '2026-01-01T00:00:00Z',
  unavailable: false,
});
const deferred = () => {
  let resolve!: (v: GeneratedReportDetail | null) => void;
  const promise = new Promise<GeneratedReportDetail | null>(r => {
    resolve = r;
  });
  return { promise, resolve };
};

/** List loading must not restore any health periods or disclose a report preview. */
test('metadata first, explicit selected read, and unavailable result never invents another version', async () => {
  const read = jest.fn(async () => null);
  const service: GeneratedReportReader = {
    list: jest.fn(async () => [row('a')]),
    read,
  };
  const ui = await render(
    <GeneratedReportBrowser open={async () => service} />,
  );
  expect(service.list).not.toHaveBeenCalled();
  await fireEvent.press(ui.getByText('보고서·진료 질문 보기'));
  await waitFor(() =>
    expect(ui.getByTestId('generated-report-a')).toBeTruthy(),
  );
  expect(read).not.toHaveBeenCalled();
  await fireEvent.press(ui.getByTestId('generated-report-a'));
  await waitFor(() => expect(ui.getByText(/이전 버전이거나/)).toBeTruthy());
  expect(read).toHaveBeenCalledTimes(1);
});

test.each(['back', 'inactive', 'delete'] as const)(
  'late selected text cannot cross %s ownership',
  async mode => {
    const pending = deferred();
    const open = async () => ({
      list: async () => [row('a')],
      read: () => pending.promise,
    });
    const ui = await render(<GeneratedReportBrowser open={open} />);
    await fireEvent.press(ui.getByText('보고서·진료 질문 보기'));
    await waitFor(() =>
      expect(ui.getByTestId('generated-report-a')).toBeTruthy(),
    );
    await fireEvent.press(ui.getByTestId('generated-report-a'));
    if (mode === 'back') await fireEvent.press(ui.getByText('목록으로'));
    if (mode === 'inactive')
      await ui.rerender(<GeneratedReportBrowser open={open} active={false} />);
    if (mode === 'delete') await act(() => notifyLocalSourceDeleted());
    await act(async () =>
      pending.resolve({ paragraphs: ['Synthetic secret'] }),
    );
    expect(ui.queryByText('Synthetic secret')).toBeNull();
  },
);

test('a later selection cannot be overwritten by the previous selection', async () => {
  const first = deferred();
  const service: GeneratedReportReader = {
    list: async () => [row('a'), row('b')],
    read: async r =>
      r.id === 'a' ? first.promise : { paragraphs: ['Second result'] },
  };
  const ui = await render(
    <GeneratedReportBrowser open={async () => service} />,
  );
  await fireEvent.press(ui.getByText('보고서·진료 질문 보기'));
  await waitFor(() =>
    expect(ui.getByTestId('generated-report-a')).toBeTruthy(),
  );
  await fireEvent.press(ui.getByTestId('generated-report-a'));
  await fireEvent.press(ui.getByText('목록으로'));
  await fireEvent.press(ui.getByTestId('generated-report-b'));
  await waitFor(() => expect(ui.getByText('Second result')).toBeTruthy());
  await act(async () => first.resolve({ paragraphs: ['First stale result'] }));
  expect(ui.queryByText('First stale result')).toBeNull();
});
