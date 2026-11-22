import { StyleSheet, View, type ViewProps } from 'react-native';
import { AppButton } from './AppButton';
import { AppSymbol } from './AppSymbol';
import { appColors } from './appColors';
import { hubSpacing } from './hubSpacing';

/** Library chrome applies the Records gutters once; only actual rows get a surface. */
export const materialLibraryStyles = StyleSheet.create({
  screen: {
    gap: 12,
    minWidth: 0,
    paddingHorizontal: hubSpacing.horizontal,
    paddingTop: hubSpacing.top,
  },
  heading: { color: appColors.text, fontSize: 21, fontWeight: '700' },
  description: { color: appColors.secondary, fontSize: 14, lineHeight: 19 },
  group: {
    backgroundColor: appColors.surface,
    borderRadius: 16,
    minWidth: 0,
    paddingHorizontal: 12,
  },
  row: { borderRadius: 0, paddingHorizontal: 0, paddingVertical: 14 },
  divider: {
    borderBottomColor: appColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});

export function MaterialLibraryRows({
  children,
  testID,
}: Pick<ViewProps, 'children' | 'testID'>) {
  return (
    <View style={materialLibraryStyles.group} testID={testID}>
      {children}
    </View>
  );
}

/** One actionable hit target per row; the accessory has no independent focus. */
export function MaterialLibraryRow({
  divider,
  ...props
}: {
  readonly title: string;
  readonly titleNumberOfLines?: number;
  readonly summary: string;
  readonly accessibilityHint?: string;
  readonly onPress?: () => void;
  readonly testID: string;
  readonly divider: boolean;
}) {
  return (
    <AppButton
      {...props}
      disabled={!props.onPress}
      variant="list"
      size="compact"
      style={[
        materialLibraryStyles.row,
        divider && materialLibraryStyles.divider,
      ]}
      trailingContent={
        props.onPress ? (
          <AppSymbol
            name="chevron.right"
            size={16}
            color={appColors.secondary}
          />
        ) : undefined
      }
    />
  );
}
