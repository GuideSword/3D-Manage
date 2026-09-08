import React, { useMemo } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import {
  API_CONFIG,
  RADIUS,
  ROLE_LABELS,
  ROLES,
  ROUTES,
  SPACING,
  TYPOGRAPHY,
} from '../constants';
import { Card, ThemeModePicker } from '../components';
import { useAuth } from '../context/AuthContext';
import { useAppTheme } from '../context/ThemeContext';

const SettingsScreen = () => {
  const { colors, themeMode, setThemeMode } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
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
            styles={styles}
            colors={colors}
            icon="person-circle-outline"
            label="当前用户"
            value={user?.name || user?.email || '未知用户'}
            hint={user?.email}
          />
          <InfoRow
            styles={styles}
            colors={colors}
            icon="shield-checkmark-outline"
            label="角色"
            value={ROLE_LABELS[user?.role] || user?.role || '未知'}
          />
          {user?.role === ROLES.OWNER ? (
            <ActionRow
              styles={styles}
              colors={colors}
              icon="people-outline"
              label="用户与权限"
              hint="创建、停用并调整员工和查看者账号"
              onPress={() => navigation.navigate(ROUTES.USERS)}
            />
          ) : null}
        </Card>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>外观</Text>
        <Card style={styles.themeCard}>
          <View style={styles.themeHeading}>
            <View style={styles.rowIcon}>
              <Ionicons name="color-palette-outline" size={19} color={colors.primary} />
            </View>
            <View style={styles.rowTextGroup}>
              <Text style={styles.rowValue}>界面主题</Text>
              <Text style={styles.rowHint}>日间奶油暖光，夜间可可月光</Text>
            </View>
          </View>
          <ThemeModePicker value={themeMode} onChange={setThemeMode} />
        </Card>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>服务器配置</Text>
        <Card style={styles.card} padding="none">
          <InfoRow
            styles={styles}
            colors={colors}
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
            styles={styles}
            colors={colors}
            icon="cloud-upload-outline"
            label="OSS 配置"
            hint="配置模型文件和图片存储"
            onPress={() => navigation.navigate(ROUTES.OSS_CONFIG)}
          />
          <ActionRow
            styles={styles}
            colors={colors}
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
          <Ionicons name="log-out-outline" size={20} color={colors.danger} />
          <Text style={styles.logoutText}>退出登录</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const InfoRow = ({ icon, label, value, hint, styles, colors }) => (
  <View style={styles.row}>
    <View style={styles.rowIcon}>
      <Ionicons name={icon} size={19} color={colors.primary} />
    </View>
    <View style={styles.rowTextGroup}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>{value}</Text>
      {hint ? <Text style={styles.rowHint} numberOfLines={2}>{hint}</Text> : null}
    </View>
  </View>
);

const ActionRow = ({ icon, label, hint, onPress, styles, colors }) => (
  <TouchableOpacity activeOpacity={0.82} style={styles.row} onPress={onPress}>
    <View style={styles.rowIcon}>
      <Ionicons name={icon} size={19} color={colors.primary} />
    </View>
    <View style={styles.rowTextGroup}>
      <Text style={styles.rowValue}>{label}</Text>
      <Text style={styles.rowHint} numberOfLines={1}>{hint}</Text>
    </View>
    <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
  </TouchableOpacity>
);

const createStyles = (colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
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
    color: colors.primary,
    marginBottom: 2,
  },
  title: {
    ...TYPOGRAPHY.screenTitle,
    color: colors.text,
  },
  section: {
    marginBottom: SPACING.xl,
  },
  sectionTitle: {
    ...TYPOGRAPHY.sectionTitle,
    color: colors.text,
    marginBottom: SPACING.md,
  },
  card: {
    marginHorizontal: 0,
    overflow: 'hidden',
  },
  themeCard: {
    marginHorizontal: 0,
  },
  themeHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginBottom: SPACING.md,
  },
  row: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  rowTextGroup: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    ...TYPOGRAPHY.caption,
    color: colors.textTertiary,
    marginBottom: 2,
  },
  rowValue: {
    ...TYPOGRAPHY.meta,
    color: colors.text,
  },
  rowHint: {
    ...TYPOGRAPHY.caption,
    color: colors.textSecondary,
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
    borderColor: colors.danger,
    backgroundColor: colors.dangerSoft,
  },
  logoutText: {
    ...TYPOGRAPHY.meta,
    color: colors.danger,
  },
});

export default SettingsScreen;
