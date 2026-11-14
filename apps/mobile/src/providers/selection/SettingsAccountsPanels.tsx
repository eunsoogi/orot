import { OpenAIAccountPanel } from '../../voiceSettings/OpenAIAccountPanel';
import { AdaptiveColumns } from '../../layout/AdaptiveColumns';
import { AccountConnectionActions } from './AccountConnectionActions';
import { AppSymbol } from '../../layout/AppSymbol';
import { AppText as Text } from '../../layout/AppText';
import { appColors } from '../../layout/appColors';
import { Pressable, StyleSheet, View } from 'react-native';
import { providerSelectionText } from './text';
import type { ChatGPTAccountSetup } from './types';

/** Separate credential cards retain flow-owned account selection and action targets. */
export default function SettingsAccountsPanels({
  setup,
}: {
  readonly setup: ChatGPTAccountSetup;
}) {
  return (
    <View style={styles.container} testID="chatgpt-account-setup">
      <AdaptiveColumns
        primary={
          <View style={styles.pageSections}>
            <Text accessibilityRole="header" style={styles.accountTitle}>
              ChatGPT
            </Text>
            <View
              style={styles.connectionCard}
              testID="subscription-account-section"
            >
              <View style={styles.content}>
                <Text>구독 계정 로그인</Text>
                <View style={styles.panel} testID="settings-accounts-list">
                  {setup.statusMessage ? (
                    <Text
                      accessibilityRole={
                        setup.statusIsError ? 'alert' : undefined
                      }
                      style={setup.statusIsError ? styles.error : undefined}
                      testID="chatgpt-account-status"
                    >
                      {setup.statusMessage}
                    </Text>
                  ) : null}
                  {setup.accounts.map((account, index) => {
                    const selected =
                      account.issuedClientID === setup.selectedAccountID;
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
                        onPress={() =>
                          setup.onAccountSelected(account.issuedClientID)
                        }
                        style={styles.account}
                        testID={`chatgpt-account-${index}`}
                      >
                        <AppSymbol
                          name={selected ? 'checkmark.circle.fill' : 'circle'}
                          size={18}
                          color={appColors.text}
                        />
                        <View style={styles.accountCopy}>
                          <Text style={styles.accountTitle}>
                            {providerSelectionText.chatGPTAccountName(
                              index + 1,
                            )}
                          </Text>
                          <Text>{status}</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <AccountConnectionActions setup={setup} />
            </View>
            <OpenAIAccountPanel />
          </View>
        }
        testID="settings-accounts-panels"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
    padding: 0,
  },
  content: { flex: 1, minWidth: 0, gap: 12 },
  accountCopy: { flex: 1, minWidth: 0, gap: 4 },
  connectionCard: {
    flexDirection: 'row',
    padding: 16,
    gap: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: appColors.border,
    backgroundColor: appColors.surface,
  },
  panel: { gap: 10, minWidth: 0 },
  pageSections: { gap: 16 },
  error: { color: appColors.danger },
  account: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: appColors.border,
    borderRadius: 16,
  },
  accountTitle: { color: appColors.text, fontWeight: '600' },
});
