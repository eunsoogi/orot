import ProviderSelectionConfirmation from './ProviderSelectionConfirmation';
import ProviderSelectionOptionCard from './ProviderSelectionOptionCard';
import { resolutionMessage } from './providerSelectionScreenPresentation';
import type {
  ProviderSelectionOption,
  ProviderSelectionResolution,
  ProviderSelectionRequirements,
} from './types';

interface ProviderSelectionChoicesProps {
  readonly options: readonly ProviderSelectionOption[];
  readonly loading: boolean;
  readonly saving: boolean;
  readonly selectedOption: ProviderSelectionOption | undefined;
  readonly pendingOption: ProviderSelectionOption | null;
  readonly confirmationOption: ProviderSelectionOption | undefined;
  readonly pendingResolution: ProviderSelectionResolution | null;
  readonly requirements: ProviderSelectionRequirements;
  readonly onChoose: (option: ProviderSelectionOption) => void;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

/** Keeps provider cards and their explicit privacy confirmation together. */
export function ProviderSelectionChoices({
  options,
  loading,
  saving,
  selectedOption,
  pendingOption,
  confirmationOption,
  pendingResolution,
  requirements,
  onChoose,
  onCancel,
  onConfirm,
}: ProviderSelectionChoicesProps) {
  return (
    <>
      {options.map((option, index) => (
        <ProviderSelectionOptionCard
          key={`${option.provider.id}:${option.modelId}`}
          disabled={loading || saving}
          index={index}
          onPress={() => onChoose(option)}
          option={option}
          requirements={requirements}
          selected={
            selectedOption?.provider.id === option.provider.id &&
            selectedOption.modelId === option.modelId
          }
        />
      ))}

      {pendingOption && confirmationOption ? (
        <ProviderSelectionConfirmation
          blockedMessage={resolutionMessage(pendingResolution)}
          canConfirm={pendingResolution?.ok === true}
          onCancel={onCancel}
          onConfirm={onConfirm}
          option={confirmationOption}
          saving={saving}
        />
      ) : null}
    </>
  );
}
