import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { agentApi } from '../utils/agentApi';
import { useAppTheme } from '../context/ThemeContext';

const DEFAULT_LLM_URL = 'https://api.minimaxi.com/v1';
const DEFAULT_EMBED_URL = 'https://api.minimaxi.com/v1';

const emptyLlm = {
  provider: 'openai_compat',
  baseUrl: DEFAULT_LLM_URL,
  model: 'MiniMax-M3',
  apiKey: '',
  apiKeyConfigured: false,
  visionStatus: 'untested',
};

const emptyEmbedding = {
  enabled: false,
  baseUrl: DEFAULT_EMBED_URL,
  model: 'embo-01',
  groupId: '',
  apiKey: '',
  apiKeyConfigured: false,
  index: null,
};

function visionLabel(status) {
  if (status === 'vision') return '支持图片';
  if (status === 'text_only') return '仅支持文本';
  if (status === 'error') return '图片验证失败';
  return '图片能力待验证';
}

export default function AgentSettingsScreen({ navigation }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [llm, setLlm] = useState(emptyLlm);
  const [embedding, setEmbedding] = useState(emptyEmbedding);
  const [editing, setEditing] = useState('llm');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [showKey, setShowKey] = useState({ llm: false, embedding: false });
  const [lastTests, setLastTests] = useState(null);

  useLayoutEffect(() => {
    navigation?.setOptions?.({ title: 'AI 服务设置' });
  }, [navigation]);

  const applyPublicSettings = (settings) => {
    const publicLlm = settings?.llm || {};
    const publicEmbedding = settings?.embedding || {};
    setLlm({
      ...emptyLlm,
      provider: publicLlm.provider || emptyLlm.provider,
      baseUrl: publicLlm.baseUrl || emptyLlm.baseUrl,
      model: publicLlm.model || emptyLlm.model,
      apiKey: '',
      apiKeyConfigured: Boolean(publicLlm.apiKeyConfigured),
      visionStatus: publicLlm.visionStatus || 'untested',
    });
    setEmbedding({
      ...emptyEmbedding,
      enabled: Boolean(publicEmbedding.enabled),
      baseUrl: publicEmbedding.baseUrl || emptyEmbedding.baseUrl,
      model: publicEmbedding.model || emptyEmbedding.model,
      groupId: publicEmbedding.groupId || '',
      apiKey: '',
      apiKeyConfigured: Boolean(publicEmbedding.apiKeyConfigured),
      index: publicEmbedding.index || null,
    });
    setEditing(settings?.configured ? null : 'llm');
  };

  useEffect(() => {
    let active = true;
    agentApi.getSettings()
      .then((result) => {
        if (active) applyPublicSettings(result?.settings);
      })
      .catch((error) => {
        if (active) Alert.alert('读取失败', error?.message || String(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const candidate = () => ({
    llm: {
      provider: llm.provider,
      baseUrl: llm.baseUrl.trim(),
      model: llm.model.trim(),
      ...(llm.apiKey.trim() ? { apiKey: llm.apiKey.trim() } : {}),
    },
    embedding: embedding.enabled
      ? {
          enabled: true,
          baseUrl: embedding.baseUrl.trim(),
          model: embedding.model.trim(),
          groupId: embedding.groupId.trim(),
          ...(embedding.apiKey.trim() ? { apiKey: embedding.apiKey.trim() } : {}),
        }
      : { enabled: false },
  });

  const testSettings = async () => {
    setBusy('test');
    try {
      const result = await agentApi.testSettings(candidate());
      setLastTests(result?.tests || null);
      const vision = visionLabel(result?.tests?.vision?.status);
      const embeddingLine = embedding.enabled
        ? (result?.tests?.embedding?.ok
            ? `Embedding 连接成功（${result.tests.embedding.dim || 0} 维）`
            : `Embedding 失败：${result?.tests?.embedding?.error || '未知错误'}`)
        : 'Embedding 未启用，不影响聊天';
      Alert.alert(
        result?.tests?.llm?.ok ? '大模型连接成功' : '大模型连接失败',
        `${vision}\n${embeddingLine}`,
      );
    } catch (error) {
      Alert.alert('测试失败', error?.message || String(error));
    } finally {
      setBusy('');
    }
  };

  const saveSettings = async () => {
    setBusy('save');
    try {
      const result = await agentApi.saveSettings(candidate());
      applyPublicSettings(result?.settings);
      setLastTests(result?.tests || null);
      setShowKey({ llm: false, embedding: false });
      Alert.alert('已保存', 'API Key 已安全保存，页面不会再次显示其内容。');
    } catch (error) {
      if (error?.data?.settings) applyPublicSettings(error.data.settings);
      Alert.alert('保存失败', error?.message || String(error));
    } finally {
      setBusy('');
    }
  };

  if (loading) {
    return <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View>;
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.intro}>
        大模型是聊天的必需配置；Embedding 是独立的可选能力，用于模型语义搜索和后续记忆检索。
      </Text>

      <ServiceCard
        styles={styles}
        colors={colors}
        icon="chatbubbles-outline"
        title="聊天大模型"
        status={llm.apiKeyConfigured ? `已配置 · ${visionLabel(llm.visionStatus)}` : '未配置'}
        editing={editing === 'llm'}
        onEdit={() => setEditing(editing === 'llm' ? null : 'llm')}
      >
        <Field styles={styles} colors={colors} label="Base URL" value={llm.baseUrl} onChange={(baseUrl) => setLlm((value) => ({ ...value, baseUrl }))} />
        <Field styles={styles} colors={colors} label="模型名" value={llm.model} onChange={(model) => setLlm((value) => ({ ...value, model }))} />
        <SecretField
          styles={styles}
          colors={colors}
          value={llm.apiKey}
          onChange={(apiKey) => setLlm((current) => ({ ...current, apiKey }))}
          configured={llm.apiKeyConfigured}
          visible={showKey.llm}
          onToggle={() => setShowKey((value) => ({ ...value, llm: !value.llm }))}
        />
        <Text style={styles.hint}>保存时系统会自动发送一张测试图，判断模型是否支持图片，不需要人工勾选。</Text>
      </ServiceCard>

      <ServiceCard
        styles={styles}
        colors={colors}
        icon="analytics-outline"
        title="Embedding · 可选"
        status={embedding.enabled
          ? (embedding.apiKeyConfigured
              ? `已启用 · 索引 ${embedding.index?.readyCount || 0}/${embedding.index?.totalCount || 0}`
              : '待填写')
          : '未启用 · 聊天仍可用'}
        editing={editing === 'embedding'}
        onEdit={() => setEditing(editing === 'embedding' ? null : 'embedding')}
      >
        <View style={styles.switchRow}>
          <View style={styles.switchCopy}>
            <Text style={styles.label}>启用 Embedding</Text>
            <Text style={styles.hint}>开启后可按含义搜索模型；关闭不会影响普通聊天。</Text>
          </View>
          <Switch value={embedding.enabled} onValueChange={(enabled) => setEmbedding((value) => ({ ...value, enabled }))} />
        </View>
        {embedding.enabled ? (
          <>
            <Field styles={styles} colors={colors} label="Base URL" value={embedding.baseUrl} onChange={(baseUrl) => setEmbedding((value) => ({ ...value, baseUrl }))} />
            <Field styles={styles} colors={colors} label="模型名" value={embedding.model} onChange={(model) => setEmbedding((value) => ({ ...value, model }))} />
            <Field styles={styles} colors={colors} label="Group ID" value={embedding.groupId} onChange={(groupId) => setEmbedding((value) => ({ ...value, groupId }))} placeholder="MiniMax Embedding 必填" />
            <SecretField
              styles={styles}
              colors={colors}
              value={embedding.apiKey}
              onChange={(apiKey) => setEmbedding((current) => ({ ...current, apiKey }))}
              configured={embedding.apiKeyConfigured}
              visible={showKey.embedding}
              onToggle={() => setShowKey((value) => ({ ...value, embedding: !value.embedding }))}
            />
          </>
        ) : null}
      </ServiceCard>

      {lastTests ? (
        <View style={styles.resultBox}>
          <Text style={styles.resultTitle}>最近一次验证</Text>
          <Text style={styles.resultText}>大模型：{lastTests.llm?.ok ? '连接成功' : '失败'}</Text>
          <Text style={styles.resultText}>图片：{visionLabel(lastTests.vision?.status)}</Text>
          <Text style={styles.resultText}>Embedding：{lastTests.embedding?.skipped ? '未启用' : lastTests.embedding?.ok ? '连接成功' : '失败'}</Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        <TouchableOpacity style={[styles.button, styles.secondaryButton]} disabled={Boolean(busy)} onPress={testSettings}>
          <Text style={styles.secondaryText}>{busy === 'test' ? '验证中…' : '测试当前配置'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.primaryButton]} disabled={Boolean(busy)} onPress={saveSettings}>
          <Text style={styles.primaryText}>{busy === 'save' ? '保存并验证中…' : '保存并验证'}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function ServiceCard({ styles, colors, icon, title, status, editing, onEdit, children }) {
  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.cardHeader} onPress={onEdit} activeOpacity={0.8}>
        <View style={styles.cardTitleRow}>
          <Ionicons name={icon} size={20} color={colors.primary} />
          <View>
            <Text style={styles.cardTitle}>{title}</Text>
            <Text style={styles.status}>{status}</Text>
          </View>
        </View>
        <View style={styles.editRow}>
          <Text style={styles.editText}>{editing ? '收起' : '编辑'}</Text>
          <Ionicons name={editing ? 'chevron-up' : 'chevron-down'} size={18} color={colors.primary} />
        </View>
      </TouchableOpacity>
      {editing ? <View style={styles.cardBody}>{children}</View> : null}
    </View>
  );
}

function Field({ label, value, onChange, placeholder, styles, colors }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={String(value || '')}
        onChangeText={onChange}
        placeholder={placeholder || ''}
        placeholderTextColor={colors.textTertiary}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

function SecretField({ value, onChange, configured, visible, onToggle, styles, colors }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>API Key</Text>
      <View style={styles.secretRow}>
        <TextInput
          style={[styles.input, styles.secretInput]}
          value={value}
          onChangeText={onChange}
          secureTextEntry={!visible}
          placeholder={configured ? 'API Key 已配置；输入新 Key 可替换' : '请输入 API Key'}
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity style={styles.eyeButton} onPress={onToggle} accessibilityLabel={visible ? '隐藏新 API Key' : '显示正在输入的新 API Key'}>
          <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.primary} />
        </TouchableOpacity>
      </View>
      {configured ? <Text style={styles.hint}>已保存的 Key 不会回显；留空将继续使用原 Key。</Text> : null}
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: 16, paddingBottom: 48 },
  intro: { color: colors.textSecondary, fontSize: 13, lineHeight: 20, marginBottom: 14 },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 18, marginBottom: 14, overflow: 'hidden' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTitle: { color: colors.text, fontWeight: '700', fontSize: 16 },
  status: { color: colors.textSecondary, fontSize: 12, marginTop: 3 },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  editText: { color: colors.primary, fontWeight: '600', fontSize: 13 },
  cardBody: { paddingHorizontal: 16, paddingBottom: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 14 },
  field: { marginBottom: 13 },
  label: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 6 },
  input: { backgroundColor: colors.surfaceElevated, color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: 13, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  secretRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  secretInput: { flex: 1 },
  eyeButton: { width: 44, height: 44, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
  hint: { color: colors.textTertiary, fontSize: 12, lineHeight: 17 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  switchCopy: { flex: 1, paddingRight: 16 },
  resultBox: { backgroundColor: colors.surfaceMuted, borderRadius: 14, padding: 13, marginBottom: 14 },
  resultTitle: { color: colors.text, fontSize: 13, fontWeight: '700', marginBottom: 5 },
  resultText: { color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 10 },
  button: { flex: 1, alignItems: 'center', borderRadius: 14, paddingVertical: 13 },
  secondaryButton: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary },
  primaryButton: { backgroundColor: colors.primary },
  secondaryText: { color: colors.primary, fontWeight: '700' },
  primaryText: { color: colors.onPrimary, fontWeight: '700' },
});
