import type { EvidenceReference } from '@orot/agent-runtime';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';

const originalReference: EvidenceReference = {
  sourceKind: 'personal_record',
  sourceId: 'source-private-123',
  sourceRevision: 'source-rev-private',
  evidenceId: 'record-private-456',
  evidenceRevision: 'evidence-rev-private',
  locator: { kind: 'structured_record', recordId: 'record-private-456' },
  effectiveTime: '2026-10-01T00:00:00.000Z',
  reviewState: 'reviewed',
};

function referenceOnly(
  value: {
    readonly content: string;
  } & EvidenceReference,
): EvidenceReference {
  return {
    sourceKind: value.sourceKind,
    sourceId: value.sourceId,
    sourceRevision: value.sourceRevision,
    evidenceId: value.evidenceId,
    evidenceRevision: value.evidenceRevision,
    locator: value.locator,
    effectiveTime: value.effectiveTime,
    ...(value.unit === undefined ? {} : { unit: value.unit }),
    reviewState: value.reviewState,
  };
}

describe('LocalEvidenceReferenceRegistry', () => {
  it('keeps raw record identifiers out of model-visible content and references', async () => {
    const registry = new LocalEvidenceReferenceRegistry();
    registry.registerSensitiveIdentifier('source-private-123');
    registry.registerSensitiveIdentifier('record-private-456');
    const readSource = jest.fn(async () => ({
      status: 'available' as const,
      document: { sourceKind: 'personal_record' as const, records: [] },
    }));
    const item = registry.add({
      reference: originalReference,
      content:
        'health_observation: {"id":"record-private-456","source":"source-private-123"}',
      validate: async () => true,
      readSource,
    });

    expect(item.sourceId).not.toContain('source-private-123');
    expect(item.evidenceId).not.toContain('record-private-456');
    expect(item.locator).not.toEqual(originalReference.locator);
    expect(item.content).not.toContain('source-private-123');
    expect(item.content).not.toContain('record-private-456');
    expect(registry.resolve(item)).toEqual(originalReference);
    await expect(
      registry.readSource(item, new AbortController().signal),
    ).resolves.toMatchObject({ status: 'available' });
    expect(readSource).toHaveBeenCalledTimes(1);
    await expect(
      registry.revalidateEvidence([item], new AbortController().signal),
    ).resolves.toBe(true);
  });

  it('returns local search chunks with aliased IDs and rejects stale or unknown citations', async () => {
    const registry = new LocalEvidenceReferenceRegistry();
    const item = registry.add({
      reference: originalReference,
      content: '혈압 기록: 수축기 120 mmHg',
      validate: async () => false,
      readSource: async () => ({ status: 'unavailable' }),
    });
    const chunk = registry.toSearchChunk(item, '혈압 기록 record-private-456', {
      status: 'reviewed',
      reviewerId: 'reviewer-private',
      reviewedAt: '2026-10-02T00:00:00.000Z',
    });

    expect(chunk.text).not.toContain('record-private-456');
    expect(chunk.metadata.sourceId).toBe(item.sourceId);
    expect(chunk.metadata.evidenceId).toBe(item.evidenceId);
    await expect(
      registry.revalidateEvidence(
        [referenceOnly(item)],
        new AbortController().signal,
      ),
    ).resolves.toBe(false);
    await expect(
      registry.revalidateEvidence(
        [originalReference],
        new AbortController().signal,
      ),
    ).resolves.toBe(false);
  });
});
