import { t } from '../../i18n';

// Feature messages use the shared locale catalog so every screen follows one translation boundary.
export const providerSelectionText = {
  title: t('provider.selection.title'),
  introduction: t('provider.selection.introduction'),
  selectPrompt: t('provider.selection.selectPrompt'),
  unavailableSelection: t('provider.selection.unavailableSelection'),
  selectedPrefix: t('provider.selection.selectedPrefix'),
  onDeviceHeading: t('provider.selection.onDeviceHeading'),
  onDevicePrivacy: t('provider.selection.onDevicePrivacy'),
  remoteHeading: t('provider.selection.remoteHeading'),
  remotePrivacy: t('provider.selection.remotePrivacy'),
  unsupportedCapabilities: t('provider.selection.unsupportedCapabilities'),
  storageLoadError: t('provider.selection.storageLoadError'),
  storageSaveError: t('provider.selection.storageSaveError'),
  saveInProgressTitle: t('provider.selection.saveInProgressTitle'),
  saveInProgressMessage: t('provider.selection.saveInProgressMessage'),
  saveInProgressConfirm: t('provider.selection.saveInProgressConfirm'),
  confirmApple: t('provider.selection.confirmApple'),
  confirmRemote: t('provider.selection.confirmRemote'),
  cancel: t('provider.selection.cancel'),
  unavailableProvider: t('provider.selection.unavailableProvider'),
  appleStatusError: t('provider.selection.appleStatusError'),
  appleDisabled: t('provider.selection.appleDisabled'),
  appleModelNotReady: t('provider.selection.appleModelNotReady'),
  appleUnsupportedDevice: t('provider.selection.appleUnsupportedDevice'),
  appleUnsupportedLanguage: t('provider.selection.appleUnsupportedLanguage'),
  chatGPTAccountRequired: t('provider.selection.chatGPTAccountRequired'),
  chatGPTAccountReadError: t('provider.selection.chatGPTAccountReadError'),
  chatGPTNoAccounts: t('provider.selection.chatGPTNoAccounts'),
  chatGPTAccountSignedIn: t('provider.selection.chatGPTAccountSignedIn'),
  chatGPTAccountSignedOut: t('provider.selection.chatGPTAccountSignedOut'),
  chatGPTAccountName: (accountNumber: number) =>
    t('provider.selection.chatGPTAccountName', { accountNumber }),
  chatGPTAccountMissingScope: t(
    'provider.selection.chatGPTAccountMissingScope',
  ),
  chatGPTChooseAccount: t('provider.selection.chatGPTChooseAccount'),
  chatGPTSignIn: t('provider.selection.chatGPTSignIn'),
  chatGPTReauthorize: t('provider.selection.chatGPTReauthorize'),
  chatGPTLoadModels: t('provider.selection.chatGPTLoadModels'),
  chatGPTCancelLogin: t('provider.selection.chatGPTCancelLogin'),
  chatGPTChecking: t('provider.selection.chatGPTChecking'),
  chatGPTLoginSuccess: t('provider.selection.chatGPTLoginSuccess'),
  chatGPTSignOutAccount: (accountNumber: number) =>
    t('provider.selection.chatGPTSignOutAccount', { accountNumber }),
  chatGPTSigningOut: (accountNumber: number) =>
    t('provider.selection.chatGPTSigningOut', { accountNumber }),
  chatGPTSignOutRemoteConfirmed: (accountNumber: number) =>
    t('provider.selection.chatGPTSignOutRemoteConfirmed', { accountNumber }),
  chatGPTSignOutLocalOnly: (accountNumber: number) =>
    t('provider.selection.chatGPTSignOutLocalOnly', { accountNumber }),
  chatGPTSignOutFailed: (accountNumber: number) =>
    t('provider.selection.chatGPTSignOutFailed', { accountNumber }),
  chatGPTModelsLoaded: t('provider.selection.chatGPTModelsLoaded'),
  chatGPTModelsUnavailable: t('provider.selection.chatGPTModelsUnavailable'),
  chatGPTLoginCancelled: t('provider.selection.chatGPTLoginCancelled'),
  chatGPTBack: t('provider.selection.back'),
} as const;
