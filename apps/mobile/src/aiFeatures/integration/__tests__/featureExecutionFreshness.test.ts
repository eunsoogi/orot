import { executionOptions } from '../featureServiceExecution';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import {
  publicEvidenceFixture,
  webReference,
} from '../testSupport/publicWebEvidenceTestSupport';

/** Empty coverage is not evidence; nonempty identities must still pass their original validators. */
test('allows no-reference freshness only while active and rejects unknown or stale sources', async () => {
  const f = publicEvidenceFixture();
  const registry = new LocalEvidenceReferenceRegistry();
  let current = true;
  const item = registry.add({
    reference: {
      ...webReference,
      sourceKind: 'personal_record',
      sourceId: 'synthetic-local',
    },
    content: 'Synthetic source',
    validate: async () => current,
    readSource: async () => ({ status: 'missing' }),
  });
  const workflow = executionOptions({
    selected: f.selected,
    consent: f.consent,
    registry,
    tools: [],
    operationRunId: 'synthetic-run',
    consentPurpose: 'record_conversation',
  });
  const signal = f.controller.signal;
  await expect(workflow.revalidateEvidence([], signal)).resolves.toBe(true);
  await expect(workflow.revalidateEvidence([item], signal)).resolves.toBe(true);
  current = false;
  await expect(workflow.revalidateEvidence([item], signal)).resolves.toBe(
    false,
  );
  await expect(
    workflow.revalidateEvidence([webReference], signal),
  ).resolves.toBe(false);
  f.controller.abort();
  await expect(workflow.revalidateEvidence([], signal)).resolves.toBe(false);
  await expect(workflow.revalidateEvidence([item], signal)).resolves.toBe(
    false,
  );
});
