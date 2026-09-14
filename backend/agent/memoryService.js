'use strict';

const crypto = require('crypto');
const sqliteDb = require('../db/agent');

function rowText(row) {
  const message = row?.content || {};
  const content = message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part?.type === 'text')
    .map((part) => part.text)
    .join(' ');
}

function groupRows(rows) {
  const rounds = [];
  let current = [];
  for (const row of rows) {
    if (row.role === 'user' && current.length) {
      rounds.push(current);
      current = [];
    }
    current.push(row);
  }
  if (current.length) rounds.push(current);
  return rounds;
}

function uniqueLimited(values, max, chars) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))]
    .slice(-max)
    .map((value) => value.slice(0, chars));
}

function buildSummary(previous, rows) {
  const userFacts = rows.filter((row) => row.role === 'user').map(rowText);
  const decisions = rows.filter((row) => row.role === 'assistant').map(rowText);
  const summary = {
    conversation_goal: previous?.conversation_goal || userFacts[0]?.slice(0, 1000) || '',
    confirmed_facts: uniqueLimited([...(previous?.confirmed_facts || []), ...userFacts], 20, 500),
    decisions: uniqueLimited([...(previous?.decisions || []), ...decisions], 20, 500),
    pending_items: uniqueLimited(previous?.pending_items || [], 20, 500),
    important_tool_results: uniqueLimited([
      ...(previous?.important_tool_results || []),
      ...rows.filter((row) => row.role === 'tool').map(rowText),
    ], 15, 500),
    image_references: previous?.image_references || [],
  };
  while (JSON.stringify(summary).length > 6000 && summary.confirmed_facts.length > 1) {
    summary.confirmed_facts.shift();
  }
  while (JSON.stringify(summary).length > 6000 && summary.decisions.length > 1) {
    summary.decisions.shift();
  }
  return summary;
}

function normalizedTerms(query) {
  const normalized = String(query || '').normalize('NFKC').toLowerCase().trim();
  const words = normalized.split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 1);
  const han = [...normalized].filter((char) => /\p{Script=Han}/u.test(char));
  const pairs = han.slice(0, -1).map((char, index) => char + han[index + 1]);
  return [...new Set([...words, ...pairs])];
}

function searchArchiveKeyword(userId, query, limit = 5, db = sqliteDb) {
  const terms = normalizedTerms(query);
  if (!terms.length) return [];
  return db.listArchivalPassages(userId, 100)
    .map((row) => {
      const haystack = `${row.topic} ${row.text}`.normalize('NFKC').toLowerCase();
      const matched = terms.filter((term) => haystack.includes(term)).length;
      return {
        id: row.id,
        conversationId: row.conversation_id,
        text: row.text,
        topic: row.topic,
        sourceSequenceStart: row.source_sequence_start,
        sourceSequenceEnd: row.source_sequence_end,
        score: matched / terms.length,
        strategy: 'keyword',
      };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function memoryError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.status = 400;
  throw error;
}

function normalizeFact(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function applyCoreMemoryCandidate({ userId, category, content, sourceMessageId, db = sqliteDb }) {
  const categories = new Set(['user_preferences', 'business_constraints', 'active_goals']);
  if (!categories.has(category)) memoryError('MEMORY_CATEGORY_INVALID', '不支持该核心记忆分类');
  const cleanContent = String(content || '').trim();
  if (!cleanContent || cleanContent.length > 500) memoryError('MEMORY_CONTENT_INVALID', '记忆内容长度必须为 1 到 500 个字符');
  const source = db.getOwnedUserMessage(sourceMessageId, userId);
  if (!source) memoryError('MEMORY_SOURCE_NOT_FOUND', '作为来源的用户消息不存在');
  if (!normalizeFact(rowText(source)).includes(normalizeFact(cleanContent))) {
    memoryError('MEMORY_NOT_EXPLICIT', '核心记忆必须引用用户明确表达的事实');
  }
  const active = db.listCoreMemories(userId);
  if (active.some((memory) => normalizeFact(memory.content) === normalizeFact(cleanContent))) {
    return { saved: false, duplicate: true };
  }
  const totalLength = active.reduce((sum, memory) => sum + memory.content.length, 0) + cleanContent.length;
  if (totalLength > 4000) memoryError('MEMORY_BUDGET_EXCEEDED', '核心记忆空间已满');
  const memory = {
    id: crypto.randomUUID(),
    user_id: String(userId),
    category,
    content: cleanContent,
    source_message_id: String(sourceMessageId),
  };
  db.insertCoreMemory(memory);
  return { saved: true, memory: { id: memory.id, category, content: cleanContent } };
}

function ensureRollingSummary({ userId, conversationId, history, db = sqliteDb }) {
  const rounds = groupRows(history);
  const recentRounds = rounds.slice(-10);
  const olderRows = rounds.slice(0, Math.max(0, rounds.length - 10)).flat();
  const existing = db.getConversationSummary(conversationId, userId);
  const priorThrough = Number(existing?.summarized_through_sequence || 0);
  const newRows = olderRows.filter((row) => Number(row.sequence) > priorThrough);

  if (newRows.length) {
    const summary = buildSummary(existing?.summary, newRows);
    const throughSequence = Math.max(...newRows.map((row) => Number(row.sequence)));
    const passageText = newRows.map((row) => `${row.role}: ${rowText(row)}`).join('\n').slice(0, 12000);
    const passage = {
      id: crypto.randomUUID(),
      text: passageText,
      topic: summary.conversation_goal.slice(0, 200),
      sourceSequenceStart: Math.min(...newRows.map((row) => Number(row.sequence))),
      sourceSequenceEnd: throughSequence,
      startedAt: newRows[0]?.created_at,
      endedAt: newRows.at(-1)?.created_at,
    };
    db.commitConversationSummary({
      conversationId,
      userId,
      summary,
      throughSequence,
      passage,
    });
    require('./archiveSearch').queueArchiveEmbedding({ userId, passage, db });
    return { summary, recentRounds };
  }
  return { summary: existing?.summary || null, recentRounds };
}

async function prepareMemoryLayers({ userId, conversationId, history, query, db = sqliteDb }) {
  const { summary, recentRounds } = ensureRollingSummary({ userId, conversationId, history, db });
  const coreMemory = db.listCoreMemories(userId)
    .map((memory) => `[${memory.category}] ${memory.content}`)
    .join('\n');
  const embeddingConfig = require('./archiveSearch').embeddingConfigForUser(userId, db);
  const archiveMatches = await require('./archiveSearch').searchArchive({
    userId,
    query,
    embeddingConfig,
    limit: 5,
    db,
  });
  return {
    coreMemory,
    summary: summary ? JSON.stringify(summary) : '',
    archiveMatches,
    recentRounds: recentRounds.map((round) => round.map((row) => row.content)),
  };
}

module.exports = {
  applyCoreMemoryCandidate,
  buildSummary,
  ensureRollingSummary,
  prepareMemoryLayers,
  searchArchiveKeyword,
};
