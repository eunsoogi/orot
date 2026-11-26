import type { LanguageModelProvider } from '@orot/model-runtime';
import { chatGPTPlanDirectPhoto } from '@orot/provider-openai';
import type { ProviderSelectionOption } from '../../providers/selection/types';
import type { SettingsConsentPermission } from './settingsConsentGrant';

/** Raw photo pixels are neither OCR, model history, nor general record evidence. */
const legacyPolicyVersion = 'selected-inline-image-with-local-reply-v2';

export const directPhotoConsentScope = Object.freeze({
  purpose: 'conversation_direct_photo',
  policyVersion: 'selected-inline-photo-group-with-local-reply-v3',
  dataCategories: Object.freeze([
    'selected_photo_image',
    'selected_photo_question',
  ]),
});

export const legacyDirectPhotoConsentScope = Object.freeze({
  ...directPhotoConsentScope,
  policyVersion: legacyPolicyVersion,
});

/** Internal metadata-only authority descriptors, never the native request body. */
const scopePayload = (policyVersion: string) =>
  Object.freeze({
    messages: Object.freeze([
      Object.freeze({
        role: 'user' as const,
        content: policyVersion,
      }),
    ]),
  });

export const directPhotoScopePayload = scopePayload(
  directPhotoConsentScope.policyVersion,
);
export const legacyDirectPhotoScopePayload = scopePayload(legacyPolicyVersion);

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
    (policy === directPhotoConsentScope.policyVersion ||
      policy === legacyPolicyVersion)
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
