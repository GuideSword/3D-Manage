import React from 'react';
import { View, Text, TextInput, Switch } from 'react-native';
import { Card, Button } from './index';
import { apiRequest } from '../utils/api';
import { getServerRuntime, isCurrentRuntime } from '../utils/serverRuntime';
import { useAppTheme } from '../context/ThemeContext';

export default function ModelDownloadSettings() {
  const { colors } = useAppTheme();
  const [policy, setPolicy] = React.useState(null), [enabled, setEnabled] = React.useState(false);
  const [password, setPassword] = React.useState(''), [confirmation, setConfirmation] = React.useState('');
  const [busy, setBusy] = React.useState(false), [message, setMessage] = React.useState('');
  const captured = React.useMemo(() => getServerRuntime(), []);
  async function load() {
    try { const result = await apiRequest('/model-downloads/policy'); if (isCurrentRuntime(captured)) { setPolicy(result); setEnabled(result.enabled); } }
    catch (error) { if (isCurrentRuntime(captured)) setMessage(error.message); }
  }
  React.useEffect(() => { load(); return () => { setPassword(''); setConfirmation(''); }; }, []);
  async function save() {
    if (!policy || busy || !isCurrentRuntime(captured)) return;
    if (password !== confirmation) { setMessage('两次输入的下载密码不一致'); return; }
    setBusy(true); setMessage('');
    try {
      const result = await apiRequest('/model-downloads/policy', { method: 'PUT', body: JSON.stringify({ enabled, version: policy.version, ...(password ? { password } : {}) }) });
      if (isCurrentRuntime(captured)) { setPolicy(result); setEnabled(result.enabled); setPassword(''); setConfirmation(''); setMessage('下载保护设置已保存；此前尚未开始的下载授权已失效'); }
    } catch (error) { if (isCurrentRuntime(captured)) { setMessage(error.message); if (error.code === 'VERSION_CONFLICT') await load(); } }
    finally { if (isCurrentRuntime(captured)) setBusy(false); }
  }
  const fieldStyle = { color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, marginTop: 10 };
  return <Card><Text style={{ color: colors.text, fontWeight: '700', fontSize: 18 }}>模型下载保护</Text>
    <Text style={{ color: colors.text, marginVertical: 12 }}>统一保护模型下载、手机分享和 Studio 导入。管理员本人也需验证下载密码。此功能需要服务器支持 HTTPS。</Text>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><Text style={{ color: colors.text }}>启用模型下载密码</Text><Switch accessibilityLabel="启用模型下载密码" disabled={busy || !policy} value={enabled} onValueChange={setEnabled} /></View>
    <TextInput accessibilityLabel="设置模型下载密码" placeholder="新下载密码（至少12个字符；留空保持原密码）" placeholderTextColor={colors.textSecondary} secureTextEntry autoCorrect={false} autoCapitalize="none" value={password} onChangeText={setPassword} style={fieldStyle} />
    <TextInput accessibilityLabel="确认模型下载密码" placeholder="再次输入新下载密码" placeholderTextColor={colors.textSecondary} secureTextEntry autoCorrect={false} autoCapitalize="none" value={confirmation} onChangeText={setConfirmation} style={fieldStyle} />
    <Text style={{ color: colors.textSecondary, marginVertical: 10 }}>开启后，未支持此授权流程的旧客户端将无法下载模型。更换密码不会收回已经下载的文件。</Text>
    {message ? <Text accessibilityRole="alert" style={{ color: colors.text, marginBottom: 10 }}>{message}</Text> : null}
    <Button title="保存下载保护" disabled={!policy || busy} loading={busy} onPress={save} />
    {!policy && <Button title="重新读取设置" variant="outline" onPress={load} />}
  </Card>;
}
