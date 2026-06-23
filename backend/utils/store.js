const fs = require('fs').promises;
const path = require('path');

const FILE_DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const DATA_FILE = path.join(FILE_DATA_DIR, 'store.json');
const STORE_DRIVER = (process.env.STORE_DRIVER || 'file').trim().toLowerCase();
const POSTGRES_TABLE = process.env.STORE_TABLE || 'app_store';
const POSTGRES_STORE_ID = process.env.STORE_ID || 'default';

const now = () => new Date().toISOString();

const DEFAULT_DATA = {
  schemaVersion: 1,
  users: [],
  orders: [],
  models: [],
  materials: [],
  stockLots: [],
  inventoryTxns: [],
  auditLogs: [],
  createdAt: now(),
  updatedAt: now(),
};

const COLLECTION_KEYS = ['users', 'orders', 'models', 'materials', 'stockLots', 'inventoryTxns', 'auditLogs'];

const clone = (value) => JSON.parse(JSON.stringify(value));

let initPromise;
let writeQueue = Promise.resolve();
let pgPool;

const ensureCollections = (data) => {
  for (const key of COLLECTION_KEYS) {
    if (!Array.isArray(data[key])) {
      data[key] = [];
    }
  }
  if (!data.schemaVersion) {
    data.schemaVersion = 1;
  }
  if (!data.createdAt) {
    data.createdAt = now();
  }
  if (!data.updatedAt) {
    data.updatedAt = now();
  }
  return data;
};

const assertSupportedDriver = () => {
  if (!['file', 'postgres', 'pg'].includes(STORE_DRIVER)) {
    throw new Error(`Unsupported STORE_DRIVER "${STORE_DRIVER}". Use "file" or "postgres".`);
  }
};

const isPostgresStore = () => STORE_DRIVER === 'postgres' || STORE_DRIVER === 'pg';

const quoteIdentifier = (identifier) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid PostgreSQL identifier "${identifier}". Use letters, numbers, and underscores only.`);
  }
  return `"${identifier}"`;
};

const getPostgresTableSql = () => quoteIdentifier(POSTGRES_TABLE);

const getPgPool = () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required when STORE_DRIVER=postgres.');
  }

  if (!pgPool) {
    const { Pool } = require('pg');
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pgPool;
};

const writeFileData = async (data) => {
  data.updatedAt = now();
  const tempFile = `${DATA_FILE}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tempFile, DATA_FILE);
};

const ensureFileStore = async () => {
  await fs.mkdir(FILE_DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    ensureCollections(JSON.parse(raw));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    await writeFileData(clone(DEFAULT_DATA));
  }
};

const ensurePostgresStore = async () => {
  const pool = getPgPool();
  const table = getPostgresTableSql();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${table} (
      id text PRIMARY KEY,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(
    `INSERT INTO ${table} (id, data, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (id) DO NOTHING`,
    [POSTGRES_STORE_ID, JSON.stringify(ensureCollections(clone(DEFAULT_DATA)))]
  );
};

const ensureStore = async () => {
  assertSupportedDriver();
  if (!initPromise) {
    initPromise = isPostgresStore() ? ensurePostgresStore() : ensureFileStore();
  }
  return initPromise;
};

const readFileData = async () => {
  await ensureStore();
  const raw = await fs.readFile(DATA_FILE, 'utf8');
  return ensureCollections(JSON.parse(raw));
};

const readPostgresData = async () => {
  await ensureStore();
  const table = getPostgresTableSql();
  const { rows } = await getPgPool().query(`SELECT data FROM ${table} WHERE id = $1`, [POSTGRES_STORE_ID]);
  if (!rows[0]) {
    return ensureCollections(clone(DEFAULT_DATA));
  }
  return ensureCollections(rows[0].data);
};

const readData = () => (isPostgresStore() ? readPostgresData() : readFileData());

const writePostgresData = async (data, client = getPgPool()) => {
  data.updatedAt = now();
  const table = getPostgresTableSql();
  await client.query(
    `INSERT INTO ${table} (id, data, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [POSTGRES_STORE_ID, JSON.stringify(data)]
  );
};

const mutatePostgresData = async (mutator) => {
  await ensureStore();
  const table = getPostgresTableSql();
  const client = await getPgPool().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT data FROM ${table} WHERE id = $1 FOR UPDATE`, [POSTGRES_STORE_ID]);
    const data = ensureCollections(rows[0] ? rows[0].data : clone(DEFAULT_DATA));
    const result = await mutator(data);
    await writePostgresData(data, client);
    await client.query('COMMIT');
    return clone(result);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const getData = async () => clone(await readData());

const withData = async (mutator, { write = true } = {}) => {
  if (!write) {
    await writeQueue;
    const data = await readData();
    return clone(await mutator(data));
  }

  const run = writeQueue.then(async () => {
    if (isPostgresStore()) {
      return mutatePostgresData(mutator);
    }

    const data = await readFileData();
    const result = await mutator(data);
    await writeFileData(data);
    return clone(result);
  });
  writeQueue = run.catch(() => {});
  return run;
};

const nextId = (items) => {
  const maxId = items.reduce((max, item) => {
    const numericId = Number.parseInt(item.id, 10);
    return Number.isFinite(numericId) ? Math.max(max, numericId) : max;
  }, 0);
  return String(maxId + 1);
};

const appendAudit = (data, { actorId = 'system', entity, entityId, action, diff = null }) => {
  const log = {
    id: nextId(data.auditLogs),
    actorId,
    entity,
    entityId: entityId == null ? null : String(entityId),
    action,
    diff,
    createdAt: now(),
  };
  data.auditLogs.push(log);
  return log;
};

const closeStore = async () => {
  if (pgPool) {
    await pgPool.end();
    pgPool = null;
  }
};

module.exports = {
  DATA_FILE,
  STORE_DRIVER,
  POSTGRES_TABLE,
  POSTGRES_STORE_ID,
  getData,
  withData,
  nextId,
  appendAudit,
  now,
  initializeStore: ensureStore,
  closeStore,
};
