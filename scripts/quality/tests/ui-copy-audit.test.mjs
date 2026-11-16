import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { selectChecksForPaths } from '../../ci/changed-paths-select.mjs';
import { findDirectKoreanCopy, isShippingTsx } from '../ui-copy-audit.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));

test('detects direct text, accessibility copy, conditional copy and template fragments', () => {
  const samples = [
    '<Text>합성 표시</Text>',
    '<Button title="합성 버튼" />',
    '<Button accessibilityLabel={"합성 이름"} accessibilityHint="합성 힌트" />',
    '<Text>{ready ? "합성 준비" : t("status")}</Text>',
    '<Input placeholder={`합성 ${count}개`} />',
    '<><Text>{["합성 항목"].join(" ")}</Text></>',
  ];
  for (const source of samples) assert.ok(findDirectKoreanCopy(source).length > 0, source);
});

test('does not translate comments, regexes, events, stored values or catalog calls', () => {
  const source = `
    // 한국어 주석은 사용자 표시 문자열이 아니다.
    const pattern = /진료|병원/u;
    const saved = "저장 계약";
    const view = <Button title={t("label", { count })} onPress={() => submit("모델 지시")} />;
    const body = <Text>{record.text}</Text>;
  `;
  assert.deepEqual(findDirectKoreanCopy(source), []);
  assert.deepEqual(findDirectKoreanCopy('<Text>OpenAI API</Text>'), []);
});

test('nested JSX keeps callbacks excluded and reports display literals once', () => {
  assert.equal(
    findDirectKoreanCopy('<>{ok && <Button title="합성" onPress={() => log("진단")} />}</>').length,
    1,
  );
  assert.throws(() => findDirectKoreanCopy('<Text>'), /invalid TSX/u);
});

test('only explicit test/catalog/probe exclusions apply', () => {
  assert.equal(isShippingTsx('apps/mobile/src/routes/Example.tsx'), true);
  assert.equal(isShippingTsx('apps/mobile/src/routes/OtherProbe.tsx'), true);
  for (const file of [
    'apps/mobile/src/routes/Example.test.tsx',
    'apps/mobile/src/routes/__tests__/Example.tsx',
    'apps/mobile/src/routes/testSupport/Example.tsx',
    'apps/mobile/src/i18n/Example.tsx',
    'apps/mobile/src/encounterReview/NativeReviewProbe.tsx',
    'apps/mobile/e2e/Example.tsx',
  ])
    assert.equal(isShippingTsx(file), false, file);
});

test('tracked shipping TSX keeps direct Korean UI copy in the existing catalog', () => {
  const files = execFileSync('git', ['ls-files', '-z', 'apps/mobile/src'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(isShippingTsx);
  assert.ok(files.length > 100, 'The audit must inspect the shipping source tree');
  const failures = files.flatMap((file) =>
    findDirectKoreanCopy(
      readFileSync(new URL('../../../' + file, import.meta.url), 'utf8'),
      file,
    ).map(({ line, column }) => `${file}:${line}:${column}`),
  );
  assert.deepEqual(
    failures,
    [],
    'Move direct display copy into the existing catalog; review non-display exceptions explicitly.',
  );
});

test('a standalone shipping TSX change selects the catalog regression gate', () => {
  const checks = selectChecksForPaths(['apps/mobile/src/routes/OverviewRoute.tsx']);
  assert.equal(checks.policy_tests, true);
  assert.equal(checks.unit_tests, true);
  assert.equal(checks.typecheck, true);
});
