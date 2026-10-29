import { HealthRecordsDetailHeader } from './HealthRecordsDetailHeader';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList } from 'react-native';
import type { HealthObservation } from '@orot/domain';
import type {
  HealthObservationCursor,
  HealthObservationPageLoader,
} from '@orot/storage';
import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { useNavigationLeaveStateRegistration } from '../navigation';
import type { NavigationLeaveState } from '../navigation';
import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import type { HealthRecordsDetailSelection } from './healthRecordsLibraryModel';
import {
  healthRecordCategoryTitle,
  healthRecordPeriodStart,
} from './healthRecordsLibraryModel';
import type { HealthObservationCategory } from './healthRecordsLibraryModel';
import { buildHealthRecordsDetailRows } from './healthRecordsDetailModel';
import { HealthRecordsDetailRecordRow } from './HealthRecordsDetailRecordRow';
import { healthRecordsDetailStyles as styles } from './HealthRecordsDetailScreen.styles';

interface HealthRecordsDetailScreenProps {
  readonly loadObservations: HealthObservationPageLoader;
  readonly onBack: () => void;
  readonly onSelectionChange: (selection: HealthRecordsDetailSelection) => void;
  readonly selection: Omit<HealthRecordsDetailSelection, 'category'> & {
    readonly category: HealthObservationCategory;
  };
}

type LoadState = 'loading' | 'ready' | 'failed';

/** Keeps controls and paged rows in one virtualized flow without resetting the selected period. */
export function HealthRecordsDetailScreen({
  loadObservations,
  onBack,
  onSelectionChange,
  selection,
}: HealthRecordsDetailScreenProps) {
  const navigationInset = useNavigationContentInset();
  const [observations, setObservations] = useState<
    readonly HealthObservation[]
  >([]);
  const [cursor, setCursor] = useState<HealthObservationCursor | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const pending = useRef(false);
  const now = useRef(new Date().toISOString()).current;
  const start = useMemo(
    () => healthRecordPeriodStart(selection.period, now),
    [selection.period, now],
  );
  const rows = useMemo(
    () =>
      buildHealthRecordsDetailRows(
        selection.category,
        observations,
        selection.period,
        now,
      ),
    [observations, selection.category, selection.period, now],
  );
  const hasSharedNavigation = useNavigationLeaveStateRegistration({
    canLeave: true,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision,
    inputRevision: 0,
  } satisfies NavigationLeaveState);

  const reload = useCallback(
    async (after: HealthObservationCursor | null = null) => {
      if (pending.current) return;
      pending.current = true;
      const request = ++generation.current;
      setLoadState('loading');
      try {
        // One request reads one storage page, even for a dense selected period.
        const page = await loadObservations(after, {
          category: selection.category,
          ...(start ? { fromInclusive: start.toISOString() } : {}),
          toInclusive: now,
        });
        if (request !== generation.current) return;
        setObservations(current =>
          after ? [...current, ...page.records] : page.records,
        );
        const oldest = page.records[page.records.length - 1];
        const passedPeriod = Boolean(
          start &&
          oldest &&
          new Date(oldest.effectiveAt).getTime() < start.getTime(),
        );
        setCursor(page.nextCursor && !passedPeriod ? page.nextCursor : null);
        setLoadState('ready');
      } catch {
        if (request === generation.current) setLoadState('failed');
      } finally {
        if (request === generation.current) {
          pending.current = false;
          setRevision(value => value + 1);
        }
      }
    },
    [loadObservations, start, selection.category, now],
  );

  useEffect(() => {
    pending.current = false;
    setObservations([]);
    setCursor(null);
    reload(null);
    return () => {
      // Reject reads from the previous period before its rows can enter this list.
      generation.current += 1;
    };
  }, [reload]);

  const title = healthRecordCategoryTitle(selection.category) + ' 기록 상세';
  const controlsPanel = (
    <HealthRecordsDetailHeader
      title={title}
      hasSharedNavigation={hasSharedNavigation}
      onBack={onBack}
      selection={selection}
      onSelectionChange={onSelectionChange}
      recordCount={rows.length}
      observationCount={observations.length}
      loadState={loadState}
      onRetry={() => {
        reload(null);
      }}
      hasMore={cursor !== null}
    />
  );
  const recordsPanel = (
    <FlatList
      data={rows}
      keyExtractor={row =>
        row.kind === 'blood_pressure' ? row.reading.id : row.observation.id
      }
      contentContainerStyle={[styles.container, navigationInset]}
      ListHeaderComponent={controlsPanel}
      ListEmptyComponent={
        loadState === 'ready' && !cursor ? (
          <Text testID="health-records-detail-empty">
            {t('healthRecords.detailEmpty')}
          </Text>
        ) : undefined
      }
      ListFooterComponent={
        cursor ? (
          loadState === 'failed' ? (
            <AppButton
              onPress={() => {
                reload(cursor);
              }}
              testID="health-records-detail-retry"
              title={t('healthRecords.retry')}
              variant="secondary"
            />
          ) : loadState === 'loading' ? (
            <Text testID="health-records-detail-loading">
              {t('healthRecords.loading')}
            </Text>
          ) : (
            <AppButton
              onPress={() => {
                reload(cursor);
              }}
              testID="health-records-load-older"
              title={t('healthRecords.loadOlder')}
              variant="secondary"
            />
          )
        ) : undefined
      }
      onEndReached={() => {
        if (cursor && loadState === 'ready') reload(cursor);
      }}
      onEndReachedThreshold={0.5}
      renderItem={({ item, index }) => (
        <HealthRecordsDetailRecordRow index={index} row={item} />
      )}
      style={styles.panelScroll}
      testID="health-records-detail-scroll"
    />
  );

  return (
    <AdaptiveColumns
      primary={recordsPanel}
      routeKey="health-records-detail"
      testID="health-records-detail-layout"
    />
  );
}
