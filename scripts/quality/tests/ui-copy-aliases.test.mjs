import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findDirectKoreanCopy } from '../ui-copy-audit.mjs';

test('reports local display aliases, chains and templates at their declaration once', () => {
  const source =
    'const title = "합성 제목"; const alias = title; const view = <><Button title={alias}/><Text>{title}</Text></>;';
  assert.deepEqual(findDirectKoreanCopy(source), [{ line: 1, column: 15 }]);
  for (const [expression, count] of [
    ['`합성 ${count}개`', 2],
    ['ready ? "합성 준비" : "Other"', 1],
    ['("합성" as const)', 1],
    ['"합성" + suffix', 1],
  ]) {
    assert.equal(
      findDirectKoreanCopy(
        `const label = ${expression}; const view = <Button accessibilityLabel={label}/>;`,
      ).length,
      count,
    );
  }
});

test('respects parameters and block shadowing instead of matching identifier spellings', () => {
  assert.deepEqual(
    findDirectKoreanCopy(`
    const title = "표시하지 않는 원문";
    function Screen({title}) { return <Text>{title}</Text>; }
    function Other() { const title = t('label'); return <Button title={title}/>; }
  `),
    [],
  );
  assert.equal(
    findDirectKoreanCopy(`
    const title = t('label');
    function Screen() { const title = "합성 표시"; return <Text>{title}</Text>; }
  `).length,
    1,
  );
});

test('does not follow imports, mutable values, object fields, calls or callbacks', () => {
  assert.deepEqual(
    findDirectKoreanCopy(`
    import { title } from './unread-file';
    let mutable = "원문";
    const record = { text: "사용자 자료" };
    const query = makeQuery("모델 지시");
    const action = () => submit("모델 지시");
    const view = <><Button title={title} onPress={action}/><Text>{mutable}{record.text}{query}</Text></>;
  `),
    [],
  );
});

test('terminates cyclic and forward alias chains without evaluating them', () => {
  assert.deepEqual(
    findDirectKoreanCopy('const a = b; const b = a; const view = <Text>{a}</Text>;'),
    [],
  );
  assert.equal(
    findDirectKoreanCopy('const a = b; const b = "합성"; const view = <Text>{a}</Text>;').length,
    1,
  );
});

test('wrapped objects, callbacks and condition-only strings remain outside scalar display flow', () => {
  assert.deepEqual(
    findDirectKoreanCopy(`
    const record = ({text: "저장 원문"} as const);
    const callback = ready ? () => "지시" : t('label');
    const condition = "직렬화 키";
    const title = condition ? t('yes') : t('no');
    const view = <Text>{record}{callback}{title}</Text>;
  `),
    [],
  );
});

test('direct JSX keeps call arguments and control predicates outside alias expansion', () => {
  for (const source of [
    'const instruction="진단하지 마세요"; const view=<Text>{run(instruction)}</Text>;',
    'const condition="내부키"; const view=<Text>{condition ? "English" : "Other"}</Text>;',
    'const condition="내부키"; const label=condition && "English"; const view=<Text>{label}</Text>;',
    'const condition="내부키"; const view=<Text>{condition === "internal"}</Text>;',
  ])
    assert.deepEqual(findDirectKoreanCopy(source), []);
  for (const expression of ['!value', '+value', 'typeof value', 'void value'])
    assert.deepEqual(
      findDirectKoreanCopy(`const value="내부키"; const view=<Text>{${expression}}</Text>;`),
      [],
    );
  // Original direct-literal detection remains intact even inside calls.
  assert.equal(findDirectKoreanCopy('<Text>{format("직접 원문")}</Text>').length, 1);
});
