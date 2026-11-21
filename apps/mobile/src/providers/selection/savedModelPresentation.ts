import { savedChatGPTModelLabel } from './knownChatGPTModelLabel';
import {
  calendarDecisionsModelLabel,
  calendarDecisionsProviderLabel,
} from '../../calendarModelSettings/calendarDecisionsPresentation';
import { APPLE_PROVIDER_ID } from '@orot/provider-apple';
import { calendarDecisionsModel } from '@orot/provider-openai';
import { t } from '../../i18n';
import { APPLE_FOUNDATION_MODEL_SELECTION_ID } from './options';
import {
  APPLE_PCC_MODEL_ID,
  APPLE_PCC_PROVIDER_ID,
} from './privateCloudCompute';
import type { ProviderSelection, ProviderSelectionOption } from './types';

/** Labels describe the stored choice, not provider readiness. Unknown catalog
 * entries never fall back to raw IDs or make a new account/model lookup. */
export function savedModelPresentation(
  saved: ProviderSelection,
  option?: ProviderSelectionOption,
  slot?: 'calendar',
  savedChatGPTTitle?: string,
): string {
  if (slot === 'calendar' && saved.providerId === 'openai-api-decisions') {
    return modelPresentation(
      calendarDecisionsProviderLabel,
      saved.modelId === calendarDecisionsModel
        ? calendarDecisionsModelLabel
        : undefined,
    );
  }
  const appleLocal = saved.providerId === APPLE_PROVIDER_ID;
  const applePcc = saved.providerId === APPLE_PCC_PROVIDER_ID;
  const chatGPTMatch =
    saved.providerId.startsWith('chatgpt-plan:') &&
    saved.providerId.endsWith(':' + saved.modelId) &&
    saved.providerId.length > 'chatgpt-plan::'.length + saved.modelId.length;
  const provider =
    appleLocal || applePcc
      ? 'Apple'
      : saved.providerId.startsWith('chatgpt-plan:')
        ? 'ChatGPT'
        : undefined;
  const knownApple =
    (appleLocal && saved.modelId === APPLE_FOUNDATION_MODEL_SELECTION_ID) ||
    (applePcc && saved.modelId === APPLE_PCC_MODEL_ID);
  const name = option?.displayName.trim();
  return modelPresentation(
    provider,
    name && name !== saved.modelId
      ? name
      : knownApple
        ? 'Apple Intelligence'
        : chatGPTMatch
          ? (savedChatGPTTitle ?? savedChatGPTModelLabel(saved.modelId))
          : undefined,
  );
}

/** Unknown is a presentation state, not an instruction to change the saved model. */
export function modelPresentation(provider?: string, model?: string): string {
  return [provider, model || t('modelSettings.modelNameUnknown')]
    .filter(Boolean)
    .join(' - ');
}
