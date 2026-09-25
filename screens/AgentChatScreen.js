import React, { useEffect, useRef, useState, useLayoutEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  KeyboardAvoidingView as KeyboardControllerAvoidingView,
  useWindowDimensions as useControllerWindowDimensions,
} from 'react-native-keyboard-controller';
import AgentBubble from '../components/agent/AgentBubble';
import ToolCallCard from '../components/agent/ToolCallCard';
import DraftConfirmCard from '../components/agent/DraftConfirmCard';
import ImageAttachment from '../components/agent/ImageAttachment';
import { streamChat, agentApi } from '../utils/agentApi';
import { useAppTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { canWrite } from '../utils/permissions';
import { XiaoliBrandMark } from '../components';
import {
  appendImages,
  canSendDraft,
  imageOnlyBubbleText,
  prepareAgentImages,
  removeImage,
} from '../utils/agentImage';
const {
  COMPOSER_LINE_HEIGHT,
  COMPOSER_VERTICAL_PADDING,
  COMPOSER_MAX_HEIGHT,
} = require('../utils/agentComposerLayoutCore.cjs');
const { getKeyboardVerticalOffset } = require('../utils/agentKeyboardOffsetCore.cjs');

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
  const { user } = useAuth();
  const allowWrite = canWrite(user);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { height: controllerWindowHeight } = useControllerWindowDimensions();
  const [avoidingLayout, setAvoidingLayout] = useState(null);
  const keyboardVerticalOffset = getKeyboardVerticalOffset(controllerWindowHeight, avoidingLayout);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [images, setImages] = useState([]);
  const [sending, setSending] = useState(false);
  const [preparingImages, setPreparingImages] = useState(false);
  const listRef = useRef(null);
  const convIdRef = useRef(route?.params?.conversationId || null);
  const cancelledRef = useRef(false);

  const recordAvoidingLayout = useCallback(({ nativeEvent: { layout } }) => {
    const next = { y: layout.y, height: layout.height };
    setAvoidingLayout((current) => current?.y === next.y && current?.height === next.height ? current : next);
  }, []);

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

  const send = async () => {
    const text = input.trim();
    if (!canSendDraft(text, images) || sending || preparingImages) return;
    const messageCountBeforeSend = messages.length;

    setSending(true);
    setPreparingImages(true);
    cancelledRef.current = false;

    const snapshot = { text, images };

    let preparedImages;
    try {
      preparedImages = await prepareAgentImages(snapshot.images);
    } catch (error) {
      Alert.alert('读取图片失败', error?.message || String(error));
      setPreparingImages(false);
      setSending(false);
      return;
    }
    setPreparingImages(false);

    // 1) Optimistic user bubble.
    appendMessage({
      role: 'user',
      text: snapshot.text || imageOnlyBubbleText(snapshot.images.length),
    });
    // 2) Empty streaming assistant bubble that deltas will fill in.
    appendMessage({ role: 'assistant', text: '', isStreaming: true });

    const toolMap = new Map(); // name|args-key → message id

    try {
      const result = await streamChat({
        message: snapshot.text,
        conversationId: convIdRef.current,
        images: preparedImages,
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
            setMessages((current) => current.slice(0, messageCountBeforeSend));
            Alert.alert('出错', msg);
          }
        },
      });
      if (result?.terminalEvent === 'done') {
        setInput('');
        setImages([]);
      }
    } catch (err) {
      Alert.alert('发送失败', err?.message || String(err));
      setMessages((current) => current.slice(0, messageCountBeforeSend));
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
          onConfirm={allowWrite ? onConfirmDraft : undefined}
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
    <KeyboardControllerAvoidingView
      style={styles.container}
      behavior="padding"
      keyboardVerticalOffset={keyboardVerticalOffset}
      onLayout={recordAvoidingLayout}
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
              <XiaoliBrandMark size={104} showBadge />
            </View>
            <Text style={styles.emptyTitle}>小鲤已就位</Text>
            <Text style={styles.emptyText}>
              你好，我是猫爪工坊助手小鲤。{'\n'}
              粘贴客户消息 → 抽取订单草稿{'\n'}
              或直接问我关于订单、模型、库存的问题
            </Text>
          </View>
        }
      />
      <ImageAttachment
        images={images}
        disabled={sending || preparingImages}
        onAdd={(picked) => {
          try {
            setImages((current) => appendImages(current, picked));
          } catch (error) {
            Alert.alert('无法添加图片', error?.message || String(error));
          }
        }}
        onRemove={(id) => setImages((current) => removeImage(current, id))}
      />
      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="问我关于订单/模型/库存的问题…"
          placeholderTextColor={colors.textTertiary}
          multiline
          scrollEnabled
          textAlignVertical="top"
          editable={!sending && !preparingImages}
          onSubmitEditing={send}
          blurOnSubmit={false}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (sending || preparingImages || !canSendDraft(input, images)) && styles.sendBtnDisabled]}
          onPress={send}
          disabled={sending || preparingImages || !canSendDraft(input, images)}
          activeOpacity={0.85}
        >
          <Text style={styles.sendText}>{preparingImages ? '读取中…' : sending ? '…' : '发送'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardControllerAvoidingView>
  );
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
    height: 116,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
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
    maxHeight: COMPOSER_MAX_HEIGHT,
    paddingHorizontal: 10,
    paddingVertical: COMPOSER_VERTICAL_PADDING / 2,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 16,
    fontSize: 15,
    lineHeight: COMPOSER_LINE_HEIGHT,
    includeFontPadding: false,
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
