import { Image, StyleSheet, View } from 'react-native';
import type { AvatarId } from './appearance';

const onboarding = require('./assets/onboarding-reference.png');
const voice = require('./assets/voice-reference.png');
const artwork = {
  neutral: {
    source: onboarding,
    width: 890,
    height: 1768,
    x: 270,
    y: 468,
    diameter: 347,
  },
  leaf: {
    source: onboarding,
    width: 890,
    height: 1768,
    x: 283,
    y: 901,
    diameter: 148,
  },
  sun: {
    source: onboarding,
    width: 890,
    height: 1768,
    x: 464,
    y: 900,
    diameter: 150,
  },
  star: {
    source: voice,
    width: 1040,
    height: 1512,
    x: 430,
    y: 306,
    diameter: 180,
  },
} as const;

/** Render the project's approved raster art without redrawing characters or changing saved IDs.
 * The original public proposal is retained as an atlas; only its avatar region is visible.
 * Names, labels, and status are live app content, never copied from the reference image.
 */
export function AvatarArtwork({
  avatar,
  size = 32,
}: {
  avatar: AvatarId;
  size?: number;
}) {
  const asset = artwork[avatar];
  const scale = size / asset.diameter;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.clip,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <Image
        source={asset.source}
        accessible={false}
        resizeMode="stretch"
        style={[
          styles.image,
          {
            width: asset.width * scale,
            height: asset.height * scale,
            left: -asset.x * scale,
            top: -asset.y * scale,
          },
        ]}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  image: { position: 'absolute' },
});
