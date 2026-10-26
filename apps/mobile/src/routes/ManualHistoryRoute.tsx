import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { t } from '../i18n';
import { AppText as Text } from '../layout/AppText';
import ManualHistoryScreen from '../manualHistory/ManualHistoryScreen';
import type { ManualHistoryScreenRepository } from '../manualHistory/types';
import { NavigationRouteScrollView } from '../navigation/NavigationRouteScrollView';
import { RouteLoadError } from './RouteLoadError';

/** Opens the existing encrypted repository before showing the manual history screen. */
export function ManualHistoryRoute({
  onBack,
}: {
  readonly onBack: () => void;
}) {
  const [repository, setRepository] =
    useState<ManualHistoryScreenRepository | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const { openLocalManualHistoryRepository } =
        require('../manualHistory/localRepository') as typeof import('../manualHistory/localRepository');
      setRepository(await openLocalManualHistoryRepository());
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  if (loading) {
    return (
      <NavigationRouteScrollView>
        <View style={styles.container}>
          <Text accessibilityRole="header">{t('manualHistory.title')}</Text>
          <Text>{t('manualHistory.loading')}</Text>
        </View>
      </NavigationRouteScrollView>
    );
  }
  if (failed || !repository) {
    return (
      <RouteLoadError
        title={t('manualHistory.title')}
        message={t('manualHistory.error.open')}
        onRetry={load}
      />
    );
  }
  return <ManualHistoryScreen onBack={onBack} repository={repository} />;
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, gap: 12, padding: 24 },
});
