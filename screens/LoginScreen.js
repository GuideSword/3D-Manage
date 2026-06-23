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
import { COLORS, ROLES, ROLE_LABELS } from '../constants';
import { Button, Input, Picker } from '../components';
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
        <View style={styles.header}>
          <Text style={styles.title}>3D 打印管理系统</Text>
          <Text style={styles.subtitle}>登录后访问订单、模型、耗材和库存数据</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.modeButtons}>
            <Button
              title="登录"
              onPress={() => setAuthMode('login')}
              variant={authMode === 'login' ? 'primary' : 'outline'}
              style={styles.modeButton}
            />
            <Button
              title="注册"
              onPress={() => setAuthMode('register')}
              variant={authMode === 'register' ? 'primary' : 'outline'}
              style={styles.modeButton}
            />
          </View>

          {authMode === 'register' && (
            <Input
              label="姓名"
              placeholder="请输入姓名"
              value={formData.name}
              onChangeText={(text) => setFormData((prev) => ({ ...prev, name: text }))}
            />
          )}
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
          {authMode === 'register' && (
            <Picker
              label="角色"
              value={formData.role}
              onValueChange={(value) => setFormData((prev) => ({ ...prev, role: value }))}
              options={ROLE_OPTIONS}
            />
          )}
          <Button
            title={authMode === 'login' ? '登录' : '注册'}
            onPress={handleAuthSubmit}
            loading={loading}
            disabled={loading}
            style={styles.submitButton}
          />

          {authMode === 'login' && (
            <Text style={styles.hint}>
              默认管理员：admin@example.com / Admin123456
            </Text>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.light,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: COLORS.textSecondary,
    lineHeight: 22,
  },
  card: {
    padding: 16,
    backgroundColor: COLORS.background,
    borderRadius: 8,
  },
  modeButtons: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  modeButton: {
    flex: 1,
  },
  submitButton: {
    marginTop: 12,
  },
  hint: {
    marginTop: 12,
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
});

export default LoginScreen;
