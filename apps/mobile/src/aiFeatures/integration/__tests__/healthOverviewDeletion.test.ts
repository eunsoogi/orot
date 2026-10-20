import { healthOverviewTestFixture } from '../testSupport/healthOverviewTestSupport';
import { revalidateWithLocalDeletionGuard } from '../deletionAwareEvidence';
import { openLocalStorage } from '../../../storage/secureDatabase';
import type { EvidenceReference } from '@orot/agent-runtime';

jest.mock('../../../storage/secureDatabase', () => ({
  openLocalStorage: jest.fn(),
}));

test('revalidates an overview through every actual row identity and rejects any deleted member', async () => {
  const fixture = await healthOverviewTestFixture();
  const batch = await fixture.tool.search({
    operationRunId: 'overview',
    operationKey: 'selected',
    input: { query: 'health', view: 'health_overview' },
    allowedScope: { sourceKinds: ['personal_record'] },
    resultLimit: 8,
    maxPayloadBytes: 20 * 1024,
    signal: new AbortController().signal,
  });
  if ('status' in batch) throw new Error('Expected local records');
  const group = batch.items.find(item => item.content.includes('예시약0'))!;
  const deleted = new Set<string>();
  const lookup = jest.fn(async (ids: readonly string[]) =>
    ids.filter(id => deleted.has(id)),
  );
  jest.mocked(openLocalStorage).mockResolvedValue({
    listDeletedSourceReferenceIds: lookup,
    get: async () => null,
    hasStoredRecordId: async (id: string) =>
      fixture.records.some(row => row.record.id === id),
  } as never);
  const revalidate = jest.fn(
    (refs: readonly EvidenceReference[], signal: AbortSignal) =>
      fixture.registry.revalidateEvidence(refs, signal),
  );
  const resolve = fixture.registry.resolve.bind(fixture.registry);
  expect(
    await revalidateWithLocalDeletionGuard(
      [group],
      new AbortController().signal,
      revalidate,
      resolve,
    ),
  ).toBe(true);
  expect(lookup.mock.calls.flat(2)).toEqual(
    expect.arrayContaining(fixture.meds.map(row => row.record.id)),
  );
  expect(revalidate).toHaveBeenCalledWith([group], expect.any(AbortSignal));
  deleted.add(fixture.meds[2]!.record.id);
  revalidate.mockClear();
  expect(
    await revalidateWithLocalDeletionGuard(
      [group],
      new AbortController().signal,
      revalidate,
      resolve,
    ),
  ).toBe(false);
  expect(revalidate).not.toHaveBeenCalled();
  expect(
    await revalidateWithLocalDeletionGuard(
      [group],
      new AbortController().signal,
      revalidate,
      ref => ({ ...ref, locator: { kind: 'health_overview', references: [] } }),
    ),
  ).toBe(false);
});
