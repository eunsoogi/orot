import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { captureConversationSources } from '../captureConversationSources';
import { fingerprint } from '../evidenceUtils';

/** Non-tool evidence remains at its original position, after native/photo awaits. */
test('photo callback changes later ordinary source before its strict capture', async () => {
  const registry = new LocalEvidenceReferenceRegistry();
  let valid = true;
  const section = {
    id: 'section',
    text: 'synthetic',
    startOffset: 0,
    endOffset: 9,
  };
  const base = {
    sourceKind: 'personal_record' as const,
    sourceId: 'photo',
    evidenceId: section.id,
    sourceRevision: `sha256:${'a'.repeat(64)}`,
    evidenceRevision: fingerprint(section),
    locator: {
      kind: 'conversation_photo',
      requestId: 'request',
      sectionId: section.id,
    },
    effectiveTime: null,
    reviewState: 'unknown' as const,
  };
  const photo = registry.add({
    reference: base,
    content: '',
    validate: async () => true,
    readSource: async () => {
      valid = false;
      return {
        status: 'available',
        document: {
          sourceKind: 'conversation_photo',
          requestId: 'request',
          sourceId: 'photo',
          contentHash: base.sourceRevision as `sha256:${string}`,
          section,
        },
      };
    },
  });
  const read = jest.fn(async () =>
    valid
      ? {
          status: 'available' as const,
          document: { sourceKind: 'personal_record' as const, records: [] },
        }
      : { status: 'changed' as const },
  );
  const ordinary = registry.add({
    reference: {
      ...base,
      sourceId: 'ordinary',
      evidenceId: 'ordinary',
      locator: { kind: 'record' },
    },
    content: '',
    readSource: read,
    validate: async () => valid,
  });
  await expect(
    captureConversationSources(
      [photo, ordinary],
      registry,
      new AbortController().signal,
    ),
  ).rejects.toThrow();
  expect(read).toHaveBeenCalledTimes(1);
  expect(valid).toBe(false);
});
