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
    current?: () => boolean;
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

/** The private-RAG adapter changes no evidence reader. Only an existing exact
 * owner can transfer its capability; source and target replacements revoke it. */
export function inheritConversationReadOperation(
  source: AiFeatureLocalData,
  target: AiFeatureLocalData,
): void {
  const owner = owners.get(source);
  const current = () =>
    Boolean(
      owner &&
      owners.get(source) === owner &&
      source.readHealthContext === owner.read &&
      source.summaryArtifactDiscovery === owner.summary &&
      (!owner.current || owner.current()),
    );
  if (
    !current() ||
    target === source ||
    target.readHealthContext !== owner!.read ||
    target.summaryArtifactDiscovery !== owner!.summary
  )
    return;
  owners.set(target, { ...owner!, current });
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
  const owned = () =>
    Boolean(
      owner &&
      owner.read &&
      owners.get(data) === owner &&
      owner.read === data.readHealthContext &&
      owner.summary === data.summaryArtifactDiscovery &&
      (!owner.current || owner.current()),
    );
  if (!owned()) return work(data);
  const operation = beginHealthContextReadOperation(
    owner!.read!,
    signal,
    shared,
  );
  if (!operation) return work(data);
  let active = true;
  const scoped: AiFeatureLocalData = new Proxy(data, {
    get(target, key, receiver) {
      if (
        active &&
        owned() &&
        key === 'readHealthContext' &&
        target.readHealthContext === owner!.read
      )
        return (
          ...args: Parameters<
            NonNullable<AiFeatureLocalData['readHealthContext']>
          >
        ) =>
          active && owned()
            ? operation.read(...args)
            : target.readHealthContext!(...args);
      if (
        active &&
        owned() &&
        key === 'summaryArtifactDiscovery' &&
        target.summaryArtifactDiscovery === owner!.summary
      )
        return (registry: LocalEvidenceReferenceRegistry) =>
          active && owned()
            ? owner!.factory(scoped, registry)
            : target.summaryArtifactDiscovery!(registry);
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
