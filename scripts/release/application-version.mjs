import { readFileSync } from 'node:fs';
import { isReleaseVersion } from './version-tags.mjs';

const MARKETING_VERSION = /^\s*MARKETING_VERSION\s*=\s*([^;\s]+)\s*;/gm;

// The root product version and iOS marketing version define the release; package dependency versions do not.
export function readApplicationVersion(readFile = readFileSync) {
  let rootManifest;
  try {
    rootManifest = JSON.parse(readFile('package.json', 'utf8'));
  } catch {
    throw new Error('root package.json does not contain valid version metadata');
  }

  const rootVersion = rootManifest.version;
  if (!isReleaseVersion(rootVersion))
    throw new Error('root package version must use MAJOR.MINOR.PATCH without a v prefix');

  const project = readFile('apps/mobile/ios/OrotMobile.xcodeproj/project.pbxproj', 'utf8');
  const marketingVersions = [...project.matchAll(MARKETING_VERSION)].map((match) => match[1]);
  if (marketingVersions.length === 0 || marketingVersions.some((value) => value !== rootVersion)) {
    throw new Error('root package and iOS MARKETING_VERSION values do not agree');
  }

  return rootVersion;
}
