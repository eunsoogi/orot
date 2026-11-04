import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { restoreSymptomSummary } from '../symptomSummarySources';
import { localData } from '../featureServiceFixtures';

test('restores a missing generated parent as an unavailable alias', async () => {
  const parent = {
    sourceKind: 'generated_artifact' as const,
    sourceId: 'private-parent',
    evidenceId: 'private-parent',
    sourceRevision: 'revision',
    evidenceRevision: 'revision',
    locator: { kind: 'generated_artifact', type: 'conversation_turn' },
    effectiveTime: null,
    reviewState: 'unreviewed' as const,
  };
  const registry = new LocalEvidenceReferenceRegistry();
  const restored = await restoreSymptomSummary(
    {
      id: 'summary',
      createdAt: '2035-01-01T00:00:00Z',
      modelName: 'Synthetic',
      modelId: 'model',
      providerId: 'provider',
      inputLineage: 'complete',
      analysis: {
        hypotheses: [
          {
            title: 'Summary',
            summary: 'Synthetic',
            uncertainty: 'Unknown',
            missingData: [],
            supportingEvidence: [parent],
            contraryEvidence: [],
          },
        ],
      },
      sources: [
        {
          kind: 'generated_conversation',
          reference: parent,
          id: parent.sourceId,
          revision: parent.sourceRevision,
        },
      ],
    },
    registry,
    localData([]).data,
  );
  expect(restored.savedSummary).toMatchObject({
    status: 'saved',
    sourceChanged: true,
  });
  const alias = restored.hypotheses[0]!.supportingEvidence[0]!;
  expect(alias.sourceId).not.toBe(parent.sourceId);
  expect(
    (await registry.readSource(alias, new AbortController().signal)).status,
  ).toBe('unavailable');
});
