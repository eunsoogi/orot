import { useState } from 'react';
import { Text, View } from 'react-native';
import { t } from '../i18n';
import { appColors } from '../layout/appColors';
import { readProcessDiagnosticWitness } from '../providers/processDiagnosticWitness';
import { SettingsRouteRow } from './SettingsRouteRows';

type Snapshot = Awaited<ReturnType<typeof readProcessDiagnosticWitness>>;

export function ProcessDiagnosticWitnessSection() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [reading, setReading] = useState(false);

  return (
    <View testID="settings-process-diagnostic-witness">
      <SettingsRouteRow
        symbol="waveform.path"
        testID="settings-read-process-diagnostic-witness"
        onPress={() => {
          if (reading) return;
          setReading(true);
          readProcessDiagnosticWitness()
            .then(setSnapshot)
            .finally(() => setReading(false));
        }}
        title={t('settings.processWitness.read')}
      />
      {reading ? (
        <Text style={{ color: appColors.secondary }}>
          {t('settings.processWitness.reading')}
        </Text>
      ) : snapshot === null ? (
        <Text style={{ color: appColors.secondary }}>
          {t('settings.processWitness.unavailable')}
        </Text>
      ) : snapshot ? (
        <View accessibilityLiveRegion="polite">
          <Text style={{ color: appColors.secondary }}>
            {t(
              snapshot.launch
                ? 'settings.processWitness.launchConfirmed'
                : 'settings.processWitness.launchMissing',
            )}
          </Text>
          <Text style={{ color: appColors.secondary }}>
            {t(
              snapshot.bridge
                ? 'settings.processWitness.bridgeConfirmed'
                : 'settings.processWitness.bridgeMissing',
            )}
          </Text>
          {snapshot.receipts.map((receipt, index) => (
            <Text key={index} style={{ color: appColors.secondary }}>
              {receipt}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}
