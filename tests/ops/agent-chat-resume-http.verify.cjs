const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const baseDir = fs.mkdtempSync(path.resolve('.tmp', 'agent-chat-resume-http-'));
process.env.NODE_ENV = 'development';
process.env.PORT = '0';
process.env.HOST = '127.0.0.1';
process.env.STORE_DRIVER = 'file';
process.env.DATA_DIR = path.join(baseDir, 'data');
process.env.UPLOAD_DIR = path.join(baseDir, 'uploads');
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
process.env.AGENT_KEY_ENC_SECRET = crypto.randomBytes(32).toString('hex');
process.env.BOOTSTRAP_TOKEN = crypto.randomBytes(32).toString('hex');
process.env.AGENT_ENABLED = 'true';

let providerCalls = 0;
const provider = http.createServer((request, response) => {
  if (request.url !== '/v1/chat/completions') { response.writeHead(404).end(); return; }
  providerCalls += 1;
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const finish = () => {
    response.write('data: ' + JSON.stringify({ id: 'fake', object: 'chat.completion.chunk', created: 1,
      model: 'fixture', choices: [{ index: 0, delta: { content: '这是续接后的回答' }, finish_reason: 'stop' }] }) + '\n\n');
    response.end('data: [DONE]\n\n');
  };
  if (providerCalls === 1) setTimeout(finish, 1600);
  else finish();
});

(async () => {
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  const providerBase = `http://127.0.0.1:${provider.address().port}/v1`;
  const app = require('../../backend/server');
  const db = require('../../backend/db/agent');
  const encryption = require('../../backend/utils/crypto');
  const listener = await app.start();
  const apiBase = `http://127.0.0.1:${listener.address().port}/api`;
  const api = async (path, init = {}, token = '') => {
    const response = await fetch(`${apiBase}${path}`, { ...init, headers: {
      'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers,
    } });
    return { status: response.status, body: await response.json() };
  };
  const boot = await api('/system/bootstrap', { method: 'POST', headers: { 'X-Bootstrap-Token': process.env.BOOTSTRAP_TOKEN },
    body: JSON.stringify({ organizationName: '01A隔离验收', ownerName: 'Owner', email: 'resume@example.test', password: 'Fixture-Resume-2026!' }) });
  assert.equal(boot.status, 201, JSON.stringify(boot.body));
  const token = boot.body.token;
  db.saveUserSettings(boot.body.user.id, {
    llm_provider: 'openai_compat', llm_base_url: providerBase,
    llm_api_key_enc: encryption.encrypt('fixture-key'), llm_model: 'fixture',
    llm_vision_status: 'text_only', llm_vision_checked_at: null, llm_config_revision: 1,
    embed_enabled: 0, embed_base_url: null, embed_api_key_enc: null, embed_model: null,
    embed_group_id: null, embed_config_fingerprint: null,
  });
  const controller = new AbortController();
  const first = await fetch(`${apiBase}/agent/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message: '请继续订单讨论' }), signal: controller.signal,
  });
  assert.equal(first.status, 200);
  const reader = first.body.getReader();
  let accepted;
  let raw = '';
  while (!accepted) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error('Stream ended before accepted');
    raw += new TextDecoder().decode(chunk.value);
    const match = raw.match(/event: accepted\ndata: ([^\n]+)/);
    if (match) accepted = JSON.parse(match[1]);
  }
  controller.abort();
  try { await reader.cancel(); } catch (_) {}
  let detail1;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    detail1 = await api(`/agent/conversations/${accepted.conversationId}`, {}, token);
    if (detail1.body.messages[0]?.content?.turn_state !== 'pending') break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  console.log(JSON.stringify({ afterAbortState: detail1.body.messages[0]?.content?.turn_state, providerCalls }));
  assert.equal(detail1.body.messages.length, 1);
  assert.equal(detail1.body.messages[0].content.turn_state, 'interrupted');
  const retry = await fetch(`${apiBase}/agent/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message: '请继续订单讨论', conversationId: accepted.conversationId,
      retryMessageId: accepted.messageId }),
  });
  const retryText = await retry.text();
  assert.equal(retry.status, 200);
  assert.match(retryText, /event: done/);
  const detail2 = await api(`/agent/conversations/${accepted.conversationId}`, {}, token);
  assert.deepEqual(detail2.body.messages.map(row => row.role), ['user', 'assistant']);
  assert.equal(detail2.body.messages[0].id, accepted.messageId);
  assert.equal(detail2.body.messages[0].content.turn_state, 'complete');
  const other = await api('/users', { method: 'POST', body: JSON.stringify({
    name: 'Second account', email: 'second@example.test', password: 'Fixture-Second-2026!', role: 'viewer',
  }) }, token);
  assert.equal(other.status, 201);
  const otherLogin = await api('/auth/login', { method: 'POST', body: JSON.stringify({
    email: 'second@example.test', password: 'Fixture-Second-2026!',
  }) });
  assert.equal(otherLogin.status, 200);
  const otherList = await api('/agent/conversations', {}, otherLogin.body.token);
  const otherDetail = await api(`/agent/conversations/${accepted.conversationId}`, {}, otherLogin.body.token);
  assert.deepEqual(otherList.body.items, []);
  assert.equal(otherDetail.status, 404);
  const forbidden = await api(`/agent/conversations/${accepted.conversationId}`, {}, 'bad-token');
  assert.equal(forbidden.status, 401);
  console.log(JSON.stringify({ firstStatus: first.status, interrupted: detail1.body.messages[0].content.turn_state,
    retryStatus: retry.status, finalRoles: detail2.body.messages.map(row => row.role),
    sameUserMessage: detail2.body.messages[0].id === accepted.messageId,
    otherAccountStatus: otherDetail.status, unauthorizedStatus: forbidden.status }));
  await app.shutdown('test');
  await new Promise(resolve => provider.close(resolve));
})().catch(error => { console.error(error); process.exitCode = 1; provider.close(); });
