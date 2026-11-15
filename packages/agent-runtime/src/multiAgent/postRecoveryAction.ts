import type { LocalActionTool } from './actionContracts';
import { canonicalJson } from './protocol';

/** A recovered invocation never regains its mutation adapter. Only a different
 * input at a strictly later ordinal may use that adapter after a new approval.
 * Consume the local grant and advance the ordinal before dispatch, including errors.
 */
export function postRecoveryAction(
  action: LocalActionTool,
  runId: string,
  key: string,
  originalInput: Parameters<LocalActionTool['authorize']>[0],
) {
  let ordinal = Number(key.slice(5));
  let approved: string | undefined;
  let authorization = 0;
  let approvedSignal: AbortSignal | undefined;
  const original = canonicalJson(originalInput);
  return {
    async authorize(input: Parameters<typeof action.authorize>[0], signal: AbortSignal) {
      approved = undefined;
      approvedSignal = undefined;
      const attempt = ++authorization;
      const payload = canonicalJson(input);
      if (signal.aborted || payload === original) return false;
      const allowed = await action.authorize(input, signal);
      if (!allowed || signal.aborted || attempt !== authorization) return false;
      approved = payload;
      approvedSignal = signal;
      return true;
    },
    async execute(request: Parameters<typeof action.execute>[0]) {
      const next = /^tool-[1-9]\d*$/.test(request.operationKey)
        ? Number(request.operationKey.slice(5))
        : NaN;
      const payload = canonicalJson(request.input);
      const allowed =
        !request.signal.aborted &&
        approvedSignal === request.signal &&
        request.operationRunId === runId &&
        Number.isSafeInteger(next) &&
        next > ordinal &&
        payload !== original &&
        approved === payload;
      approved = undefined;
      approvedSignal = undefined;
      if (!allowed) throw new Error('New action after recovery is not authorized.');
      ordinal = next;
      return action.execute(request);
    },
  };
}
