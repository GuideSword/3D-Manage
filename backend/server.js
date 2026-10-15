const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');

dotenv.config();

const { assertRuntimeConfig } = require('./config/runtime');
assertRuntimeConfig();

const { createBusinessRuntime } = require('./application/businessRuntime');
const { publicErrorMessage } = require('./utils/publicError');

const app = express();
const PORT = process.env.PORT || 5000;
const readiness = createBusinessRuntime({
  driver: process.env.STORE_DRIVER || 'file', connectionString: process.env.DATABASE_URL,
  factories: {
    legacy: () => require('./application/legacyRuntime').createLegacyRuntime(),
    relational: context => require('./application/relationalRuntime').createRelationalRuntime({
      ...context, jwtSecret: process.env.JWT_SECRET, uploadDirectory: process.env.UPLOAD_DIR,
    }),
  },
});
// Observe startup rejection without changing the Promise awaited by start and requests.
readiness.catch(() => {});

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:8081',
  'http://127.0.0.1:8081',
  'http://localhost:19006',
  'http://127.0.0.1:19006',
];

const parseAllowedOrigins = (value) => (
  value
    ? value.split(',').map((origin) => origin.trim()).filter(Boolean)
    : []
);

const configuredAllowedOrigins = parseAllowedOrigins(
  process.env.CORS_ORIGINS || process.env.FRONTEND_URLS || process.env.FRONTEND_URL
);
const allowedOrigins = configuredAllowedOrigins.length > 0
  ? configuredAllowedOrigins
  : (process.env.NODE_ENV === 'production' ? [] : DEFAULT_ALLOWED_ORIGINS);

app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`不允许该跨域来源：${origin}`));
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(async (req, res, next) => {
  try { await readiness; next(); }
  catch (_error) { res.status(503).json({ code: 'STORAGE_UNAVAILABLE', error: '服务器存储暂不可用' }); }
});

app.use('/api', async (req, res, next) => {
  try { const runtime = await readiness; await runtime.router(req, res, next); }
  catch (error) { next(error); }
});

const requireReady = async (_req, res, next) => {
  try { await (await readiness).checkReady(); next(); }
  catch (_error) { res.status(503).json({ code: 'STORAGE_UNAVAILABLE', error: '服务器存储暂不可用' }); }
};
app.get('/', requireReady, (req, res) => {
  res.json({
    name: '3D Manage API',
    status: 'OK',
    health: '/health',
    apiBase: '/api',
    endpoints: [
      '/api/auth',
      '/api/orders',
      '/api/models',
      '/api/materials',
      '/api/stock',
      '/api/files',
      '/api/oss',
      '/api/agent',
    ],
  });
});

app.get('/health', requireReady, (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.use((req, res) => {
  res.status(404).json({ error: '请求的接口不存在' });
});

app.use((err, req, res, next) => {
  console.error(err.stack || err);
  res.status(err.status || 500).json({
    ...(/^BUSINESS_RUNTIME_[A-Z_]+$/.test(err.code || '') ? { code: err.code } : {}),
    error: publicErrorMessage(err, '服务器内部错误'),
  });
});

let httpServer;
let shuttingDown = false;
let startPromise;
let shutdownPromise;

const start = () => {
  if (shuttingDown) return Promise.reject(Object.assign(new Error('服务正在关闭'), { code: 'BUSINESS_RUNTIME_CLOSED' }));
  if (!startPromise) startPromise = (async () => {
    const runtime = await readiness;
    if (shuttingDown) throw Object.assign(new Error('服务正在关闭'), { code: 'BUSINESS_RUNTIME_CLOSED' });
    const HOST = process.env.HOST || '0.0.0.0';
    try {
      httpServer = await new Promise((resolve, reject) => {
        const listener = app.listen(PORT, HOST, error => error ? reject(error) : resolve(listener));
        listener.once('error', reject);
      });
    } catch (failure) {
      try { await runtime.close(); } catch (cleanupError) { failure.cleanupError = cleanupError; }
      throw failure;
    }
    console.log(`Server running on ${HOST}:${PORT}`);
    console.log(`Frontend CORS allowed: ${allowedOrigins.join(', ')}`);
    return httpServer;
  })();
  return startPromise;
};

const shutdown = (signal = 'shutdown') => {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  shutdownPromise = (async () => {
    console.log(`${signal} received, draining requests`);
    const deadline = setTimeout(() => {
      console.error('Graceful shutdown timed out');
      process.exitCode = 1;
      process.exit(1);
    }, Number(process.env.SHUTDOWN_TIMEOUT_MS || 25000));
    deadline.unref();
    try {
      // A listen callback can still be pending when shutdown is requested.
      try { await startPromise; } catch (_) { /* Failed startup already closes its selected runtime. */ }
      if (httpServer) {
        await new Promise((resolve, reject) => httpServer.close((error) => (error ? reject(error) : resolve())));
        httpServer.closeAllConnections?.();
      }
      let runtime;
      try { runtime = await readiness; } catch (_) { /* Failed factories already clean up their resources. */ }
      await runtime?.close();
      console.log('Graceful shutdown complete');
    } finally {
      clearTimeout(deadline);
    }
  })();
  return shutdownPromise;
};

if (require.main === module) {
  start().catch((error) => {
    console.error('[startup failed]', error.stack || error);
    process.exitCode = 1;
  });
}

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err && err.stack || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('beforeExit', (code) => {
  console.error('[beforeExit] event loop empty, code=' + code);
});
process.on('exit', (code) => {
  console.error('[exit] code=' + code);
});

process.on('SIGTERM', () => shutdown('SIGTERM').catch((error) => {
  console.error('[shutdown failed]', error.stack || error);
  process.exitCode = 1;
}));
process.on('SIGINT', () => shutdown('SIGINT').catch((error) => {
  console.error('[shutdown failed]', error.stack || error);
  process.exitCode = 1;
}));

module.exports = app;
module.exports.start = start;
module.exports.shutdown = shutdown;
module.exports.ready = readiness;
