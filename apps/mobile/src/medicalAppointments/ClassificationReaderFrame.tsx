import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { appColors } from '../layout/appColors';
import { AppSymbol } from '../layout/AppSymbol';
import { NavigationMotionContext } from '../navigation/NavigationMotionContext';
import { t } from '../i18n';

/** Dismiss before invoking the original action so its consent Modal never competes with this reader. */
export function useClassificationReaderFrame(
  action: () => void,
  documents: readonly string[],
) {
  const [expanded, setExpanded] = useState(false);
  const [closing, setClosing] = useState(false);
  const active = useRef(true);
  const pending = useRef<{
    action: () => void;
    documents: readonly string[];
  } | null>(null);
  const latest = useRef({ action, documents });
  latest.current = { action, documents };
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      pending.current = null;
    };
  }, []);
  const close = () => {
    pending.current = null;
    setClosing(true);
    setExpanded(false);
  };
  return {
    expanded,
    closing,
    close,
    expand: () => {
      if (!closing) setExpanded(true);
    },
    execute: () => {
      if (closing || pending.current) return;
      if (!expanded) {
        action();
        return;
      }
      pending.current = { action, documents: [...documents] };
      setClosing(true);
      setExpanded(false);
    },
    dismissed: () => {
      if (!active.current) return;
      const queued = pending.current;
      pending.current = null;
      setClosing(false);
      // A newer model, recipient or screen callback invalidates an action queued under old context.
      if (
        queued &&
        queued.action === latest.current.action &&
        queued.documents.length === latest.current.documents.length &&
        queued.documents.every(
          (document, index) => document === latest.current.documents[index],
        )
      )
        queued.action();
    },
  };
}

/** A same-stage full-window reader is the escape path when the route lane cannot fit one scaled line. */
export function ClassificationReaderFrame({
  expanded,
  closing,
  close,
  dismissed,
  children,
}: {
  readonly expanded: boolean;
  readonly closing: boolean;
  readonly close: () => void;
  readonly dismissed: () => void;
  readonly children: ReactNode;
}) {
  const reduceMotion = useContext(NavigationMotionContext);
  return (
    <>
      {!expanded && !closing ? children : null}
      <Modal
        visible={expanded}
        animationType={reduceMotion ? 'none' : 'fade'}
        presentationStyle="fullScreen"
        supportedOrientations={[
          'portrait',
          'portrait-upside-down',
          'landscape-left',
          'landscape-right',
        ]}
        onRequestClose={close}
        onDismiss={dismissed}
        testID="classification-expanded-reader"
      >
        {expanded || closing ? (
          <SafeAreaView style={styles.fill}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('medicalAppointments.closeReader')}
              accessibilityState={{ disabled: closing }}
              disabled={closing}
              onPress={close}
              testID="classification-close-reader"
              style={styles.close}
            >
              <AppSymbol name="xmark" size={20} />
            </Pressable>
            {children}
          </SafeAreaView>
        ) : null}
      </Modal>
    </>
  );
}
const styles = StyleSheet.create({
  fill: {
    flex: 1,
    paddingHorizontal: 16,
    backgroundColor: appColors.background,
  },
  close: {
    minHeight: 44,
    minWidth: 44,
    alignSelf: 'flex-end',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
