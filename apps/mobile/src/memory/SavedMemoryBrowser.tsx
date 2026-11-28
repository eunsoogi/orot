import { useNavigationRouteScrollPosition } from '../navigation/NavigationRouteScrollView';
import type { NavigationRouteOwnership } from '../navigation/navigationRouteContracts';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { SavedMemorySwipeRow } from './SavedMemorySwipeRow';
import { useSavedMemorySwipeActions } from './useSavedMemorySwipeActions';
import { useSavedMemories, type SavedMemory } from './useSavedMemories';
import {
  MaterialLibraryRows,
  materialLibraryStyles as styles,
} from '../layout/MaterialLibraryRows';
/** Summaries remain local; navigation receives only the selected memory ID, never text. */
export function SavedMemoryBrowser({
  load,
  active = true,
  ownership,
  onOpenMemory,
}: {
  readonly active?: boolean;
  readonly load?: () => Promise<SavedMemory[]>;
  readonly ownership?: NavigationRouteOwnership;
  readonly onOpenMemory?: (id: string) => void;
}) {
  const { rows, state, refresh, refreshReadOnly, readyRead } = useSavedMemories(
    load,
    active,
    ownership,
  );
  const [visible, setVisible] = useState(20);
  const position = useNavigationRouteScrollPosition();
  const [revealed, setRevealed] = useState<string>();
  const { busy, error, requestDelete } = useSavedMemorySwipeActions({
    read: readyRead,
    owner: ownership,
    refresh: refreshReadOnly,
  });
  useEffect(() => setRevealed(undefined), [readyRead]);
  // Restore only after the fresh protected list has committed, not while its rows are empty.
  useEffect(() => {
    if (active && state === 'ready') position?.restore();
  }, [active, state, position]);
  // Retain the page bound while a native detail owns focus, so Back restores the same list position.
  return (
    <View style={styles.screen} testID="saved-memory-browser">
      <Text accessibilityRole="header" style={styles.heading}>
        {t('savedMemory.title')}
      </Text>
      <Text style={styles.description}>{t('savedMemory.privacy')}</Text>
      {state === 'loading' && (
        <Text accessibilityLiveRegion="polite">{t('savedMemory.loading')}</Text>
      )}
      {state === 'invalidated' && (
        <>
          <Text accessibilityLiveRegion="polite">
            {t('savedMemory.invalidated')}
          </Text>
          <AppButton
            title={t('savedMemory.reload')}
            onPress={() => {
              refresh();
            }}
          />
        </>
      )}
      {state === 'failed' && (
        <>
          <Text accessibilityRole="alert">{t('savedMemory.failed')}</Text>
          <AppButton
            variant="neutral"
            title={t('savedMemory.retry')}
            onPress={() => {
              refresh();
            }}
          />
        </>
      )}
      {error && state === 'ready' ? (
        <Text accessibilityRole="alert">{error}</Text>
      ) : null}
      {state === 'ready' && (
        <>
          <Text accessibilityLiveRegion="polite">
            {rows.length
              ? t('savedMemory.count', { count: rows.length })
              : t('savedMemory.empty')}
          </Text>
          {rows.length ? (
            <MaterialLibraryRows testID="saved-memory-rows">
              {rows.slice(0, visible).map((row, index) => (
                <SavedMemorySwipeRow
                  key={row.id}
                  row={row}
                  enabled={Boolean(ownership && readyRead)}
                  disabled={busy}
                  revealed={revealed === row.id}
                  onReveal={open =>
                    setRevealed(current =>
                      open ? row.id : current === row.id ? undefined : current,
                    )
                  }
                  divider={index + 1 < Math.min(visible, rows.length)}
                  onDelete={() => {
                    setRevealed(undefined);
                    requestDelete(row);
                  }}
                  onOpen={
                    onOpenMemory &&
                    (() => {
                      if (!readyRead?.isCurrent()) return;
                      setRevealed(undefined);
                      position?.preserve();
                      onOpenMemory(row.id);
                    })
                  }
                />
              ))}
            </MaterialLibraryRows>
          ) : null}
          {visible < rows.length && (
            <AppButton
              variant="neutral"
              title={t('savedMemory.more')}
              onPress={() => setVisible(value => value + 20)}
            />
          )}
        </>
      )}
    </View>
  );
}
