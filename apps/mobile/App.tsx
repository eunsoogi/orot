import { useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';

export default function App() {
  const [hasStarted, setHasStarted] = useState(false);

  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.title} testID="welcome-title">
        Orot workspace ready
      </Text>
      <Text style={styles.message}>
        {hasStarted ? 'You are ready to build.' : 'A simple foundation for Orot.'}
      </Text>
      <Button
        onPress={() => setHasStarted(true)}
        testID="get-started"
        title="Get started"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
    backgroundColor: '#f7f8fa',
  },
  title: {
    color: '#17212b',
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
  message: {
    color: '#45515f',
    fontSize: 16,
    textAlign: 'center',
  },
});
