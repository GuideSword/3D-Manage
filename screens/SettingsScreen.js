import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { API_CONFIG, COLORS, ROLE_LABELS, ROUTES } from '../constants';
import { Button } from '../components';
import { useAuth } from '../context/AuthContext';

const SettingsScreen = () => {
  const navigation = useNavigation();
  const { user, signOut } = useAuth();

  const handleLogout = async () => {
    await signOut();
    Alert.alert('成功', '已退出登录');
  };

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>设置</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>账号与权限</Text>
        <View style={styles.infoCard}>
          <Text style={styles.infoLabel}>当前用户</Text>
          <Text style={styles.infoValue}>
            {user?.name || user?.email || '未知用户'}
          </Text>
          {user?.email && (
            <Text style={styles.infoHint}>{user.email}</Text>
          )}
          <Text style={styles.infoHint}>
            角色：{ROLE_LABELS[user?.role] || user?.role || '未知'}
          </Text>
          <Button
            title="退出登录"
            onPress={handleLogout}
            variant="outline"
            style={styles.sectionButton}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>服务器配置</Text>
        <View style={styles.infoCard}>
          <Text style={styles.infoLabel}>API 地址:</Text>
          <Text style={styles.infoValue}>{API_CONFIG.BASE_URL}</Text>
        </View>
        <Text style={styles.infoHint}>
          可通过 EXPO_PUBLIC_API_BASE_URL 配置开发环境 API 地址
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>文件存储</Text>
        <Button
          title="OSS 配置"
          onPress={() => navigation.navigate(ROUTES.OSS_CONFIG)}
          variant="outline"
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>数据维护</Text>
        <Button
          title="CSV 导入"
          onPress={() => navigation.navigate(ROUTES.DATA_IMPORT)}
          variant="outline"
        />
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: COLORS.background,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    color: COLORS.text,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  infoCard: {
    padding: 16,
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    marginBottom: 8,
  },
  infoLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 16,
    color: COLORS.text,
    fontWeight: '500',
  },
  infoHint: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontStyle: 'italic',
    marginTop: 4,
  },
  sectionButton: {
    marginTop: 12,
  },
});

export default SettingsScreen;
