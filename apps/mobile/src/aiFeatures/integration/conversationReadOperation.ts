import type { CommittedReportScope } from '../../healthEvidence/healthContext/committedReportScope';
import { beginHealthContextReadOperation } from '../../healthEvidence/healthContext/healthContextReadOperation';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';

type SummaryFactory = (
  data: AiFeatureLocalData,
  registry: LocalEvidenceReferenceRegistry,
) => ReturnType<NonNullable<AiFeatureLocalData['summaryArtifactDiscovery']>>;

const owners = new WeakMap<
  AiFeatureLocalData,
  {
    read: AiFeatureLocalData['readHealthContext'];
    summary: AiFeatureLocalData['summaryArtifactDiscovery'];
    factory: SummaryFactory;
  }
>();

/** Called only by the production local-data factory with its own summary builder.
 * Neither source locators nor arbitrary/custom discovery objects confer ownership. */
export function registerConversationReadOperation(
  data: AiFeatureLocalData,
  factory: SummaryFactory,
) {
  owners.set(data, {
    read: data.readHealthContext,
    summary: data.summaryArtifactDiscovery,
    factory,
  });
}

/** Only aggregate report work is scoped. Every original source callback and its
 * order remain unchanged, including native and custom-source freshness checks. */
export async function withConversationReadOperation<T>(
  data: AiFeatureLocalData,
  work: (scoped: AiFeatureLocalData) => Promise<T>,
  signal?: AbortSignal,
  shared?: CommittedReportScope,
): Promise<T> {
  const owner = owners.get(data);
  if (
    !owner ||
    !owner.read ||
    owner.read !== data.readHealthContext ||
    owner.summary !== data.summaryArtifactDiscovery
  )
    return work(data);
  const operation = beginHealthContextReadOperation(owner.read, signal, shared);
  if (!operation) return work(data);
  let active = true;
  const scoped: AiFeatureLocalData = new Proxy(data, {
    get(target, key, receiver) {
      if (
        active &&
        key === 'readHealthContext' &&
        target.readHealthContext === owner.read
      )
        return operation.read;
      if (
        active &&
        key === 'summaryArtifactDiscovery' &&
        target.summaryArtifactDiscovery === owner.summary
      )
        return (registry: LocalEvidenceReferenceRegistry) =>
          owner.factory(scoped, registry);
      return Reflect.get(target, key, receiver);
    },
  });
  try {
    return await work(scoped);
  } finally {
    active = false;
    operation.dispose();
  }
}
