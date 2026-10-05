import type { LanguageModelProvider } from '@orot/model-runtime';
import type {
  ProviderSelection,
  ProviderSelectionOption,
  ProviderSelectionRequirements,
  ProviderSelectionResolution,
} from './types';

export function supportsProviderRequirements(
  provider: LanguageModelProvider,
  requirements: ProviderSelectionRequirements,
): boolean {
  const { capabilities } = provider;
  if (
    !requirements.inputTypes.every(type =>
      capabilities.inputTypes.includes(type),
    )
  ) {
    return false;
  }
  if (requirements.streaming && !capabilities.streaming) return false;
  if (requirements.structuredOutput && !capabilities.structuredOutput) {
    return false;
  }
  if (requirements.toolCalling && !capabilities.toolCalling) return false;
  return true;
}

export function isProviderSelectionOptionSelectable(
  option: ProviderSelectionOption,
  requirements: ProviderSelectionRequirements,
): boolean {
  return (
    option.availability.status === 'available' &&
    supportsProviderRequirements(option.provider, requirements)
  );
}

export function filterSelectableProviders(
  options: readonly ProviderSelectionOption[],
  requirements: ProviderSelectionRequirements,
): readonly ProviderSelectionOption[] {
  return options.filter(option =>
    isProviderSelectionOptionSelectable(option, requirements),
  );
}

export function resolveProviderSelection(
  selection: ProviderSelection | null,
  options: readonly ProviderSelectionOption[],
  requirements: ProviderSelectionRequirements,
): ProviderSelectionResolution {
  if (!selection) return { ok: false, reason: 'selection-required' };

  // Both identifiers must still match; availability changes never choose another provider.
  const selected = options.find(
    option =>
      option.provider.id === selection.providerId &&
      option.modelId === selection.modelId,
  );
  if (!selected) return { ok: false, reason: 'selection-unavailable' };
  if (selected.availability.status === 'unavailable') {
    return {
      ok: false,
      reason: 'provider-unavailable',
      message: selected.availability.message,
    };
  }
  if (!supportsProviderRequirements(selected.provider, requirements)) {
    return { ok: false, reason: 'missing-capability' };
  }

  return { ok: true, provider: selected.provider };
}
