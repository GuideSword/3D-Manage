'use strict';
const { sha256 } = require('../preflight/source');
const REVIEW_ACTIONS = Object.freeze({
  CUSTOMER_MAPPING_REVIEW: 'create_separate_customer',
  CUSTOMER_MATCH_REVIEW: 'keep_separate',
  AUDIT_ACTOR_SNAPSHOT_REVIEW: 'preserve_snapshot_null_actor',
  ORDER_MODEL_SNAPSHOT_REVIEW: 'preserve_snapshot_null_model',
  LEGACY_BALANCE_REVIEW: 'preserve_unverified_balance',
  LEGACY_TRANSACTIONS_PRESERVED: 'preserve_legacy_transactions',
  EXTERNAL_FILE_UNVERIFIED: 'preserve_external_reference',
});
function fail() {
  throw Object.assign(new Error('必须逐项确认与当前来源一致的迁移决策，客户不能自动合并'), { code: 'ERP_IMPORT_DECISIONS_INVALID' });
}
const reviewKey = row => JSON.stringify([row.code, row.collection, row.entityId ?? null, row.field ?? null]);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;

function validateDecisions(report, input) {
  if (!input || input.approved !== true || input.sourceSha256 !== report.sourceSha256
      || !Array.isArray(input.reviews) || !Array.isArray(input.customers)) fail();
  const expected = new Map(report.issues.filter(r => r.severity === 'review').map(r => [reviewKey(r), r]));
  if (input.reviews.length !== expected.size) fail();
  const reviews = [];
  for (const row of input.reviews) {
    if (!row || !expected.delete(reviewKey(row)) || !REVIEW_ACTIONS[row.code] || row.action !== REVIEW_ACTIONS[row.code]) fail();
    reviews.push({ code: row.code, collection: row.collection, ...(row.entityId != null ? { entityId: row.entityId } : {}),
      ...(row.field != null ? { field: row.field } : {}), action: row.action });
  }
  const orders = new Set(report.customerMappings.map(row => row.orderId));
  if (orders.size !== input.customers.length) fail();
  const targetIds = new Set();
  const customers = [];
  for (const row of input.customers) {
    if (!row || !orders.delete(row.orderId) || !nonempty(row.targetId) || targetIds.has(row.targetId)
        || row.action !== 'create_separate_customer') fail();
    targetIds.add(row.targetId);
    customers.push({ orderId: row.orderId, targetId: row.targetId, action: row.action });
  }
  reviews.sort((a, b) => reviewKey(a).localeCompare(reviewKey(b), 'en'));
  customers.sort((a, b) => a.orderId.localeCompare(b.orderId, 'en'));
  return { sourceSha256: input.sourceSha256, approved: true, reviews, customers };
}
const decisionsHash = decisions => sha256(JSON.stringify(decisions));
module.exports = { validateDecisions, decisionsHash, REVIEW_ACTIONS };
