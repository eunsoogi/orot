import { t } from '../../i18n';
import { resolveProviderSelection } from '../../providers/selection/providerSelection';
import { visitRecommendationRequirements } from '../../providers/selection/options';
import type {
  ProviderSelection,
  ProviderSelectionOption,
} from '../../providers/selection/types';
import { APPLE_PCC_PROVIDER_ID } from '../../providers/selection/privateCloudCompute';
import type { SelectedAiResolution } from './provider';

/** Keep eligibility authoritative; only the exact native platform's optional
 * reason reaches presentation, never a different provider's result. */
export function readySelection(
  selection: ProviderSelection,
  options: readonly ProviderSelectionOption[],
  platformPresentation = false,
): SelectedAiResolution {
  const result = resolveProviderSelection(
    selection,
    options,
    visitRecommendationRequirements,
  );
  if (!result.ok)
    return {
      status: 'unavailable',
      ...(platformPresentation &&
      result.reason === 'provider-unavailable' &&
      result.message
        ? { platformMessage: result.message }
        : {}),
    };
  const selected = options.find(
    option =>
      option.provider.id === selection.providerId &&
      option.modelId === selection.modelId,
  );
  if (!selected) return { status: 'unavailable' };
  return {
    status: 'ready',
    selection,
    option: selected,
    provider: result.provider,
    modelId: selected.modelId,
    recipient:
      selected.privacyBoundary === 'on-device'
        ? t('nextVisit.recipient.onDevice')
        : selected.provider.id === APPLE_PCC_PROVIDER_ID
          ? t('provider.pcc.recipient')
          : t('nextVisit.recipient.chatgpt'),
    remoteProcessing: selected.privacyBoundary === 'selected-context-remote',
  };
}
