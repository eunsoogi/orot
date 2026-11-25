import { useEffect, useState } from 'react';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { openSavedGeneratedReportReferences } from './openSavedGeneratedReportReferences';

/** Load the protected original only after selecting its identity-only pin. */
export function SavedConversationAnswerDetail({
  artifactId,
  isReadCurrent,
}: {
  readonly artifactId: string;
  readonly isReadCurrent: () => boolean;
}) {
  const [value, setValue] = useState<{
    artifactId: string;
    answer: string | null;
  }>();
  useEffect(() => {
    let mounted = true;
    const current = () => mounted && isReadCurrent();
    const publish = (answer: string | null) => {
      if (current()) setValue({ artifactId, answer });
    };
    openSavedGeneratedReportReferences()
      .then(storage => storage.readSavedConversationAnswer(artifactId, current))
      .then(publish, () => publish(null));
    return () => {
      mounted = false;
    };
  }, [artifactId, isReadCurrent]);
  if (!isReadCurrent()) return null;
  if (value?.artifactId !== artifactId)
    return <Text>{t('savedMemory.loading')}</Text>;
  return (
    <>
      <Text accessibilityRole="header">
        {t('historyDisplay.answerMemoryTitle')}
      </Text>
      <Text selectable>{value.answer ?? t('savedMemory.notFound')}</Text>
    </>
  );
}
