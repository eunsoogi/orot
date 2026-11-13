import { useState } from 'react';
import { NativeModules, StyleSheet, Text } from 'react-native';

/** Exposes one requested native sample to the isolated rotation diagnostic. */
export function RotationGeometryRequest({ session }: { session: unknown }) {
  const [rotationReceipt, setRotationReceipt] = useState('{}');
  return (
    <>
      {typeof session === 'string' ? (
        <Text
          accessible
          accessibilityLabel={rotationReceipt}
          onPress={() => {
            const requestId = session;
            const requestedAtMs = Date.now();
            // One explicit test request invokes UIKit; periodic marker contents cannot satisfy it.
            NativeModules.OrotTestControl.navigationSnapshot().then(
              (value: { windowGeometry?: Record<string, unknown> }) => {
                const geometry = value.windowGeometry;
                setRotationReceipt(
                  JSON.stringify({
                    requestId,
                    requestedAtMs,
                    windowGeometry: geometry && {
                      windowBounds: geometry.windowBounds,
                      safeAreaInsets: geometry.safeAreaInsets,
                      sceneOrientation: geometry.sceneOrientation,
                      sampleStartedAtMs: geometry.sampleStartedAtMs,
                      sampleEndedAtMs: geometry.sampleEndedAtMs,
                    },
                  }),
                );
              },
            );
          }}
          style={styles.request}
          testID="rotation-geometry-request"
        >
          Geometry request
        </Text>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  request: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 44,
    height: 44,
    fontSize: 1,
  },
});
