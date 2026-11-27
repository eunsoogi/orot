import type { SelectedAiResolution } from '../aiFeatures/integration/provider';
import type { ProviderSelection } from '../providers/selection/types';

/** A matching display name or model ID is not proof that this is the originally selected on-device model. */
export function matchesLocalEncounterSelection(
  selected: Extract<SelectedAiResolution, { status: 'ready' }>,
  choice: ProviderSelection,
) {
  return (
    !selected.remoteProcessing &&
    selected.option.privacyBoundary === 'on-device' &&
    selected.provider.id === choice.providerId &&
    selected.selection.providerId === choice.providerId &&
    selected.selection.modelId === choice.modelId &&
    selected.option.provider.id === choice.providerId &&
    selected.option.modelId === choice.modelId &&
    selected.modelId === choice.modelId
  );
}
