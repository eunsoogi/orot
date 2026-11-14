import { referenceOnly } from '../../../diseaseHypotheses/resultValidation';
import type {
  EvidenceReference,
  ToolSourceReference,
} from '@orot/agent-runtime';
import { LocalEvidenceReferenceRegistry as Registry } from '../evidenceRegistry';
import type { ResearchInputTrackerSnapshot } from '../researchInputTrackerSnapshot';
export const scope = {
  sessionId: 'synthetic-session',
  operationRunId: 'synthetic-run',
};
export const call = { ...scope, callId: 'tool-1' };
export const source: ToolSourceReference = {
  sourceKind: 'external_medical',
  sourceId: 'public-source',
  sourceRevision: 'retrieved-v1',
  evidenceId: 'public-evidence',
  evidenceRevision: 'retrieved-v1',
};
export function fixture() {
  const registry = new Registry();
  const original: EvidenceReference = {
    sourceKind: 'generated_artifact',
    sourceId: 'research-1',
    sourceRevision: 'v1',
    evidenceId: 'research-1',
    evidenceRevision: 'v1',
    locator: { kind: 'generated_artifact', type: 'research_publication' },
    effectiveTime: null,
    reviewState: 'unknown',
  };
  const validate = jest.fn(async () => true);
  const readSource = jest.fn(async () => ({ status: 'unavailable' as const }));
  const alias = referenceOnly(
    registry.add({
      reference: original,
      content: '',
      validate,
      readSource,
    }),
  );
  const other = referenceOnly(
    registry.add({
      reference: {
        ...original,
        sourceId: 'research-2',
        evidenceId: 'research-2',
      },
      content: '',
      validate,
      readSource,
    }),
  );
  registry.toolReferences.bindResearch(source, alias, call);
  registry.toolReferences.bindResearch(source, alias, call, true);
  const resolve = (ref: EvidenceReference) => registry.resolve(ref);
  const snapshot = registry.toolReferences.snapshotScope(
    scope,
    ['tool-1'],
    resolve,
  );
  const fresh = Registry.restore(registry.snapshot(), registry);
  const trackerSnapshot: ResearchInputTrackerSnapshot = {
    version: 1,
    incomplete: false,
    scopeBindings: 'not_captured',
    inputs: [{ reference: alias, original }],
    retained: [{ id: 'research-1', revision: 'v1', reference: alias }],
  };
  return {
    registry,
    fresh,
    alias,
    other,
    resolve,
    snapshot,
    trackerSnapshot,
    validate,
    readSource,
  };
}
