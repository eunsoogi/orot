import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Modal, Pressable, View, ScrollView } from 'react-native';
import { ConversationA2UISurface } from './ConversationA2UISurface';
import { ConversationA2UILocalDraftOwner } from './conversationA2UILocalDraftOwner';
import { conversationExecutionNative } from './conversationExecutionNative';
import { archivedPairedDetailsFor } from './archivedPairedDetailsBinding';
import { openArchivedPairedDetail } from './openArchivedPairedDetail';
import type { ConversationA2UINode } from './conversationA2UI';
import { AppText } from '../layout/AppText';
import { t } from '../i18n';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../storage/localDataClearEvents';

/** Only the explicit tap asks for one exact, already visible read-only panel.
 * Failed/missing owner keeps all accepted text inline. */
const idle = () => () => {};
export function ArchivedPairedDetailsSurface({
  root,
  testID,
}: {
  root: ConversationA2UINode;
  testID?: string;
}) {
  const bound = archivedPairedDetailsFor(root);
  const owner = useContext(ConversationA2UILocalDraftOwner);
  const mounted = useRef(false);
  const retire = useRef<(() => void) | undefined>(undefined);
  const [failed, setFailed] = useState<{
    root: ConversationA2UINode;
    owner: typeof owner;
  }>();
  const canShow = useSyncExternalStore(owner?.subscribe ?? idle, () =>
    Boolean(bound && owner?.hasArchive?.(root, bound.lease)),
  );
  const [detail, setDetail] = useState<{
    root: ConversationA2UINode;
    owner: typeof owner;
    signal: AbortSignal;
    body: ConversationA2UINode;
    close: () => void;
  }>();
  const close = useCallback(() => {
    const flight = retire.current;
    retire.current = undefined;
    flight?.();
    if (mounted.current) setDetail(undefined);
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      close();
    };
  }, [close, root, owner]);

  const open = async (section: 0 | 1) => {
    if (!bound || retire.current || !mounted.current) return;
    const ownership = owner?.beginArchive?.(
      root,
      bound.lease,
      () => mounted.current,
      close,
    );
    if (!ownership) {
      setFailed({ root, owner });
      return;
    }
    const data = subscribeLocalDataClear(close);
    const removed = subscribeLocalSourceDeletion(close);
    const flight = () => {
      data();
      removed();
      ownership.close();
    };
    retire.current = flight;
    const dismiss = () => {
      if (retire.current === flight) close();
    };
    const result = await openArchivedPairedDetail({
      native: conversationExecutionNative(),
      signal: ownership.controller.signal,
      current: ownership.current,
      ...bound,
      section,
    });
    if (
      !result ||
      result.signal.aborted ||
      retire.current !== flight ||
      !ownership.current()
    ) {
      result?.dispose();
      if (mounted.current && retire.current === flight)
        setFailed({ root, owner });
      dismiss();
      return;
    }
    result.signal.addEventListener('abort', dismiss, { once: true });
    setDetail({
      root,
      owner,
      signal: result.signal,
      body: result.selected.body,
      close: dismiss,
    });
  };
  if (
    !bound ||
    root.component !== 'Column' ||
    !canShow ||
    (failed?.root === root && failed.owner === owner)
  )
    return <ConversationA2UISurface root={root} testID={testID} />;
  const visibleDetail =
    detail?.root === root && detail.owner === owner && !detail.signal.aborted
      ? detail
      : undefined;
  return (
    <View testID={testID}>
      {root.children.map((child, position) => {
        const slot = bound.panels.indexOf(position);
        const trigger =
          child.component === 'Column' ? child.children[0] : undefined;
        if (slot < 0 || trigger?.component !== 'Text')
          return <ConversationA2UISurface key={child.id} root={child} />;
        return (
          <Pressable
            key={child.id}
            onPress={() => open(slot === 0 ? 0 : 1)}
            accessibilityRole="button"
            accessibilityLabel={trigger.text}
          >
            <ConversationA2UISurface root={trigger} />
          </Pressable>
        );
      })}
      {visibleDetail && (
        <Modal
          visible
          presentationStyle="pageSheet"
          onRequestClose={visibleDetail.close}
        >
          <View accessibilityViewIsModal>
            <Pressable onPress={visibleDetail.close} accessibilityRole="button">
              <AppText>{t('savedMemory.close')}</AppText>
            </Pressable>
            <ScrollView>
              <ConversationA2UISurface root={visibleDetail.body} />
            </ScrollView>
          </View>
        </Modal>
      )}
    </View>
  );
}
