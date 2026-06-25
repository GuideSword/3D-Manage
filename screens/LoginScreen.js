import React, { useState } from 'react';
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
import { COLORS, RADIUS, ROLES, ROLE_LABELS, SHADOWS, SPACING, TYPOGRAPHY } from '../constants';
import { Button, Card, Input, Picker } from '../components';
import { useAuth } from '../context/AuthContext';

const ROLE_OPTIONS = [ROLES.STAFF, ROLES.VIEWER].map((role) => ({
  value: role,
  label: ROLE_LABELS[role] || role,
}));

const LoginScreen = () => {
  const { signIn, register } = useAuth();
  const [loading, setLoading] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [formData, setFormData] = useState({
    email: 'admin@example.com',
    password: 'Admin123456',
    name: '',
    role: ROLES.STAFF,
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
    if (authMode === 'register' && !formData.name.trim()) {
      Alert.alert('验证失败', '请输入姓名');
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

      if (authMode === 'login') {
        await signIn(payload);
      } else {
        await register({
          ...payload,
          name: formData.name.trim(),
          role: formData.role,
        });
      }
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
              <Ionicons name="cube" size={28} color={COLORS.surfaceElevated} />
            </View>
            <Text style={styles.eyebrow}>3D PRINT OPERATIONS</Text>
            <Text style={styles.title}>3D 打印管理系统</Text>
            <Text style={styles.subtitle}>
              登录后访问订单、模型、耗材和库存数据。
            </Text>
          </View>

          <Card style={styles.card} padding="large">
            <View style={styles.modeSwitch}>
              <Button
                title="登录"
                onPress={() => setAuthMode('login')}
                variant={authMode === 'login' ? 'primary' : 'ghost'}
                size="small"
                style={styles.modeButton}
              />
              <Button
                title="注册"
                onPress={() => setAuthMode('register')}
                variant={authMode === 'register' ? 'primary' : 'ghost'}
                size="small"
                style={styles.modeButton}
              />
            </View>

            {authMode === 'register' ? (
              <Input
                label="姓名"
                placeholder="请输入姓名"
                value={formData.name}
                onChangeText={(text) => setFormData((prev) => ({ ...prev, name: text }))}
              />
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
            {authMode === 'register' ? (
              <Picker
                label="角色"
                value={formData.role}
                onValueChange={(value) => setFormData((prev) => ({ ...prev, role: value }))}
                options={ROLE_OPTIONS}
              />
            ) : null}
            <Button
              title={authMode === 'login' ? '登录' : '注册'}
              onPress={handleAuthSubmit}
              loading={loading}
              disabled={loading}
              iconLeft={authMode === 'login' ? 'log-in-outline' : 'person-add-outline'}
              fullWidth
              style={styles.submitButton}
            />

            {authMode === 'login' ? (
              <View style={styles.hintRow}>
                <Ionicons name="key-outline" size={15} color={COLORS.textSecondary} />
                <Text style={styles.hint}>
                  默认管理员：admin@example.com / Admin123456
                </Text>
              </View>
            ) : null}
          </Card>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
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
    backgroundColor: COLORS.primary,
    marginBottom: SPACING.lg,
    ...SHADOWS.card,
  },
  eyebrow: {
    ...TYPOGRAPHY.caption,
    color: COLORS.primary,
    letterSpacing: 0,
    marginBottom: SPACING.xs,
  },
  title: {
    ...TYPOGRAPHY.screenTitle,
    color: COLORS.text,
  },
  subtitle: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
    marginTop: SPACING.sm,
  },
  card: {
    marginHorizontal: 0,
  },
  modeSwitch: {
    flexDirection: 'row',
    gap: SPACING.sm,
    padding: SPACING.xs,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.surfaceMuted,
    marginBottom: SPACING.md,
  },
  modeButton: {
    flex: 1,
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
    color: COLORS.textSecondary,
  },
});

export default LoginScreen;
