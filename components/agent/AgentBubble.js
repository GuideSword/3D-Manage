import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import Markdown from 'react-native-markdown-display';

// A single message bubble in the Agent chat.
//
//   role: 'user' | 'assistant'
//   text: rendered string (assistant text may contain Markdown)
//   isStreaming: when true, shows a blinking-style cursor suffix while
//                the assistant token stream is still in flight.
//
// Render strategy:
//   - user bubble: plain Text (user doesn't type Markdown)
//   - assistant bubble:
//       * isStreaming=true → plain Text (avoids re-parsing Markdown on every
//         token, which would be expensive and flicker during streaming)
//       * isStreaming=false → Markdown 渲染，让表格/代码/列表等格式生效

export default function AgentBubble({ role, text, isStreaming }) {
  const isUser = role === 'user';
  const body = text || '';
  return (
    <View style={[styles.row, isUser ? styles.right : styles.left]}>
      <View style={[styles.bubble, isUser ? styles.user : styles.assistant]}>
        {isUser ? (
          <Text style={[styles.text, styles.userText]} selectable>
            {body}
          </Text>
        ) : isStreaming ? (
          <Text style={[styles.text, styles.assistantText]} selectable>
            {body}
            <Text style={styles.cursor}> ▍</Text>
          </Text>
        ) : (
          <View style={styles.markdownWrap}>
            <Markdown style={markdownStyles}>{body}</Markdown>
          </View>
        )}
      </View>
    </View>
  );
}

// 平台特定 monospace 字体
const monoFont = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

// Markdown 样式：适配 assistant 气泡（浅灰底 + 黑字）
const markdownStyles = {
  body: { color: '#000', fontSize: 15, lineHeight: 22 },
  heading1: { fontSize: 20, fontWeight: '700', marginVertical: 6, color: '#000' },
  heading2: { fontSize: 18, fontWeight: '700', marginVertical: 5, color: '#000' },
  heading3: { fontSize: 16, fontWeight: '600', marginVertical: 4, color: '#000' },
  strong: { fontWeight: '700', color: '#000' },
  em: { fontStyle: 'italic', color: '#000' },
  link: { color: '#5856D6', textDecorationLine: 'underline' },
  bullet_list: { marginVertical: 4 },
  ordered_list: { marginVertical: 4 },
  list_item: { marginVertical: 2 },
  code_inline: {
    fontFamily: monoFont,
    fontSize: 13,
    backgroundColor: '#E5E5EA',
    color: '#C7254E',
    paddingHorizontal: 4,
    borderRadius: 3,
  },
  code_block: {
    fontFamily: monoFont,
    fontSize: 13,
    backgroundColor: '#1E1E1E',
    color: '#D4D4D4',
    padding: 8,
    borderRadius: 6,
    marginVertical: 4,
  },
  fence: {
    fontFamily: monoFont,
    fontSize: 13,
    backgroundColor: '#1E1E1E',
    color: '#D4D4D4',
    padding: 8,
    borderRadius: 6,
    marginVertical: 4,
  },
  blockquote: {
    backgroundColor: '#EFEFF4',
    borderLeftColor: '#5856D6',
    borderLeftWidth: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginVertical: 4,
  },
  table: { borderColor: '#ccc', borderWidth: 1 },
  th: { padding: 4, backgroundColor: '#F2F2F7', fontWeight: '600' },
  td: { padding: 4 },
  tr: { borderBottomColor: '#ccc', borderBottomWidth: 1 },
  hr: { backgroundColor: '#ccc', height: 1, marginVertical: 6 },
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    marginVertical: 4,
    paddingHorizontal: 12,
  },
  right: { justifyContent: 'flex-end' },
  left: { justifyContent: 'flex-start' },
  bubble: {
    maxWidth: '80%',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  user: { backgroundColor: '#5856D6' },
  assistant: {
    backgroundColor: '#F2F2F7',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E7EA',
  },
  text: { fontSize: 15, lineHeight: 20 },
  userText: { color: '#fff' },
  assistantText: { color: '#000' },
  cursor: { color: '#999' },
  markdownWrap: { alignSelf: 'flex-start' },
});
