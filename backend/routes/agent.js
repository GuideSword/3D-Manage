// Express router for the AI agent surface.
// Mounted by backend/server.js at /api/agent.
//
// Endpoints (all require JWT auth via `requireAuth`):
//   POST   /chat                 — main SSE entry point
//   GET    /conversations        — list current user's conversations
//   GET    /conversations/:id    — fetch one conversation + its messages
//   DELETE /conversations/:id    — delete one conversation
//   POST   /drafts/confirm       — write an order from an Agent-generated draft
//   GET    /keys                 — return public configuration status only
//   POST   /keys/test            — verify independent LLM/Embedding candidates
//   PUT    /keys                 — save independent LLM/Embedding configuration

const express = require('express');
const crypto = require('../utils/crypto');
const sqliteDb = require('../db/agent');
const { requireAuth, requireRoles } = require('../middleware/auth');
const { runConversation } = require('../agent/orchestrator');
const { normalizeChatRequest } = require('../agent/chatRequest');
const { createChatGuard } = require('../agent/chatLimits');
const { parseAgentImages } = require('../agent/imagePayload');
const { ensureStoredVisionCapability } = require('../agent/visionCapabilityService');
const {
  buildCandidate,
  persistedRow,
  testEmbeddingCandidate,
  testLlmCandidate,
  toPublicSettings,
} = require('../agent/settingsService');
const { queueUserModelReconcile } = require('../agent/modelIndex');
const { deleteConversationAttachments, readOwnedAttachment } = require('../agent/attachmentStore');
const { withData } = require('../utils/store');
const { createOrderInData } = require('../services/orders');
const { z } = require('zod');
const { parseRequest } = require('../utils/validation');
const { publicErrorMessage } = require('../utils/publicError');

const router = express.Router();
router.use(requireAuth);
const chatGuard = createChatGuard();

const orderDraftSchema = z.object({
  customer_name: z.string().trim().min(1).max(200),
  due_date: z.string().trim().max(40).nullable().optional(),
  notes: z.string().trim().max(5000).optional().default(''),
  items: z.array(z.object({
    model_asset_id: z.string().max(200).optional().default(''),
    model_name: z.string().max(200).optional().default(''),
    material_type: z.string().trim().min(1).max(120),
    color: z.string().max(120).optional().default(''),
    layer_height_mm: z.union([z.string(), z.number()]).optional().default(''),
    qty: z.coerce.number().positive(),
    unit_price: z.coerce.number().nonnegative(),
    notes: z.string().max(1000).optional().default(''),
  }).strict()).min(1),
  confidence: z.number().min(0).max(1).optional(),
  missing_fields: z.array(z.string()).optional(),
}).strict();

// 1) POST /chat — main entry, SSE
router.post('/chat', async (req, res) => {
  let chatRequest;
  try {
    chatRequest = normalizeChatRequest(req.body);
  } catch (error) {
    return res.status(error.status || 400).json({
      code: error.code || 'CHAT_REQUEST_INVALID',
      error: publicErrorMessage(error, '对话初始化失败'),
    });
  }
  const { conversationId, suppliedMessage, images, modelMessage } = chatRequest;

  const settings = sqliteDb.getUserSettings(req.user.id);
  if (!settings?.llm_api_key_enc) {
    return res.status(422).json({ code: 'LLM_NOT_CONFIGURED', error: '尚未配置大模型服务' });
  }

  let parsedImages;
  let releaseChatSlot;
  try {
    // Validate images before reserving this user's active chat slot.
    const visionStatus = settings.llm_vision_status || 'untested';
    parsedImages = parseAgentImages(images, visionStatus === 'untested' ? 'vision' : visionStatus);
    releaseChatSlot = chatGuard.acquire(req.user.id);
    const vision = images.length > 0
      ? await ensureStoredVisionCapability({ userId: req.user.id, settings })
      : { status: visionStatus };
    if (images.length && vision.status !== 'vision') parseAgentImages(images, vision.status);
  } catch (error) {
    releaseChatSlot?.();
    return res.status(error.status || 500).json({
      code: error.code || 'CHAT_INIT_FAILED',
      error: publicErrorMessage(error, '对话初始化失败'),
    });
  }

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

  try {
    await runConversation({
      userId: req.user.id,
      role: req.user.role,
      conversationId,
      userMessage: modelMessage,
      displayUserMessage: suppliedMessage,
      imageParts: parsedImages.parts,
      decodedImages: parsedImages.decoded,
      signal: ac.signal,
      onEvent: safeWrite,
    });
  } catch (err) {
    safeWrite('error', { message: publicErrorMessage(err, '流式响应中断') });
  } finally {
    releaseChatSlot();
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
    res.status(500).json({ error: publicErrorMessage(err, '读取对话失败') });
  }
});

// 3) GET /conversations/:id
router.get('/conversations/:id', (req, res) => {
  try {
    const conv = sqliteDb.getConversation(req.params.id, req.user.id);
    if (!conv) return res.status(404).json({ error: '记录不存在' });
    const messages = sqliteDb.getMessages(conv.id);
    res.json({ conversation: conv, messages });
  } catch (err) {
    res.status(500).json({ error: publicErrorMessage(err, '读取对话失败') });
  }
});

// 4) DELETE /conversations/:id
router.delete('/conversations/:id', async (req, res) => {
  try {
    const attachments = sqliteDb.listConversationAttachments(req.params.id, req.user.id);
    const ok = sqliteDb.deleteConversation(req.params.id, req.user.id);
    if (!ok) return res.status(404).json({ error: '记录不存在' });
    const cleanup = await deleteConversationAttachments(attachments);
    res.json({ deleted: true, cleanupPending: cleanup.cleanupPending });
  } catch (err) {
    res.status(500).json({ error: publicErrorMessage(err, '删除对话失败') });
  }
});

// 5) POST /drafts/confirm
router.post('/drafts/confirm', requireRoles('owner', 'staff'), async (req, res) => {
  const draft = parseRequest(orderDraftSchema, req.body?.draft, res);
  if (!draft) return undefined;
  try {
    const newOrder = await withData((data) => createOrderInData(data, {
      customer: { name: draft.customer_name, email: '', phone: '' },
      status: 'draft',
      currency: 'CNY',
      dueDate: draft.due_date || null,
      notes: draft.notes,
      items: draft.items.map((item) => ({
        modelId: item.model_asset_id,
        modelName: item.model_name,
        materialType: item.material_type,
        color: item.color,
        layerHeightMm: item.layer_height_mm,
        quantity: item.qty,
        unitPrice: item.unit_price,
        notes: item.notes,
      })),
    }, {
      actorId: req.user.id,
      action: 'create_from_draft',
    }));
    res.json({ order: newOrder });
  } catch (err) {
    res.status(500).json({ error: publicErrorMessage(err, '读取草稿失败') });
  }
});

// 6) GET /keys — public projection only. Stored keys and ciphertext never leave
// the backend, including masked suffixes.
function publicSettingsForUser(userId, row = sqliteDb.getUserSettings(userId)) {
  const settings = toPublicSettings(row);
  const state = row?.embed_enabled
    ? sqliteDb.getModelIndexState(userId, row.embed_config_fingerprint)
    : null;
  settings.embedding.index = state ? {
    status: state.status,
    totalCount: state.total_count,
    readyCount: state.ready_count,
    failedCount: state.failed_count,
    updatedAt: state.updated_at,
  } : null;
  return settings;
}

router.get('/keys', (req, res) => {
  const row = sqliteDb.getUserSettings(req.user.id);
  if (row?.embed_enabled) queueUserModelReconcile(req.user.id);
  res.json({ settings: publicSettingsForUser(req.user.id, row) });
});

router.get('/conversations/:conversationId/attachments/:attachmentId', async (req, res) => {
  try {
    const attachment = await readOwnedAttachment({
      attachmentId: req.params.attachmentId,
      conversationId: req.params.conversationId,
      userId: req.user.id,
    });
    res.setHeader('Content-Type', attachment.metadata.mime_type);
    res.setHeader('Content-Length', attachment.buffer.length);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', 'inline');
    return res.send(attachment.buffer);
  } catch (_) {
    return res.status(404).json({ error: '记录不存在' });
  }
});

async function evaluateCandidate(candidate) {
  const llmResult = await testLlmCandidate(candidate);
  const embeddingResult = await testEmbeddingCandidate(candidate);
  return { ...llmResult, embedding: embeddingResult };
}

// 7) POST /keys/test — tests an unsaved candidate without mutating settings.
router.post('/keys/test', async (req, res) => {
  try {
    const existing = sqliteDb.getUserSettings(req.user.id);
    const candidate = buildCandidate({ existing, input: req.body, secrets: crypto });
    const tests = await evaluateCandidate(candidate);
    res.json({ ok: tests.llm.ok && tests.embedding.ok, tests });
  } catch (error) {
    res.status(error.status || 500).json({
      code: error.code || 'SETTINGS_TEST_FAILED',
      error: publicErrorMessage(error, '测试 AI 服务配置失败'),
    });
  }
});

// 8) PUT /keys — validates and tests candidates before persistence. A failed
// Embedding replacement never overwrites the last working Embedding settings.
router.put('/keys', async (req, res) => {
  const existing = sqliteDb.getUserSettings(req.user.id);
  try {
    const candidate = buildCandidate({ existing, input: req.body, secrets: crypto });
    const tests = await evaluateCandidate(candidate);
    if (!tests.llm.ok) {
      return res.status(422).json({ code: 'LLM_CONNECTION_FAILED', error: tests.llm.error, tests });
    }

    const embeddingFailed = candidate.embedding.enabled && !tests.embedding.ok;
    const row = persistedRow({
      candidate,
      existing,
      vision: tests.vision,
      preserveEmbedding: embeddingFailed,
      secrets: crypto,
    });
    sqliteDb.saveUserSettings(req.user.id, row);
    const savedRow = sqliteDb.getUserSettings(req.user.id);
    const settings = publicSettingsForUser(req.user.id, savedRow);

    if (embeddingFailed) {
      return res.status(422).json({
        code: 'EMBEDDING_CONNECTION_FAILED',
        error: tests.embedding.error,
        settings,
        tests,
      });
    }
    if (savedRow.embed_enabled) queueUserModelReconcile(req.user.id);
    return res.json({ ok: true, settings, tests });
  } catch (error) {
    return res.status(error.status || 500).json({
      code: error.code || 'SETTINGS_SAVE_FAILED',
      error: publicErrorMessage(error, '保存 AI 服务配置失败'),
    });
  }
});

module.exports = router;

// MOUNT INSTRUCTIONS (parent will do this in backend/server.js):
//   const agentRouter = require('./routes/agent');
//   app.use('/api/agent', agentRouter);
