import React, { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Input } from '../components';
import { RADIUS, SPACING, TYPOGRAPHY } from '../constants';
import { useServerConfig } from '../context/ServerConfigContext';
import { useAppTheme } from '../context/ThemeContext';

const ERROR_MESSAGES = {
  TIMEOUT: '连接超时，请检查地址、网络和服务器防火墙。',
  INCOMPATIBLE_API: '服务器 API 版本与当前客户端不兼容。',
  WRONG_PRODUCT: '该地址不是 3D Manage 服务。',
  SERVER_UNREACHABLE: '无法连接服务器，请确认地址和服务状态。',
  SERVER_UNAVAILABLE: '服务器尚未准备就绪，请稍后重试。',
};

const ServerSetupScreen = ({ route, navigation }) => {
  const replacement = Boolean(route?.params?.replacement);
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { server, configureServer, replaceServer, isReplacing } = useServerConfig();
  const [address, setAddress] = useState(replacement ? server?.apiBaseUrl || '' : '');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async () => {
    if (!address.trim()) {
      setErrorMessage('请输入服务器地址。');
      return;
    }
    setSubmitting(true);
    setErrorMessage('');
    try {
      await (replacement ? replaceServer(address) : configureServer(address));
    } catch (error) {
      setErrorMessage(ERROR_MESSAGES[error.code] || error.message || '连接失败。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.shell}>
          <View style={styles.icon}><Ionicons name="server-outline" size={28} color={colors.onPrimary} /></View>
          <Text style={styles.eyebrow}>SELF-HOSTED</Text>
          <Text style={styles.title}>{replacement ? '更换服务器' : '连接 3D Manage'}</Text>
          <Text style={styles.subtitle}>输入管理员提供的部署地址。验证成功后才会保存在此设备。</Text>
          <Card style={styles.card} padding="large">
            <Input
              label="服务器地址"
              placeholder="例如 192.168.1.10:5000"
              value={address}
              onChangeText={setAddress}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.note}>
              <Ionicons name="information-circle-outline" size={17} color={colors.info} />
              <Text style={styles.noteText}>局域网内可使用 HTTP；通过公网访问时必须配置 HTTPS。</Text>
            </View>
            {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
            <Button
              title={submitting || isReplacing ? '正在测试连接…' : '测试并保存'}
              onPress={handleSubmit}
              loading={submitting || isReplacing}
              disabled={submitting || isReplacing}
              fullWidth
              style={styles.button}
            />
            {replacement ? (
              <Button title="取消" variant="secondary" onPress={() => navigation.goBack()} disabled={submitting || isReplacing} fullWidth />
            ) : null}
          </Card>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const createStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, justifyContent: 'center', padding: SPACING.xl },
  shell: { width: '100%', maxWidth: 520, alignSelf: 'center' },
  icon: { width: 56, height: 56, borderRadius: RADIUS.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, marginBottom: SPACING.lg },
  eyebrow: { ...TYPOGRAPHY.caption, color: colors.primary, marginBottom: SPACING.xs },
  title: { ...TYPOGRAPHY.screenTitle, color: colors.text },
  subtitle: { ...TYPOGRAPHY.body, color: colors.textSecondary, marginTop: SPACING.sm, marginBottom: SPACING.xl },
  card: { marginHorizontal: 0 },
  note: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm },
  noteText: { ...TYPOGRAPHY.caption, color: colors.textSecondary, flex: 1 },
  error: { ...TYPOGRAPHY.meta, color: colors.danger, marginTop: SPACING.md },
  button: { marginTop: SPACING.lg, marginBottom: SPACING.sm },
});

export default ServerSetupScreen;
