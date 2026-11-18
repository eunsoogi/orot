import { dailyReportReceiptObservers } from '../dailyReportReceiptObservers';

test('late joins receive only real observations, monotonic once, never source or task callbacks', () => {
  const operation = new AbortController();
  const receipts = dailyReportReceiptObservers(operation.signal);
  const first = { onProviderReceipt: jest.fn(), onTaskStreamEvent: jest.fn() };
  const second = { onProviderReceipt: jest.fn(), onTaskStreamEvent: jest.fn() };
  receipts.join(first);
  expect(first.onProviderReceipt).not.toHaveBeenCalled();
  receipts.observe('accepted');
  receipts.observe('response_started');
  receipts.join(second);
  receipts.join(second);
  receipts.observe('accepted');
  receipts.observe('response_started');
  expect(first.onProviderReceipt.mock.calls).toEqual([
    ['accepted'],
    ['response_started'],
  ]);
  expect(second.onProviderReceipt.mock.calls).toEqual([['response_started']]);
  expect(first.onTaskStreamEvent).not.toHaveBeenCalled();
  expect(second.onTaskStreamEvent).not.toHaveBeenCalled();
  receipts.dispose();
});

test('subscriber abort and operation end suppress late callbacks and release listeners', () => {
  const operation = new AbortController();
  const observerLife = new AbortController();
  const remove = jest.spyOn(observerLife.signal, 'removeEventListener');
  const receipts = dailyReportReceiptObservers(operation.signal);
  const gone = { onProviderReceipt: jest.fn() };
  const current = { onProviderReceipt: jest.fn() };
  receipts.join(gone, observerLife.signal);
  observerLife.abort();
  receipts.join(gone, observerLife.signal);
  receipts.join(current);
  receipts.observe('accepted');
  expect(gone.onProviderReceipt).not.toHaveBeenCalled();
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  operation.abort();
  receipts.observe('response_started');
  receipts.join(gone);
  expect(current.onProviderReceipt.mock.calls).toEqual([['accepted']]);
  expect(gone.onProviderReceipt).not.toHaveBeenCalled();
});

test('observer errors are isolated, settlement clears state, new operations do not inherit read', () => {
  const receipts = dailyReportReceiptObservers(new AbortController().signal);
  const broken = {
    onProviderReceipt: jest.fn(() => {
      throw new Error('synthetic');
    }),
  };
  const healthy = { onProviderReceipt: jest.fn() };
  receipts.join(broken);
  receipts.join(healthy);
  expect(() => receipts.observe('response_started')).not.toThrow();
  expect(healthy.onProviderReceipt).toHaveBeenCalledTimes(1);
  receipts.dispose();
  receipts.observe('response_started');
  receipts.join({ onProviderReceipt: healthy.onProviderReceipt });
  const next = dailyReportReceiptObservers(new AbortController().signal);
  next.join(healthy);
  expect(healthy.onProviderReceipt).toHaveBeenCalledTimes(1);
  next.dispose();
});

test('a synchronous join inside another callback gets one replay, not a second broadcast', () => {
  const receipts = dailyReportReceiptObservers(new AbortController().signal);
  const joining = { onProviderReceipt: jest.fn() };
  receipts.join({ onProviderReceipt: () => receipts.join(joining) });
  receipts.observe('response_started');
  expect(joining.onProviderReceipt).toHaveBeenCalledTimes(1);
  receipts.dispose();
});

test('nested processing observation cannot deliver accepted after read to a later subscriber', () => {
  const receipts = dailyReportReceiptObservers(new AbortController().signal);
  const next = { onProviderReceipt: jest.fn() };
  receipts.join({
    onProviderReceipt: receipt => {
      if (receipt === 'accepted') receipts.observe('response_started');
    },
  });
  receipts.join(next);
  receipts.observe('accepted');
  expect(next.onProviderReceipt.mock.calls).toEqual([['response_started']]);
  receipts.dispose();
});
