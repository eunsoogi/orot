import type { LanguageModelProvider } from '@orot/model-runtime';
import { chatGPTPlanDirectPhoto } from '@orot/provider-openai';
import type { ProviderSelectionOption } from '../../providers/selection/types';
import type { SettingsConsentPermission } from './settingsConsentGrant';

/** Raw photo pixels are neither OCR, model history, nor general record evidence. */
export const directPhotoConsentScope = Object.freeze({
  purpose: 'conversation_direct_photo',
  policyVersion: 'selected-inline-image-with-local-reply-v2',
  dataCategories: Object.freeze([
    'selected_photo_image',
    'selected_photo_question',
  ]),
});

/** Internal metadata-only authority descriptor, never the native request body. */
export const directPhotoScopePayload = Object.freeze({
  messages: Object.freeze([
    Object.freeze({
      role: 'user' as const,
      content: directPhotoConsentScope.policyVersion,
    }),
  ]),
});

export function isDirectPhotoPlanPair(providerId: string, modelId: string) {
  return (
    providerId.startsWith('chatgpt-plan:') &&
    providerId.endsWith(':' + modelId) &&
    (modelId === 'gpt-6.2-sol' || modelId === 'gpt-6.2-astra')
  );
}

export const directPhotoPermission: SettingsConsentPermission = Object.freeze({
  ...directPhotoConsentScope,
  sourceKinds: Object.freeze([]),
});

export function isDirectPhotoConsentScope(purpose: unknown, policy: unknown) {
  return (
    purpose === directPhotoConsentScope.purpose &&
    policy === directPhotoConsentScope.policyVersion
  );
}

export function isExactDirectPhotoPermission(
  permission: SettingsConsentPermission,
) {
  return (
    isDirectPhotoConsentScope(permission.purpose, permission.policyVersion) &&
    !permission.sourceKinds.length &&
    permission.dataCategories.length ===
      directPhotoPermission.dataCategories.length &&
    directPhotoPermission.dataCategories.every(category =>
      permission.dataCategories.includes(category),
    )
  );
}

export type DirectPhotoOption = Pick<
  ProviderSelectionOption,
  'modelId' | 'privacyBoundary'
> & {
  readonly provider: Pick<LanguageModelProvider, 'id'>;
};

export function canDiscloseDirectPhoto(option: DirectPhotoOption) {
  if (
    option.privacyBoundary !== 'selected-context-remote' ||
    !isDirectPhotoPlanPair(option.provider.id, option.modelId)
  )
    return false;
  // Identity-only lookup: a synthetic object with the correct ID cannot mint an adapter.
  const capability = chatGPTPlanDirectPhoto(
    option.provider as LanguageModelProvider,
  );
  return capability?.model === option.modelId;
}
