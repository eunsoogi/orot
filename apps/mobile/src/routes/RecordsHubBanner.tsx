import { createContext } from 'react';
import { t } from '../i18n';
import { HubBanner } from './HubBanner';

/** Standalone record routes retain their heading; the hub supplies it once. */
export const RecordsHubHeadingContext = createContext(false);

/** Records shares decorative artwork with Overview and Settings without duplicating content. */
export function RecordsHubBanner() {
  return (
    <HubBanner
      title={t('records.title')}
      subtitle={t('records.subtitle')}
      testID="records"
      collapseSubtitle
    />
  );
}
