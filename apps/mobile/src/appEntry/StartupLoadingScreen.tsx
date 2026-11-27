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
import Svg, {
  Circle,
  Defs,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import { t } from '../i18n';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';

// Match the native launch storyboard's semantic UIColor, not the route chrome.
const launchBackground =
  Platform.OS === 'ios'
    ? PlatformColor('systemBackgroundColor')
    : appColors.surface;

function StartupBackdrop() {
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
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id="startup-halo" cx="50%" cy="46%" rx="58%" ry="48%">
            <Stop
              offset="0%"
              stopColor={appColors.primary}
              stopOpacity={dark ? 0.18 : 0.12}
            />
            <Stop
              offset="58%"
              stopColor={appColors.primary}
              stopOpacity={dark ? 0.07 : 0.045}
            />
            <Stop offset="100%" stopColor={appColors.primary} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#startup-halo)" />
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

/** Center the startup lockup in the full React root, not the inset frame.
 * The centered artwork remains clear of OS overlays without shifting when they move. */
export function StartupLoadingScreen() {
  const { width, height } = useWindowDimensions();
  const landscape = height < 500 && width >= 400;
  const spacious = width >= 600 && !landscape;
  const markSize = landscape ? 70 : spacious ? 112 : 92;
  return (
    <View style={styles.surface} testID="startup-surface">
      <StartupBackdrop />
      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.center}
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        showsVerticalScrollIndicator={false}
        testID="startup-readable-area"
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
            >
              <ActivityIndicator color={appColors.primaryText} />
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
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
  copy: { flexShrink: 1, minWidth: 0, alignItems: 'center', gap: 12 },
  title: {
    textAlign: 'center',
    fontSize: 38,
    fontWeight: '700',
    letterSpacing: -1.2,
  },
  spaciousTitle: { fontSize: 46 },
});
