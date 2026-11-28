import { formatDateTime, t } from '../i18n';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { AppText } from '../layout/AppText';
import { AppButton } from '../layout/AppButton';
import {
  MaterialLibraryRow,
  MaterialLibraryRows,
} from '../layout/MaterialLibraryRows';
import { generatedReportCopy as copy } from './text';
import type { GeneratedReportRow } from './types';
import { GeneratedReportCatalogRemoval } from './GeneratedReportCatalogRemoval';
import { generatedReportBrowserStyles as styles } from './generatedReportBrowserStyles';

export type GeneratedReportPagination =
  'idle' | 'ready' | 'loading' | 'failed' | 'complete';

/** The list publishes metadata only; opening a row is the protected content read. */
export function GeneratedReportRows({
  rows,
  pagination,
  onOpen,
  onMore,
  onRemove,
}: {
  readonly rows: readonly GeneratedReportRow[];
  readonly pagination: GeneratedReportPagination;
  readonly onOpen: (row: GeneratedReportRow) => void;
  readonly onRemove?: (row: GeneratedReportRow) => void;
  readonly onMore: () => void;
}) {
  return (
    <>
      {rows.length === 0 ? (
        <AppText>{copy.empty}</AppText>
      ) : (
        <MaterialLibraryRows testID="generated-report-rows">
          {rows.map((row, index) => (
            <GeneratedReportCatalogRemoval
              key={row.key}
              row={row}
              remove={onRemove}
            >
              <MaterialLibraryRow
                testID={`generated-report-${row.key}`}
                divider={index + 1 < rows.length}
                title={copy[row.kind]}
                summary={`${formatDateTime(new Date(row.createdAt))}${row.unavailable ? ' · ' + copy.unavailable : ''}`}
                onPress={() => {
                  onOpen(row);
                }}
              />
            </GeneratedReportCatalogRemoval>
          ))}
        </MaterialLibraryRows>
      )}
      {pagination !== 'idle' && (
        <View style={styles.pagination}>
          {pagination === 'failed' && (
            <AppText accessibilityRole="alert">{copy.moreFailed}</AppText>
          )}
          {pagination === 'complete' ? (
            <AppText accessibilityLiveRegion="polite">
              {copy.moreComplete}
            </AppText>
          ) : (
            <AppButton
              title={
                pagination === 'loading'
                  ? copy.moreLoading
                  : pagination === 'failed'
                    ? copy.moreRetry
                    : copy.more
              }
              busy={pagination === 'loading'}
              onPress={() => {
                onMore();
              }}
            />
          )}
        </View>
      )}
    </>
  );
}

/** Destination headings sit outside their metadata list; the detail keeps its reader surface. */
export function GeneratedReportFrame({
  selected,
  destination,
  children,
}: {
  readonly selected: boolean;
  readonly destination: boolean;
  readonly children: ReactNode;
}) {
  const library = destination && !selected;
  return (
    <View
      style={library ? styles.library : styles.panel}
      testID="generated-report-browser"
    >
      <AppText
        accessibilityRole="header"
        style={library ? styles.libraryHeading : styles.heading}
      >
        {destination ? t('records.generatedConversationMaterials') : copy.title}
      </AppText>
      {children}
    </View>
  );
}

export function GeneratedReportDescription({
  destination,
}: {
  readonly destination: boolean;
}) {
  return (
    <AppText style={destination ? styles.libraryDescription : undefined}>
      {copy.description}
    </AppText>
  );
}

/** Status copy stays separate from row identity and the catalog mutation owner. */
export function GeneratedReportStatus({
  state,
  retry,
}: {
  readonly state: 'idle' | 'loading' | 'ready' | 'failed' | 'unavailable';
  readonly retry: () => void;
}) {
  if (state === 'loading')
    return <AppText accessibilityLiveRegion="polite">{copy.loading}</AppText>;
  if (state === 'unavailable')
    return <AppText accessibilityRole="alert">{copy.unavailable}</AppText>;
  if (state !== 'failed') return null;
  return (
    <>
      <AppText accessibilityRole="alert">{copy.failed}</AppText>
      <AppButton title={copy.retry} onPress={retry} />
    </>
  );
}
