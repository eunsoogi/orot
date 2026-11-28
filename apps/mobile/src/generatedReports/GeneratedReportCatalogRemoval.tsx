import type { ReactNode } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { TrailingSwipeAction } from '../layout/TrailingSwipeAction';
import type { GeneratedReportReader, GeneratedReportRow } from './types';
import { generatedReportCopy as copy } from './text';

/** These tiles only remove the catalog projection, never the shared answer. */
export function GeneratedReportCatalogRemoval({
  row,
  remove,
  revealed,
  onReveal,
  children,
}: {
  readonly row: GeneratedReportRow;
  readonly remove?: (row: GeneratedReportRow) => void;
  readonly revealed: boolean;
  readonly onReveal: (next: boolean) => void;
  readonly children: ReactNode;
}) {
  if (
    !remove ||
    row.origin !== 'conversation' ||
    row.kind !== 'possibilities' ||
    row.unavailable
  )
    return children;
  return (
    <TrailingSwipeAction
      revealDuringDrag
      disabled={false}
      revealed={revealed}
      onRevealedChange={onReveal}
      testID={`generated-report-swipe-${row.key}`}
      revealWidth={64}
      action={
        <View style={styles.lane}>
          <Pressable
            testID={`generated-report-remove-${row.key}`}
            accessibilityRole="button"
            accessibilityLabel={copy.catalogRemove}
            style={styles.delete}
            onPress={() => {
              onReveal(false);
              remove(row);
            }}
          >
            <AppSymbol name="trash" color={appColors.onDanger} size={20} />
          </Pressable>
        </View>
      }
    >
      {children}
    </TrailingSwipeAction>
  );
}

/** One exact browser request owns the prompt, including delayed callbacks. */
export function catalogRemovalAction(
  open: () => Promise<GeneratedReportReader>,
  current: () => boolean,
  pending: { current: AbortController | null },
  remove: (key: string) => void,
) {
  return (row: GeneratedReportRow) => {
    if (!current() || pending.current?.signal.aborted === false) return;
    const controller = new AbortController();
    pending.current = controller;
    requestGeneratedReportCatalogRemoval(row, open, current, controller, () =>
      remove(row.key),
    );
  };
}

/** Keep a cancelled prompt inert even when native hands back an old callback. */
export async function requestGeneratedReportCatalogRemoval(
  row: GeneratedReportRow,
  open: () => Promise<GeneratedReportReader>,
  current: () => boolean,
  controller: AbortController,
  removed: () => void,
) {
  if (!current()) return;
  const live = () => current() && !controller.signal.aborted;
  const failed = () => {
    if (live()) Alert.alert(copy.catalogRemoveFailed);
  };
  let awaitingConfirmation = false;
  try {
    const reader = await open();
    if (!live()) return;
    const remove = await reader.prepareCatalogRemoval?.(
      row,
      controller.signal,
      live,
    );
    if (!live()) return;
    if (!remove) {
      failed();
      return;
    }
    Alert.alert(
      copy.catalogRemove,
      copy.catalogRemoveConfirmation,
      [
        {
          text: copy.catalogRemoveCancel,
          style: 'cancel',
          onPress: () => controller.abort(),
        },
        {
          text: copy.catalogRemove,
          style: 'destructive',
          onPress: () => {
            if (!live()) {
              controller.abort();
              return;
            }
            remove()
              .then(didRemove => {
                if (!live()) return;
                if (didRemove) removed();
                else failed();
              }, failed)
              .finally(() => controller.abort());
          },
        },
      ],
      { cancelable: true, onDismiss: () => controller.abort() },
    );
    awaitingConfirmation = true;
  } catch {
    failed();
  } finally {
    if (!awaitingConfirmation) controller.abort();
  }
}

const styles = StyleSheet.create({
  lane: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  delete: {
    alignSelf: 'center',
    width: 48,
    minHeight: 48,
    borderRadius: 13,
    backgroundColor: appColors.dangerAction,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
