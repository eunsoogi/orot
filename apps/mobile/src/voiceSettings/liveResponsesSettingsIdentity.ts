import type { SettingsConsentPermission } from '../agent/execution/settingsConsentGrant';

export const liveResponsesBackends = ['gpt-6-luna', 'gpt-6-sol'] as const;
export type LiveResponsesBackend = (typeof liveResponsesBackends)[number];
export function isLiveResponsesBackend(
  value: unknown,
): value is LiveResponsesBackend {
  return value === 'gpt-6-luna' || value === 'gpt-6-sol';
}
export const liveResponsesSlot = 'voice-responses';
export const liveResponsesProviderId = 'openai-live-responses';
export const liveResponsesRecipient = 'OpenAI Responses (Live)';
const contextPurpose = 'live_responses_context';
const contextPolicy = 'selected-live-responses-context-v1';

export const isLiveResponsesContextScope = (
  purpose: unknown,
  policy: unknown,
) => purpose === contextPurpose && policy === contextPolicy;

// The continuing grant never authorizes executing a tool or releasing exact output.
// The runtime separately checks the current tool owner, evidence and user approval.
export const liveResponsesPermissions: readonly SettingsConsentPermission[] = [
  {
    purpose: contextPurpose,
    policyVersion: contextPolicy,
    dataCategories: ['voice_conversation'],
    sourceKinds: [],
  },
  {
    purpose: 'live_responses_health_aggregate',
    policyVersion: 'selected-health-aggregate-result-v1',
    dataCategories: ['health_aggregate'],
    sourceKinds: ['personal_record'],
  },
];

export const liveResponsesAggregateV2Permissions: readonly SettingsConsentPermission[] =
  [
    liveResponsesPermissions[0]!,
    {
      purpose: 'live_responses_health_aggregate',
      policyVersion: 'selected-live-heart-rate-aggregate-v2',
      dataCategories: ['health_aggregate'],
      sourceKinds: ['personal_record'],
    },
  ];

/** V1 disclosed recurring decisions; matching it must never authorize V2. */
export function liveResponsesPermissionVersion(
  permissions: readonly SettingsConsentPermission[],
) {
  const exact = JSON.stringify(permissions);
  if (exact === JSON.stringify(liveResponsesAggregateV2Permissions))
    return 'headless-v2';
  if (exact === JSON.stringify(liveResponsesPermissions))
    return 'interactive-v1';
}
