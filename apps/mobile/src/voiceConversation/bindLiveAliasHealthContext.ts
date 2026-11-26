import { bindHealthContextTool } from '../aiFeatures/integration/bindHealthContextTool';
import type { AiFeatureLocalData } from '../aiFeatures/integration/localData';
import type { LocalEvidenceReferenceRegistry } from '../aiFeatures/integration/evidenceRegistry';
import { committedHealthContextSnapshotReader } from '../healthEvidence/healthContext/reader';

/** The aggregate alias uses the same scope, report, payload cap and final
 * registry validation. Reuse only the immutable object the reader already cached. */
export function bindLiveAliasHealthContext(
  data: Pick<
    AiFeatureLocalData,
    'readHealthContext' | 'resolveHealthContextWindow'
  >,
  registry: LocalEvidenceReferenceRegistry,
) {
  const read = data.readHealthContext;
  if (!read) return;
  return bindHealthContextTool(
    {
      readHealthContext: committedHealthContextSnapshotReader(read),
      resolveHealthContextWindow: data.resolveHealthContextWindow,
    },
    registry,
    'rag',
  );
}
