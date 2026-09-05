// Express router for the AI agent surface.
// Mounted by backend/server.js at /api/agent.
//
// Endpoints (all require JWT auth via `requireAuth`):
//   POST   /chat                 — main SSE entry point
//   GET    /conversations        — list current user's conversations
//   GET    /conversations/:id    — fetch one conversation + its messages
//   DELETE /conversations/:id    — delete one conversation
//   POST   /drafts/confirm       — write an order from an Agent-generated draft
//   GET    /keys/test            — verify LLM API key by listing models
//   PUT    /keys                 — save the user's API key + model config

const express = require('express');
const crypto = require('../utils/crypto');
const sqliteDb = require('../db/agent');
const { requireAuth } = require('../middleware/auth');
const { runConversation } = require('../agent/orchestrator');
const { createLLMClient, listModels } = require('../agent/providers/llm');
const embedProvider = require('../agent/providers/embed');
const { withData, appendAudit } = require('../utils/store');

const router = express.Router();
router.use(requireAuth);

// 1) POST /chat — main entry, SSE
router.post('/chat', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  // AbortController：客户端断开时立即通知 orchestrator 取消 LLM 请求
  // 否则客户端 XHR abort → 服务端 res.write 抛 EPIPE → handler 崩溃 → 连接 RST
  const ac = new AbortController();
  let clientGone = false;

  const safeWrite = (event, data) => {
    if (clientGone) return;  // 客户端已断，写入毫无意义
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (err) {
      // EPIPE / socket hang up 等不再 propagate 出去
      console.warn('[/chat] safeWrite failed:', err?.message);
      clientGone = true;
      ac.abort();
    }
  };

  // 客户端断开（XHR abort、网络中断、切后台）→ 立刻 abort LLM 流
  req.on('close', () => {
    if (!clientGone) {
      clientGone = true;
      ac.abort();
    }
  });
  res.on('error', (err) => {
    console.warn('[/chat] res error:', err?.message);
    clientGone = true;
    ac.abort();
  });

  const { conversationId, message, images } = req.body || {};
  if (!message) {
    safeWrite('error', { message: 'message is required' });
    res.end();
    return;
  }

  // Convert images to multimodal parts
  const imageParts = [];
  if (Array.isArray(images)) {
    for (const img of images) {
      if (img?.dataUrl) {
        imageParts.push({ type: 'image_url', image_url: { url: img.dataUrl } });
      }
    }
  }

  try {
    await runConversation({
      userId: req.user.id,
      conversationId,
      userMessage: message,
      imageParts,
      signal: ac.signal,
      onEvent: safeWrite,
    });
  } catch (err) {
    safeWrite('error', { message: err.message });
  }
  // 客户端已断就别再 end（可能抛错）
  if (!clientGone) {
    try { res.end(); } catch (_) { /* ignore */ }
  }
});

// 2) GET /conversations
router.get('/conversations', (req, res) => {
  try {
    const list = sqliteDb.listConversations(req.user.id, { limit: 100 });
    res.json({ items: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3) GET /conversations/:id
router.get('/conversations/:id', (req, res) => {
  try {
    const conv = sqliteDb.getConversation(req.params.id, req.user.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });
    const messages = sqliteDb.getMessages(conv.id);
    res.json({ conversation: conv, messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4) DELETE /conversations/:id
router.delete('/conversations/:id', (req, res) => {
  try {
    const ok = sqliteDb.deleteConversation(req.params.id, req.user.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5) POST /drafts/confirm
router.post('/drafts/confirm', async (req, res) => {
  const { draft } = req.body || {};
  if (!draft || !Array.isArray(draft.items)) {
    return res.status(400).json({ error: 'draft with items[] is required' });
  }
  try {
    // Create the order via the JSON store
    const newOrder = await withData((d) => {
      const id = (d.orders?.length || 0) + 1;
      const total = (draft.items || []).reduce((s, it) => s + Number(it.qty || 0) * Number(it.unit_price || 0), 0);
      const order = {
        id: String(id),
        customerId: null, // TODO: lookup or create customer
        customerName: draft.customer_name || '',
        status: 'draft',
        total,
        currency: 'CNY',
        dueDate: draft.due_date || null,
        notes: draft.notes || '',
        items: (draft.items || []).map((it) => ({
          materialType: it.material_type,
          color: it.color,
          layerHeightMm: it.layer_height_mm,
          qty: it.qty,
          unitPrice: it.unit_price,
          subtotal: Number(it.qty || 0) * Number(it.unit_price || 0),
          modelAssetId: it.model_asset_id,
        })),
        createdBy: req.user.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      d.orders = d.orders || [];
      d.orders.push(order);
      appendAudit(d, { actorId: String(req.user.id), entity: 'order', entityId: order.id, action: 'create_from_draft', diff: { draft } });
      return order;
    });
    res.json({ order: newOrder });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6) GET /keys/test
// Tests BOTH the chat LLM and the embedding endpoint, returning detailed
// per-section results. We deliberately do NOT use `client.models.list()` here
// because MiniMax's OpenAI-compat layer does not always expose that endpoint
// reliably. A 1-token chat completion is the canonical "does my key work" test.
router.get('/keys/test', async (req, res) => {
  const settings = sqliteDb.getUserSettings(req.user.id);
  if (!settings) {
    return res.status(404).json({ ok: false, error: 'No settings configured' });
  }

  const result = {
    llm: { ok: false, error: null, model: null, reply: null },
    embed: { ok: false, error: null, dim: null },
    base_url: settings.llm_base_url,
  };

  // --- Test LLM: minimal chat completion (5 token budget) ---
  try {
    const llmKey = crypto.decrypt(settings.llm_api_key_enc);
    const llm = createLLMClient({ baseUrl: settings.llm_base_url, apiKey: llmKey });
    const response = await llm.chat.completions.create({
      model: settings.llm_model,
      messages: [{ role: 'user', content: 'hi' }],
      max_completion_tokens: 5,
      // M3 默认开启 thinking 会吃掉 5 token 预算，关掉拿干净回复
      extra_body: { thinking: { type: 'disabled' } },
    });
    result.llm.ok = true;
    result.llm.model = response.model || settings.llm_model;
    // 兼容剥离残留的 <think>...</think> 块（个别请求可能漏掉参数）
    let reply = response.choices?.[0]?.message?.content || '';
    reply = reply.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    result.llm.reply = reply;
  } catch (err) {
    result.llm.error = err?.message || String(err);
    if (err?.status) result.llm.status = err.status;
  }

  // --- Test embedding: 1 short text, return vector dimension ---
  try {
    const embedKey = crypto.decrypt(settings.embed_api_key_enc);
    const vectors = await embedProvider.embed({
      baseUrl: settings.embed_base_url,
      apiKey: embedKey,
      groupId: settings.embed_group_id,
      model: settings.embed_model,
      texts: ['test'],
      type: 'query',
    });
    result.embed.ok = true;
    result.embed.dim = vectors?.[0]?.length || 0;
  } catch (err) {
    result.embed.error = err?.message || String(err);
    if (err?.status) result.embed.status = err.status;
  }

  result.ok = result.llm.ok;  // LLM is the hard requirement
  res.json(result);
});

// 7) PUT /keys
router.put('/keys', (req, res) => {
  const { llm_provider, llm_base_url, llm_api_key, llm_model, embed_base_url, embed_api_key, embed_model, embed_group_id } = req.body || {};
  if (!llm_api_key || !embed_api_key) {
    return res.status(400).json({ error: 'llm_api_key and embed_api_key are required' });
  }
  try {
    sqliteDb.upsertUserSettings(req.user.id, {
      llm_provider: llm_provider || 'openai_compat',
      llm_base_url: llm_base_url || 'https://api.minimaxi.com/v1',
      llm_api_key_enc: crypto.encrypt(llm_api_key),
      llm_model: llm_model || 'MiniMax-M3',
      embed_base_url: embed_base_url || 'https://api.minimaxi.com/v1',
      embed_api_key_enc: crypto.encrypt(embed_api_key),
      embed_model: embed_model || 'embo-01',
      embed_group_id: embed_group_id || null,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

// MOUNT INSTRUCTIONS (parent will do this in backend/server.js):
//   const agentRouter = require('./routes/agent');
//   app.use('/api/agent', agentRouter);
