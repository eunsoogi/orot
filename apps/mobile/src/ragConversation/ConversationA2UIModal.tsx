import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { AppText } from '../layout/AppText';
import { t } from '../i18n';
import { conversationExecutionNative } from './conversationExecutionNative';
import { watchEncounterNativeAdmission } from '../encounterReview/nativeAdmission';
import {
  ConversationA2UILocalDraftOwner,
  useOwnedConversationA2UIStamp,
} from './conversationA2UILocalDraftOwner';
import type { ConversationA2UINode } from './conversationA2UI';

export const ConversationA2UIModalRoot = createContext<
  ConversationA2UINode | undefined
>(undefined);

export function ConversationA2UIModal({
  trigger,
  panel,
}: {
  readonly trigger: ReactNode;
  readonly panel: ReactNode;
}) {
  const root = useContext(ConversationA2UIModalRoot);
  const owner = useContext(ConversationA2UILocalDraftOwner);
  const stamp = useOwnedConversationA2UIStamp(owner, root, Boolean(root));
  const [open, setOpen] = useState<{
    controller: AbortController;
    root: ConversationA2UINode;
    stamp: string;
  }>();
  const attempt = useRef<AbortController>(undefined);
  const mounted = useRef(false);
  const close = useCallback(() => {
    const pending = attempt.current;
    attempt.current = undefined;
    pending?.abort();
    if (mounted.current) setOpen(undefined);
  }, []);
  useLayoutEffect(() => {
    mounted.current = true;
    const stop = owner?.subscribe(() => {
      if (!root || !stamp || owner.surface(root) !== stamp) close();
    });
    return () => {
      mounted.current = false;
      stop?.();
      close();
    };
  }, [close, owner, root, stamp]);
  if (!root || !stamp || !owner)
    return (
      <>
        {trigger}
        {panel}
      </>
    );
  const start = async () => {
    if (attempt.current || !mounted.current || owner.surface(root) !== stamp)
      return;
    const controller = new AbortController();
    attempt.current = controller;
    const current = () =>
      mounted.current &&
      attempt.current === controller &&
      !controller.signal.aborted &&
      owner.surface(root) === stamp;
    const lease = watchEncounterNativeAdmission(
      conversationExecutionNative(),
      controller.signal,
      current,
    );
    if (!lease) {
      close();
      return;
    }
    lease.signal.addEventListener(
      'abort',
      () => {
        if (attempt.current === controller) close();
      },
      { once: true },
    );
    if ((await lease.confirm()) && current())
      setOpen({ controller, root, stamp });
    else if (attempt.current === controller) close();
  };
  const visible =
    open?.root === root &&
    open.stamp === stamp &&
    !open.controller.signal.aborted &&
    owner.surface(root) === stamp;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={start}
        testID="conversation-a2ui-open-modal"
      >
        {trigger}
      </Pressable>
      {visible ? (
        <Modal
          visible
          onRequestClose={close}
          animationType="none"
          presentationStyle="pageSheet"
        >
          <View accessibilityViewIsModal style={{ flex: 1, padding: 20 }}>
            <Pressable
              accessibilityRole="button"
              onPress={close}
              testID="conversation-a2ui-close-modal"
            >
              <AppText allowFontScaling>{t('savedMemory.close')}</AppText>
            </Pressable>
            <ScrollView>{panel}</ScrollView>
          </View>
        </Modal>
      ) : null}
    </>
  );
}
