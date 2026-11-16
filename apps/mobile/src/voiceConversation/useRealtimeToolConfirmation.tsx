import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, ScrollView, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { NavigationModal } from '../navigation/NavigationModal';
import { AppText } from '../layout/AppText';
import { AppButton } from '../layout/AppButton';
import { t } from '../i18n';
import { disclosureStyles as styles } from '../agent/execution/InferenceDisclosureStyles';

export interface RealtimeToolConfirmationRequest {
  readonly text: string;
  readonly recipient: string;
  readonly model: string;
  readonly signal: AbortSignal;
}
interface Pending {
  readonly request: RealtimeToolConfirmationRequest;
  readonly resolve: (approved: boolean) => void;
  readonly onAbort: () => void;
}

/** Only a visible, current request may authorize delegation. The caller owns the call/item lease. */
export function useRealtimeToolConfirmation() {
  const pending = useRef<Pending | null>(null);
  const mounted = useRef(false);
  const [request, setRequest] =
    useState<RealtimeToolConfirmationRequest | null>(null);
  const [closing, setClosing] =
    useState<RealtimeToolConfirmationRequest | null>(null);
  const finish = useCallback(
    (approved: boolean, expected?: RealtimeToolConfirmationRequest) => {
      const current = pending.current;
      // A dismissed modal's late event must not decide a newer request.
      if (!current || (expected && current.request !== expected)) return;
      pending.current = null;
      current.request.signal.removeEventListener('abort', current.onAbort);
      if (mounted.current) {
        setRequest(null);
        setClosing(null);
      }
      current.resolve(
        approved &&
          mounted.current &&
          AppState.currentState === 'active' &&
          !current.request.signal.aborted,
      );
    },
    [],
  );
  const confirm = useCallback(
    (input: RealtimeToolConfirmationRequest) =>
      new Promise<boolean>(resolve => {
        if (
          !mounted.current ||
          pending.current ||
          input.signal.aborted ||
          AppState.currentState !== 'active' ||
          !input.text.trim()
        ) {
          resolve(false);
          return;
        }
        // Snapshot the exact displayed strings; the caller cannot mutate an approved request.
        const snapshot = { ...input };
        const onAbort = () => finish(false, snapshot);
        pending.current = { request: snapshot, resolve, onAbort };
        snapshot.signal.addEventListener('abort', onAbort, { once: true });
        if (snapshot.signal.aborted) finish(false, snapshot);
        else setRequest(snapshot);
      }),
    [finish],
  );
  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') finish(false);
    });
    return () => {
      mounted.current = false;
      subscription.remove();
      finish(false);
    };
  }, [finish]);
  const node = request ? (
    <NavigationModal
      visible={closing !== request}
      onDismiss={() => finish(closing === request, request)}
      presentationStyle="pageSheet"
      allowSwipeDismissal
      testID="realtime-tool-confirmation-modal"
      onRequestClose={() => finish(false, request)}
    >
      <SafeAreaProvider style={styles.backdrop}>
        <SafeAreaView style={styles.panel}>
          <ScrollView contentContainerStyle={styles.content}>
            <AppText accessibilityRole="header" style={styles.title}>
              {t('realtimeToolConsent.title')}
            </AppText>
            <AppText style={styles.label}>
              {t('realtimeToolConsent.recognized')}
            </AppText>
            <AppText
              selectable
              testID="realtime-tool-confirmation-text"
              style={styles.value}
            >
              {request.text}
            </AppText>
            <AppText>
              {t('realtimeToolConsent.recipient', {
                recipient: request.recipient,
              })}
            </AppText>
            <AppText>
              {t('realtimeToolConsent.model', { model: request.model })}
            </AppText>
            <AppText>{t('realtimeToolConsent.effects')}</AppText>
            <AppText>{t('realtimeToolConsent.correction')}</AppText>
            <AppText>{t('realtimeToolConsent.resultBoundary')}</AppText>
            <View style={styles.footer}>
              <AppButton
                title={t('realtimeToolConsent.allow')}
                testID="realtime-tool-confirmation-allow"
                onPress={() => {
                  // Do not open a subsequent approval while UIKit is still dismissing this sheet.
                  if (
                    AppState.currentState !== 'active' ||
                    request.signal.aborted
                  )
                    finish(false, request);
                  else setClosing(request);
                }}
              />
              <AppButton
                variant="neutral"
                title={t('realtimeToolConsent.cancel')}
                testID="realtime-tool-confirmation-cancel"
                onPress={() => finish(false, request)}
              />
            </View>
          </ScrollView>
        </SafeAreaView>
      </SafeAreaProvider>
    </NavigationModal>
  ) : null;
  return { confirm, node };
}
