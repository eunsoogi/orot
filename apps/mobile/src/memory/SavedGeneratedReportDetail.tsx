import { conversationDailyReportText } from '../aiFeatures/integration/conversationDailyReportText';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { AppText } from '../layout/AppText';
import { t } from '../i18n';
import { openSavedGeneratedReportReferences } from './openSavedGeneratedReportReferences';

/** Resolve the original only on explicit local open; never treat it as authored memory. */
export function SavedGeneratedReportDetail({
  artifactId,
}: {
  artifactId: string;
}) {
  const [result, setResult] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let current = true;
    openSavedGeneratedReportReferences()
      .then(storage =>
        storage.readSavedGeneratedReportReference(artifactId, () => current),
      )
      .then(report => {
        if (current)
          setResult(report ? conversationDailyReportText(report) : null);
      })
      .catch(() => {
        if (current) setResult(null);
      });
    return () => {
      current = false;
    };
  }, [artifactId]);
  return (
    <View testID="saved-generated-report-detail">
      <AppText accessibilityRole="header">
        {t('savedMemory.generatedReportDaily')}
      </AppText>
      <AppText>{t('savedMemory.generatedReportOrigin')}</AppText>
      {result === undefined ? (
        <AppText>{t('savedMemory.loading')}</AppText>
      ) : !result ? (
        <AppText accessibilityRole="alert">
          {t('savedMemory.generatedReportUnavailable')}
        </AppText>
      ) : (
        <AppText selectable>{result}</AppText>
      )}
    </View>
  );
}
