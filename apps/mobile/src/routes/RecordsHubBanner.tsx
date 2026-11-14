import { createContext } from 'react';
import { StyleSheet, View, useColorScheme } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { AppText as Text } from '../layout/AppText';
import { appColorPalettes, appColors } from '../layout/appColors';
import { t } from '../i18n';

/** Standalone record routes retain their heading; the hub supplies it once. */
export const RecordsHubHeadingContext = createContext(false);

/** Decorative, data-free waves reproduce the approved banner without storing mockup images. */
export function RecordsHubBanner() {
  const palette =
    appColorPalettes[useColorScheme() === 'dark' ? 'dark' : 'light'];
  return (
    <View style={styles.banner}>
      <View
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Svg
          width="100%"
          height="100%"
          viewBox="0 0 1000 130"
          preserveAspectRatio="none"
        >
          <Defs>
            <LinearGradient id="records-wave" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={palette.surface} />
              <Stop offset="1" stopColor={palette.border} />
            </LinearGradient>
          </Defs>
          <Path
            d="M0 75 C220 150 250 20 480 70 S770 85 1000 0 L1000 0 L0 0 Z"
            fill="url(#records-wave)"
          />
          <Path
            d="M0 120 C260 50 330 115 560 65 S850 25 1000 85 L1000 130 L0 130 Z"
            fill={palette.background}
            opacity={0.45}
          />
        </Svg>
      </View>
      <Text
        accessibilityRole="header"
        style={styles.title}
        testID="records-title"
      >
        {t('records.title')}
      </Text>
      <Text style={styles.subtitle} testID="records-subtitle">
        {t('records.subtitle')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { minHeight: 108, padding: 20, gap: 8 },
  title: { color: appColors.text, fontSize: 36, fontWeight: '700' },
  subtitle: { color: appColors.secondary, fontSize: 16, lineHeight: 24 },
});
