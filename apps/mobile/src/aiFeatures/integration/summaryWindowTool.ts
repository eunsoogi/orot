import type { ResolveHealthContextWindow } from '../../healthEvidence/healthContext/availableWindow';
import type { EvidenceSearchTool } from '@orot/agent-runtime';
import type { HealthContextWindow } from '../../healthEvidence/healthContext/types';
import { stableJson } from './evidenceUtils';
import { recentHealthContextWindow } from '../../healthEvidence/healthContext/window';
import { parseHealthSummaryWindow } from '../../ragConversation/healthSummary';

/** Bind every model-selected query to the admitted period; reject attempts to change it. */
export function bindSummaryWindow(
  tool: EvidenceSearchTool,
  options: {
    readonly window?: HealthContextWindow;
    readonly endAt: string;
    readonly timeZone: string;
    readonly resolveWindow?: ResolveHealthContextWindow;
  },
): {
  tool: EvidenceSearchTool;
  admittedWindow: () => HealthContextWindow | undefined;
} {
  let admitted: HealthContextWindow | undefined;
  const parse = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return undefined;
    const input = value as Record<string, unknown>;
    const parsed = tool.parseInput(value);
    if (!parsed) return undefined;
    const window =
      input.window !== undefined
        ? parseHealthSummaryWindow(input.window)
        : input.days !== undefined
          ? recentHealthContextWindow(
              parsed.days as number,
              options.endAt,
              options.timeZone,
            )
          : (admitted ?? options.window);
    if (
      ((input.window !== undefined || input.days !== undefined) && !window) ||
      (options.window && stableJson(window) !== stableJson(options.window))
    )
      return undefined;
    const rest = { ...parsed };
    delete rest.days;
    return {
      ...rest,
      ...(window ? { window: { ...window } } : {}),
    };
  };
  return {
    admittedWindow: () => admitted,
    tool: {
      ...tool,
      description: `${tool.description} Keep the same period across this summary.`,
      parseInput: parse,
      async search(request) {
        // Availability metadata is local data too: do not read it outside admitted scope.
        if (
          request.signal.aborted ||
          !request.allowedScope.sourceKinds.includes('personal_record') ||
          request.allowedScope.sourceIds ||
          request.allowedScope.timeRange
        )
          return tool.search(request);
        let input = parse(request.input);
        if (!input)
          throw new Error(
            'The health summary period does not match the request.',
          );
        if (!input.window) {
          if (!options.resolveWindow)
            throw new Error(
              'An explicit summary period is required when availability cannot be resolved.',
            );
          const available = await options.resolveWindow(
            request.signal,
            options.endAt,
            options.timeZone,
          );
          if (!available) {
            return {
              items: [],
              coverage: [
                {
                  sourceKind: 'personal_record',
                  searchedSourceIds: [],
                  gaps: [],
                  truncated: false,
                  resultLimit: request.resultLimit,
                  returnedCount: 0,
                },
              ],
              conflicts: [],
            };
          }
          input = { ...input, window: { ...available } };
        }
        const window = input.window as unknown as HealthContextWindow;
        if (admitted && stableJson(admitted) !== stableJson(window))
          throw new Error('The health summary period changed.');
        const batch = await tool.search({ ...request, input });
        if ('status' in batch || !batch.items.length || request.signal.aborted)
          return batch;
        if (admitted && stableJson(admitted) !== stableJson(window))
          throw new Error('The health summary period changed.');
        admitted = window;
        return batch;
      },
    },
  };
}
