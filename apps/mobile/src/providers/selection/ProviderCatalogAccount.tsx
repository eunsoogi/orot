import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../../layout/AppText';
import { AppSymbol } from '../../layout/AppSymbol';
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
  return (
    <View style={styles.container} testID="chatgpt-account-setup">
      <View style={styles.header}>
        <View style={styles.icon}>
          <OpenAIProviderMark />
        </View>
        <Pressable
          style={styles.copy}
          accessibilityRole="button"
          accessibilityLabel="ChatGPT 계정 관리"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded(value => !value)}
          testID="chatgpt-account-details"
        >
          <Text style={styles.title}>ChatGPT</Text>
          <Text style={styles.secondary}>
            {account
              ? copy.chatGPTAccountName(index + 1)
              : copy.chatGPTNoAccounts}
          </Text>
        </Pressable>
        {/* Settings keeps authentication on its dedicated account route. */}
        {setup.presentation !== 'settings-provider' || ready ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{
              disabled: actionDisabled,
            }}
            disabled={actionDisabled}
            onPress={setup.signingIn ? setup.onCancelSignIn : setup.onAction}
            testID={
              setup.signingIn
                ? 'chatgpt-cancel-sign-in'
                : setup.presentation === 'settings-provider'
                  ? 'settings-provider-load-models'
                  : 'chatgpt-account-action'
            }
            style={styles.action}
          >
            <AppSymbol
              name="arrow.triangle.2.circlepath"
              size={18}
              color={appColors.primary}
            />
            <Text style={styles.link}>
              {setup.signingIn
                ? copy.chatGPTCancelLogin
                : ready && setup.statusMessage === copy.chatGPTModelsLoaded
                  ? '모델 새로고침'
                  : setup.actionTitle}
            </Text>
          </Pressable>
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
            <Text style={styles.secondary}>
              {copy.chatGPTAccountName(number + 1)}
            </Text>
            <Text style={styles.secondary}>
              {item.requiresSignIn
                ? copy.chatGPTAccountSignedOut
                : item.hasDirectPlanAccess
                  ? copy.chatGPTAccountSignedIn
                  : copy.chatGPTAccountMissingScope}
            </Text>
          </Pressable>
        ))}
      {setup.statusMessage &&
      setup.statusMessage !== copy.chatGPTNoAccounts &&
      (expanded || setup.statusMessage !== copy.chatGPTModelsLoaded) ? (
        <Text
          testID="chatgpt-account-status"
          accessibilityRole={setup.statusIsError ? 'alert' : undefined}
          style={setup.statusIsError ? styles.error : styles.secondary}
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
          <Text style={styles.link}>계정 관리</Text>
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
          <Text style={styles.secondary}>
            {copy.chatGPTSignOutAccount(index + 1)}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  container: { gap: 8, padding: 10 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 15,
    backgroundColor: appColors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, gap: 5 },
  title: { fontSize: 18, fontWeight: '600', color: appColors.text },
  secondary: { fontSize: 13, color: appColors.secondary },
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
