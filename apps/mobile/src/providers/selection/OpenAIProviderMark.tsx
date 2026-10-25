import { Image, StyleSheet, useColorScheme } from 'react-native';

/** Unmodified official provider identification, with artwork proportions and clear space preserved. */
export function OpenAIProviderMark() {
  const dark = useColorScheme() === 'dark';
  return (
    <Image
      accessible={false}
      resizeMode="contain"
      style={styles.mark}
      source={
        dark
          ? require('./assets/OpenAI-white-monoblossom.png')
          : require('./assets/OpenAI-black-monoblossom.png')
      }
    />
  );
}
const styles = StyleSheet.create({ mark: { width: 44, height: 44 } });
