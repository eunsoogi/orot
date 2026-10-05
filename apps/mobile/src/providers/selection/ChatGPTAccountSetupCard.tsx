import { Button, Pressable, StyleSheet, Text, View } from 'react-native';
import { providerSelectionText } from './text';
import type { ChatGPTAccountSetup } from './types';

interface ChatGPTAccountSetupCardProps {
  readonly setup: ChatGPTAccountSetup;
}

export default function ChatGPTAccountSetupCard({
  setup,
}: ChatGPTAccountSetupCardProps) {
  return (
    <View style={styles.container} testID="chatgpt-account-setup">
      <Text style={styles.heading}>{providerSelectionText.remoteHeading}</Text>
      <Text>{providerSelectionText.remotePrivacy}</Text>
      {setup.statusMessage ? (
        <Text
          accessibilityRole={setup.statusIsError ? 'alert' : undefined}
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
            <Text
              style={styles.accountTitle}
            >{`ChatGPT 계정 ${index + 1}`}</Text>
            <Text>{status}</Text>
          </Pressable>
        );
      })}
      {setup.signingIn ? (
        <Button
          onPress={setup.onCancelSignIn}
          testID="chatgpt-cancel-sign-in"
          title={providerSelectionText.chatGPTCancelLogin}
        />
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
    backgroundColor: '#eef4f8',
  },
  heading: { color: '#293847', fontWeight: '600' },
  account: {
    gap: 4,
    padding: 12,
    borderWidth: 1,
    borderColor: '#9aa7b2',
    borderRadius: 8,
  },
  selectedAccount: { borderColor: '#1769aa', borderWidth: 2 },
  accountTitle: { color: '#17212b', fontWeight: '600' },
});
