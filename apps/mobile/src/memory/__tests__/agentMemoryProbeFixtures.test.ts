import {
  createAgentMemoryProbeFixture,
  deterministicProvider,
} from '../agentMemoryProbeFixtures';

test('preserves the existing fixture for callers that do not request isolation', () => {
  const fixture = createAgentMemoryProbeFixture();
  expect(fixture.sourceRecord.id).toBe('agent-memory-synthetic-source');
  expect(fixture.sourceRecord.contentHash).toBe('sha256:' + 'a'.repeat(64));
  expect(fixture.memoryInput.memoryKey).toBe('preference:outpatient-reminder');
  expect(fixture.chunkId).toBe('agent-memory-synthetic-chunk');
  expect(fixture.memoryInput.provenance.sourceIds).toEqual([
    fixture.sourceRecord.id,
  ]);
  expect(deterministicProvider.id).toBe('agent-memory-e2e-fixture');
});
test('keeps two native test cases separate from durable source deletion fences', () => {
  const first = createAgentMemoryProbeFixture(
    'test-memory-AAAAAAAA-1111-2222-3333-444444444444',
  );
  const second = createAgentMemoryProbeFixture(
    'test-memory-BBBBBBBB-1111-2222-3333-444444444444',
  );
  expect(first.sourceRecord.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(first.sourceRecord.contentHash).not.toBe(
    second.sourceRecord.contentHash,
  );
  expect(first.memoryInput.memoryKey).not.toBe(second.memoryInput.memoryKey);
  expect(first.chunkId).not.toBe(second.chunkId);
  expect(first.chunkId).toContain(first.sourceRecord.id);
  expect(first.memoryInput.provenance.sourceIds).toEqual([
    first.sourceRecord.id,
  ]);
  expect(first.memoryInput.provenance.sourceDates[0].sourceId).toBe(
    first.sourceRecord.id,
  );
});
test('rejects identifiers outside the synthetic fixture namespace', () => {
  for (const identifier of [
    'real-source',
    'test-memory-' + '-'.repeat(36),
    'test-memory-invalid',
  ])
    expect(() => createAgentMemoryProbeFixture(identifier)).toThrow(
      'Invalid synthetic memory fixture identifier',
    );
});
