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
import { generatedReportBrowserStyles as styles } from './generatedReportBrowserStyles';

/** The list publishes metadata only; opening a row is the protected content read. */
export function GeneratedReportRows({
  rows,
  more,
  onOpen,
  onMore,
}: {
  readonly rows: readonly GeneratedReportRow[];
  readonly more: boolean;
  readonly onOpen: (row: GeneratedReportRow) => void;
  readonly onMore: () => void;
}) {
  return (
    <>
      {rows.length === 0 ? (
        <AppText>{copy.empty}</AppText>
      ) : (
        <MaterialLibraryRows testID="generated-report-rows">
          {rows.map((row, index) => (
            <MaterialLibraryRow
              key={row.key}
              testID={`generated-report-${row.key}`}
              divider={index + 1 < rows.length}
              title={copy[row.kind]}
              summary={`${formatDateTime(new Date(row.createdAt))}${row.unavailable ? ' · ' + copy.unavailable : ''}`}
              onPress={() => {
                onOpen(row);
              }}
            />
          ))}
        </MaterialLibraryRows>
      )}
      {more ? (
        <AppButton
          title={copy.more}
          onPress={() => {
            onMore();
          }}
        />
      ) : null}
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
