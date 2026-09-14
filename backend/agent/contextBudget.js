'use strict';

function asText(value) {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return JSON.stringify(value, (key, nested) => (
    key === 'url' && typeof nested === 'string' && nested.startsWith('data:image/')
      ? '[image-bytes]'
      : nested
  ));
}

function estimateTokens(value) {
  const text = asText(value);
  let cjk = 0;
  let other = 0;
  for (const char of text) {
    if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(char)) cjk += 1;
    else other += 1;
  }
  return Math.ceil((cjk + Math.ceil(other / 4)) * 1.2);
}

function groupConversationRounds(messages = []) {
  const rounds = [];
  let current = [];
  for (const message of messages) {
    if (message?.role === 'user' && current.length) {
      rounds.push(current);
      current = [];
    }
    current.push(message);
  }
  if (current.length) rounds.push(current);
  return rounds;
}

function clipToolResult(message, maxChars = 2000) {
  if (message?.role !== 'tool') return message;
  const raw = asText(message.content);
  if (raw.length <= maxChars) return message;
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
  const compact = parsed && typeof parsed === 'object' ? {
    id: parsed.id,
    name: parsed.name,
    status: parsed.status,
    count: parsed.count,
    total: parsed.total,
    error: typeof parsed.error === 'string' ? parsed.error.slice(0, 500) : parsed.error,
    clipped: true,
  } : { excerpt: raw.slice(0, maxChars), clipped: true };
  return { ...message, content: JSON.stringify(compact) };
}

function layerMessage(title, content) {
  const text = asText(content).trim();
  return text ? { role: 'system', content: `${title}\n${text}` } : null;
}

function assembleBudgetedContext({
  systemMessages = [],
  coreMemory = '',
  summary = '',
  archiveMatches = [],
  recentRounds = [],
  currentMessage,
  maxInputTokens = 12000,
} = {}) {
  let coreText = asText(coreMemory).slice(0, 4000);
  let summaryText = asText(summary).slice(0, 6000);
  const archives = archiveMatches.slice(0, 5);
  const recent = recentRounds.slice(-10).map((round) => round.map((message) => clipToolResult(message)));

  const build = () => {
    const layers = [
      ...systemMessages,
      layerMessage('【核心记忆】', coreText),
      layerMessage('【历史摘要】', summaryText),
      ...archives.map((item) => layerMessage('【相关历史】', item.text || item)),
      ...recent.flat(),
      currentMessage,
    ].filter(Boolean);
    return layers;
  };

  let messages = build();
  let estimatedTokens = estimateTokens(messages);
  while (estimatedTokens > maxInputTokens && archives.length) {
    archives.pop();
    messages = build();
    estimatedTokens = estimateTokens(messages);
  }
  while (estimatedTokens > maxInputTokens && recent.length > 3) {
    recent.shift();
    messages = build();
    estimatedTokens = estimateTokens(messages);
  }
  if (estimatedTokens > maxInputTokens) {
    summaryText = summaryText.slice(0, Math.max(0, Math.floor(summaryText.length / 2)));
    coreText = coreText.slice(0, Math.max(0, Math.floor(coreText.length / 2)));
    messages = build();
    estimatedTokens = estimateTokens(messages);
  }

  return {
    messages,
    estimatedTokens,
    overBudget: estimatedTokens > maxInputTokens,
    recentRoundsKept: recent.length,
    archiveMatchesKept: archives.length,
  };
}

module.exports = {
  assembleBudgetedContext,
  clipToolResult,
  estimateTokens,
  groupConversationRounds,
};
