import { APPLE_PCC_PROVIDER_ID, APPLE_PROVIDER_ID } from '@orot/provider-apple';
import type { SavedPlatformChoice, SelectedAiResolution } from './provider';
import { t } from '../../i18n';

export type Presentation =
  | {
      readonly status:
        | 'loading'
        | 'selection-required'
        | 'unavailable'
        | 'catalog-unconfirmed';
    }
  | {
      readonly status:
        | 'saved'
        | 'saved-chatgpt'
        | 'saved-chatgpt-unverified'
        | 'ready'
        | 'saved-unavailable';
      readonly detail?: string;
      readonly name: string;
      readonly local: boolean;
    };

/** A saved remote label must be announced separately from readiness. */
export function providerControlCopy(shown: Presentation) {
  const named =
    shown.status === 'ready' ||
    shown.status === 'saved' ||
    shown.status === 'saved-chatgpt' ||
    shown.status === 'saved-chatgpt-unverified' ||
    shown.status === 'saved-unavailable';
  const value = named
    ? shown.name
    : shown.status === 'selection-required'
      ? t('provider.selection.rowPrompt')
      : shown.status === 'loading'
        ? t('provider.selection.rowLoading')
        : shown.status === 'catalog-unconfirmed'
          ? t('provider.selection.rowOpenSettings')
          : t('provider.selection.rowUnavailable');
  const rowLabel = `${t('provider.selection.rowTitle')}, ${
    shown.status === 'saved-chatgpt'
      ? t('provider.selection.rowSavedPendingLabel', { model: value })
      : shown.status === 'saved-chatgpt-unverified'
        ? t('provider.selection.rowSavedUnverifiedLabel', { model: value })
        : shown.status === 'saved-unavailable'
          ? `${value}. ${shown.detail ?? t('provider.selection.rowUnavailable')}`
          : value
  }`;

  return {
    local: named && shown.local,
    value,
    rowLabel,
    detail: shown.status === 'saved-unavailable' ? shown.detail : undefined,
    busy:
      shown.status === 'loading' ||
      shown.status === 'saved' ||
      shown.status === 'saved-chatgpt',
  };
}

/** A matching saved platform name is not discarded when eligibility fails. */
export function resolvedProviderPresentation(
  result: SelectedAiResolution,
  exactPlatform?: SavedPlatformChoice,
  observedName?: string,
): Presentation {
  // A verified resolver result is not itself an exact PCC presentation witness.
  if (
    result.status === 'ready' &&
    result.selection.providerId === APPLE_PCC_PROVIDER_ID &&
    exactPlatform !== 'pcc'
  )
    return { status: 'unavailable' };
  return result.status === 'ready'
    ? {
        status: 'ready',
        name: result.option.displayName,
        local: result.selection.providerId === APPLE_PROVIDER_ID,
      }
    : exactPlatform !== 'pcc' && observedName && result.status === 'unavailable'
      ? {
          status: 'saved-unavailable',
          name: observedName,
          local: exactPlatform === 'on-device',
          detail:
            result.reason === 'transient-catalog'
              ? t('provider.selection.rowOpenSettings')
              : result.platformMessage,
        }
      : {
          status:
            result.status === 'unavailable' &&
            result.reason === 'transient-catalog'
              ? 'catalog-unconfirmed'
              : result.status,
        };
}
