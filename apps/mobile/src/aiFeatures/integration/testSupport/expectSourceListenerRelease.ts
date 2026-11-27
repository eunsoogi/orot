import type { EvidenceSourceReadResult } from '../evidenceRegistry';
import { AppState } from 'react-native';

/** Record actual registration/removal, while keeping the mounted route and AppState behavior. */
export function expectSourceListenerRelease() {
  const addEvent = AppState.addEventListener;
  const add = jest.isMockFunction(addEvent)
    ? addEvent.getMockImplementation()
    : addEvent.bind(AppState);
  const removers: jest.Mock[] = [];
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((event, callback) => {
      const live = add?.(event, callback) ?? { remove() {} };
      if (callback.name === 'revokeOnInactive') {
        const remove = jest.fn(() => live.remove());
        removers.push(remove);
        return { remove };
      }
      return live;
    });
  const abort = jest.spyOn(AbortSignal.prototype, 'addEventListener');
  const remove = jest.spyOn(AbortSignal.prototype, 'removeEventListener');
  return () => {
    // Match the exact modal lease's AppState cleanup registration, not a total count.
    const routeIndex = abort.mock.calls.findIndex(
      ([event, callback]) =>
        event === 'abort' &&
        typeof callback === 'function' &&
        callback.name === 'removeAppObserver',
    );
    expect(routeIndex).toBeGreaterThanOrEqual(0);
    const routeSignal = abort.mock.contexts[routeIndex];
    const routeCallback = abort.mock.calls[routeIndex]![1];
    expect(
      remove.mock.calls.some(
        ([event, callback], i) =>
          remove.mock.contexts[i] === routeSignal &&
          event === 'abort' &&
          callback === routeCallback,
      ),
    ).toBe(true);
    expect(removers.some(removeApp => removeApp.mock.calls.length === 1)).toBe(
      true,
    );
  };
}

export const sourceResult: EvidenceSourceReadResult = {
  status: 'available',
  document: {
    sourceKind: 'personal_record',
    records: [
      {
        kind: 'source_record',
        record: {
          id: 'synthetic-private-source',
          sourceKind: 'device_export',
          title: 'Synthetic protected record',
          effectiveAt: '2026-01-01T00:00:00.000Z',
          recordedAt: '2026-01-01T00:00:00.000Z',
          ingestedAt: '2026-01-01T00:00:00.000Z',
          provenance: { origin: 'imported', sourceRecordIds: [] },
          reviewState: { status: 'unreviewed' },
        },
      },
    ],
  },
};
