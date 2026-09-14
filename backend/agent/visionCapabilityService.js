'use strict';

const secrets = require('../utils/crypto');
const sqliteDb = require('../db/agent');
const { createLLMClient } = require('./providers/llm');
const { probeVision } = require('./visionProbe');

const inFlightProbes = new Map();
const FINAL_STATUSES = new Set(['vision', 'text_only', 'error']);

async function ensureStoredVisionCapability({ userId, settings }, dependencies = {}) {
  const currentStatus = settings?.llm_vision_status || 'untested';
  if (currentStatus !== 'untested') return { status: currentStatus, checkedAt: settings?.llm_vision_checked_at || null };

  const key = `${String(userId)}:${Number(settings?.llm_config_revision || 0)}`;
  if (inFlightProbes.has(key)) return inFlightProbes.get(key);

  const run = (async () => {
    const decrypt = dependencies.decrypt || secrets.decrypt;
    const createClient = dependencies.createClient || createLLMClient;
    const runProbe = dependencies.probeVision || probeVision;
    const updateVisionStatus = dependencies.updateVisionStatus || sqliteDb.updateUserVisionStatus;
    let result;

    try {
      const apiKey = decrypt(settings.llm_api_key_enc);
      const client = createClient({ baseUrl: settings.llm_base_url, apiKey });
      result = await runProbe({
        model: settings.llm_model,
        complete: (request) => client.chat.completions.create(request),
      });
    } catch (_) {
      result = { status: 'error', checkedAt: new Date().toISOString(), reasonCode: 'VISION_PROBE_FAILED' };
    }

    if (!FINAL_STATUSES.has(result?.status)) {
      result = { status: 'error', checkedAt: new Date().toISOString(), reasonCode: 'VISION_PROBE_INVALID_RESULT' };
    }
    updateVisionStatus(String(userId), result.status, result.checkedAt || new Date().toISOString());
    return result;
  })();

  inFlightProbes.set(key, run);
  try {
    return await run;
  } finally {
    if (inFlightProbes.get(key) === run) inFlightProbes.delete(key);
  }
}

module.exports = { ensureStoredVisionCapability };
