const fs = require('fs').promises;
const path = require('path');
const { randomUUID } = require('node:crypto');
const { CURRENT_SCHEMA_VERSION } = require('../config/runtime');

const FILE_DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const DATA_FILE = path.join(FILE_DATA_DIR, 'store.json');
const STORE_DRIVER = (process.env.STORE_DRIVER || 'file').trim().toLowerCase();
const POSTGRES_TABLE = process.env.STORE_TABLE || 'app_store';
const POSTGRES_STORE_ID = process.env.STORE_ID || 'default';

const now = () => new Date().toISOString();

const COLLECTION_KEYS = ['users', 'orders', 'models', 'materials', 'stockLots', 'inventoryTxns', 'auditLogs'];

const clone = (value) => JSON.parse(JSON.stringify(value));

const createFreshData = () => {
  const timestamp = now();
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    system: {
      serverId: randomUUID(),
      organizationName: '',
      initializedAt: null,
    },
    users: [],
    orders: [],
    models: [],
    materials: [],
    stockLots: [],
    inventoryTxns: [],
    auditLogs: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

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

const migrateData = (input) => {
  const data = ensureCollections(input);
  const sourceVersion = Number(data.schemaVersion || 1);
  if (sourceVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Store schema ${sourceVersion} is newer than supported schema ${CURRENT_SCHEMA_VERSION}; upgrade the server before opening this data.`
    );
  }

  let changed = sourceVersion !== CURRENT_SCHEMA_VERSION;
  if (!data.system) {
    const activeOwner = data.users.find((user) => user.role === 'owner' && user.active !== false);
    if (data.users.length > 0 && !activeOwner) {
      throw new Error(
        'Existing data has users but no active Owner. Run the host-only Owner recovery command before starting the service.'
      );
    }
    data.system = {
      serverId: randomUUID(),
      organizationName: activeOwner ? 'Legacy organization' : '',
      initializedAt: activeOwner ? (data.createdAt || now()) : null,
    };
    changed = true;
  }

  for (const user of data.users) {
    if (!Number.isInteger(user.tokenVersion) || user.tokenVersion < 1) {
      user.tokenVersion = 1;
      changed = true;
    }
  }

  if (data.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    data.schemaVersion = CURRENT_SCHEMA_VERSION;
    changed = true;
  }

  return { data, changed };
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
    const migrated = migrateData(JSON.parse(raw));
    if (migrated.changed) {
      await writeFileData(migrated.data);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    await writeFileData(createFreshData());
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT data FROM ${table} WHERE id = $1 FOR UPDATE`, [POSTGRES_STORE_ID]);
    if (!rows[0]) {
      await client.query(
        `INSERT INTO ${table} (id, data, updated_at) VALUES ($1, $2::jsonb, now())`,
        [POSTGRES_STORE_ID, JSON.stringify(createFreshData())]
      );
    } else {
      const migrated = migrateData(rows[0].data);
      if (migrated.changed) {
        await writePostgresData(migrated.data, client);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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
  return migrateData(JSON.parse(raw)).data;
};

const readPostgresData = async () => {
  await ensureStore();
  const table = getPostgresTableSql();
  const { rows } = await getPgPool().query(`SELECT data FROM ${table} WHERE id = $1`, [POSTGRES_STORE_ID]);
  if (!rows[0]) {
    return createFreshData();
  }
  return migrateData(rows[0].data).data;
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
    const data = rows[0] ? migrateData(rows[0].data).data : createFreshData();
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
  await writeQueue;
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
  createFreshData,
  migrateData,
};
