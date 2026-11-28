import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { calendarStyles as styles } from './calendarStyles';

/** An empty day, incomplete result, and unqueried day are separate states. */
export function CalendarDateCoverage({
  selectedDateOutsideQuery,
  incomplete,
  empty,
}: {
  readonly selectedDateOutsideQuery: boolean;
  readonly incomplete: boolean;
  readonly empty: boolean;
}) {
  return (
    <>
      {selectedDateOutsideQuery ? (
        <Text style={styles.calendarNotice} testID="calendar-outside-query">
          {t('calendar.outsideQueryRange')}
        </Text>
      ) : null}
      {incomplete ? (
        <Text style={styles.calendarNotice} testID="calendar-result-limit">
          {t('calendar.resultsMayBeIncomplete')}
        </Text>
      ) : null}
      {empty ? (
        <>
          <Text testID="calendar-empty">{t('calendar.empty')}</Text>
          <Text
            style={styles.calendarNotice}
            testID="calendar-empty-query-note"
          >
            {t('calendar.emptyQueryNote')}
          </Text>
        </>
      ) : null}
    </>
  );
}
