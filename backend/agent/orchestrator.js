// Agent Orchestrator — drives the LLM ↔ tool loop and emits SSE events.
//
// Reads user settings, decrypts API keys, builds ctx = { db, embed, userId },
// then calls streamChatCompletion in a loop, executes tool calls via the
// shared registry, and pushes history into SQLite so the next turn has full
// context (including tool_calls and tool messages).

const crypto = require('../utils/crypto');
const sqliteDb = require('../db/agent');
const { dispatchTool, getToolsForContext } = require('./tools');
const { createLLMClient, streamChatCompletion } = require('./providers/llm');
const embedProvider = require('./providers/embed');
const dbBridge = require('./dbBridge');
const { isImageInputRejection } = require('./visionProbe');
const { deleteConversationAttachments, discardPreparedImages, prepareMessageImages } = require('./attachmentStore');
const { assembleBudgetedContext } = require('./contextBudget');
const { prepareMemoryLayers } = require('./memoryService');
const { withData, appendAudit } = require('../utils/store');
const { publicErrorMessage } = require('../utils/publicError');

const MAX_TURNS = 8;
const SYSTEM_PROMPT = `你是 3D 打印管理系统的 AI 助手（代号 Mavis）。你能查询订单、模型、耗材数据，并能从用户文本中抽取订单草稿。

**输出格式严格要求**：
- 你的回复**直接呈现给最终用户**，绝对不要在回复中包含 <think>...</think> 之类的内部思考标签
- 如果你的模型会自动产生思考过程，请在内部消化，**绝不可暴露给用户**
- 正常回复必须出现在 </think> 之后（或根本不出现 think 块）

规则：
1. 回答简洁、实用，避免冗长
2. 涉及写操作（创建订单/更新数据）必须先让用户确认，绝不直接执行
3. 收到中文对话就用中文回复
4. 当用户描述订单/客户需求时，调用 extract_order_draft 工具提取结构化信息
5. 模糊查询（外观/用途）用 search_models_semantic；精确查询用 search_models_by_keyword
6. 如果工具返回空，诚实告知用户并建议下一步
7. 你看到的是该用户的数据，绝不假设其他用户/租户的存在
8. 只有当用户在当前消息中明确说出长期偏好、业务约束或持续目标时，才调用 remember_explicit_user_fact；禁止根据语气或行为推测
`;

function newId() {
  return require('crypto').randomUUID();
}

async function ensureConversation({ userId, conversationId, firstUserMessage }) {
  if (conversationId) {
    const existing = sqliteDb.getConversation(conversationId, userId);
    if (existing) return { ...existing, justCreated: false };
  }
  // Create new
  const id = newId();
  const title = (firstUserMessage || '').slice(0, 30).replace(/\s+/g, ' ').trim() || '新对话';
  const intent = 'chat';
  sqliteDb.createConversation({ id, user_id: userId, title, intent });
  return { ...sqliteDb.getConversation(id, userId), justCreated: true };
}

/**
 * Main entry point.
 * @param {object} args
 * @param {number} args.userId
 * @param {string} [args.conversationId]
 * @param {string} args.userMessage
 * @param {Array} [args.imageParts]  multimodal content parts for image input
 * @param {function} args.onEvent    (eventName, data) => void
 * @param {AbortSignal} [args.signal]  forwarded to LLM stream; abort kills the request
 */
function messageForProvider(stored) {
  if (!Array.isArray(stored?.content)) return stored;
  const placeholders = stored.content.filter((part) => ['image_placeholder', 'image_attachment'].includes(part?.type));
  const content = stored.content.filter((part) => !['image_placeholder', 'image_attachment'].includes(part?.type));
  if (placeholders.length) {
    content.push({
      type: 'text',
      text: `（此前消息包含 ${placeholders.length} 张图片，图片内容不会在后续轮次自动重复上传）`,
    });
  }
  return { ...stored, content };
}

async function runConversation({
  userId,
  role,
  conversationId,
  userMessage,
  displayUserMessage = userMessage,
  imageParts = [],
  decodedImages = [],
  onEvent,
  signal,
}) {
  // 1. Load settings + decrypt API keys
  const settings = sqliteDb.getUserSettings(userId);
  if (!settings) {
    onEvent('error', { message: '尚未配置 AI 服务，请在设置页填写 MiniMax API Key' });
    return;
  }

  let llmKey;
  let embedKey = null;
  try {
    llmKey = crypto.decrypt(settings.llm_api_key_enc);
    if (settings.embed_enabled && settings.embed_api_key_enc) {
      embedKey = crypto.decrypt(settings.embed_api_key_enc);
    }
  } catch (err) {
    onEvent('error', { message: publicErrorMessage(err, 'API Key 解密失败，请重新保存 AI 服务配置') });
    return;
  }

  // 2. Ensure conversation exists
  const conv = await ensureConversation({
    userId,
    conversationId,
    firstUserMessage: displayUserMessage || (decodedImages.length ? '图片消息' : userMessage),
  });
  sqliteDb.touchConversation(conv.id);

  // 3. Load history
  const history = sqliteDb.getMessages(conv.id);
  const memoryLayers = await prepareMemoryLayers({
    userId,
    conversationId: conv.id,
    history,
    query: displayUserMessage || userMessage,
  });

  // 4. Append new user message (with optional images)
  const userContent = imageParts.length > 0
    ? [{ type: 'text', text: userMessage }, ...imageParts]
    : userMessage;
  const userMsg = { role: 'user', content: userContent };
  const budgetedContext = assembleBudgetedContext({
    systemMessages: [{ role: 'system', content: SYSTEM_PROMPT }],
    coreMemory: memoryLayers.coreMemory,
    summary: memoryLayers.summary,
    archiveMatches: memoryLayers.archiveMatches,
    recentRounds: memoryLayers.recentRounds.map((round) => round.map(messageForProvider)),
    currentMessage: userMsg,
    maxInputTokens: 12000,
  });
  const messages = budgetedContext.messages;
  const userMessageId = newId();
  const preparedAttachments = await prepareMessageImages({
    images: decodedImages,
    userId,
    conversationId: conv.id,
    messageId: userMessageId,
  });
  const persistentUserMsg = {
    role: 'user',
    content: preparedAttachments.length > 0
      ? [
          { type: 'text', text: displayUserMessage },
          ...preparedAttachments.map((attachment) => ({
            type: 'image_attachment',
            attachment_id: attachment.id,
            name: attachment.display_name,
            mime_type: attachment.mime_type,
            byte_size: attachment.byte_size,
          })),
        ]
      : displayUserMessage,
  };
  let currentSequence;
  try {
    currentSequence = sqliteDb.addMessageWithAttachments({
      id: userMessageId,
      conversation_id: conv.id,
      role: 'user',
      content: persistentUserMsg,
    }, preparedAttachments);
  } catch (error) {
    await discardPreparedImages(preparedAttachments);
    throw error;
  }
  let failedTurnCleaned = false;
  const cleanupFailedTurn = async () => {
    if (failedTurnCleaned) return;
    failedTurnCleaned = true;
    sqliteDb.deleteConversationMessagesFromSequence(conv.id, userId, currentSequence);
    await deleteConversationAttachments(preparedAttachments);
    if (conv.justCreated) sqliteDb.deleteConversation(conv.id, userId);
  };

  // 5. Build the per-turn runtime. Any local setup failure after persistence must
  // roll the turn back just like a provider failure, otherwise retrying would
  // leave an invisible duplicate user message in the conversation history.
  let ctx;
  let activeTools;
  let llm;
  try {
    ctx = {
      userId,
      role,
      currentUserMessageId: userMessageId,
      conversationId: conv.id,
      db: dbBridge,
      ...(embedKey ? {
        embeddingFingerprint: settings.embed_config_fingerprint,
        embed: {
          embedQuery: async (text) => embedProvider.embedQuery({
            baseUrl: settings.embed_base_url,
            apiKey: embedKey,
            groupId: settings.embed_group_id,
            model: settings.embed_model,
            text,
          }),
        },
      } : {}),
    };
    const indexState = embedKey
      ? sqliteDb.getModelIndexState(userId, settings.embed_config_fingerprint)
      : null;
    activeTools = getToolsForContext({
      embeddingReady: Number(indexState?.ready_count || 0) > 0,
      hasAttachments: settings.llm_vision_status === 'vision'
        && sqliteDb.listConversationAttachments(conv.id, userId).length > 0,
    });
    llm = createLLMClient({ baseUrl: settings.llm_base_url, apiKey: llmKey });
  } catch (error) {
    await cleanupFailedTurn();
    onEvent('error', { code: 'AGENT_SETUP_FAILED', message: publicErrorMessage(error, '对话初始化失败') });
    return;
  }

  // 7. Main loop
  let turn = 0;
  let finalText = '';
  let draftEmitted = false;

  // signal 已从参数解构出来；客户端断开时取消 LLM 请求，节省 token + 避免流到一半挂起
  // （OpenAI SDK >= 4.50 接受 signal 选项，会把流 abort）

  while (turn < MAX_TURNS) {
    if (signal?.aborted) {
      await cleanupFailedTurn();
      onEvent('error', { message: '客户端已断开' });
      return;
    }
    turn += 1;
    let stream;
    try {
      stream = await streamChatCompletion(llm, {
        model: settings.llm_model,
        messages,
        tools: activeTools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
        tool_choice: 'auto',
        max_completion_tokens: 4096,
        // M3 默认开启 thinking 会拖慢首 token、偶尔挂起流；显式关掉
        extra_body: { thinking: { type: 'disabled' } },
        ...(signal ? { signal } : {}),
      });
    } catch (err) {
      // 客户端主动 abort（AbortError）不当作错误抛给用户
      if (err?.name === 'AbortError' || signal?.aborted) {
        await cleanupFailedTurn();
        return;
      }
      if (imageParts.length && isImageInputRejection(err)) {
        await cleanupFailedTurn();
        sqliteDb.updateUserVisionStatus(userId, 'untested', null);
        onEvent('error', {
          code: 'IMAGE_CAPABILITY_UNSUPPORTED',
          message: '当前模型拒绝了图片输入，系统已将图片能力标记为待重新验证',
        });
        return;
      }
      await cleanupFailedTurn();
      onEvent('error', { code: 'LLM_CALL_FAILED', message: publicErrorMessage(err, '大模型调用失败') });
      return;
    }

    // Accumulate stream
    // Think-block stripping state. M3 默认开启 thinking 会在 content 里
    // 夹带 <think>...</think> 块；尽管我们已经传了 thinking.disabled，但
    // 实际仍有泄漏 —— 更糟的是 LLM 有时**忘了写 </think> 关闭标签**，把
    // 思考和正常回复都塞在一个未关闭的 <think> 块里。
    //
    // 剥离策略（按以下顺序）：
    //   1) 完整 <think>...</think> 块 → 整段删除
    //   2) 未关闭的 <think> 块（从 <think> 到字符串末尾） → 整段删除
    //   3) rawContent 中残留的 <think> 起始标记 → 不 emit 给前端
    //
    // 采用"累加 + 增量"模式：每收到 delta 重新计算 visible = 剥离后的内容，
    // emit 增量 = visible - 上次 emittedVisible。这样能正确处理
    // <think> 或 </think> 跨 chunk 边界的情况。
    //
    // 副作用：如果 LLM 真的没关闭 think 块且在 <think> 之后还有正常回复
    // （极少见），那些正常回复也会被吃。安全优于显示内部思考。
    let rawContent = '';
    let emittedVisible = '';
    const THINK_CLOSED_RE = /<think>[\s\S]*?<\/think>/g;
    const THINK_UNCLOSED_RE = /<think>[\s\S]*$/;
    const stripThink = (s) => s.replace(THINK_CLOSED_RE, '').replace(THINK_UNCLOSED_RE, '');
    const toolCallsMap = new Map(); // index -> { id, name, arguments }
    let finishReason = null;

    try {
      for await (const chunk of stream) {
        if (signal?.aborted) {
          await cleanupFailedTurn();
          return;
        }
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          rawContent += delta.content;
          // 剥离 think 块后只 emit 增量
          const visible = stripThink(rawContent);
          const deltaText = visible.slice(emittedVisible.length);
          emittedVisible = visible;
          if (deltaText) {
            onEvent('delta', { text: deltaText });
          }
        }
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCallsMap.has(idx)) {
              toolCallsMap.set(idx, { id: tc.id || '', name: tc.function?.name || '', arguments: '' });
            }
            const entry = toolCallsMap.get(idx);
            if (tc.id) entry.id = tc.id;
            if (tc.function?.name) entry.name = tc.function.name;
            if (tc.function?.arguments) entry.arguments += tc.function.arguments;
          }
        }
        if (chunk.choices?.[0]?.finish_reason) {
          finishReason = chunk.choices[0].finish_reason;
        }
      }
    } catch (err) {
      if (err?.name === 'AbortError' || signal?.aborted) {
        await cleanupFailedTurn();
        return;  // 客户端断开是预期路径
      }
      if (imageParts.length && isImageInputRejection(err)) {
        await cleanupFailedTurn();
        sqliteDb.updateUserVisionStatus(userId, 'untested', null);
        onEvent('error', {
          code: 'IMAGE_CAPABILITY_UNSUPPORTED',
          message: '当前模型拒绝了图片输入，系统已将图片能力标记为待重新验证',
        });
        return;
      }
      await cleanupFailedTurn();
      onEvent('error', { message: publicErrorMessage(err, '流式响应中断') });
      return;
    }

    // finalText 用剥离 think 块后的内容，保证 done 事件和 SQLite 都不残留
    finalText = emittedVisible || '';

    const toolCalls = Array.from(toolCallsMap.values());
    const assistantMessage = {
      role: 'assistant',
      content: emittedVisible || null,
      tool_calls: toolCalls.length > 0 ? toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.arguments },
      })) : undefined,
    };
    messages.push(assistantMessage);
    sqliteDb.addMessage({
      id: newId(),
      conversation_id: conv.id,
      role: 'assistant',
      content: assistantMessage,
    });

    // If no tool calls, we're done
    if (toolCalls.length === 0) {
      break;
    }

    // Execute tools
    for (const tc of toolCalls) {
      onEvent('tool_call', { name: tc.name, arguments: tc.arguments });
      let args;
      try {
        args = JSON.parse(tc.arguments || '{}');
      } catch (err) {
        await cleanupFailedTurn();
        onEvent('error', { message: publicErrorMessage(err, '工具参数解析失败') });
        return;
      }

      let result;
      try {
        result = await dispatchTool(tc.name, args, ctx);
      } catch (err) {
        result = { error: publicErrorMessage(err, '工具执行失败') };
      }

      let storedResult = result;
      if (result?.__imageRecall) {
        storedResult = { attachment_id: result.attachmentId, recalled: true };
      }

      // If this is the extract_order_draft tool, emit a draft event
      if (tc.name === 'extract_order_draft' && !draftEmitted) {
        onEvent('draft', { draft: result });
        draftEmitted = true;
      }

      const toolMsg = {
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(storedResult),
      };
      messages.push(toolMsg);
      if (result?.__imageRecall) {
        messages.push({
          role: 'user',
          content: [
            { type: 'text', text: '这是刚才请求回看的历史图片，请结合当前问题继续分析。' },
            { type: 'image_url', image_url: { url: result.dataUrl } },
          ],
        });
      }
      sqliteDb.addMessage({
        id: newId(),
        conversation_id: conv.id,
        role: 'tool',
        content: toolMsg,
      });

      // Audit
      await withData((d) => {
        appendAudit(d, {
          actorId: String(userId),
          entity: 'agent_tool',
          entityId: tc.id,
          action: tc.name,
          diff: { arguments: args, hasResult: !result?.error },
        });
        return null;
      });
    }
  }

  if (preparedAttachments.length && finalText) {
    sqliteDb.updateAttachmentDescriptions(
      preparedAttachments.map((attachment) => attachment.id),
      finalText.slice(0, 500),
    );
  }

  onEvent('done', { conversationId: conv.id, text: finalText, turns: turn });
  return { conversationId: conv.id, turns: turn };
}

module.exports = { runConversation };
