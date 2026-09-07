import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { useAppTheme } from '../../context/ThemeContext';

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
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const markdownStyles = useMemo(() => createMarkdownStyles(colors), [colors]);
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
const createMarkdownStyles = (colors) => ({
  body: { color: colors.text, fontSize: 15, lineHeight: 22 },
  heading1: { fontSize: 20, fontWeight: '700', marginVertical: 6, color: colors.text },
  heading2: { fontSize: 18, fontWeight: '700', marginVertical: 5, color: colors.text },
  heading3: { fontSize: 16, fontWeight: '600', marginVertical: 4, color: colors.text },
  strong: { fontWeight: '700', color: colors.text },
  em: { fontStyle: 'italic', color: colors.text },
  link: { color: colors.primary, textDecorationLine: 'underline' },
  bullet_list: { marginVertical: 4 },
  ordered_list: { marginVertical: 4 },
  list_item: { marginVertical: 2 },
  code_inline: {
    fontFamily: monoFont,
    fontSize: 13,
    backgroundColor: colors.surface,
    color: colors.danger,
    paddingHorizontal: 4,
    borderRadius: 3,
  },
  code_block: {
    fontFamily: monoFont,
    fontSize: 13,
    backgroundColor: colors.dark,
    color: colors.light,
    padding: 8,
    borderRadius: 6,
    marginVertical: 4,
  },
  fence: {
    fontFamily: monoFont,
    fontSize: 13,
    backgroundColor: colors.dark,
    color: colors.light,
    padding: 8,
    borderRadius: 6,
    marginVertical: 4,
  },
  blockquote: {
    backgroundColor: colors.surfaceMuted,
    borderLeftColor: colors.primary,
    borderLeftWidth: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginVertical: 4,
  },
  table: { borderColor: colors.border, borderWidth: 1 },
  th: { padding: 4, backgroundColor: colors.surface, fontWeight: '600' },
  td: { padding: 4 },
  tr: { borderBottomColor: colors.border, borderBottomWidth: 1 },
  hr: { backgroundColor: colors.border, height: 1, marginVertical: 6 },
});

const createStyles = (colors) => StyleSheet.create({
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
    borderRadius: 18,
  },
  user: { backgroundColor: colors.primary },
  assistant: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  text: { fontSize: 15, lineHeight: 20 },
  userText: { color: colors.onPrimary },
  assistantText: { color: colors.text },
  cursor: { color: colors.primary },
  markdownWrap: { alignSelf: 'flex-start' },
});
