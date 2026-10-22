import React, { useEffect, useRef, useState, useLayoutEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ScrollView,
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
import UpdateConfirmCard from '../components/agent/UpdateConfirmCard';
import ImageAttachment from '../components/agent/ImageAttachment';
import { streamChat, agentApi } from '../utils/agentApi';
import { getAgentChatState, setAgentChatState } from '../utils/sessionStorage';
import { getServerRuntime, isCurrentRuntime } from '../utils/serverRuntime';
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
const { restoreConversationMessages } = require('../utils/agentConversationCore.cjs');

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
  const [conversations, setConversations] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [retryMessage, setRetryMessage] = useState(null);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const listRef = useRef(null);
  const convIdRef = useRef(route?.params?.conversationId || null);
  const cancelledRef = useRef(false);
  const currentDraftRef = useRef('');
  const conversationLoadRef = useRef(0);

  const saveLocalState = useCallback((conversationId, draft = currentDraftRef.current) => {
    const captured = getServerRuntime();
    if (captured && user?.id) setAgentChatState(captured, user.id, { conversationId, draft }).catch(() => {});
  }, [user?.id]);

  const showConversation = useCallback(async (id, captured, active = () => true) => {
    const loadId = ++conversationLoadRef.current;
    const detail = await agentApi.getConversation(id);
    if (!active() || !isCurrentRuntime(captured) || loadId !== conversationLoadRef.current) return false;
    const restored = restoreConversationMessages(detail.messages || []);
    convIdRef.current = id;
    setMessages(restored.messages);
    setRetryMessage(restored.retryMessage);
    setShowHistory(false);
    saveLocalState(id);
    return true;
  }, [saveLocalState]);

  useEffect(() => {
    let active = true;
    conversationLoadRef.current += 1;
    const captured = getServerRuntime();
    convIdRef.current = route?.params?.conversationId || null;
    setMessages([]);
    setRetryMessage(null);
    setLoadingHistory(true);
    setHistoryError('');
    (async () => {
      try {
        const [local, result] = await Promise.all([
          getAgentChatState(captured, user?.id), agentApi.listConversations(),
        ]);
        if (!active || !isCurrentRuntime(captured)) return;
        const items = result?.items || [];
        setConversations(items);
        const savedDraft = local?.draft || '';
        currentDraftRef.current = savedDraft;
        setInput(savedDraft);
        const requestedId = route?.params?.conversationId || local?.conversationId;
        const chosen = items.find(item => item.id === requestedId) || items[0];
        if (chosen) await showConversation(chosen.id, captured, () => active);
      } catch (error) {
        if (active && isCurrentRuntime(captured)) setHistoryError(error?.message || '读取历史对话失败');
      } finally {
        if (active && isCurrentRuntime(captured)) setLoadingHistory(false);
      }
    })();
    return () => { active = false; };
  }, [user?.id, route?.params?.conversationId, showConversation]);

  const openConversation = async (id) => {
    try {
      await showConversation(id, getServerRuntime());
    } catch (error) {
      Alert.alert('打开失败', error?.message || '读取对话失败');
    }
  };

  const startNewConversation = () => {
    conversationLoadRef.current += 1;
    convIdRef.current = null;
    setMessages([]);
    setRetryMessage(null);
    setShowHistory(false);
    setPendingDeleteId(null);
    saveLocalState(null);
  };

  const deleteConversation = async (id) => {
    if (pendingDeleteId !== id) { setPendingDeleteId(id); return; }
    try {
      await agentApi.deleteConversation(id);
      const remaining = conversations.filter(item => item.id !== id);
      setConversations(remaining);
      setPendingDeleteId(null);
      if (convIdRef.current === id) {
        if (remaining.length) await openConversation(remaining[0].id);
        else startNewConversation();
      }
    } catch (error) {
      Alert.alert('删除失败', error?.message || '删除对话失败');
    }
  };

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

  const send = async ({ retryMessageId = null } = {}) => {
    const retrying = Boolean(retryMessageId);
    if (retrying && retryMessage?.hasImages) {
      Alert.alert('无法重试图片', '请重新选择图片并发起新问题');
      return;
    }
    const text = retrying ? retryMessage?.text : input.trim();
    const sendImages = retrying ? [] : images;
    if (!canSendDraft(text, sendImages) || sending || preparingImages) return;
    const messageCountBeforeSend = messages.length;

    setSending(true);
    setPreparingImages(true);
    cancelledRef.current = false;

    const snapshot = { text, images: sendImages };

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
    if (!retrying) appendMessage({
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
        retryMessageId,
        images: preparedImages,
        onEvent: (event, data) => {
          if (cancelledRef.current) return;

          if (event === 'accepted') {
            if (data?.conversationId) {
              convIdRef.current = data.conversationId;
              saveLocalState(data.conversationId);
            }
          } else if (event === 'delta') {
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
          } else if (event === 'update_proposal') {
            appendMessage({ proposal: data?.proposal || data });
          } else if (event === 'done') {
            if (data?.conversationId) {
              convIdRef.current = data.conversationId;
            }
            updateLastAssistant({ isStreaming: false });
          } else if (event === 'error') {
            const msg = data?.message || '未知错误';
            Alert.alert('出错', msg);
          }
        },
      });
      if (result?.terminalEvent === 'done') {
        if (!retrying) {
          setInput('');
          currentDraftRef.current = '';
          setImages([]);
        }
        setRetryMessage(null);
        saveLocalState(convIdRef.current, currentDraftRef.current);
        agentApi.listConversations().then(result => setConversations(result?.items || [])).catch(() => {});
      } else {
        const captured = getServerRuntime();
        const result = await agentApi.listConversations();
        const items = result?.items || [];
        setConversations(items);
        const chosen = items.find(item => item.id === convIdRef.current) || items[0];
        if (chosen) await showConversation(chosen.id, captured);
        else setMessages(current => current.slice(0, messageCountBeforeSend));
      }
    } catch (err) {
      Alert.alert('发送失败', err?.message || String(err));
      try {
        const captured = getServerRuntime();
        const result = await agentApi.listConversations();
        const items = result?.items || [];
        setConversations(items);
        const chosen = items.find(item => item.id === convIdRef.current) || items[0];
        if (chosen) await showConversation(chosen.id, captured);
        else setMessages(current => current.slice(0, messageCountBeforeSend));
      } catch (_) {
        setMessages(current => current.slice(0, messageCountBeforeSend));
      }
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

  const onConfirmUpdate = async (proposal) => {
    try {
      await agentApi.confirmUpdate(proposal);
      setMessages((prev) => prev.filter((item) => item.proposal !== proposal));
      appendMessage({ role: 'assistant', text: `${{ orders: '订单', models: '模型', materials: '耗材' }[proposal.entity]} #${proposal.id} 已更新。` });
    } catch (error) {
      Alert.alert('修改失败', error?.message || String(error));
    }
  };

  const renderItem = ({ item }) => {
    if (item.proposal) return <UpdateConfirmCard
      proposal={item.proposal}
      onConfirm={allowWrite ? onConfirmUpdate : undefined}
      onCancel={() => setMessages((prev) => prev.filter((entry) => entry.id !== item.id))}
    />;
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
      <View style={styles.historyBar}>
        <TouchableOpacity onPress={() => setShowHistory(value => !value)} style={styles.historyAction}>
          <Text style={styles.historyActionText}>历史对话</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={startNewConversation} style={styles.historyAction} disabled={sending}>
          <Text style={styles.historyActionText}>新对话</Text>
        </TouchableOpacity>
      </View>
      {showHistory ? <ScrollView style={styles.historyList}>
        {loadingHistory ? <Text style={styles.historyHint}>正在读取历史对话…</Text> : null}
        {historyError ? <Text style={styles.historyHint}>{historyError}</Text> : null}
        {!loadingHistory && conversations.length === 0 ? <Text style={styles.historyHint}>暂无历史对话</Text> : null}
        {conversations.map(conversation => <View key={conversation.id} style={styles.historyRow}>
          <TouchableOpacity style={styles.historyTitle} disabled={sending} onPress={() => openConversation(conversation.id)}>
            <Text style={styles.historyTitleText} numberOfLines={1}>{conversation.title || '未命名对话'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => deleteConversation(conversation.id)} disabled={sending} style={styles.historyDelete}>
            <Text style={styles.historyDeleteText}>{pendingDeleteId === conversation.id ? '确认删除' : '删除'}</Text>
          </TouchableOpacity>
        </View>)}
      </ScrollView> : null}
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
      {retryMessage ? <View style={styles.retryBar}>
        <Text style={styles.retryText}>{retryMessage.hasImages
          ? '上次图片回复已中断，请重新选择图片并发起新问题。'
          : '上次回复已中断，原问题已保存。'}</Text>
        {!retryMessage.hasImages ? <TouchableOpacity
          disabled={sending || preparingImages}
          onPress={() => send({ retryMessageId: retryMessage.id })}
          style={styles.retryAction}
        ><Text style={styles.retryActionText}>重试回复</Text></TouchableOpacity> : null}
      </View> : null}
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
          onChangeText={(value) => {
            currentDraftRef.current = value;
            setInput(value);
            saveLocalState(convIdRef.current, value);
          }}
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
  historyBar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  historyAction: { paddingHorizontal: 10, paddingVertical: 5 },
  historyActionText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
  historyList: { maxHeight: 240, backgroundColor: colors.surfaceElevated },
  historyHint: { color: colors.textSecondary, padding: 14 },
  historyRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  historyTitle: { flex: 1, paddingVertical: 12 },
  historyTitleText: { color: colors.text, fontSize: 14 },
  historyDelete: { paddingHorizontal: 10, paddingVertical: 10 },
  historyDeleteText: { color: colors.danger, fontSize: 13 },
  retryBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.surfaceMuted },
  retryText: { flex: 1, color: colors.textSecondary, fontSize: 12 },
  retryAction: { paddingHorizontal: 10, paddingVertical: 6 },
  retryActionText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
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
