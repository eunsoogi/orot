// Preserve the component test's async-press boundary without native button dependencies.
export const calendarButtonFixture = {
  AppButton: ({
    onPress,
    title,
    ...props
  }: {
    onPress?: () => unknown;
    title: string;
    testID?: string;
    disabled?: boolean;
  }) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable
        {...props}
        onPress={() => {
          onPress?.();
        }}
      >
        <Text>{title}</Text>
      </Pressable>
    );
  },
};
