import type { EvidenceSourceKind } from './contracts';
import { isSourceAllowed } from './evidence';
import type { RuntimeContext } from './runtimeContext';

/** Require only an unattempted, available source kind. This never reads records or constructs a query. */
export function missingNativeEvidenceKind<TResult>(
  context: RuntimeContext<TResult>,
): EvidenceSourceKind | undefined {
  const { options, currentEvidence } = context;
  if (!options.provider.capabilities.toolCalling) return undefined;
  return options.task.requiredToolEvidenceKinds?.find(
    (kind) =>
      isSourceAllowed(options.execution.allowedScope, kind) &&
      options.tools.some((tool) => tool.sourceKind === kind) &&
      !currentEvidence.items.some((item) => item.sourceKind === kind) &&
      // A completed empty search is distinct from an unperformed search. Existing
      // coverage validation still decides whether its gap permits an answer.
      !currentEvidence.coverage.some((coverage) => coverage.sourceKind === kind),
  );
}
