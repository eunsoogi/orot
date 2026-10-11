import { AppText as Text } from '../../layout/AppText';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppButton as Button } from '../../layout/AppButton';
import { appColors } from '../../layout/appColors';
import { t } from '../../i18n';
import { providerSelectionText } from './text';
import type { ChatGPTAccountSetup } from './types';

interface ChatGPTAccountSetupCardProps {
  readonly setup: ChatGPTAccountSetup;
}

export default function ChatGPTAccountSetupCard({
  setup,
}: ChatGPTAccountSetupCardProps) {
  const selectedAccountIndex = setup.accounts.findIndex(
    account => account.issuedClientID === setup.selectedAccountID,
  );
  const selectedAccount = setup.accounts[selectedAccountIndex];
  const selectedAccountCanLoadModels =
    selectedAccount !== undefined &&
    !selectedAccount.requiresSignIn &&
    selectedAccount.hasDirectPlanAccess;
  const isProviderSettings = setup.presentation === 'settings-provider';
  const isAccountSettings = setup.presentation === 'settings-accounts';

  return (
    <View style={styles.container} testID="chatgpt-account-setup">
      {!isAccountSettings ? (
        <Text style={styles.heading}>
          {providerSelectionText.remoteHeading}
        </Text>
      ) : null}
      {!isAccountSettings ? (
        <Text>{providerSelectionText.remotePrivacy}</Text>
      ) : null}
      {setup.statusMessage ? (
        <Text
          accessibilityRole={setup.statusIsError ? 'alert' : undefined}
          style={setup.statusIsError ? styles.error : undefined}
          testID="chatgpt-account-status"
        >
          {setup.statusMessage}
        </Text>
      ) : null}
      {setup.accounts.map((account, index) => {
        const selected = account.issuedClientID === setup.selectedAccountID;
        const status = account.requiresSignIn
          ? providerSelectionText.chatGPTAccountSignedOut
          : account.hasDirectPlanAccess
            ? providerSelectionText.chatGPTAccountSignedIn
            : providerSelectionText.chatGPTAccountMissingScope;
        return (
          <Pressable
            key={account.issuedClientID}
            accessibilityRole="radio"
            accessibilityState={{ disabled: setup.busy, selected }}
            disabled={setup.busy}
            onPress={() => setup.onAccountSelected(account.issuedClientID)}
            style={[styles.account, selected && styles.selectedAccount]}
            testID={`chatgpt-account-${index}`}
          >
            <Text style={styles.accountTitle}>
              {providerSelectionText.chatGPTAccountName(index + 1)}
            </Text>
            <Text>{status}</Text>
          </Pressable>
        );
      })}
      {selectedAccount &&
      !selectedAccount.requiresSignIn &&
      !isProviderSettings ? (
        // The numbered label keeps the sign-out target clear when several accounts are saved.
        <Button
          disabled={setup.busy}
          onPress={() => setup.onSignOut(selectedAccount.issuedClientID)}
          testID="chatgpt-account-sign-out"
          title={
            setup.signingOut
              ? providerSelectionText.chatGPTSigningOut(
                  selectedAccountIndex + 1,
                )
              : providerSelectionText.chatGPTSignOutAccount(
                  selectedAccountIndex + 1,
                )
          }
        />
      ) : null}
      {setup.signingIn ? (
        <Button
          onPress={setup.onCancelSignIn}
          testID="chatgpt-cancel-sign-in"
          title={providerSelectionText.chatGPTCancelLogin}
        />
      ) : isProviderSettings ? (
        <>
          {/* Catalog reads are allowed here; authentication changes stay on the account screen. */}
          {selectedAccountCanLoadModels ? (
            <Button
              disabled={setup.busy || setup.actionDisabled}
              onPress={setup.onAction}
              testID="settings-provider-load-models"
              title={providerSelectionText.chatGPTLoadModels}
            />
          ) : null}
          <Button
            disabled={setup.busy || !setup.onOpenAccounts}
            onPress={() => setup.onOpenAccounts?.()}
            testID="settings-provider-manage-accounts"
            title={t('settings.accounts')}
          />
        </>
      ) : isAccountSettings ? (
        selectedAccountCanLoadModels ||
        (setup.accounts.length > 0 && !selectedAccount) ? null : (
          <Button
            disabled={setup.busy || setup.actionDisabled}
            onPress={setup.onAction}
            testID="chatgpt-account-action"
            title={setup.actionTitle}
          />
        )
      ) : (
        <Button
          disabled={setup.busy || setup.actionDisabled}
          onPress={setup.onAction}
          testID="chatgpt-account-action"
          title={setup.actionTitle}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
    padding: 16,
    borderRadius: 12,
    backgroundColor: appColors.surface,
  },
  heading: { color: appColors.text, fontWeight: '600' },
  error: { color: appColors.danger },
  account: {
    gap: 4,
    padding: 12,
    borderWidth: 1,
    borderColor: appColors.border,
    borderRadius: 16,
  },
  selectedAccount: { borderColor: appColors.primary, borderWidth: 2 },
  accountTitle: { color: appColors.text, fontWeight: '600' },
});
