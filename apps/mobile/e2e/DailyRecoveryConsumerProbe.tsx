import { useState } from 'react';
import { Button, Text, View } from 'react-native';
import { DailyReportLocalRecovery } from '../src/aiFeatures/integration/DailyReportLocalRecovery';
import type { createDailyRecoveryNativeSession } from './dailyRecoveryNativeSession';

/** Only the explicitly selected isolated native entry mounts this real consumer.
 * Route toggling exercises unmount cancellation; it cannot resume or generate.
 * Status contains the session's closed metadata, never report/source contents. */
export function DailyRecoveryConsumerProbe({
  session,
}: {
  session: ReturnType<typeof createDailyRecoveryNativeSession>;
}) {
  const [visible, setVisible] = useState(true);
  const [working, setWorking] = useState(false);
  const [metadata, setMetadata] = useState('not-inspected');
  const inspect = async () => {
    try {
      setMetadata(JSON.stringify(await session.inspect()));
    } catch {
      setMetadata('synthetic-inspection-failed');
    }
  };
  return (
    <View>
      <Text testID="daily-recovery-consumer-status">{metadata}</Text>
      <Text testID="daily-recovery-consumer-working">{String(working)}</Text>
      <Button
        title="Inspect local metadata"
        onPress={() => {
          inspect();
        }}
      />
      <Button
        title="Toggle recovery route"
        onPress={() => setVisible(value => !value)}
      />
      {visible ? (
        <DailyReportLocalRecovery
          feature={session.recoveryActions}
          identity={session.identity}
          busy={false}
          revision={0}
          onBusy={setWorking}
          onSaved={() => {
            inspect();
          }}
        />
      ) : null}
    </View>
  );
}
