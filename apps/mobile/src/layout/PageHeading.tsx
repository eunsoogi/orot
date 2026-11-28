import {
  Platform,
  StyleSheet,
  type TextStyle,
  useWindowDimensions,
} from 'react-native';
import { AppText } from './AppText';
import { pageHeadingStyles } from './pageHeadingPresentation';

type Props = {
  readonly children: string;
  readonly testID?: string;
  readonly style?: TextStyle;
};

/** Use a common iOS line box only at default size; explicit leading disturbed
 * some wrapped Korean headings at accessibility sizes. Keep native wrapping. */
export function PageHeading({ children, testID, style }: Props) {
  const { fontScale } = useWindowDimensions();
  const title =
    Platform.OS === 'ios' && fontScale === 1
      ? styles.defaultTitle
      : pageHeadingStyles.title;
  return (
    <AppText
      accessibilityRole="header"
      style={style ? [title, style] : title}
      testID={testID}
    >
      {children}
    </AppText>
  );
}

const styles = StyleSheet.create({
  defaultTitle: { ...pageHeadingStyles.title, lineHeight: 42 },
});
