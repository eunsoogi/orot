import { quarantinedHistoryFixture } from '../testSupport/quarantinedHistoryFixture';
import { restoreConversationArtifactSnapshot } from '../restoreConversationArtifact';
import * as evidence from '../evidenceUtils';

test('a validated snapshot canonicalizes once while its citation still rechecks live parents', async () => {
  const f = await quarantinedHistoryFixture();
  try {
    const saved = await f.storage.read('older');
    if (!saved) throw new Error('Missing synthetic retained answer');
    const fingerprint = jest.spyOn(evidence, 'fingerprint');
    try {
      const revision = evidence.fingerprint(saved);
      fingerprint.mockClear();
      const signal = new AbortController().signal;
      const restored = await restoreConversationArtifactSnapshot(
        {
          id: saved.id,
          data: await f.input.loadLocalData(),
          registry: f.input.registry,
          storage: f.storage,
          signal,
        },
        saved,
      );
      expect(restored?.revision).toBe(revision);
      expect(
        fingerprint.mock.calls.filter(([value]) => value === saved),
      ).toHaveLength(1);
      const item = restored?.citations[0];
      if (!item) throw new Error('Missing rebound synthetic citation');
      expect((await f.input.registry.readSource(item, signal)).status).toBe(
        'available',
      );
      await f.quarantine();
      expect((await f.input.registry.readSource(item, signal)).status).not.toBe(
        'available',
      );
    } finally {
      fingerprint.mockRestore();
    }
  } finally {
    f.close();
  }
});
