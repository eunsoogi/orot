const baseConfig = require('../metro.config.js');

module.exports = {
  ...baseConfig,
  server: {
    ...baseConfig.server,
    rewriteRequestUrl(requestUrl) {
      const url = new URL(requestUrl, 'http://localhost');

      // The native debug delegate requests index.bundle; redirect only this probe's server.
      if (url.pathname === '/index.bundle') {
        url.pathname = '/e2e/bloodPressureProbeEntry.bundle';
      }

      return url.toString();
    },
  },
};
