const baseConfig = require('../metro.config.js');

module.exports = {
  ...baseConfig,
  server: {
    ...baseConfig.server,
    rewriteRequestUrl(requestUrl) {
      const url = new URL(requestUrl, 'http://localhost');

      // Redirect only this dedicated server to the diagnostic AppRegistry entry.
      if (url.pathname === '/index.bundle') {
        url.pathname = '/e2e/commonObservationsProbeEntry.bundle';
      }

      return url.toString();
    },
  },
};
