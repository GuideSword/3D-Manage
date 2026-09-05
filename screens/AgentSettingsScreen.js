import React, { useState, useLayoutEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Linking,
} from 'react-native';
import { agentApi } from '../utils/agentApi';

// API Key settings page (BYOK = Bring Your Own Key).
//
// Two sections:
//   1. Chat LLM (OpenAI-compatible protocol only for now).
//      - Base URL, API Key, Model name
//      - "Test connection" button hits GET /agent/keys/test
//   2. Embedding (MiniMax embo-01, MiniMax-specific protocol).
//      - Group ID is mandatory because the MiniMax embedding endpoint
//        requires it as a URL query param. API Key is shared with chat.
//
// Note: "MiniMax protocol" here refers to the embedding endpoint's custom
// request shape (`{ texts, type }` + GroupId query), not a "search service".
// MiniMax has no search model — semantic search is implemented client-side
// on top of embo-01 vectors (cosine similarity in Node).

// Default base URL. Two valid MiniMax regions:
//   - International: https://api.minimax.io/v1
//   - China:         https://api.minimaxi.com/v1
// Default to China (most users in this project are CN-based).
const DEFAULT_BASE_URL = 'https://api.minimaxi.com/v1';

export default function AgentSettingsScreen({ navigation }) {
  const [llmBaseUrl, setLlmBaseUrl] = useState(DEFAULT_BASE_URL);
  const [llmApiKey, setLlmApiKey] = useState('');
  const [llmModel, setLlmModel] = useState('MiniMax-M3');
  const [embedGroupId, setEmbedGroupId] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useLayoutEffect(() => {
    navigation?.setOptions?.({ title: 'AI 服务设置' });
  }, [navigation]);

  const save = async () => {
    if (!llmApiKey.trim()) {
      Alert.alert('错误', 'API Key 不能为空');
      return;
    }
    if (!embedGroupId.trim()) {
      Alert.alert('错误', 'Group ID 不能为空（Embedding 必需）');
      return;
    }
    setSaving(true);
    try {
      await agentApi.saveSettings({
        llm_provider: 'openai_compat',
        llm_base_url: llmBaseUrl.trim(),
        llm_api_key: llmApiKey.trim(),
        llm_model: llmModel.trim(),
        embed_base_url: llmBaseUrl.trim(),
        embed_api_key: llmApiKey.trim(),
        embed_model: 'embo-01',
        embed_group_id: embedGroupId.trim(),
      });
      Alert.alert('已保存', 'AI 服务设置已保存');
    } catch (err) {
      Alert.alert('保存失败', err?.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      // Save first so the backend has the latest keys to test against.
      if (llmApiKey.trim() && embedGroupId.trim()) {
        try {
          await agentApi.saveSettings({
            llm_provider: 'openai_compat',
            llm_base_url: llmBaseUrl.trim(),
            llm_api_key: llmApiKey.trim(),
            llm_model: llmModel.trim(),
            embed_base_url: llmBaseUrl.trim(),
            embed_api_key: llmApiKey.trim(),
            embed_model: 'embo-01',
            embed_group_id: embedGroupId.trim(),
          });
        } catch (e) {
          // Ignore save errors here — test will surface them anyway.
        }
      }

      const res = await agentApi.testConnection();
      const llmLine = res?.llm?.ok
        ? `✅ LLM：连接成功（模型：${res.llm.model || '未知'}，返回："${res.llm.reply || ''}"）`
        : `❌ LLM：${res?.llm?.error || '失败'}${res?.llm?.status ? ` [HTTP ${res.llm.status}]` : ''}`;
      const embedLine = res?.embed?.ok
        ? `✅ Embedding：连接成功（维度：${res.embed.dim}）`
        : res?.embed?.error
          ? `❌ Embedding：${res.embed.error}${res?.embed?.status ? ` [HTTP ${res.embed.status}]` : ''}`
          : '⚠️ Embedding：未配置';
      const urlLine = `Base URL：${res?.base_url || llmBaseUrl}`;

      Alert.alert(
        res?.ok ? '✅ LLM 连接成功' : '❌ LLM 连接失败',
        `${urlLine}\n\n${llmLine}\n${embedLine}`
      );
    } catch (err) {
      Alert.alert('❌ 测试失败', err?.message || String(err));
    } finally {
      setTesting(false);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.section}>🤖 聊天大模型（OpenAI 兼容协议）</Text>
      <Field label="协议格式" value="OpenAI 协议（当前唯一）" editable={false} />
      <Field label="Base URL" value={llmBaseUrl} onChange={setLlmBaseUrl} />
      <Field
        label="模型名"
        value={llmModel}
        onChange={setLlmModel}
        placeholder="例如 MiniMax-M3"
      />

      {/* API Key with show/hide toggle */}
      <View style={styles.field}>
        <Text style={styles.label}>API Key</Text>
        <View style={styles.inputRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={llmApiKey}
            onChangeText={setLlmApiKey}
            secureTextEntry={!showApiKey}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="sk-... 或 eyJ..."
            placeholderTextColor="#9CA3AF"
          />
          <TouchableOpacity
            onPress={() => setShowApiKey(!showApiKey)}
            style={styles.eyeBtn}
            activeOpacity={0.7}
            accessibilityLabel={showApiKey ? '隐藏 API Key' : '显示 API Key'}
          >
            <Text style={styles.eyeText}>{showApiKey ? '🙈' : '👁'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.btn, testing && styles.btnDisabled]}
        onPress={test}
        disabled={testing}
        activeOpacity={0.85}
      >
        <Text style={styles.btnText}>{testing ? '测试中…' : '🔌 测试连接'}</Text>
      </TouchableOpacity>

      <Text style={[styles.section, { marginTop: 24 }]}>📊 Embedding（MiniMax embo-01）</Text>
      <Field
        label="Group ID（必填）"
        value={embedGroupId}
        onChange={setEmbedGroupId}
        placeholder="例如 1234567890"
      />
      <Text style={styles.hint}>
        语义搜索基于 MiniMax 的 Embedding 模型 embo-01（输出 1536 维向量）。
        MiniMax 的 Embedding 端点使用专有协议（URL 上必须带 GroupId，请求体用 texts/type 而非 input），
        所以需要单独填 Group ID。聊天和 Embedding 共用上面填的 API Key。
      </Text>

      <TouchableOpacity
        style={[styles.btn, styles.primary, saving && styles.btnDisabled]}
        onPress={save}
        disabled={saving}
        activeOpacity={0.85}
      >
        <Text style={[styles.btnText, styles.primaryBtnText]}>
          {saving ? '保存中…' : '💾 保存'}
        </Text>
      </TouchableOpacity>

      <View style={styles.warning}>
        <Text style={styles.warningTitle}>⚠️ 说明</Text>
        <Text style={styles.warningText}>• 聊天：OpenAI 兼容协议（任意兼容厂商：MiniMax / DeepSeek / Qwen 等）</Text>
        <Text style={styles.warningText}>• Embedding：仅 MiniMax 协议（embo-01）</Text>
        <Text style={styles.warningText}>• Base URL 国内用 api.minimaxi.com，国际用 api.minimax.io</Text>
        <Text style={styles.warningText}>• 不知道 Group ID？去 MiniMax 控制台 → API Keys 页面查看</Text>
        <TouchableOpacity
          onPress={() => Linking.openURL('https://platform.minimax.io/user-center/basic-information/interface-key')}
        >
          <Text style={[styles.warningText, styles.link]}>👉 打开 MiniMax 控制台获取 API Key + Group ID</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function Field({ label, value, onChange, editable = true, placeholder }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, !editable && styles.inputDisabled]}
        value={value != null ? String(value) : ''}
        onChangeText={onChange}
        editable={editable}
        placeholder={placeholder || ''}
        placeholderTextColor="#9CA3AF"
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16, paddingBottom: 48 },
  section: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    color: '#111827',
  },
  field: { marginBottom: 12 },
  label: { fontSize: 13, color: '#4B5563', marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    backgroundColor: '#fff',
    color: '#111827',
  },
  inputDisabled: { backgroundColor: '#F3F4F6', color: '#6B7280' },
  inputRow: { flexDirection: 'row', alignItems: 'center' },
  eyeBtn: {
    marginLeft: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 6,
    backgroundColor: '#F9FAFB',
  },
  eyeText: { fontSize: 16 },
  btn: {
    backgroundColor: '#F2F2F7',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#5856D6', fontWeight: '600', fontSize: 14 },
  primary: { backgroundColor: '#5856D6', marginTop: 24 },
  primaryBtnText: { color: '#fff' },
  hint: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
    lineHeight: 17,
  },
  warning: {
    backgroundColor: '#FFF8E1',
    padding: 12,
    borderRadius: 8,
    marginTop: 24,
  },
  warningTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
    color: '#5D4037',
  },
  warningText: { fontSize: 12, color: '#5D4037', lineHeight: 18 },
  link: { color: '#2563EB', textDecorationLine: 'underline', marginTop: 4 },
});
