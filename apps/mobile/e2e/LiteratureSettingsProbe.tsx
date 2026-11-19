import ProviderSelectionScreen from '../src/providers/selection/ProviderSelectionScreen';
import { createAppleSelectionOption } from '../src/providers/selection/options';
import { providerSelectionStore } from '../src/providers/selection/keychainSelectionStore';

/** The real settings screen and stores persist the user's explicit medical-search choice. */
export function LiteratureSettingsProbe({ onBack }: { onBack: () => void }) {
  return (
    <ProviderSelectionScreen
      presentation="settings-provider"
      options={[createAppleSelectionOption('available')]}
      requirements={{ inputTypes: ['text'] }}
      selectionStore={providerSelectionStore}
      onBack={onBack}
      onSelectionCommitted={onBack}
    />
  );
}
