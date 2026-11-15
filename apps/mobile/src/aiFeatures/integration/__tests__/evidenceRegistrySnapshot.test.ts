import type { EvidenceReference } from '@orot/agent-runtime';
import { LocalEvidenceReferenceRegistry as Registry } from '../evidenceRegistry';

const reference: EvidenceReference = {
  sourceKind: 'personal_record',
  sourceId: 'synthetic-private-source',
  sourceRevision: 'revision-1',
  evidenceId: 'synthetic-private-record',
  evidenceRevision: 'revision-1',
  locator: { kind: 'structured_record', recordId: 'synthetic-private-record' },
  effectiveTime: '2026-11-14T00:00:00.000Z',
  reviewState: 'reviewed',
};
function readers() {
  return {
    validate: jest.fn(async () => true),
    readSource: jest.fn(async () => ({
      status: 'available' as const,
      document: { sourceKind: 'personal_record' as const, records: [] },
    })),
  };
}
function add(registry: Registry, ref = reference, ports = readers()) {
  return registry.add({
    reference: ref,
    content: `${ref.sourceId} ${ref.evidenceId}`,
    ...ports,
  });
}
function fixture() {
  const original = new Registry();
  original.registerSensitiveIdentifier('synthetic-extra-id');
  const first = add(original);
  const secondReference = {
    ...reference,
    evidenceId: 'synthetic-second-record',
    locator: { kind: 'structured_record', recordId: 'synthetic-second-record' },
  };
  const second = add(original, secondReference);
  const fresh = new Registry();
  const ports = readers();
  // Different registration order must not change the old graph's alias identities.
  add(fresh, secondReference, ports);
  add(fresh, reference, ports);
  return {
    original,
    fresh,
    first,
    second,
    ports,
    snapshot: original.snapshot(),
  };
}

test('private round trip preserves exact aliases and fresh readers without invoking them', async () => {
  const f = fixture();
  const saved = JSON.parse(JSON.stringify(f.snapshot));
  expect(JSON.stringify(saved)).not.toContain('validate');
  expect(JSON.stringify(saved)).not.toContain('readSource');
  const restored = Registry.restore(saved, f.fresh);
  expect(f.ports.validate).not.toHaveBeenCalled();
  expect(f.ports.readSource).not.toHaveBeenCalled();
  expect(restored.resolve(f.first)).toEqual(reference);
  expect(restored.resolve(f.second)?.evidenceId).toBe(
    'synthetic-second-record',
  );
  expect(restored.localSourceIds([f.first.sourceId])).toEqual([
    reference.sourceId,
  ]);
  expect(restored.redactText('synthetic-extra-id')).toBe(
    f.original.redactText('synthetic-extra-id'),
  );
  expect(restored.resolveToolReference(f.first)).toMatchObject({
    evidenceId: f.first.evidenceId,
  });
  await expect(
    restored.revalidateEvidence([f.first], new AbortController().signal),
  ).resolves.toBe(true);
  expect(f.ports.validate).toHaveBeenCalledTimes(1);
  await expect(
    restored.readSource(f.second, new AbortController().signal),
  ).resolves.toMatchObject({ status: 'available' });
  expect(f.ports.readSource).toHaveBeenCalledTimes(1);
  const next = add(restored, {
    ...reference,
    evidenceId: 'synthetic-third-record',
  });
  expect(next.evidenceId).toBe('e3');
  expect(next.sourceId).toBe(f.first.sourceId);
  expect(next.content).not.toContain('synthetic-private');
  saved.entries[0].original.sourceRevision = 'mutated';
  expect(restored.resolve(f.first)).toEqual(reference);
});

test.each([
  (s: any) => {
    s.entries.push(s.entries[0]);
  },
  (s: any) => {
    s.entries[1].alias.evidenceId = s.entries[0].alias.evidenceId;
  },
  (s: any) => {
    s.entries[0].alias.sourceRevision = 'forged';
  },
  (s: any) => {
    s.entries[0].original.sourceRevision = 'changed';
  },
  (s: any) => {
    s.identifiers.sources[0][1] = 'other-source';
  },
  (s: any) => {
    s.identifiers.sensitive[0][1] = 'raw-identifier';
  },
  (s: any) => {
    s.identifiers.sources.push(s.identifiers.sources[0]);
  },
  (s: any) => {
    s.nextAlias = 0;
  },
  (s: any) => {
    s.version = 2;
  },
])(
  'rejects malformed or conflicting snapshots without changing fresh registry',
  mutate => {
    const f = fixture();
    const before = f.fresh.snapshot();
    const saved = JSON.parse(JSON.stringify(f.snapshot));
    mutate(saved);
    expect(() => Registry.restore(saved, f.fresh)).toThrow();
    expect(f.fresh.snapshot()).toEqual(before);
    expect(f.ports.validate).not.toHaveBeenCalled();
    expect(f.ports.readSource).not.toHaveBeenCalled();
  },
);

test('missing or ambiguous fresh original readers cannot restore an alias', () => {
  const f = fixture();
  expect(() => Registry.restore(f.snapshot, new Registry())).toThrow();
  add(f.fresh, reference);
  expect(() => Registry.restore(f.snapshot, f.fresh)).toThrow('ambiguous');
});

test('empty registry snapshots remain usable without inventing a source', () => {
  const restored = Registry.restore(new Registry().snapshot(), new Registry());
  expect(restored.localSourceIds(['s1'])).toEqual([]);
  expect(add(restored).evidenceId).toBe('e1');
});

test('restored aliases retain fresh source invalidation rather than granting validity', async () => {
  const f = fixture();
  const restored = Registry.restore(f.snapshot, f.fresh);
  f.ports.validate.mockResolvedValue(false);
  await expect(
    restored.revalidateEvidence([f.first], new AbortController().signal),
  ).resolves.toBe(false);
});
