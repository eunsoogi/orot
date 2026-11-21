import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { AppButton } from '../../layout/AppButton';
import { AppText } from '../../layout/AppText';
import { t } from '../../i18n';
import {
  appPublisherCorpus,
  publisherCorpusAvailable,
} from './appPublisherCorpus';

export function PublisherCorpusSettings() {
  const running = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] =
    useState<Awaited<ReturnType<typeof appPublisherCorpus.refresh>>>();
  useEffect(
    () => () => {
      running.current?.abort();
      running.current = null;
    },
    [],
  );
  const refresh = async () => {
    if (running.current) return;
    const work = new AbortController();
    running.current = work;
    setBusy(true);
    const next = await appPublisherCorpus.refresh(work.signal);
    if (running.current !== work) return;
    running.current = null;
    setStatus(next);
    setBusy(false);
  };
  return (
    <View testID="publisher-corpus-settings">
      <AppText accessibilityRole="header">{t('publisherWeb.title')}</AppText>
      <AppText>{t('publisherWeb.disclosure')}</AppText>
      <AppButton
        title={t('publisherWeb.refresh')}
        disabled={!publisherCorpusAvailable || busy}
        onPress={refresh}
        testID="publisher-corpus-refresh"
      />
      {status || !publisherCorpusAvailable ? (
        <AppText accessibilityRole="status">
          {status === 'ready' || status === 'retained'
            ? t('publisherWeb.ready')
            : status === 'partial'
              ? t('publisherWeb.partial')
              : t('publisherWeb.unavailable')}
        </AppText>
      ) : null}
    </View>
  );
}
