import { formatDateTime } from '../i18n';
import { AppText } from '../layout/AppText';
import { AppButton } from '../layout/AppButton';
import { generatedReportCopy as copy } from './text';
import type { GeneratedReportRow } from './types';

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
        rows.map(row => (
          <AppButton
            key={row.key}
            testID={`generated-report-${row.key}`}
            variant="list"
            title={copy[row.kind]}
            summary={`${formatDateTime(new Date(row.createdAt))}${row.unavailable ? ' · ' + copy.unavailable : ''}`}
            onPress={() => {
              onOpen(row);
            }}
          />
        ))
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
