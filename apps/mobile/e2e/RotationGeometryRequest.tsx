import { useState } from 'react';
import { NativeModules, StyleSheet, Text } from 'react-native';

/** Restrict policy evidence to documented scalar and enum values. */
function orientationPolicy(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of [
    'rootSupportedMask',
    'activeSupportedMask',
    'sceneActivation',
  ]) {
    if (typeof source[key] === 'number' && Number.isFinite(source[key]))
      result[key] = source[key];
  }
  for (const key of [
    'sceneDelegateOverridesMask',
    'controllerPrefersLock',
    'sceneLocked',
  ]) {
    if (typeof source[key] === 'boolean') result[key] = source[key];
  }
  if (
    Array.isArray(source.presentedStyles) &&
    source.presentedStyles.every(
      (item: unknown) => typeof item === 'number' && Number.isFinite(item),
    )
  )
    result.presentedStyles = source.presentedStyles;
  const allowed = [
    'UIInterfaceOrientationPortrait',
    'UIInterfaceOrientationPortraitUpsideDown',
    'UIInterfaceOrientationLandscapeLeft',
    'UIInterfaceOrientationLandscapeRight',
  ];
  if (
    Array.isArray(source.declaredOrientations) &&
    source.declaredOrientations.every(
      (item: unknown) => typeof item === 'string' && allowed.includes(item),
    )
  )
    result.declaredOrientations = source.declaredOrientations;
  return result;
}

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
                      orientationPolicy: orientationPolicy(
                        geometry.orientationPolicy,
                      ),
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
