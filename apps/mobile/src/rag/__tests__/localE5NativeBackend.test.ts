import { createLocalE5NativeBackend } from '../localE5NativeBackend';
import type { LocalE5NativeModule } from '../localE5NativeBackend';

interface ProgressEvent {
  readonly requestId: string;
  readonly completed: number;
  readonly total: number;
}

class TestEventSource {
  private listeners = new Set<(event: ProgressEvent) => void>();

  addListener(_eventName: string, listener: (event: ProgressEvent) => void) {
    this.listeners.add(listener);
    return { remove: () => this.listeners.delete(listener) };
  }

  emit(event: ProgressEvent) {
    this.listeners.forEach(listener => listener(event));
  }

  get listenerCount() {
    return this.listeners.size;
  }
}

describe('local E5 native backend', () => {
  it('filters download progress by request and removes the event listener when preparation settles', async () => {
    const events = new TestEventSource();
    const module: LocalE5NativeModule = {
      getModelIdentity: jest.fn(),
      prepare: jest.fn(async requestId => {
        events.emit({ requestId: 'other-request', completed: 2, total: 10 });
        events.emit({ requestId, completed: 7, total: 10 });
      }),
      embedBatch: jest.fn(async input => input.map(() => [1])),
      cancel: jest.fn(),
    };
    const backend = createLocalE5NativeBackend(module, events);
    const progress: [number, number][] = [];

    await backend.prepare('request-1', (completed, total) =>
      progress.push([completed, total]),
    );

    expect(progress).toEqual([
      [7, 10],
      [475_337_561, 475_337_561],
    ]);
    expect(events.listenerCount).toBe(0);
  });

  it('forwards the role and request cancellation to the native runtime', async () => {
    const events = new TestEventSource();
    const module: LocalE5NativeModule = {
      getModelIdentity: jest.fn(),
      prepare: jest.fn(async () => undefined),
      embedBatch: jest.fn(async input => input.map(() => [1, 0])),
      cancel: jest.fn(),
    };
    const backend = createLocalE5NativeBackend(module, events);

    await expect(
      backend.embedBatch(['진료 기록'], 'query', 'request-2'),
    ).resolves.toEqual([[1, 0]]);
    backend.cancel('request-2');

    expect(module.embedBatch).toHaveBeenCalledWith(
      ['진료 기록'],
      'query',
      'request-2',
    );
    expect(module.cancel).toHaveBeenCalledWith('request-2');
  });

  it('removes its progress listener after native preparation fails', async () => {
    const events = new TestEventSource();
    const module: LocalE5NativeModule = {
      getModelIdentity: jest.fn(),
      prepare: jest.fn(async () => {
        throw new Error('model checksum mismatch');
      }),
      embedBatch: jest.fn(),
      cancel: jest.fn(),
    };
    const backend = createLocalE5NativeBackend(module, events);

    await expect(backend.prepare('request-3', jest.fn())).rejects.toThrow(
      'checksum mismatch',
    );
    expect(events.listenerCount).toBe(0);
  });
});
