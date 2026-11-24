import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { createHealthContextTool } from './healthContextTool';

/** Bind the canonical Conversation tool without constructing unrelated search and
 * memory tools. A transport may impose a narrower approval/scope, but not
 * replace this descriptor, parser, aggregation, or evidence implementation. */
export function bindHealthContextTool(
  data: Pick<
    AiFeatureLocalData,
    'readHealthContext' | 'resolveHealthContextWindow'
  >,
  registry: LocalEvidenceReferenceRegistry,
  feature: 'disease' | 'rag',
) {
  const read = data.readHealthContext;
  if (!read) return;
  // Ordinary Conversation re-proves unexposed evidence; other features keep their single-read contract.
  return createHealthContextTool(
    read,
    registry,
    feature,
    feature === 'rag',
    data.resolveHealthContextWindow,
  );
}
