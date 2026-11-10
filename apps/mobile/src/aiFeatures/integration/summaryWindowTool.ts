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
              parsed.days as 7 | 30 | 90,
              options.endAt,
              options.timeZone,
            )
          : (admitted ??
            options.window ??
            recentHealthContextWindow(30, options.endAt, options.timeZone));
    if (
      !window ||
      (options.window && stableJson(window) !== stableJson(options.window))
    )
      return undefined;
    const rest = { ...parsed };
    delete rest.days;
    return {
      ...rest,
      window: {
        fromInclusive: window.fromInclusive,
        toExclusive: window.toExclusive,
        timeZone: window.timeZone,
      },
    };
  };
  return {
    admittedWindow: () => admitted,
    tool: {
      ...tool,
      description: `${tool.description} Keep the same period across this summary.`,
      parseInput: parse,
      async search(request) {
        const input = parse(request.input);
        if (!input)
          throw new Error(
            'The health summary period does not match the request.',
          );
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
