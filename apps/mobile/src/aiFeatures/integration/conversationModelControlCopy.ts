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
      readonly status: 'saved' | 'saved-chatgpt' | 'ready';
      readonly name: string;
      readonly local: boolean;
    };

/** A saved remote label must be announced separately from readiness. */
export function providerControlCopy(shown: Presentation) {
  const named =
    shown.status === 'ready' ||
    shown.status === 'saved' ||
    shown.status === 'saved-chatgpt';
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
      : value
  }`;

  return {
    local: named && shown.local,
    value,
    rowLabel,
    busy:
      shown.status === 'loading' ||
      shown.status === 'saved' ||
      shown.status === 'saved-chatgpt',
  };
}
