import React, { useEffect, useRef, useState, useLayoutEffect, useCallback } from 'react';
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
import AgentBubble from '../components/agent/AgentBubble';
import ToolCallCard from '../components/agent/ToolCallCard';
import DraftConfirmCard from '../components/agent/DraftConfirmCard';
import ImageAttachment from '../components/agent/ImageAttachment';
import { streamChat, agentApi } from '../utils/agentApi';

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
          <Text style={{ fontSize: 20 }}>⚙️</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

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
            <Text style={styles.emptyIcon}>✨</Text>
            <Text style={styles.emptyText}>
              你好，我是 3D-Manage 智能助手。{'\n'}
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
          placeholderTextColor="#9CA3AF"
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  listContent: { paddingVertical: 8, flexGrow: 1 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 80,
  },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E5EA',
    backgroundColor: '#fff',
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#F2F2F7',
    borderRadius: 8,
    fontSize: 15,
    color: '#000',
  },
  sendBtn: {
    backgroundColor: '#5856D6',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    marginLeft: 8,
    minWidth: 56,
    alignItems: 'center',
  },
  sendBtnDisabled: { opacity: 0.5 },
  sendText: { color: '#fff', fontWeight: '600', fontSize: 14 },
});
