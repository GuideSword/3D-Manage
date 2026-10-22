'use strict';

function visibleText(content) {
  const value = content?.content ?? content;
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  const text = value.filter(part => part?.type === 'text').map(part => part.text || '').join('\n');
  const imageCount = value.filter(part => ['image_attachment', 'image_placeholder'].includes(part?.type)).length;
  return [text, imageCount ? `图片 ${imageCount} 张` : ''].filter(Boolean).join('\n');
}

function restoreConversationMessages(rows = []) {
  const messages = [];
  for (const row of rows) {
    if (row.role !== 'user' && row.role !== 'assistant') continue;
    const text = visibleText(row.content);
    if (!text) continue;
    const interrupted = row.role === 'user' && ['pending', 'interrupted'].includes(row.content?.turn_state);
    messages.push({ id: String(row.id), role: row.role,
      text: interrupted ? `${text}\n（回复未完成）` : text });
  }
  const last = rows[rows.length - 1];
  const state = last?.content?.turn_state;
  const retryMessage = last?.role === 'user' && ['pending', 'interrupted'].includes(state)
    ? { id: String(last.id), text: visibleText(last.content), hasImages: Array.isArray(last.content?.content) }
    : null;
  return { messages, retryMessage };
}

module.exports = { restoreConversationMessages, visibleText };
