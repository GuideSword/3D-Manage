import React, { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Input } from '../components';
import { RADIUS, SPACING, TYPOGRAPHY } from '../constants';
import { useAuth } from '../context/AuthContext';
import { useServerConfig } from '../context/ServerConfigContext';
import { useAppTheme } from '../context/ThemeContext';
import { authAPI, systemAPI } from '../utils/api';

const emptySecrets = { password: '', passwordConfirmation: '', bootstrapToken: '' };

const BootstrapOwnerScreen = () => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { server, refreshServer } = useServerConfig();
  const { refreshUser } = useAuth();
  const [form, setForm] = useState({ organizationName: '', ownerName: '', email: '', ...emptySecrets });
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => () => setForm((current) => ({ ...current, ...emptySecrets })), []);
  const update = (key) => (value) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    const passwordBytes = new TextEncoder().encode(form.password).length;
    if (!form.organizationName.trim() || !form.ownerName.trim() || !form.email.trim() || !form.bootstrapToken) {
      setErrorMessage('请完整填写所有字段。'); return;
    }
    if (form.password.length < 12 || passwordBytes > 72) {
      setErrorMessage('密码至少 12 个字符，且最多 72 个 UTF-8 字节。'); return;
    }
    if (form.password !== form.passwordConfirmation) {
      setErrorMessage('两次输入的密码不一致。'); return;
    }
    setSubmitting(true); setErrorMessage('');
    try {
      const result = await systemAPI.bootstrap({
        organizationName: form.organizationName.trim(),
        ownerName: form.ownerName.trim(),
        email: form.email.trim(),
        password: form.password,
      }, form.bootstrapToken);
      if (result.serverId !== server.serverId) throw new Error('服务器身份在初始化期间发生变化');
      await authAPI.saveToken(result.token);
      setForm((current) => ({ ...current, ...emptySecrets }));
      await refreshServer();
      await refreshUser();
    } catch (error) {
      setForm((current) => ({ ...current, ...emptySecrets }));
      if (error?.name === 'AbortError' || /timeout|超时/i.test(error?.message || '')) {
        try {
          const refreshed = await refreshServer();
          if (refreshed?.initialized) {
            setErrorMessage('初始化结果未能确认；服务器已初始化，请使用 Owner 账号登录。');
            return;
          }
        } catch (_) { /* retain the original unknown-result message */ }
        setErrorMessage('初始化请求结果未知，请先重试连接并确认状态，不要立即重复创建。');
      } else {
        setErrorMessage(error.message || '初始化失败。');
      }
    } finally { setSubmitting(false); }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.shell}>
          <Text style={styles.eyebrow}>FIRST RUN</Text>
          <Text style={styles.title}>初始化组织 Owner</Text>
          <Text style={styles.subtitle}>连接到 {server?.apiBaseUrl}。部署令牌只用于本次初始化，不会保存在设备上。</Text>
          <Card style={styles.card} padding="large">
            <Input label="组织名称" value={form.organizationName} onChangeText={update('organizationName')} />
            <Input label="Owner 姓名" value={form.ownerName} onChangeText={update('ownerName')} />
            <Input label="邮箱" value={form.email} onChangeText={update('email')} keyboardType="email-address" autoCapitalize="none" />
            <Input label="密码" value={form.password} onChangeText={update('password')} secureTextEntry />
            <Input label="确认密码" value={form.passwordConfirmation} onChangeText={update('passwordConfirmation')} secureTextEntry />
            <Input label="部署初始化令牌" value={form.bootstrapToken} onChangeText={update('bootstrapToken')} secureTextEntry autoCapitalize="none" />
            {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
            <Button title="创建组织并登录" onPress={submit} loading={submitting} disabled={submitting} fullWidth style={styles.button} />
          </Card>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const createStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, justifyContent: 'center', padding: SPACING.xl },
  shell: { width: '100%', maxWidth: 560, alignSelf: 'center' },
  eyebrow: { ...TYPOGRAPHY.caption, color: colors.primary, marginBottom: SPACING.xs },
  title: { ...TYPOGRAPHY.screenTitle, color: colors.text },
  subtitle: { ...TYPOGRAPHY.body, color: colors.textSecondary, marginTop: SPACING.sm, marginBottom: SPACING.xl },
  card: { marginHorizontal: 0, borderRadius: RADIUS.lg },
  error: { ...TYPOGRAPHY.meta, color: colors.danger, marginTop: SPACING.sm },
  button: { marginTop: SPACING.lg },
});

export default BootstrapOwnerScreen;
