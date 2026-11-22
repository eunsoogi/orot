import { useRef, useState } from 'react';
import { t } from '../i18n';
import { AppButton } from '../layout/AppButton';
import { AppText } from '../layout/AppText';

/** A tap authorizes only the currently displayed original, never a new report or provider call. */
export function GeneratedReportBookmarkAction({
  bookmark,
  current,
}: {
  readonly bookmark: (current: () => boolean) => Promise<boolean>;
  readonly current: () => boolean;
}) {
  const pressing = useRef(false);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>(
    'idle',
  );
  const save = async () => {
    if (pressing.current || !current()) return;
    pressing.current = true;
    setStatus('saving');
    try {
      const saved = await bookmark(current);
      if (current()) setStatus(saved ? 'saved' : 'failed');
    } catch {
      if (current()) setStatus('failed');
    } finally {
      pressing.current = false;
    }
  };
  return (
    <>
      <AppButton
        title={t('savedMemory.bookmarkDiseasePossibilities')}
        variant="neutral"
        testID="generated-report-bookmark-original"
        disabled={status === 'saving'}
        onPress={() => {
          save();
        }}
      />
      {status === 'saved' || status === 'failed' ? (
        <AppText accessibilityLiveRegion="polite">
          {t(
            status === 'saved'
              ? 'savedMemory.generatedReportSaved'
              : 'savedMemory.generatedReportUnavailable',
          )}
        </AppText>
      ) : null}
    </>
  );
}
