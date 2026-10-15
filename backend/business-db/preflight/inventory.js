'use strict';
const { integer, grams } = require('./values');

function inspectInventory(data, add) {
  const materials = new Set(data.materials.map(row => row.id));
  const lots = new Set(data.stockLots.map(row => row.id));
  const orders = new Set(data.orders.map(row => row.id));
  for (const txn of data.inventoryTxns) {
    const lotId = txn.lotId || txn.lot_id;
    if (!lots.has(lotId)) add('blocker', 'TXN_LOT_MISSING', 'inventoryTxns', txn.id, 'lotId');
    const orderId = txn.orderId || txn.relatedOrderId || txn.related_order_id;
    if (orderId && !orders.has(orderId)) add('blocker', 'TXN_ORDER_MISSING', 'inventoryTxns', txn.id, 'orderId');
    if (txn.ledgerVersion !== undefined && txn.ledgerVersion !== '1') {
      add('blocker', 'LEDGER_VERSION_UNSUPPORTED', 'inventoryTxns', txn.id, 'ledgerVersion');
    }
  }
  return data.stockLots.map(lot => {
    const result = { id: lot.id, balanceStatus: lot.balanceStatus || null, storedQtyMg: null,
      baselineQtyMg: null, expectedQtyMg: null, checkedTransactions: 0, legacyTransactionCount: 0 };
    if (!materials.has(lot.materialId || lot.material_id)) add('blocker', 'LOT_MATERIAL_MISSING', 'stockLots', lot.id, 'materialId');
    if (lot.balanceStatus === 'legacy_invalid') add('blocker', 'LEGACY_BALANCE_INVALID', 'stockLots', lot.id, 'balanceStatus');
    if (lot.balanceStatus === 'legacy_unverified') add('review', 'LEGACY_BALANCE_REVIEW', 'stockLots', lot.id, 'balanceStatus');
    if (lot.balanceStatus !== undefined && !['tracked', 'legacy_unverified', 'legacy_invalid'].includes(lot.balanceStatus)) add('blocker', 'LOT_BALANCE_STATUS_INVALID', 'stockLots', lot.id, 'balanceStatus');
    let current;
    try {
      const display = lot.qty ?? lot.qty_g;
      current = lot.qtyMg !== undefined ? integer(lot.qtyMg) : grams(display);
      result.storedQtyMg = String(current);
      if (display !== undefined && grams(display) !== current) add('blocker', 'LOT_QUANTITY_FIELDS_MISMATCH', 'stockLots', lot.id, 'qty');
    } catch (_) { add('blocker', 'LOT_QUANTITY_INVALID', 'stockLots', lot.id, 'qty'); }
    const movements = data.inventoryTxns.filter(txn => (txn.lotId || txn.lot_id) === lot.id);
    result.legacyTransactionCount = movements.filter(txn => txn.ledgerVersion === undefined).length;
    if (result.legacyTransactionCount) add('review', 'LEGACY_TRANSACTIONS_PRESERVED', 'stockLots', lot.id, 'inventoryTxns');
    let cursor;
    try {
      cursor = integer(lot.ledgerBaselineQtyMg);
      result.baselineQtyMg = String(cursor);
    } catch (_) {
      add('blocker', 'LOT_BASELINE_MISSING', 'stockLots', lot.id, 'ledgerBaselineQtyMg');
    }
    for (const txn of movements.filter(row => row.ledgerVersion === '1')) {
      try {
        const before = integer(txn.beforeQtyMg);
        const after = integer(txn.afterQtyMg);
        const delta = integer(txn.deltaQtyMg, true);
        const qty = integer(txn.qtyMg);
        if (txn.qty !== undefined && grams(txn.qty) !== qty) throw Error('Quantity aliases mismatch');
        if (txn.beforeQty !== undefined && grams(txn.beforeQty) !== before) throw Error('Before quantity mismatch');
        if (txn.afterQty !== undefined && grams(txn.afterQty) !== after) throw Error('After quantity mismatch');
        const expected = txn.type === 'in' ? qty : ['out', 'scrap'].includes(txn.type) ? -qty
          : txn.type === 'adjust' && after === qty ? after - before : null;
        if (expected === null || expected !== delta || before + delta !== after || (txn.type !== 'adjust' && qty === 0n)) throw Error('Movement mismatch');
        if (cursor !== undefined && before !== cursor) add('blocker', 'LEDGER_CHAIN_BROKEN', 'inventoryTxns', txn.id, 'beforeQtyMg');
        if (txn.materialId && txn.materialId !== (lot.materialId || lot.material_id)) throw Error('Material mismatch');
        cursor = after;
        result.checkedTransactions += 1;
      } catch (_) { add('blocker', 'LEDGER_MOVEMENT_INVALID', 'inventoryTxns', txn.id, 'qtyMg'); }
    }
    if (result.baselineQtyMg !== null && cursor !== undefined) {
      result.expectedQtyMg = String(cursor);
      if (current !== undefined && cursor !== current) add('blocker', 'LOT_BALANCE_MISMATCH', 'stockLots', lot.id, 'qtyMg');
    }
    return result;
  });
}
module.exports = { inspectInventory };
