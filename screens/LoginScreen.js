import React, { useMemo, useState } from 'react';
import {
  Alert,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { RADIUS, SPACING, TYPOGRAPHY } from '../constants';
import { Button, Card, Input, XiaoliBrandMark } from '../components';
import { useAuth } from '../context/AuthContext';
import { useAppTheme } from '../context/ThemeContext';
import { useServerConfig } from '../context/ServerConfigContext';

const LoginScreen = () => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { signIn, cleanupError, retrySessionCleanup } = useAuth();
  const { server } = useServerConfig();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });

  const validateAuthForm = () => {
    if (!formData.email.trim()) {
      Alert.alert('验证失败', '请输入邮箱');
      return false;
    }
    if (!formData.password || formData.password.length < 8) {
      Alert.alert('验证失败', '密码至少 8 位');
      return false;
    }
    return true;
  };

  const handleAuthSubmit = async () => {
    if (!validateAuthForm()) {
      return;
    }

    try {
      setLoading(true);
      const payload = {
        email: formData.email.trim(),
        password: formData.password,
      };

      await signIn(payload);
    } catch (error) {
      Alert.alert('错误', error.message || '认证失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAwareScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      bottomOffset={SPACING.lg}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      <View style={styles.shell}>
          <View style={styles.brandBlock}>
            <XiaoliBrandMark size={72} style={styles.logoMark} />
            <Text style={styles.eyebrow}>3D PRINT OPERATIONS</Text>
            <Text style={styles.title}>3D 打印管理系统</Text>
            <Text style={styles.subtitle}>
              登录后访问订单、模型、耗材和库存数据。
            </Text>
            <View style={styles.serverBadge}>
              <Ionicons name="server-outline" size={16} color={colors.primary} />
              <View style={styles.serverText}>
                <Text style={styles.serverName}>{server?.organizationName || '3D Manage'}</Text>
                <Text style={styles.serverEndpoint}>{server?.apiBaseUrl}</Text>
              </View>
            </View>
          </View>

          <Card style={styles.card} padding="large">
            {cleanupError ? (
              <View style={styles.cleanupWarning}>
                <Text style={styles.cleanupText}>上次退出的本地清理未完成，完成清理前不可登录。</Text>
                <Button title="重试清理" variant="secondary" onPress={() => retrySessionCleanup().catch(() => undefined)} fullWidth />
              </View>
            ) : null}
            <Input
              label="邮箱"
              placeholder="请输入邮箱"
              value={formData.email}
              onChangeText={(text) => setFormData((prev) => ({ ...prev, email: text }))}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <Input
              label="密码"
              placeholder="请输入密码"
              value={formData.password}
              onChangeText={(text) => setFormData((prev) => ({ ...prev, password: text }))}
              secureTextEntry
            />
            <Button
              title="登录"
              onPress={handleAuthSubmit}
              loading={loading}
              disabled={loading || Boolean(cleanupError)}
              iconLeft="log-in-outline"
              fullWidth
              style={styles.submitButton}
            />

            <View style={styles.hintRow}>
              <Ionicons name="shield-checkmark-outline" size={15} color={colors.textSecondary} />
              <Text style={styles.hint}>账号由组织 Owner 创建和管理</Text>
            </View>
          </Card>
      </View>
    </KeyboardAwareScrollView>
  );
};

const createStyles = (colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  shell: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  brandBlock: {
    marginBottom: SPACING.xl,
  },
  logoMark: {
    marginBottom: SPACING.lg,
  },
  eyebrow: {
    ...TYPOGRAPHY.caption,
    color: colors.primary,
    letterSpacing: 0,
    marginBottom: SPACING.xs,
  },
  title: {
    ...TYPOGRAPHY.screenTitle,
    color: colors.text,
  },
  subtitle: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
    marginTop: SPACING.sm,
  },
  serverBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginTop: SPACING.lg,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    backgroundColor: colors.primarySoft,
  },
  serverText: { flex: 1 },
  serverName: { ...TYPOGRAPHY.meta, color: colors.text },
  serverEndpoint: { ...TYPOGRAPHY.caption, color: colors.textSecondary, marginTop: 2 },
  card: {
    marginHorizontal: 0,
  },
  cleanupWarning: {
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    backgroundColor: colors.dangerSoft,
    marginBottom: SPACING.lg,
  },
  cleanupText: { ...TYPOGRAPHY.meta, color: colors.danger, marginBottom: SPACING.sm },
  submitButton: {
    marginTop: SPACING.lg,
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    marginTop: SPACING.md,
  },
  hint: {
    ...TYPOGRAPHY.caption,
    color: colors.textSecondary,
  },
});

export default LoginScreen;
