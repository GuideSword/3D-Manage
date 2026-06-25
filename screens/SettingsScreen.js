import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import {
  API_CONFIG,
  COLORS,
  RADIUS,
  ROLE_LABELS,
  ROUTES,
  SPACING,
  TYPOGRAPHY,
} from '../constants';
import { Card } from '../components';
import { useAuth } from '../context/AuthContext';

const SettingsScreen = () => {
  const navigation = useNavigation();
  const { user, signOut } = useAuth();

  const handleLogout = async () => {
    await signOut();
    Alert.alert('成功', '已退出登录');
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Text style={styles.eyebrow}>SETTINGS</Text>
        <Text style={styles.title}>设置</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>账号与权限</Text>
        <Card style={styles.card} padding="none">
          <InfoRow
            icon="person-circle-outline"
            label="当前用户"
            value={user?.name || user?.email || '未知用户'}
            hint={user?.email}
          />
          <InfoRow
            icon="shield-checkmark-outline"
            label="角色"
            value={ROLE_LABELS[user?.role] || user?.role || '未知'}
          />
        </Card>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>服务器配置</Text>
        <Card style={styles.card} padding="none">
          <InfoRow
            icon="server-outline"
            label="API 地址"
            value={API_CONFIG.BASE_URL}
            hint="可通过 EXPO_PUBLIC_API_BASE_URL 配置开发环境 API 地址"
          />
        </Card>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>工具</Text>
        <Card style={styles.card} padding="none">
          <ActionRow
            icon="cloud-upload-outline"
            label="OSS 配置"
            hint="配置模型文件和图片存储"
            onPress={() => navigation.navigate(ROUTES.OSS_CONFIG)}
          />
          <ActionRow
            icon="document-attach-outline"
            label="CSV 导入"
            hint="批量导入订单、耗材或库存数据"
            onPress={() => navigation.navigate(ROUTES.DATA_IMPORT)}
          />
        </Card>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>会话</Text>
        <TouchableOpacity activeOpacity={0.82} style={styles.logoutButton} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={20} color={COLORS.danger} />
          <Text style={styles.logoutText}>退出登录</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const InfoRow = ({ icon, label, value, hint }) => (
  <View style={styles.row}>
    <View style={styles.rowIcon}>
      <Ionicons name={icon} size={19} color={COLORS.primary} />
    </View>
    <View style={styles.rowTextGroup}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>{value}</Text>
      {hint ? <Text style={styles.rowHint} numberOfLines={2}>{hint}</Text> : null}
    </View>
  </View>
);

const ActionRow = ({ icon, label, hint, onPress }) => (
  <TouchableOpacity activeOpacity={0.82} style={styles.row} onPress={onPress}>
    <View style={styles.rowIcon}>
      <Ionicons name={icon} size={19} color={COLORS.primary} />
    </View>
    <View style={styles.rowTextGroup}>
      <Text style={styles.rowValue}>{label}</Text>
      <Text style={styles.rowHint} numberOfLines={1}>{hint}</Text>
    </View>
    <Ionicons name="chevron-forward" size={18} color={COLORS.textTertiary} />
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  header: {
    marginBottom: SPACING.xl,
  },
  eyebrow: {
    ...TYPOGRAPHY.caption,
    color: COLORS.primary,
    marginBottom: 2,
  },
  title: {
    ...TYPOGRAPHY.screenTitle,
    color: COLORS.text,
  },
  section: {
    marginBottom: SPACING.xl,
  },
  sectionTitle: {
    ...TYPOGRAPHY.sectionTitle,
    color: COLORS.text,
    marginBottom: SPACING.md,
  },
  card: {
    marginHorizontal: 0,
    overflow: 'hidden',
  },
  row: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primarySoft,
  },
  rowTextGroup: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textTertiary,
    marginBottom: 2,
  },
  rowValue: {
    ...TYPOGRAPHY.meta,
    color: COLORS.text,
  },
  rowHint: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  logoutButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.dangerSoft,
    backgroundColor: COLORS.dangerSoft,
  },
  logoutText: {
    ...TYPOGRAPHY.meta,
    color: COLORS.danger,
  },
});

export default SettingsScreen;
