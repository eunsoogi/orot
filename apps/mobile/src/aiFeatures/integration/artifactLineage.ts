import type { EvidenceReference } from '@orot/agent-runtime';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';

// Only references disclosed in a searched artifact can be followed in this registry's session.
const lineages = new WeakMap<
  LocalEvidenceReferenceRegistry,
  Map<
    string,
    Map<
      string,
      {
        reference: EvidenceReference;
        parentId: string;
        parentRevision: string;
        sourceStatus: 'current' | 'changed' | 'unknown';
      }
    >
  >
>();

export function registerArtifactSource(
  registry: LocalEvidenceReferenceRegistry,
  operationRunId: string,
  reference: EvidenceReference,
  parent: {
    id: string;
    revision: string;
    sourceStatus: 'current' | 'changed' | 'unknown';
  },
) {
  let operations = lineages.get(registry);
  if (!operations) {
    operations = new Map();
    lineages.set(registry, operations);
  }
  let sources = operations.get(operationRunId);
  if (!sources) {
    if (operations.size >= 64)
      operations.delete(operations.keys().next().value!);
    sources = new Map();
    operations.set(operationRunId, sources);
  }
  sources.set(reference.evidenceId, {
    reference,
    parentId: parent.id,
    parentRevision: parent.revision,
    sourceStatus: parent.sourceStatus,
  });
}

export function artifactSource(
  registry: LocalEvidenceReferenceRegistry,
  operationRunId: string,
  id: string,
) {
  return lineages.get(registry)?.get(operationRunId)?.get(id);
}
