const target = process.env.MADAR_FLOW_API_TARGET || 'http://localhost:3000';

module.exports = {
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
