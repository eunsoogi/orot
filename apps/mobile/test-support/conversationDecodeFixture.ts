/** Entirely synthetic persisted references; no database or provider involved. */
export function serialized(count: number) {
  const sources = Array.from({ length: count }, (_, index) => ({
    kind: 'source',
    records: [],
    reference: {
      sourceKind: 'external_medical',
      sourceId: `source-${index}`,
      sourceRevision: 'revision',
      evidenceId: `evidence-${index}`,
      evidenceRevision: 'revision',
      effectiveTime: null,
      reviewState: 'unknown',
      locator: { kind: 'synthetic', index },
    },
  }));
  return JSON.stringify({
    id: 'synthetic',
    sessionId: 'session',
    createdAt: '2026-11-01T00:00:00.000Z',
    providerId: 'synthetic',
    modelId: 'synthetic',
    question: 'Question',
    answer: 'Answer',
    status: 'complete',
    sources,
    citations: sources.map(source => source.reference),
  });
}
