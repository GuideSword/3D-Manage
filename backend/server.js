const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const { initStorage } = require('./config/storage');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

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
  : DEFAULT_ALLOWED_ORIGINS;

app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`CORS origin not allowed: ${origin}`));
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

initStorage().catch((err) => console.error('Storage initialization failed:', err));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/models', require('./routes/models'));
app.use('/api/materials', require('./routes/materials'));
app.use('/api/stock', require('./routes/stock'));
app.use('/api/files', require('./routes/files'));
app.use('/api/oss', require('./routes/oss'));

app.get('/', (req, res) => {
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
    ],
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err, req, res, next) => {
  console.error(err.stack || err);
  res.status(err.status || 500).json({ error: err.message || 'Something went wrong' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Frontend CORS allowed: ${allowedOrigins.join(', ')}`);
  });
}

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

module.exports = app;
