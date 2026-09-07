import React, { useEffect, useRef, useState, useLayoutEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AgentBubble from '../components/agent/AgentBubble';
import ToolCallCard from '../components/agent/ToolCallCard';
import DraftConfirmCard from '../components/agent/DraftConfirmCard';
import ImageAttachment from '../components/agent/ImageAttachment';
import { streamChat, agentApi } from '../utils/agentApi';
import { useAppTheme } from '../context/ThemeContext';

// Full-screen Agent chat.
//
// State model:
//   - messages: an ordered list of items where each item is one of:
//       { id, role: 'user' | 'assistant', text, isStreaming? }
//       { id, toolCall: { name, args, result? } }
//       { id, draft: <object from backend> }
//   - input:    current composer text
//   - images:   pending image attachments (not yet sent)
//   - sending:  disables the send button while a stream is in flight
//
// SSE event handling: streamChat invokes onEvent(name, data). We map
// each event into state mutations:
//   - 'delta'       → append text to the last assistant bubble
//   - 'tool_call'   → push a ToolCallCard
//   - 'tool_result' → update the matching ToolCallCard
//   - 'draft'       → push a DraftConfirmCard
//   - 'done'        → finalize (save conversationId, mark stream over)
//   - 'error'       → surface in the last assistant bubble + Alert

export default function AgentChatScreen({ route, navigation }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [images, setImages] = useState([]);
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);
  const convIdRef = useRef(route?.params?.conversationId || null);
  const cancelledRef = useRef(false);

  // Header: settings shortcut (right side).
  useLayoutEffect(() => {
    navigation?.setOptions?.({
      title: 'AI 助手',
      headerRight: () => (
        <TouchableOpacity
          onPress={() => navigation?.navigate?.('AgentSettings')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{ paddingHorizontal: 4 }}
        >
          <Ionicons name="settings-outline" size={22} color={colors.primary} />
        </TouchableOpacity>
      ),
    });
  }, [colors.primary, navigation]);

  // Auto-scroll to the bottom when messages grow.
  useEffect(() => {
    if (messages.length === 0) return;
    const t = setTimeout(() => {
      try {
        listRef.current?.scrollToEnd?.({ animated: true });
      } catch (_) { /* ignore */ }
    }, 50);
    return () => clearTimeout(t);
  }, [messages.length]);

  const appendMessage = useCallback((m) => {
    setMessages((prev) => [...prev, { id: `${Date.now()}-${prev.length}`, ...m }]);
  }, []);

  const updateLastAssistant = useCallback((patch) => {
    setMessages((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i -= 1) {
        if (next[i] && next[i].role === 'assistant') {
          next[i] = { ...next[i], ...patch };
          break;
        }
      }
      return next;
    });
  }, []);

  const onImageChange = useCallback((img, list) => {
    if (Array.isArray(list)) {
      setImages(list);
    } else if (img) {
      setImages((prev) => [...prev, img]);
    }
  }, []);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;

    setSending(true);
    cancelledRef.current = false;

    const userText = text;
    const userImgs = images;
    setInput('');
    setImages([]);

    // 1) Optimistic user bubble.
    appendMessage({ role: 'user', text: userText });
    // 2) Empty streaming assistant bubble that deltas will fill in.
    appendMessage({ role: 'assistant', text: '', isStreaming: true });

    const toolMap = new Map(); // name|args-key → message id

    try {
      await streamChat({
        message: userText,
        conversationId: convIdRef.current,
        images: userImgs.map((i) => ({ dataUrl: i.dataUrl, name: i.name, mimeType: i.mimeType })),
        onEvent: (event, data) => {
          if (cancelledRef.current) return;

          if (event === 'delta') {
            const piece = (data && (data.text || data.content)) || '';
            setMessages((prev) => {
              const next = [...prev];
              for (let i = next.length - 1; i >= 0; i -= 1) {
                if (next[i] && next[i].role === 'assistant') {
                  next[i] = { ...next[i], text: (next[i].text || '') + piece };
                  break;
                }
              }
              return next;
            });
          } else if (event === 'tool_call') {
            const name = data?.name || 'tool';
            const args = data?.arguments || data?.args || {};
            const key = `${name}:${JSON.stringify(args)}`;
            const id = `${Date.now()}-tool-${Math.random().toString(36).slice(2, 6)}`;
            toolMap.set(key, id);
            appendMessage({ id, toolCall: { name, args, result: null } });
          } else if (event === 'tool_result') {
            // Best-effort: update the LAST tool card (the server doesn't
            // currently echo a key, so we assume results arrive in order).
            setMessages((prev) => {
              const next = [...prev];
              for (let i = next.length - 1; i >= 0; i -= 1) {
                if (next[i] && next[i].toolCall && !next[i].toolCall.result) {
                  next[i] = {
                    ...next[i],
                    toolCall: { ...next[i].toolCall, result: data?.result ?? data },
                  };
                  break;
                }
              }
              return next;
            });
          } else if (event === 'draft') {
            appendMessage({ draft: data?.draft || data });
          } else if (event === 'done') {
            if (data?.conversationId) {
              convIdRef.current = data.conversationId;
            }
            updateLastAssistant({ isStreaming: false });
          } else if (event === 'error') {
            const msg = data?.message || '未知错误';
            updateLastAssistant({
              text: (existingText(messages) || '') + (existingText(messages) ? '\n' : '') + `[错误] ${msg}`,
              isStreaming: false,
            });
            Alert.alert('出错', msg);
          }
        },
      });
    } catch (err) {
      Alert.alert('发送失败', err?.message || String(err));
      updateLastAssistant({ isStreaming: false });
    } finally {
      setSending(false);
    }
  };

  const onConfirmDraft = async (draft) => {
    try {
      const res = await agentApi.confirmDraft(draft);
      const orderId = res?.order?.id ?? res?.id ?? '(未知)';
      Alert.alert('已创建', `订单 #${orderId} 已创建`);
      // Drop all draft messages from the view.
      setMessages((prev) => prev.filter((m) => !m.draft));
    } catch (err) {
      Alert.alert('创建失败', err?.message || String(err));
    }
  };

  const onCancelDraft = () => {
    setMessages((prev) => prev.filter((m) => !m.draft));
  };

  const renderItem = ({ item }) => {
    if (item.toolCall) {
      return (
        <ToolCallCard
          name={item.toolCall.name}
          args={item.toolCall.args}
          result={item.toolCall.result}
        />
      );
    }
    if (item.draft) {
      return (
        <DraftConfirmCard
          draft={item.draft}
          onConfirm={onConfirmDraft}
          onCancel={onCancelDraft}
        />
      );
    }
    return (
      <AgentBubble
        role={item.role}
        text={item.text}
        isStreaming={item.isStreaming}
      />
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.mascot}>
              <Text style={styles.catFace}>ฅ^•ﻌ•^ฅ</Text>
              <View style={styles.mascotBadge}>
                <Ionicons name="sparkles" size={14} color={colors.onPrimary} />
              </View>
            </View>
            <Text style={styles.emptyTitle}>小麦已就位</Text>
            <Text style={styles.emptyText}>
              你好，我是猫爪工坊助手小麦。{'\n'}
              粘贴客户消息 → 抽取订单草稿{'\n'}
              或直接问我关于订单、模型、库存的问题
            </Text>
          </View>
        }
      />
      <ImageAttachment onAttach={onImageChange} />
      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="问我关于订单/模型/库存的问题…"
          placeholderTextColor={colors.textTertiary}
          multiline
          editable={!sending}
          onSubmitEditing={send}
          blurOnSubmit={false}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (sending || !input.trim()) && styles.sendBtnDisabled]}
          onPress={send}
          disabled={sending || !input.trim()}
          activeOpacity={0.85}
        >
          <Text style={styles.sendText}>{sending ? '…' : '发送'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// Helper: read the latest assistant text outside of setState
// (used inside the 'error' branch above where messages is the
//  stale closure value).
function existingText(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i] && messages[i].role === 'assistant') {
      return messages[i].text || '';
    }
  }
  return '';
}

const createStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  listContent: { paddingVertical: 8, flexGrow: 1 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 80,
  },
  mascot: {
    width: 116,
    height: 92,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 32,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 14,
  },
  catFace: { fontSize: 25, color: colors.primaryDark },
  mascotBadge: {
    position: 'absolute',
    right: -5,
    bottom: -5,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderWidth: 3,
    borderColor: colors.background,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 6 },
  emptyText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 16,
    fontSize: 15,
    color: colors.text,
  },
  sendBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 16,
    marginLeft: 8,
    minWidth: 56,
    alignItems: 'center',
  },
  sendBtnDisabled: { opacity: 0.5 },
  sendText: { color: colors.onPrimary, fontWeight: '700', fontSize: 14 },
});
