import { t } from '../../i18n';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../../layout/AppText';
import { AppSymbol } from '../../layout/AppSymbol';
import { providerSettingsStyles as shared } from '../../layout/providerSettingsPresentation';
import { appColors } from '../../layout/appColors';
import type { ChatGPTAccountSetup } from './types';
import { providerSelectionText as copy } from './text';
import { OpenAIProviderMark } from './OpenAIProviderMark';

/** Account controls use actual authentication state; model selection never implies consent. */
export function ProviderCatalogAccount({
  setup,
}: {
  readonly setup: ChatGPTAccountSetup;
}) {
  const index = setup.accounts.findIndex(
    account => account.issuedClientID === setup.selectedAccountID,
  );
  const account = setup.accounts[index];
  const [expanded, setExpanded] = useState(false);
  const ready =
    account && !account.requiresSignIn && account.hasDirectPlanAccess;
  // Cancelling an active sign-in remains available while starting other actions is disabled.
  const actionDisabled =
    !setup.signingIn && (setup.busy || setup.actionDisabled);
  // Settings keeps authentication on its dedicated account route.
  const actionVisible =
    setup.presentation !== 'settings-provider' || Boolean(ready);
  const actionBusy = setup.busy || setup.signingIn || setup.signingOut;
  // Preserve the prior success wording as VoiceOver's action name after loading.
  const actionLabel = setup.signingIn
    ? copy.chatGPTCancelLogin
    : ready && setup.statusMessage === copy.chatGPTModelsLoaded
      ? t('modelSettings.refreshModels')
      : setup.actionTitle;
  return (
    <View style={styles.container} testID="chatgpt-account-setup">
      <View style={shared.catalogContent}>
        <View style={shared.header}>
          <View style={shared.icon}>
            <OpenAIProviderMark />
          </View>
          <Pressable
            style={shared.copy}
            accessibilityRole="button"
            accessibilityLabel={t('modelSettings.chatgptAccount')}
            accessibilityState={{ expanded }}
            onPress={() => setExpanded(value => !value)}
            testID="chatgpt-account-details"
          >
            <Text style={shared.title}>ChatGPT</Text>
            <Text style={shared.secondary}>
              {account
                ? copy.chatGPTAccountName(index + 1)
                : copy.chatGPTNoAccounts}
            </Text>
          </Pressable>
          {actionVisible ? (
            <View
              pointerEvents="box-none"
              style={shared.catalogActionLane}
              testID="chatgpt-account-action-lane"
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={actionLabel}
                accessibilityState={{
                  disabled: actionDisabled,
                  busy: actionBusy,
                }}
                disabled={actionDisabled}
                onPress={
                  setup.signingIn ? setup.onCancelSignIn : setup.onAction
                }
                testID={
                  setup.signingIn
                    ? 'chatgpt-cancel-sign-in'
                    : setup.presentation === 'settings-provider'
                      ? 'settings-provider-load-models'
                      : 'chatgpt-account-action'
                }
                style={shared.action}
              >
                <AppSymbol
                  name="arrow.triangle.2.circlepath"
                  size={18}
                  color={appColors.primary}
                />
              </Pressable>
            </View>
          ) : null}
        </View>
        {(expanded || setup.accounts.length > 1 || !ready) &&
          setup.accounts.map((item, number) => (
            <Pressable
              key={item.issuedClientID}
              accessibilityRole="radio"
              accessibilityState={{
                selected: item.issuedClientID === setup.selectedAccountID,
                disabled: setup.busy,
              }}
              disabled={setup.busy}
              onPress={() => setup.onAccountSelected(item.issuedClientID)}
              testID={`chatgpt-account-${number}`}
              style={styles.action}
            >
              <View style={styles.accountCopy}>
                <Text style={styles.accountText}>
                  {copy.chatGPTAccountName(number + 1)}
                </Text>
                <Text
                  style={styles.accountText}
                  testID={`chatgpt-account-permission-${number}`}
                >
                  {item.requiresSignIn
                    ? copy.chatGPTAccountSignedOut
                    : item.hasDirectPlanAccess
                      ? copy.chatGPTAccountSignedIn
                      : copy.chatGPTAccountMissingScope}
                </Text>
              </View>
            </Pressable>
          ))}
        {setup.statusMessage &&
        setup.statusMessage !== copy.chatGPTNoAccounts &&
        (expanded || setup.statusMessage !== copy.chatGPTModelsLoaded) ? (
          <Text
            testID="chatgpt-account-status"
            accessibilityRole={setup.statusIsError ? 'alert' : undefined}
            style={setup.statusIsError ? styles.error : shared.secondary}
          >
            {setup.statusMessage}
          </Text>
        ) : null}
        {expanded && setup.onOpenAccounts ? (
          <Pressable
            accessibilityRole="button"
            onPress={setup.onOpenAccounts}
            testID="settings-provider-manage-accounts"
            style={styles.action}
          >
            <Text style={styles.link}>{t('modelSettings.manageAccount')}</Text>
          </Pressable>
        ) : null}
        {(expanded || setup.accounts.length > 1) &&
        account &&
        !account.requiresSignIn &&
        setup.presentation === 'feature' ? (
          <Pressable
            accessibilityRole="button"
            disabled={setup.busy}
            onPress={() => setup.onSignOut(account.issuedClientID)}
            testID="chatgpt-account-sign-out"
            style={styles.action}
          >
            <Text style={shared.secondary}>
              {copy.chatGPTSignOutAccount(index + 1)}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  container: { position: 'relative' },
  // A single bounded text column lets long locale copy wrap before the action lane.
  accountCopy: { flex: 1, minWidth: 0, gap: 2 },
  accountText: { flexShrink: 1, minWidth: 0, color: appColors.secondary },
  action: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexShrink: 1,
  },
  link: {
    fontSize: 14,
    color: appColors.primary,
    fontWeight: '600',
    flexShrink: 1,
  },
  error: { color: appColors.danger },
});
