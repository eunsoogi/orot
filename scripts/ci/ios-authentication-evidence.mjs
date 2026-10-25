import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const udidPattern = /^[a-f0-9-]{36}$/i;

/** Validate recorded Device Hub input against the owned Simulator, never against XCTest status alone. */
export function verifyFaceIdControlLog(path, expectedUdid) {
  if (!udidPattern.test(expectedUdid ?? ''))
    throw new Error('Authentication evidence requires its exact Simulator owner UDID');
  const events = readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('FACE_ID_'));
  const withUdid = events.map((line) => ({
    line,
    udid: /\budid=([a-f0-9-]{36})(?:\s|$)/i.exec(line)?.[1],
  }));
  if (!events.length || withUdid.some(({ udid }) => udid !== expectedUdid))
    throw new Error('Authentication control log is missing or belongs to another Simulator');

  const matching = (pattern) => events.filter((line) => pattern.test(line));
  const ownerLaunch = matching(/FACE_ID_OWNER_APP_LAUNCHED\b/);
  const enrollBegin = matching(/FACE_ID_ACTION_BEGIN action=enroll\b/);
  const enrollSent = matching(/FACE_ID_ACTION_SENT action=enroll\b/);
  const authorizationInputs = matching(/FACE_ID_AUTHORIZATION_INPUT_SENT\b/).map((line) =>
    Number(/count=(\d+)/.exec(line)?.[1]),
  );
  const testResult = matching(/FACE_ID_TEST_RESULT\b/).map((line) =>
    /FACE_ID_TEST_RESULT exit=(\d+) authorization_inputs=(\d+)\b/.exec(line),
  );
  const authorizationStarts = matching(/FACE_ID_ACTION_BEGIN action=authorize\b/);
  if (
    ownerLaunch.length !== 1 ||
    enrollBegin.length !== 1 ||
    enrollSent.length !== 1 ||
    matching(/FACE_ID_ACTION_FAILED\b/).length > 0 ||
    authorizationStarts.length < 1 ||
    authorizationInputs.some((count, index) => count !== index + 1) ||
    testResult.length !== 1 ||
    !testResult[0] ||
    testResult[0][1] !== '0' ||
    Number(testResult[0][2]) < 1 ||
    Number(testResult[0][2]) !== authorizationInputs.length ||
    authorizationStarts.length < authorizationInputs.length
  )
    throw new Error('Authentication control log lacks a successful prompted Keychain test run');

  const ownerIndex = events.indexOf(ownerLaunch[0]);
  const enrollBeginIndex = events.indexOf(enrollBegin[0]);
  const enrollSentIndex = events.indexOf(enrollSent[0]);
  const inputIndex = events.findIndex((line) => line.includes('FACE_ID_AUTHORIZATION_INPUT_SENT'));
  const resultIndex = events.indexOf(events.find((line) => line.includes('FACE_ID_TEST_RESULT')));
  if (!(
    ownerIndex < enrollBeginIndex &&
    enrollBeginIndex < enrollSentIndex &&
    enrollSentIndex < inputIndex &&
    inputIndex < resultIndex
  ))
    throw new Error('Authentication control log events are out of order');

  return {
    ownerUdid: expectedUdid,
    biometricAuthorizationInputs: authorizationInputs.length,
  };
}

/** An xcresult bundle must be a real downloaded directory with its standard metadata and data tree. */
export function verifyAuthenticationResultBundle(directory) {
  const bundle = lstatSync(directory);
  const info = lstatSync(join(directory, 'Info.plist'));
  const data = lstatSync(join(directory, 'Data'));
  if (
    !bundle.isDirectory() ||
    bundle.isSymbolicLink() ||
    !info.isFile() ||
    info.isSymbolicLink() ||
    !data.isDirectory() ||
    data.isSymbolicLink()
  )
    throw new Error('Authentication evidence requires a complete .xcresult bundle');
}
