'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { parseSource, assertSourceHash } = require('../../backend/business-db/preflight/source');
const { buildPreflightReport } = require('../../backend/business-db/preflight/report');

function fixture() {
  return { schemaVersion: 3, system: { serverId: 'f5942634-5fdd-4964-abc6-3971b1787c0b' },
    users: [{ id: 'u1', email: 'owner@example.test', role: 'owner', active: true, tokenVersion: 1, passwordHash: 'fixture-hash' }],
    models: [{ id: 'm1', files: [], images: [] }], materials: [{ id: 'mat1' }],
    orders: [{ id: 'o1', createdBy: 'u1', status: 'draft', currency: 'CNY', total: '1.00',
      customer: { id: 'old-customer', name: '同名客户' }, attachments: [],
      items: [{ id: 'line1', modelId: 'm1', quantity: '0.333', unitPrice: '3.000001', subtotal: '1.00' }] }],
    stockLots: [], inventoryTxns: [], auditLogs: [], objectUploads: [], commandReceipts: [] };
}
const inspect = value => buildPreflightReport(parseSource(JSON.stringify(value)));
const codes = report => report.issues.map(issue => issue.code);
async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'manage3d-preflight-'));
  t.after(async () => {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test('source parsing preserves numeric lexemes and refuses changed source hashes', () => {
  const raw = '{"total":9007199254740993.01,"small":0.30000000000000004,"flag":true}';
  const source = parseSource(raw);
  assert.equal(source.raw, raw);
  assert.equal(source.data.total, '9007199254740993.01');
  assert.equal(source.data.small, '0.30000000000000004');
  assert.equal(source.data.flag, true);
  assertSourceHash(source, source.sha256);
  assert.throws(() => assertSourceHash(source, '0'.repeat(64)), { code: 'PREFLIGHT_SOURCE_CHANGED' });
  assert.throws(() => parseSource(Buffer.from([0xff])), { code: 'PREFLIGHT_SOURCE_INVALID' });
  assert.throws(() => parseSource('[]'), { code: 'PREFLIGHT_SOURCE_INVALID' });
});

test('amount report preserves old values and sums independently rounded line amounts', async () => {
  const data = fixture();
  const raw = JSON.stringify(data);
  const report = await buildPreflightReport(parseSource(raw));
  assert.equal(report.status, 'review_required');
  assert.equal(report.orders[0].calculatedTotal, '1.00');
  assert.equal(report.orders[0].storedTotal, '1.00');
  assert.equal(report.blockerCount, 0);
  assert.equal(JSON.stringify(data), raw);
  data.orders[0].items = [1, 2].map(id => ({ id: String(id), quantity: '1', unitPrice: '0.005000', subtotal: '0.01' }));
  data.orders[0].total = '0.02';
  assert.equal((await inspect(data)).orders[0].calculatedTotal, '0.02');
  data.orders[0].total = '0.01';
  assert.ok(codes(await inspect(data)).includes('ORDER_TOTAL_MISMATCH'));
});

test('missing prices, fractional cents, line mismatches and negative quantities block migration', async () => {
  for (const [field, value, expected] of [
    ['unitPrice', undefined, 'ORDER_LINE_INVALID'], ['quantity', '-1', 'ORDER_LINE_INVALID'],
    ['subtotal', '0.30000000000000004', 'ORDER_LINE_AMOUNT_INVALID'], ['subtotal', '0.99', 'ORDER_LINE_SUBTOTAL_MISMATCH'],
  ]) {
    const data = fixture(); data.orders[0].items[0][field] = value;
    const report = await inspect(data);
    assert.equal(report.status, 'blocked'); assert.ok(codes(report).includes(expected));
  }
  const data = fixture();
  data.orders[0].total = '1.000000';
  assert.equal((await inspect(data)).blockerCount, 0, 'Extra trailing zeros do not change the exact value');
  const raw = JSON.stringify(data).replace('"1.000000"', '9007199254740993.01');
  assert.equal((await buildPreflightReport(parseSource(raw))).orders[0].storedTotal, '9007199254740993.01');
});

test('identity and references are checked, while matching customer names never auto-merge', async () => {
  const data = fixture();
  data.orders.push({ ...structuredClone(data.orders[0]), id: 'o2' });
  const report = await inspect(data);
  assert.equal(report.customerMappings.length, 2);
  assert.notEqual(report.customerMappings[0].targetKey, report.customerMappings[1].targetKey);
  assert.ok(codes(report).includes('CUSTOMER_MATCH_REVIEW'));
  data.users[0].role = 'viewer';
  data.materials.push({ id: 'mat1' });
  data.stockLots.push({ id: 'lot1', materialId: 'missing', qty: '1', qtyMg: '1000', balanceStatus: 'tracked', ledgerBaselineQtyMg: '0' });
  const invalid = await inspect(data);
  assert.ok(codes(invalid).includes('ACTIVE_OWNER_MISSING'));
  assert.ok(codes(invalid).includes('DUPLICATE_ID'));
  assert.ok(codes(invalid).includes('LOT_MATERIAL_MISSING'));
});

test('new ledger reconciles from its baseline and never sums legacy absolute adjustments', async () => {
  const data = fixture();
  data.stockLots = [{ id: 'lot1', materialId: 'mat1', qty: '400', qtyMg: '400000', version: 2,
    balanceStatus: 'legacy_unverified', ledgerBaselineQtyMg: '500000' }];
  data.inventoryTxns = [
    { id: 'old-adjust', lotId: 'lot1', type: 'adjust', qty: '500' },
    { id: 'new-out', lotId: 'lot1', type: 'out', qtyMg: '100000', beforeQtyMg: '500000', afterQtyMg: '400000', deltaQtyMg: '-100000', ledgerVersion: 1 },
  ];
  const report = await inspect(data);
  assert.equal(report.stockLots[0].expectedQtyMg, '400000');
  assert.equal(report.stockLots[0].legacyTransactionCount, 1);
  assert.equal(report.blockerCount, 0);
  assert.ok(codes(report).includes('LEGACY_BALANCE_REVIEW'));
  data.inventoryTxns[1].deltaQtyMg = '-200000';
  assert.ok(codes(await inspect(data)).includes('LEDGER_MOVEMENT_INVALID'));
  data.inventoryTxns[1].deltaQtyMg = '-100000';
  data.stockLots[0].qty = '401'; data.stockLots[0].qtyMg = '401000';
  assert.ok(codes(await inspect(data)).includes('LOT_BALANCE_MISMATCH'));
});

test('invalid historical balances and malformed collections remain visible as blockers', async () => {
  const data = fixture();
  data.stockLots = [{ id: 'lot1', materialId: 'mat1', qty: '-1', balanceStatus: 'legacy_invalid' }];
  data.orders = { invalid: true };
  const report = await inspect(data);
  assert.equal(report.status, 'blocked');
  assert.ok(codes(report).includes('COLLECTION_INVALID'));
  assert.ok(codes(report).includes('LEGACY_BALANCE_INVALID'));
});

test('tracked opening and absolute adjustment reconcile, while broken chains and invented baselines block', async () => {
  const data = fixture();
  data.stockLots = [{ id: 'lot1', materialId: 'mat1', qtyMg: '350000', qty: '350', balanceStatus: 'tracked', ledgerBaselineQtyMg: '0' }];
  data.inventoryTxns = [
    { id: 'opening', lotId: 'lot1', type: 'in', qtyMg: '500000', beforeQtyMg: '0', afterQtyMg: '500000', deltaQtyMg: '500000', ledgerVersion: 1 },
    { id: 'count', lotId: 'lot1', type: 'adjust', qtyMg: '350000', beforeQtyMg: '500000', afterQtyMg: '350000', deltaQtyMg: '-150000', ledgerVersion: 1 },
  ];
  let report = await inspect(data);
  assert.equal(report.blockerCount, 0);
  assert.equal(report.stockLots[0].expectedQtyMg, '350000');
  data.inventoryTxns.reverse();
  assert.ok(codes(await inspect(data)).includes('LEDGER_CHAIN_BROKEN'));
  data.inventoryTxns.reverse();
  data.stockLots[0].ledgerBaselineQtyMg = '500000';
  assert.ok(codes(await inspect(data)).includes('TRACKED_BASELINE_NONZERO'));
  data.schemaVersion = false;
  assert.ok(codes(await inspect(data)).includes('SOURCE_SCHEMA_UNSUPPORTED'));
});

test('file audit checks byte hashes, sizes, Windows paths, missing files and external links', async t => {
  const directory = await temporaryDirectory(t);
  await fs.mkdir(path.join(directory, 'models'));
  const bytes = Buffer.from('known STL fixture');
  const hash = createHash('sha256').update(bytes).digest('hex');
  await fs.writeFile(path.join(directory, 'models', 'fixture.stl'), bytes);
  const data = fixture();
  data.models[0].files = [{ id: 'f1', fileKey: 'models\\fixture.stl', fileUrl: '/api/files/models/fixture.stl', sha256: hash, size: bytes.length }];
  let report = await buildPreflightReport(parseSource(JSON.stringify(data)), { uploadDirectory: directory });
  assert.equal(report.blockerCount, 0);
  assert.equal(report.files[0].sha256, hash);
  await fs.writeFile(path.join(directory, 'models', 'fixture.stl'), 'changed');
  report = await buildPreflightReport(parseSource(JSON.stringify(data)), { uploadDirectory: directory });
  assert.ok(codes(report).includes('FILE_HASH_MISMATCH'));
  assert.ok(codes(report).includes('FILE_SIZE_MISMATCH'));
  data.models[0].files = [{ fileKey: 'missing.stl' }, { fileUrl: 'https://never-fetch.invalid/file.stl' }];
  report = await buildPreflightReport(parseSource(JSON.stringify(data)), { uploadDirectory: directory });
  assert.ok(codes(report).includes('FILE_MISSING'));
  assert.ok(codes(report).includes('EXTERNAL_FILE_UNVERIFIED'));
});

test('file traversal and symlink escape are blocked before reading outside uploads', async t => {
  const directory = await temporaryDirectory(t);
  const uploads = path.join(directory, 'uploads');
  const outside = path.join(directory, 'outside');
  await fs.mkdir(uploads); await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'secret.stl'), 'outside');
  await fs.symlink(outside, path.join(uploads, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  const data = fixture();
  data.models[0].files = [
    { fileKey: '../outside/secret.stl' }, { fileKey: 'link/secret.stl' },
    { fileUrl: '/api/files/%2e%2e/outside/secret.stl' }, { fileKey: 'C:\\outside\\secret.stl' },
  ];
  const report = await buildPreflightReport(parseSource(JSON.stringify(data)), { uploadDirectory: uploads });
  assert.equal(report.issues.filter(issue => issue.code === 'FILE_PATH_UNSAFE').length, 4);
  assert.ok(report.files.every(file => file.sha256 === null));
});

test('CLI preserves source bytes, binds artifacts to the source hash, and refuses output overwrite', async t => {
  const directory = await temporaryDirectory(t);
  const filename = path.join(directory, 'source.json');
  const raw = JSON.stringify(fixture());
  await fs.writeFile(filename, raw);
  const output = path.join(directory, 'result');
  const cli = path.resolve(__dirname, '../../backend/scripts/erp-preflight.js');
  const invoke = (destination, extra = []) => spawnSync(process.execPath, [cli, '--source-file', filename, '--output', destination, ...extra], { encoding: 'utf8' });
  const result = invoke(output);
  assert.equal(result.status, 3, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, 'review_required');
  assert.equal(result.stdout.includes('fixture-hash'), false);
  assert.equal(await fs.readFile(filename, 'utf8'), raw);
  assert.equal(await fs.readFile(path.join(output, 'snapshot.json'), 'utf8'), raw);
  const manifest = JSON.parse(await fs.readFile(path.join(output, 'manifest.json'), 'utf8'));
  assert.equal(manifest.migrationExecuted, false);
  assert.equal(manifest.hashes['snapshot.json'], parseSource(raw).sha256);
  assert.equal(JSON.parse(await fs.readFile(path.join(output, 'mappings.json'), 'utf8')).approved, false);
  assert.equal(invoke(output).status, 1);
  const changed = invoke(path.join(directory, 'changed-source'), ['--expected-source-hash', '0'.repeat(64)]);
  assert.equal(changed.status, 1);
  assert.equal(JSON.parse(changed.stderr).code, 'PREFLIGHT_SOURCE_CHANGED');
  await assert.rejects(fs.stat(path.join(directory, 'changed-source')), { code: 'ENOENT' });
  const data = fixture(); data.orders[0].total = '0.01';
  await fs.writeFile(filename, JSON.stringify(data));
  assert.equal(invoke(path.join(directory, 'blocked')).status, 2);
  data.orders = [];
  await fs.writeFile(filename, JSON.stringify(data));
  assert.equal(invoke(path.join(directory, 'ready')).status, 0);
});
