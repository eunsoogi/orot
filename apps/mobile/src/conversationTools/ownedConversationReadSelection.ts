import {
  nativeToolParameterSchema,
  type EvidenceSearchRequest,
  type EvidenceSearchTool,
} from '@orot/agent-runtime';
import type { JsonObject } from '@orot/model-runtime';
import { stable } from '../aiFeatures/integration/stableEvidenceReference';

export type OwnedConversationReadTool = Readonly<
  Pick<EvidenceSearchTool, 'id' | 'sourceKind' | 'inputSchema' | 'parseInput'>
>;
export type CurrentConversationRead = {
  readonly current: () => boolean;
};

/** Match an existing app-owned admission to one stock tool and the exact graph
 * request it runs. A normalized declaration proves compatibility, not
 * permission. The owner supplies current authorization and source protection;
 * this witness grants neither an additional source nor outbound transfer. */
export function prepareOwnedConversationReadSelection(input: {
  readonly declaration: Readonly<{ name: string; parameters: JsonObject }>;
  readonly operationRunId: string;
  readonly allowedScope: EvidenceSearchRequest['allowedScope'];
  readonly admittedArguments: string;
  readonly current: () => boolean;
  readonly protectedDataAvailable: () => Promise<boolean>;
}) {
  const { name, parameters } = input.declaration;
  const { operationRunId, current } = input;
  const sourceKinds = new Set(input.allowedScope.sourceKinds);
  const scopeStamp = stable(input.allowedScope);
  const schemaStamp = stable(parameters);
  let args: unknown;
  try {
    args = JSON.parse(input.admittedArguments);
  } catch {
    return;
  }

  const permits = (tool: OwnedConversationReadTool) =>
    current() === true &&
    tool.id === name &&
    sourceKinds.has(tool.sourceKind) &&
    stable(nativeToolParameterSchema(tool.inputSchema)) === schemaStamp;
  return {
    permits,
    async beforeRead(
      signal: AbortSignal,
      request: EvidenceSearchRequest,
      tool: OwnedConversationReadTool,
    ): Promise<CurrentConversationRead | false> {
      if (
        signal !== request.signal ||
        signal.aborted ||
        request.operationRunId !== operationRunId ||
        !permits(tool)
      )
        return false;
      let parsed: JsonObject | undefined;
      try {
        // Both channels run the stock parser. Never equate raw provider text
        // with the actual request that the shared graph is about to execute.
        parsed = tool.parseInput(args);
      } catch {
        return false;
      }
      if (!parsed) return false;
      const argsStamp = stable(parsed);
      const stillCurrent = () =>
        !signal.aborted &&
        request.operationRunId === operationRunId &&
        permits(tool) &&
        stable(request.allowedScope) === scopeStamp &&
        stable(request.input) === argsStamp;
      if (
        !stillCurrent() ||
        (await input.protectedDataAvailable()) !== true ||
        !stillCurrent()
      )
        return false;
      return Object.freeze({ current: stillCurrent });
    },
  };
}
