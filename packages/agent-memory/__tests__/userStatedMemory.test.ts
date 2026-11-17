import { createAgentMemory } from '../src/service';
import { isProvenance } from '../src/validation';
import { embedder, PersistentMemoryStorage, preference } from './testFixtures';
const provenance = {
  sourceIds: ['original'],
  sourceReferences: [{ kind: 'conversation_user_statement', id: 'original' }],
  sourceDates: [{ sourceId: 'original', date: '2026-11-01T00:00:00Z' }],
  reviewState: 'user_stated' as const,
};
test('source-backed user statements retain their distinct trust after save and recall', async () => {
  const storage = new PersistentMemoryStorage();
  const memory = await createAgentMemory({ storage, embedder });
  const id = await memory.remember({ ...preference, provenance });
  expect((await memory.recall(preference.text))[0]).toMatchObject({ id, provenance });
  await memory.close();
});
test('unlinked or undated user statements cannot impersonate a reviewed memory', () => {
  expect(isProvenance({ ...provenance, sourceDates: undefined })).toBe(false);
  expect(isProvenance({ ...provenance, sourceReferences: undefined })).toBe(false);
  expect(
    isProvenance({ ...provenance, sourceDates: [{ sourceId: 'original', date: 'unknown' }] }),
  ).toBe(false);
  expect(isProvenance(preference.provenance)).toBe(true);
});
