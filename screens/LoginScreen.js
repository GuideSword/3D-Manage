import React, { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RADIUS, SPACING, TYPOGRAPHY } from '../constants';
import { Button, Card, Input } from '../components';
import { useAuth } from '../context/AuthContext';
import { useAppTheme } from '../context/ThemeContext';
import { useServerConfig } from '../context/ServerConfigContext';

const LoginScreen = () => {
  const { colors, shadows } = useAppTheme();
  const styles = useMemo(() => createStyles(colors, shadows), [colors, shadows]);
  const { signIn } = useAuth();
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
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.shell}>
          <View style={styles.brandBlock}>
            <View style={styles.logoMark}>
              <Ionicons name="paw" size={28} color={colors.onPrimary} />
            </View>
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
              disabled={loading}
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
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const createStyles = (colors, shadows) => StyleSheet.create({
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
    width: 56,
    height: 56,
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    marginBottom: SPACING.lg,
    ...shadows.card,
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
