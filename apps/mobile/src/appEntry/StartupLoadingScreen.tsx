import {
  ActivityIndicator,
  Platform,
  PlatformColor,
  ScrollView,
  StyleSheet,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';
import { t } from '../i18n';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';

// Match the native launch storyboard's semantic UIColor, not the route chrome.
const launchBackground =
  Platform.OS === 'ios'
    ? PlatformColor('systemBackgroundColor')
    : appColors.surface;

function StartupDecoration() {
  const dark = useColorScheme() === 'dark';
  return (
    <View
      testID="startup-decoration"
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg
        width="100%"
        height="100%"
        viewBox="0 0 400 760"
        preserveAspectRatio="none"
      >
        <Ellipse
          cx="396"
          cy="86"
          rx="224"
          ry="188"
          fill={appColors.primary}
          opacity={dark ? 0.1 : 0.07}
        />
        <Ellipse
          cx="404"
          cy="82"
          rx="184"
          ry="149"
          fill="none"
          stroke={appColors.primary}
          strokeWidth="1"
          opacity={dark ? 0.36 : 0.24}
        />
        <Ellipse
          cx="-42"
          cy="758"
          rx="210"
          ry="220"
          fill={appColors.primary}
          opacity={dark ? 0.09 : 0.055}
        />
        <Ellipse
          cx="-38"
          cy="746"
          rx="165"
          ry="170"
          fill="none"
          stroke={appColors.primary}
          strokeWidth="1"
          opacity={dark ? 0.3 : 0.19}
        />
        <Circle
          cx="245"
          cy="65"
          r="4"
          fill={appColors.primary}
          opacity="0.48"
        />
        <Circle
          cx="108"
          cy="668"
          r="3"
          fill={appColors.primary}
          opacity="0.42"
        />
      </Svg>
    </View>
  );
}

function StartupMark({ size }: { size: number }) {
  return (
    <View
      testID="startup-mark"
      style={[
        styles.mark,
        { width: size, height: size, borderRadius: size * 0.28 },
      ]}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* The open ring and pale satellite reproduce the app icon's silhouette. */}
      <Svg width="72%" height="72%" viewBox="0 0 1024 1024">
        <Path
          fill="#ffffff"
          d="M732 196C552 108 338 160 225 300C100 454 130 688 295 810C455 930 679 902 811 748C913 629 914 465 826 349C784 294 738 312 746 359C752 400 721 430 678 442C663 446 663 458 678 473C735 530 712 629 650 686C572 757 442 747 367 674C288 597 285 470 354 388C438 286 585 249 705 287C758 312 772 243 732 196Z"
        />
        <Circle cx="669" cy="358" r="56" fill="#b6e4fc" />
      </Svg>
    </View>
  );
}

/** Display-only splash while the existing app-entry gate reads its preference.
 * Full-bleed decoration never sets the safe bounds for readable content. */
export function StartupLoadingScreen() {
  const { width, height } = useWindowDimensions();
  const landscape = height < 500 && width >= 400;
  const spacious = width >= 600 && !landscape;
  const markSize = landscape ? 70 : spacious ? 112 : 92;
  return (
    <SafeAreaProvider style={styles.fill}>
      <View style={styles.surface} testID="startup-surface">
        <StartupDecoration />
        <SafeAreaView
          edges={['top', 'right', 'bottom', 'left']}
          style={styles.fill}
          testID="startup-readable-area"
        >
          <ScrollView
            style={styles.fill}
            contentContainerStyle={styles.center}
            contentInsetAdjustmentBehavior="never"
            showsVerticalScrollIndicator={false}
          >
            <View
              style={[styles.lockup, landscape && styles.wideLockup]}
              testID="startup-lockup"
            >
              <StartupMark size={markSize} />
              <View style={styles.copy}>
                <AppText
                  accessibilityRole="header"
                  style={[styles.title, spacious && styles.spaciousTitle]}
                >
                  {t('app.welcome.title')}
                </AppText>
                <View
                  accessible
                  accessibilityRole="progressbar"
                  accessibilityState={{ busy: true }}
                  accessibilityLabel={t('assistantAppearance.loading')}
                  style={styles.status}
                >
                  <ActivityIndicator color={appColors.primaryText} />
                  <AppText style={styles.statusLabel}>
                    {t('assistantAppearance.loading')}
                  </AppText>
                </View>
              </View>
            </View>
          </ScrollView>
        </SafeAreaView>
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  surface: { flex: 1, backgroundColor: launchBackground, overflow: 'hidden' },
  center: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 20,
  },
  lockup: {
    maxWidth: 440,
    alignItems: 'center',
    gap: 20,
    flexDirection: 'column',
  },
  wideLockup: { flexDirection: 'row', gap: 24 },
  mark: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: appColors.primary,
    flexShrink: 0,
  },
  copy: { flexShrink: 1, minWidth: 0, alignItems: 'center', gap: 8 },
  title: {
    textAlign: 'center',
    fontSize: 38,
    fontWeight: '700',
    letterSpacing: -1.2,
  },
  spaciousTitle: { fontSize: 46 },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: 8,
  },
  statusLabel: {
    flexShrink: 1,
    textAlign: 'center',
    color: appColors.secondary,
    fontSize: 15,
  },
});
