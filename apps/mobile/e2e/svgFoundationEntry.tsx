import { useState } from 'react';
import { AppRegistry, Button, StyleSheet, Text, View } from 'react-native';
import Svg, { G, Path, Text as SvgText, TSpan } from 'react-native-svg';
import { name } from '../app.json';

/** Exercises synthetic SVG property updates without loading health data. */
function SvgFoundationFixture() {
  const [changed, setChanged] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [hits, setHits] = useState(0);
  return (
    <View style={styles.root}>
      <Text>{`상태: ${changed ? '변경' : '기본'} / 적중: ${hits}`}</Text>
      <Button title="변경 및 복원" onPress={() => setChanged(!changed)} />
      <Button title="다시 생성" onPress={() => setGeneration(generation + 1)} />
      <Svg key={generation} width={320} height={240} testID="svg-foundation">
        <G
          opacity={changed ? 0.5 : 1}
          transform={changed ? 'translate(80,40)' : 'translate(0,0)'}
        >
          <Path
            d="M20 20 H160 V110 H20 Z"
            fill="red"
            onPress={() => setHits(hits + 1)}
          />
          <SvgText x={30} y={160} fontSize={24} fill="blue">
            <TSpan>합성 자료</TSpan>
          </SvgText>
        </G>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 70, backgroundColor: 'white' },
});

AppRegistry.registerComponent(name, () => SvgFoundationFixture);
