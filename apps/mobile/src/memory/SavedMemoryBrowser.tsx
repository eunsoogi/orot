import { useNavigationRouteScrollPosition } from '../navigation/NavigationRouteScrollView';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { formatDateTime, t } from '../i18n';
import { useSavedMemories, type SavedMemory } from './useSavedMemories';
import { savedMemoryStyles as styles } from './savedMemoryStyles';
// Keep a multi-paragraph memory compact without changing the stored or detail text.
function summary(text: string) {
  const characters = Array.from(text.replace(/\s+/g, ' ').trim());
  return characters.length > 100
    ? characters.slice(0, 100).join('') + '…'
    : characters.join('');
}

/** Summaries remain local; navigation receives only the selected memory ID, never text. */
export function SavedMemoryBrowser({
  load,
  active = true,
  onOpenMemory,
}: {
  readonly active?: boolean;
  readonly load?: () => Promise<SavedMemory[]>;
  readonly onOpenMemory?: (id: string) => void;
}) {
  const { rows, state, refresh } = useSavedMemories(load, active);
  const [visible, setVisible] = useState(20);
  const position = useNavigationRouteScrollPosition();
  // Restore only after the fresh protected list has committed, not while its rows are empty.
  useEffect(() => {
    if (active && state === 'ready') position?.restore();
  }, [active, state, position]);
  // Retain the page bound while a native detail owns focus, so Back restores the same list position.
  return (
    <View style={[styles.section, styles.panel]} testID="saved-memory-browser">
      <Text accessibilityRole="header" style={styles.title}>
        {t('savedMemory.title')}
      </Text>
      <Text style={styles.description}>{t('savedMemory.privacy')}</Text>
      {state === 'loading' && (
        <Text accessibilityLiveRegion="polite">{t('savedMemory.loading')}</Text>
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
      {state === 'ready' && (
        <>
          <Text accessibilityLiveRegion="polite">
            {rows.length
              ? t('savedMemory.count', { count: rows.length })
              : t('savedMemory.empty')}
          </Text>
          {rows.slice(0, visible).map(row => (
            <AppButton
              key={row.id}
              variant="list"
              title={summary(row.text)}
              summary={t('savedMemory.savedAt', {
                date: formatDateTime(new Date(row.createdAt)),
              })}
              accessibilityHint={t('savedMemory.openDetail')}
              onPress={() => {
                position?.preserve();
                onOpenMemory?.(row.id);
              }}
            />
          ))}
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
