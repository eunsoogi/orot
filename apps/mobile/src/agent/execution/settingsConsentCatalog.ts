import {
  directPhotoPermission,
  isDirectPhotoConsentScope,
  isExactDirectPhotoPermission,
} from './directPhotoConsentScope';
import {
  isLiveVoiceAudioScope,
  liveVoiceAudioPolicy,
  liveVoiceAudioPurpose,
  liveVoiceProviderId,
} from './liveVoiceSettingsIdentity';
import {
  isLiveResponsesContextScope,
  liveResponsesPermissions,
  liveResponsesAggregateV2Permissions,
  liveResponsesCommonToolsPermissions,
  liveResponsesProviderId,
} from '../../voiceSettings/liveResponsesSettingsIdentity';
import type { SettingsConsentPermission } from './settingsConsentGrant';
import { conversationSettingsPermissions } from './conversationSettingsPermissions';

/** Changing a declared boundary requires explicit settings consent again. This catalog
 * describes possible permissions; it does not enable a recipient or create a grant. */
export const SETTINGS_CONSENT_CATALOG_VERSION = 'model-settings-v1';
export type SettingsConsentFeature =
  'conversation' | 'calendar' | 'voice' | 'voice-responses';

const permission = (
  purpose: string,
  policyVersion: string,
  dataCategories: readonly string[],
  sourceKinds: readonly string[],
): SettingsConsentPermission => ({
  purpose,
  policyVersion,
  dataCategories,
  sourceKinds,
});

const calendar = [
  permission(
    'calendar_classification',
    'upcoming-year-v1',
    ['calendar_title_time'],
    ['personal_record'],
  ),
];
const voice = [
  permission(
    'realtime_audio',
    'selected-realtime-v1',
    ['live_voice_audio', 'voice_conversation'],
    ['personal_record'],
  ),
  permission(
    'realtime_result',
    'selected-result-relay-v1',
    ['generated_answer'],
    ['personal_record', 'generated_artifact'],
  ),
];

// Live media settings do not grant result relay or protected context.
const liveVoice = [
  permission(
    liveVoiceAudioPurpose,
    liveVoiceAudioPolicy,
    ['live_voice_audio', 'voice_conversation'],
    [],
  ),
];

/** Public search is deliberately separate: approving a text model does not grant
 * either the selected search recipient or Europe PMC access. */
export const publicSearchSettingsPermissions = {
  web: permission(
    'public_web_search',
    'controlled-public-topics-v2',
    ['public_web_search_terms'],
    ['external_medical'],
  ),
  medical: permission(
    'public_medical_search',
    'public-query-v1',
    ['medical_search_terms'],
    ['external_medical'],
  ),
} as const;

export function settingsPermissionsForFeature(
  feature: SettingsConsentFeature,
  providerId?: string,
  reviewedDirectPhoto = false,
): readonly SettingsConsentPermission[] {
  const values =
    feature === 'conversation'
      ? reviewedDirectPhoto && providerId?.startsWith('chatgpt-plan:')
        ? [...conversationSettingsPermissions, directPhotoPermission]
        : conversationSettingsPermissions
      : feature === 'calendar'
        ? calendar
        : feature === 'voice'
          ? providerId === liveVoiceProviderId
            ? liveVoice
            : voice
          : feature === 'voice-responses'
            ? providerId === liveResponsesProviderId
              ? liveResponsesPermissions
              : []
            : null;
  if (!values) throw new Error('Unknown settings consent feature');
  return values.map(value => ({
    ...value,
    dataCategories: [...value.dataCategories],
    sourceKinds: [...value.sourceKinds],
  }));
}

/** A durable row cannot introduce arbitrary purpose/category names under a known
 * catalog version. Exact recipient/account ownership is checked separately. */
export function isCatalogPermission(value: SettingsConsentPermission): boolean {
  if (isDirectPhotoConsentScope(value.purpose, value.policyVersion))
    return isExactDirectPhotoPermission(value);
  return [
    ...conversationSettingsPermissions,
    ...calendar,
    ...voice,
    ...liveVoice,
    ...liveResponsesPermissions,
    ...liveResponsesAggregateV2Permissions,
    ...Object.values(publicSearchSettingsPermissions),
  ].some(
    known =>
      known.purpose === value.purpose &&
      known.policyVersion === value.policyVersion &&
      value.dataCategories.length > 0 &&
      (isLiveVoiceAudioScope(value.purpose, value.policyVersion) ||
      isLiveResponsesContextScope(value.purpose, value.policyVersion)
        ? value.sourceKinds.length === 0
        : value.sourceKinds.length > 0) &&
      value.dataCategories.every(category =>
        known.dataCategories.includes(category),
      ) &&
      value.sourceKinds.every(kind => known.sourceKinds.includes(kind)),
  );
}

/** The selected recipient domain is part of the permission boundary, not a display label. */
export function isCatalogDomainPermission(
  feature: SettingsConsentFeature,
  domain: 'model' | 'public-web' | 'medical-search',
  value: SettingsConsentPermission,
  providerId?: string,
): boolean {
  const candidates =
    domain === 'model'
      ? feature === 'voice-responses' && providerId === liveResponsesProviderId
        ? [...liveResponsesPermissions, ...liveResponsesCommonToolsPermissions]
        : settingsPermissionsForFeature(feature, providerId, true)
      : feature !== 'conversation'
        ? []
        : domain === 'public-web'
          ? [publicSearchSettingsPermissions.web]
          : domain === 'medical-search'
            ? [publicSearchSettingsPermissions.medical]
            : [];
  return (
    isCatalogPermission(value) &&
    candidates.some(
      known =>
        known.purpose === value.purpose &&
        (feature !== 'voice-responses' ||
          value.purpose !== 'record_conversation' ||
          (value.dataCategories.every(category =>
            known.dataCategories.includes(category),
          ) &&
            value.sourceKinds.every(kind =>
              known.sourceKinds.includes(kind),
            ))) &&
        (known.policyVersion === value.policyVersion ||
          (known.purpose === directPhotoPermission.purpose &&
            known.policyVersion === directPhotoPermission.policyVersion &&
            isDirectPhotoConsentScope(value.purpose, value.policyVersion))),
    )
  );
}
