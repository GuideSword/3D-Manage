'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { assertSourceHash, sha256 } = require('./source');

const cell = value => String(value ?? '').replace(/[\\`*_{}\[\]()#+.!|>]/g, '\\$&').replace(/[\r\n]/g, ' ');
function markdownReport(report) {
  const table = (headers, rows) => [headers.join(' | '), headers.map(() => '---').join(' | '),
    ...rows.map(row => row.map(cell).join(' | '))].map(row => `| ${row} |`).join('\n');
  return `# ERP 迁移预检\n\n状态：${report.status}；阻断 ${report.blockerCount}，待复核 ${report.reviewCount}。\n\n`
    + `来源 SHA-256：${report.sourceSha256}\n\n本报告未执行迁移；历史金额、余额和客户关联均未修改。\n\n`
    + `## 异常与复核\n\n${table(['等级', '编码', '集合', '记录 ID', '字段'], report.issues.map(row => [row.severity, row.code, row.collection, row.entityId, row.field]))}\n\n`
    + `## 订单金额\n\n${table(['订单', '原总金额', '计算总金额'], report.orders.map(row => [row.id, row.storedTotal, row.calculatedTotal]))}\n\n`
    + `## 批次余额（毫克）\n\n${table(['批次', '原余额', '账本基线', '核对余额', '旧流水数'], report.stockLots.map(row => [row.id, row.storedQtyMg, row.baselineQtyMg, row.expectedQtyMg, row.legacyTransactionCount]))}\n`;
}

async function writePreflightArtifacts(source, report, outputDirectory) {
  assertSourceHash(source, report.sourceSha256);
  const directory = path.resolve(outputDirectory);
  await fs.mkdir(path.dirname(directory), { recursive: true, mode: 0o700 });
  await fs.mkdir(directory, { mode: 0o700 }); // Existing output is never overwritten.
  const json = value => JSON.stringify(value, null, 2) + '\n';
  const contents = { 'snapshot.json': source.raw, 'report.json': json(report),
    'mappings.json': json({ sourceSha256: source.sha256, approved: false, customers: report.customerMappings }),
    'report.md': markdownReport(report) };
  try {
    for (const [name, content] of Object.entries(contents)) {
      await fs.writeFile(path.join(directory, name), content, { flag: 'wx', mode: 0o600 });
    }
    const manifest = { artifactType: 'erp-migration-preflight', status: 'complete', preflightStatus: report.status,
      createdAt: new Date().toISOString(), migrationExecuted: false, sourceSha256: source.sha256,
      hashes: Object.fromEntries(Object.entries(contents).map(([name, value]) => [name, sha256(Buffer.from(value))])) };
    await fs.writeFile(path.join(directory, 'manifest.json'), json(manifest), { flag: 'wx', mode: 0o600 });
    return { status: report.status, blockerCount: report.blockerCount, reviewCount: report.reviewCount, sourceSha256: source.sha256 };
  } catch (error) {
    await fs.writeFile(path.join(directory, 'manifest.incomplete.json'), json({ artifactType: 'erp-migration-preflight', status: 'incomplete' }),
      { flag: 'wx', mode: 0o600 }).catch(() => {});
    throw error;
  }
}
module.exports = { writePreflightArtifacts, markdownReport };
