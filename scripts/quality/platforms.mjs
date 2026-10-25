import { join } from 'node:path';

// A check partition identifies the runner requirement; the host key selects the matching tool asset.
const ALLOWED_PLATFORMS = new Set(['all', 'linux']);

export function parseQualityArguments(args) {
  // pnpm forwards its script-argument separator; remove it only at the argument boundary.
  const forwardedArgs = args[0] === '--' ? args.slice(1) : args;
  let platform = 'all';
  let foundPlatform = false;
  let surface = null;
  let foundSurface = false;
  const remaining = [];

  for (let index = 0; index < forwardedArgs.length; index += 1) {
    if (forwardedArgs[index] === '--surface') {
      if (foundSurface) throw new Error('Use --surface only once');
      foundSurface = true;
      surface = forwardedArgs[index + 1];
      index += 1;
      if (!surface || surface.startsWith('--')) {
        throw new Error('--surface requires a value; use --surface <configured-quality-surface>');
      }
      continue;
    }
    if (forwardedArgs[index] !== '--platform') {
      remaining.push(forwardedArgs[index]);
      continue;
    }
    if (foundPlatform) throw new Error('Use --platform only once');
    foundPlatform = true;
    platform = forwardedArgs[index + 1];
    index += 1;
    if (!ALLOWED_PLATFORMS.has(platform)) {
      throw new Error('Use --platform all or --platform linux');
    }
  }
  return { platform, surface, remaining };
}

export function parsePlatformArgument(args) {
  // Setup installs one runner toolchain; lint-only surface selection must not narrow its pins.
  const { platform, surface, remaining } = parseQualityArguments(args);
  if (surface) throw new Error('--surface is available only for a lint invocation');
  return { platform, remaining };
}

export function selectPlatformEntries(entries, policy, platform) {
  if (!ALLOWED_PLATFORMS.has(platform)) {
    throw new Error(`Unknown quality platform: ${platform}`);
  }
  for (const entry of entries) {
    if (entry.kind !== 'surface') continue;
    const assigned = policy.surfaces[entry.surface]?.platform;
    if (assigned !== 'linux') {
      throw new Error(`Quality surface has no supported platform assignment: ${entry.surface}`);
    }
  }
  if (platform === 'all') return entries;
  return entries.filter(
    (entry) => entry.kind !== 'surface' || policy.surfaces[entry.surface].platform === platform,
  );
}

export function selectSurfaceEntries(entries, policy, surface) {
  if (!Object.prototype.hasOwnProperty.call(policy.surfaces, surface)) {
    throw new Error(`Unknown quality surface: ${surface}`);
  }
  // The caller builds and validates the complete repository inventory before this lint-only split.
  // Keep a configured zero-file surface as a successful no-op leaf so its CI check name remains stable.
  return entries.filter((entry) => entry.kind === 'surface' && entry.surface === surface);
}

export function selectQualityTools(versions, hostKey, platform) {
  if (!ALLOWED_PLATFORMS.has(platform)) {
    throw new Error(`Unknown quality platform: ${platform}`);
  }
  if (!versions.supportedHosts?.includes(hostKey)) {
    throw new Error(`Pinned quality tools do not support this host: ${hostKey}`);
  }

  const tools = {};
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

  // Ruby checks use the pinned Gemfile; this selection contains only downloaded quality binaries.
  return { hostKey, platform, tools };
}
