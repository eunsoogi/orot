import { createArchivedCitationService } from '../archivedCitationService';
import type { AiFeatureLocalData } from '../localData';

function hold<T>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>(resolve => {
    release = resolve;
  });
  return { promise, release };
}

test.each(['local data', 'protected database'] as const)(
  'archive resolution does not begin a selected lookup after losing ownership while opening %s',
  async stage => {
    const selected = jest.fn();
    const storage = {
      readSelectedArchivedCitation: selected,
    } as unknown as Awaited<
      ReturnType<
        NonNullable<AiFeatureLocalData['openConversationArtifactStorage']>
      >
    >;
    const db = hold<typeof storage>();
    const opening = jest.fn(async () =>
      stage === 'protected database' ? db.promise : storage,
    );
    const data = {
      openConversationArtifactStorage: opening,
    } as unknown as AiFeatureLocalData;
    const local = hold<typeof data>();
    const load = jest.fn(() =>
      stage === 'local data' ? local.promise : Promise.resolve(data),
    );
    const archive = createArchivedCitationService(load);
    const controller = new AbortController();
    const result = archive.resolve(
      {
        sessionId: 'synthetic-session',
        sessionVersion: 0,
        turnId: 'synthetic-turn',
        createdAt: '2036-01-02T00:00:00.000Z',
      },
      0,
      controller.signal,
    );
    if (stage === 'protected database') {
      await Promise.resolve();
      expect(opening).toHaveBeenCalledTimes(1);
    }
    controller.abort();
    local.release(data);
    db.release(storage);
    await expect(result).resolves.toBeUndefined();
    expect(selected).not.toHaveBeenCalled();
    if (stage === 'local data') expect(opening).not.toHaveBeenCalled();
  },
);
