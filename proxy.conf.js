const target = process.env.MADAR_FLOW_API_TARGET || 'http://localhost:3000';

module.exports = {
  // ConnectionService polls `${browserApiUrl without /v1}/health/detailed`, i.e. /api/health/detailed.
  // Without this rule the dev server answers with index.html and the app always thinks the
  // backend is unreachable, so auto-sync never runs.
  '/api/health': {
    target,
    secure: false,
    changeOrigin: true,
    pathRewrite: { '^/api/health': '/health' },
  },
  '/api/v1': {
    target,
    secure: false,
    changeOrigin: true,
    pathRewrite: { '^/api/v1': '/v1' },
    // Future HttpOnly refresh-cookie support will need the browser-visible
    // path because the Backend receives the rewritten /v1 path.
    cookiePathRewrite: { '/v1': '/api/v1' },
  },
};
