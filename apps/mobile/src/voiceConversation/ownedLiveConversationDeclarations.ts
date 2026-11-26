import {
  nativeToolParameterSchema,
  type EvidenceSearchTool,
} from '@orot/agent-runtime';
import { stable } from '../aiFeatures/integration/stableEvidenceReference';
import type { LiveCommonRegistration } from './nativeLiveCommonConversation';

type Definition = Pick<
  EvidenceSearchTool,
  'id' | 'description' | 'inputSchema'
>;
type Registration = LiveCommonRegistration['tools'];

/** Derive invocation declarations from the prepared Chat tools, never from a
 * parallel Live implementation. Native transport must attest this exact set
 * and order; a mismatch does not permit a partial registration or dispatch. */
export function matchesOwnedLiveConversationDeclarations(
  prepared: readonly Definition[],
  registered: Registration,
) {
  if (
    !prepared.length ||
    prepared.length !== registered.length ||
    new Set(prepared.map(tool => tool.id)).size !== prepared.length
  )
    return false;
  return (
    stable(
      prepared.map(tool => ({
        name: tool.id,
        description: tool.description,
        parameters: nativeToolParameterSchema(tool.inputSchema),
      })),
    ) === stable(registered)
  );
}
