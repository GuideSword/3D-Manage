require('dotenv').config();

const {
  DATA_FILE,
  STORE_DRIVER,
  POSTGRES_TABLE,
  POSTGRES_STORE_ID,
  closeStore,
  getData,
  initializeStore,
} = require('../utils/store');

const main = async () => {
  await initializeStore();
  const data = await getData();
  const counts = {
    users: data.users.length,
    orders: data.orders.length,
    models: data.models.length,
    materials: data.materials.length,
    stockLots: data.stockLots.length,
    inventoryTxns: data.inventoryTxns.length,
    auditLogs: data.auditLogs.length,
  };

  console.log(`Store initialized with driver: ${STORE_DRIVER}`);
  if (STORE_DRIVER === 'postgres' || STORE_DRIVER === 'pg') {
    console.log(`PostgreSQL table: ${POSTGRES_TABLE}`);
    console.log(`PostgreSQL row id: ${POSTGRES_STORE_ID}`);
  } else {
    console.log(`Data file: ${DATA_FILE}`);
  }
  console.log(`Collections: ${Object.entries(counts).map(([key, value]) => `${key}=${value}`).join(', ')}`);
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeStore();
  });
