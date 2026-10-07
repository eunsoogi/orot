import { join } from 'node:path';

// A check partition identifies the runner requirement; the host key selects the matching tool asset.
const ALLOWED_PLATFORMS = new Set(['all', 'linux', 'macos']);

export function parsePlatformArgument(args) {
  // pnpm forwards its script-argument separator; remove it only at the argument boundary.
  const forwardedArgs = args[0] === '--' ? args.slice(1) : args;
  let platform = 'all';
  let foundPlatform = false;
  const remaining = [];

  for (let index = 0; index < forwardedArgs.length; index += 1) {
    if (forwardedArgs[index] !== '--platform') {
      remaining.push(forwardedArgs[index]);
      continue;
    }
    if (foundPlatform) throw new Error('Use --platform only once');
    foundPlatform = true;
    platform = forwardedArgs[index + 1];
    index += 1;
    if (!ALLOWED_PLATFORMS.has(platform)) {
      throw new Error('Use --platform all, --platform linux, or --platform macos');
    }
  }
  return { platform, remaining };
}

export function selectPlatformEntries(entries, policy, platform) {
  if (!ALLOWED_PLATFORMS.has(platform)) {
    throw new Error(`Unknown quality platform: ${platform}`);
  }
  for (const entry of entries) {
    if (entry.kind !== 'surface') continue;
    const assigned = policy.surfaces[entry.surface]?.platform;
    if (!['linux', 'macos'].includes(assigned)) {
      throw new Error(`Quality surface has no supported platform assignment: ${entry.surface}`);
    }
  }
  if (platform === 'all') return entries;
  return entries.filter(
    (entry) => entry.kind !== 'surface' || policy.surfaces[entry.surface].platform === platform,
  );
}

export function selectQualityTools(versions, hostKey, platform) {
  if (!ALLOWED_PLATFORMS.has(platform)) {
    throw new Error(`Unknown quality platform: ${platform}`);
  }
  const host = versions.platforms[hostKey];
  if (!host) throw new Error(`Pinned quality tools do not support this host: ${hostKey}`);

  const includeLinux = platform === 'all' || platform === 'linux';
  const includeMacOS = platform === 'all' || platform === 'macos';
  if (includeMacOS && host.clangFormat !== true) {
    throw new Error(`The macOS quality checks require Xcode; this host is ${hostKey}`);
  }

  const tools = {};
  if (includeLinux) {
    for (const [name, spec] of Object.entries(versions.tools)) {
      if (spec.platform !== 'linux') continue;
      const asset = spec.assets?.[hostKey];
      if (!asset) throw new Error(`No pinned ${hostKey} asset is configured for ${name}`);
      if (!/^[a-f0-9]{64}$/.test(asset.sha256)) {
        throw new Error(`No valid SHA-256 pin is configured for ${name} on ${hostKey}`);
      }
      tools[name] = {
        ...asset,
        version: spec.version,
        cachePath: join(name, spec.version, hostKey),
      };
    }
  }

  const jdkAsset = includeLinux ? versions.jdk.platforms?.[hostKey] : null;
  if (includeLinux && (!jdkAsset || !/^[a-f0-9]{64}$/.test(jdkAsset.sha256))) {
    throw new Error(`No valid JDK pin is configured for ${hostKey}`);
  }
  const jdk = jdkAsset
    ? {
        ...jdkAsset,
        version: versions.jdk.version,
        cachePath: join('jdk', versions.jdk.version, jdkAsset.cacheHome),
      }
    : null;
  return {
    hostKey,
    platform,
    tools,
    jdk,
    clangFormat: includeMacOS ? versions.clangFormat : null,
  };
}
