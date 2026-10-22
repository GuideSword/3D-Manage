import React from 'react';
import { Modal, View, Text, TextInput, Pressable, Linking, ScrollView } from 'react-native';
import { apiRequest, setFileDownloadAuthorizer } from '../utils/api';
import { isCurrentRuntime, subscribeServerRuntime, StaleSessionError } from '../utils/serverRuntime';
import { useAppTheme } from '../context/ThemeContext';

const repositoryUrl = 'https://github.com/GuideSword/3D-Manage/tree/master/tools/model-handoff';
const cancelled = () => Object.assign(new Error('已取消本地模型拉取'), { code: 'MODEL_DOWNLOAD_CANCELLED' });
function keyFromUrl(fileUrl, runtime) {
  const base = new URL(runtime.apiBaseUrl), target = new URL(fileUrl, base.origin);
  const prefix = base.pathname.replace(/\/$/, '') + '/files/';
  if (target.origin !== base.origin || !target.pathname.startsWith(prefix) || target.search || target.hash) return null;
  return decodeURIComponent(target.pathname.slice(prefix.length));
}
export default function ModelDownloadDialog() {
  const { colors } = useAppTheme();
  const current = React.useRef(null), [task, setTask] = React.useState(null);
  const preparing = React.useRef(false);
  const [password, setPassword] = React.useState(''), [consent, setConsent] = React.useState(false);
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [ready, setReady] = React.useState(null);
  const finish = React.useCallback((failure, value) => {
    const pending = current.current; current.current = null;
    setTask(null); setPassword(''); setConsent(false); setReady(null); setBusy(false); setError('');
    if (pending) failure ? pending.reject(failure) : pending.resolve(value);
  }, []);
  React.useEffect(() => {
    setFileDownloadAuthorizer(async options => {
      if (current.current || preparing.current) throw new Error('请先完成当前下载授权');
      preparing.current = true;
      try {
      const key = keyFromUrl(options.fileUrl, options.captured);
      if (!key) {
        const policy = await apiRequest('/model-downloads/policy');
        if (!isCurrentRuntime(options.captured)) throw new StaleSessionError();
        if (policy.enabled || options.purpose === 'handoff') throw new Error('此文件使用外部地址，不能执行受保护模型交接，请联系管理员迁入服务器');
        return {};
      }
      const requirements = await apiRequest('/model-downloads/requirements?key=' + encodeURIComponent(key));
      if (!isCurrentRuntime(options.captured)) throw new StaleSessionError();
      if (!requirements.protected && options.purpose === 'download') return {};
      return await new Promise((resolve, reject) => {
        current.current = { ...options, key, requirements, resolve, reject };
        setTask(current.current); setPassword(''); setConsent(false); setError(''); setReady(null);
      });
      } finally { preparing.current = false; }
    });
    const unsubscribe = subscribeServerRuntime(() => { if (current.current && !isCurrentRuntime(current.current.captured)) finish(new StaleSessionError()); });
    return () => { setFileDownloadAuthorizer(null); unsubscribe(); if (current.current) finish(cancelled()); };
  }, [finish]);
  async function authorize() {
    const pending = current.current; if (!pending || busy || !consent) return;
    setBusy(true); setError('');
    try {
      if (!isCurrentRuntime(pending.captured)) throw new StaleSessionError();
      if (pending.purpose === 'download' && !pending.requirements.requiresPassword) { finish(null, {}); return; }
      const result = await apiRequest('/model-downloads/authorize', { method: 'POST', body: JSON.stringify({ key: pending.key, password: pending.requirements.requiresPassword ? password : undefined, purpose: pending.purpose, consent: true }) });
      if (current.current !== pending || !isCurrentRuntime(pending.captured)) throw new StaleSessionError();
      setPassword('');
      if (pending.purpose === 'handoff') { setReady(result.token); setBusy(false); }
      else finish(null, { 'X-Model-Download-Grant': result.token });
    } catch (caught) { if (current.current === pending) { setError(caught.message); setBusy(false); } }
  }
  async function openStudio() {
    const pending = current.current; if (!ready || !pending || busy) return;
    setBusy(true);
    try {
      if (!isCurrentRuntime(pending.captured)) throw new StaleSessionError();
      await Linking.openURL(`manage3d-model://open?server=${encodeURIComponent(pending.captured.apiBaseUrl)}&ticket=${encodeURIComponent(ready)}`);
      finish(null, true);
    } catch (caught) { setError('未能启动本地助手，请确认已安装并配置；你可以重新授权后再试。'); setReady(null); setBusy(false); }
  }
  const action = (label, onPress, disabled = false) => <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={{ padding: 12, marginTop: 8, backgroundColor: colors.primary, opacity: disabled ? 0.5 : 1, borderRadius: 8 }}><Text style={{ color: '#fff' }}>{label}</Text></Pressable>;
  return <Modal visible={Boolean(task)} transparent animationType="fade" onRequestClose={() => finish(cancelled())}>
    <View style={{ flex: 1, backgroundColor: '#0008', justifyContent: 'center', padding: 24 }}><ScrollView style={{ maxHeight: '85%', backgroundColor: colors.surface || '#fff', borderRadius: 14 }} contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
      <Text style={{ color: colors.text, fontSize: 20, fontWeight: '700' }}>{task?.purpose === 'handoff' ? '在 Bambu Studio 中打开' : '确认模型下载'}</Text>
      <Text style={{ color: colors.text, marginTop: 12 }}>{task?.filename || '模型源文件'}</Text>
      <Text style={{ color: colors.text, marginTop: 12 }}>此操作将从服务器拉取模型至当前设备。本地需要一份数据才能打开，临时文件和 Studio 缓存可能留存在本机。</Text>
      {task?.purpose === 'handoff' && <><Text style={{ color: colors.text, marginTop: 12 }}>需要在当前电脑安装本地助手。首次使用请查看仓库内的源码、安装说明与可用安装包。安装完成后返回此处继续。参数调整和打印由你在 Studio 中操作。</Text>{action('查看助手源码与安装说明', () => Linking.openURL(repositoryUrl))}</>}
      {action(consent ? '✓ 已同意将模型拉取至本地' : '同意将模型拉取至本地', () => setConsent(!consent), busy || Boolean(ready))}
      {task?.requirements.requiresPassword && !ready && <TextInput accessibilityLabel="模型下载密码" placeholder="请输入管理员设置的模型下载密码" placeholderTextColor={colors.textSecondary} secureTextEntry autoCapitalize="none" autoCorrect={false} value={password} onChangeText={setPassword} style={{ color: colors.text, borderWidth: 1, borderColor: colors.border, padding: 12, marginTop: 12, borderRadius: 8 }} />}
      {error ? <Text accessibilityRole="alert" style={{ color: colors.danger || '#b91c1c', marginTop: 12 }}>{error}</Text> : null}
      {ready ? action('打开 Bambu Studio', openStudio, busy) : action(busy ? '正在验证…' : task?.purpose === 'handoff' ? '已安装助手，验证并继续' : '验证并下载', authorize, busy || !consent)}
      {action('取消', () => finish(cancelled()))}
    </ScrollView></View>
  </Modal>;
}
