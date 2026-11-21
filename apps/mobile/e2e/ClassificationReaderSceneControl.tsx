import { useEffect, useState } from 'react';
import { NativeModules, Pressable, StyleSheet, Text } from 'react-native';
import { createReaderSceneAdapter } from './classificationReaderSceneGeometry';

/** Test-only no-store adapter. Native owns scene binding, masks and event observation. */
export function ClassificationReaderSceneControl() {
  const [receipt, setReceipt] = useState('{}');
  const [pending, setPending] = useState(false);
  const [adapter, setAdapter] = useState<ReturnType<
    typeof createReaderSceneAdapter
  > | null>(null);
  useEffect(() => {
    const manager = NativeModules.SettingsManager;
    const settings =
      manager?.settings ?? manager?.getConstants?.().settings ?? {};
    const controller = createReaderSceneAdapter(
      settings.OROT_TEST_ROTATION_GEOMETRY_SESSION,
      (session, mode) =>
        NativeModules.OrotTestControl.rotationGeometryCommand(session, mode),
    );
    setAdapter(controller);
    return () => controller.dispose();
  }, []);
  return (
    <Pressable
      testID="classification-reader-scene"
      accessibilityRole="button"
      accessibilityLabel={receipt}
      disabled={pending || !adapter}
      style={styles.control}
      onPress={async () => {
        setPending(true);
        const result = await adapter?.run();
        if (result) setReceipt(JSON.stringify(result));
        setPending(false);
      }}
    >
      <Text allowFontScaling={false}>Scene</Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  control: { minWidth: 45, minHeight: 45, justifyContent: 'center' },
});
