import { Alert } from 'react-native';
import { catalogRemovalAction } from '../GeneratedReportCatalogRemoval';
import type { GeneratedReportRow } from '../types';

const row: GeneratedReportRow = {
  id: 'target',
  key: 'conversation:target',
  kind: 'possibilities',
  origin: 'conversation',
  unavailable: false,
  createdAt: '2035-01-01T00:00:00Z',
};

afterEach(() => jest.restoreAllMocks());

test('requires explicit confirmation and cancels the exact staged request', async () => {
  const dialog = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const commit = jest.fn(async () => true);
  const prepare = jest.fn(async () => commit);
  const open = jest.fn(async () => ({
    list: async () => [],
    read: async () => null,
    prepareCatalogRemoval: prepare,
  }));
  const removed = jest.fn();
  const pending = { current: null as AbortController | null };
  const action = catalogRemovalAction(open, () => true, pending, removed);
  const prompt = async () => {
    action(row);
    await Promise.resolve();
    await Promise.resolve();
    return dialog.mock.calls.at(-1)?.[2];
  };
  const cancelled = await prompt();
  expect(dialog.mock.calls[0]?.[1]).toContain('원래 대화와 답변은 남아요');
  expect(commit).not.toHaveBeenCalled();
  cancelled?.[0]?.onPress?.();
  cancelled?.[1]?.onPress?.();
  expect(commit).not.toHaveBeenCalled();

  const stale = await prompt();
  pending.current?.abort();
  stale?.[1]?.onPress?.();
  expect(commit).not.toHaveBeenCalled();

  const confirmed = await prompt();
  confirmed?.[1]?.onPress?.();
  await Promise.resolve();
  expect(commit).toHaveBeenCalledTimes(1);
  expect(removed).toHaveBeenCalledWith(row.key);
});
