import type { EvidenceSearchTool, ProviderStopObservation } from './contracts';
import type { WorkflowState } from './state';

/** Tool declarations are trusted adapter metadata, never model arguments. Local
 * reads cannot spend model slots; unknown or larger declared costs fail at startup. */
export function validToolModelCost(tool: EvidenceSearchTool): boolean {
  return (
    tool.additionalModelCalls === undefined ||
    (tool.additionalModelCalls === 1 && tool.execution === 'external_read_only')
  );
}

/** Leave one slot for the responder after a delegated request. Ordinary zero-cost
 * tools keep their existing availability and search/checkpoint behavior. */
export function canReserveToolModelCall(tool: EvidenceSearchTool, state: WorkflowState): boolean {
  return (
    tool.additionalModelCalls === undefined ||
    state.modelCalls + tool.additionalModelCalls < state.budget.maxModelCalls
  );
}

/** A cancelled adapter can still have an underlying provider request in flight.
 * Without a provider acknowledgement the workflow must not claim it never started. */
export function toolProviderStop(tool: EvidenceSearchTool): ProviderStopObservation {
  return tool.additionalModelCalls ? 'underlying_call_unconfirmed' : 'not_started';
}
