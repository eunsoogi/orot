import { useEffect, useRef } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { AppSymbol } from '../../layout/AppSymbol';
import { appColors } from '../../layout/appColors';
import { providerSelectionText as copy } from './text';
import type { ChatGPTAccountSetup } from './types';

/** Confirmation captures its target but rechecks live state before credential removal. */
export function AccountConnectionActions({
  setup,
}: {
  readonly setup: ChatGPTAccountSetup;
}) {
  const current = useRef(setup);
  current.current = setup;
  const mounted = useRef(true);
  const confirming = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const index = setup.accounts.findIndex(
    account => account.issuedClientID === setup.selectedAccountID,
  );
  const account = setup.accounts[index];
  const canSignOut = account && !account.requiresSignIn;
  const ready = canSignOut && account.hasDirectPlanAccess;
  const confirm = () => {
    if (!account || setup.busy || confirming.current) return;
    confirming.current = true;
    const id = account.issuedClientID;
    let resolved = false;
    const finish = (approved: boolean) => {
      if (resolved) return;
      resolved = true;
      confirming.current = false;
      const latest = current.current;
      if (
        approved &&
        mounted.current &&
        !latest.busy &&
        latest.selectedAccountID === id &&
        latest.accounts.some(
          item => item.issuedClientID === id && !item.requiresSignIn,
        )
      ) {
        latest.onSignOut(id);
      }
    };
    Alert.alert(
      copy.chatGPTSignOutAccount(index + 1),
      '이 계정에서 로그아웃할까요? 저장된 기록은 유지됩니다.',
      [
        { text: '취소', style: 'cancel', onPress: () => finish(false) },
        { text: '로그아웃', style: 'destructive', onPress: () => finish(true) },
      ],
      { cancelable: true, onDismiss: () => finish(false) },
    );
  };
  return (
    <View style={styles.actions} testID="settings-accounts-actions">
      {canSignOut && !setup.signingIn ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            setup.signingOut
              ? copy.chatGPTSigningOut(index + 1)
              : copy.chatGPTSignOutAccount(index + 1)
          }
          accessibilityState={{ disabled: setup.busy, busy: setup.signingOut }}
          disabled={setup.busy}
          onPress={confirm}
          testID="chatgpt-account-sign-out"
          style={styles.target}
        >
          <AppSymbol
            name="rectangle.portrait.and.arrow.right"
            size={18}
            color={appColors.text}
          />
        </Pressable>
      ) : null}
      {setup.signingIn ||
      (!ready && !(setup.accounts.length > 0 && !account)) ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            setup.signingIn ? copy.chatGPTCancelLogin : setup.actionTitle
          }
          accessibilityState={{
            disabled: !setup.signingIn && (setup.busy || setup.actionDisabled),
            busy: setup.signingIn,
          }}
          disabled={!setup.signingIn && (setup.busy || setup.actionDisabled)}
          onPress={setup.signingIn ? setup.onCancelSignIn : setup.onAction}
          testID={
            setup.signingIn
              ? 'chatgpt-cancel-sign-in'
              : 'chatgpt-account-action'
          }
          style={styles.target}
        >
          <AppSymbol
            name={setup.signingIn ? 'xmark' : 'person.crop.circle.badge.plus'}
            size={18}
            color={appColors.text}
          />
        </Pressable>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  actions: { width: 44, justifyContent: 'center', alignItems: 'center' },
  target: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
