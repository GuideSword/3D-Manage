'use strict';

async function withBusinessTransaction(pool, callback) {
  const client = await pool.connect();
  let begun = false;
  let releaseError;
  try {
    await client.query('BEGIN');
    begun = true;
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (begun) {
      try { await client.query('ROLLBACK'); } catch (rollbackError) {
        releaseError = rollbackError;
        if (error instanceof Error) error.rollbackError = rollbackError;
        else throw new AggregateError([error, rollbackError], '事务失败且回滚失败');
      }
    } else { releaseError = error; }
    throw error;
  } finally {
    // A failed rollback leaves transaction state unknown; pg must discard this client.
    client.release(releaseError);
  }
}

module.exports = { withBusinessTransaction };
