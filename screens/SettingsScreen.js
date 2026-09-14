import React, { useMemo } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import {
  RADIUS,
  ROLE_LABELS,
  ROLES,
  ROUTES,
  SPACING,
  TYPOGRAPHY,
} from '../constants';
import { Button, Card, CyberPageHeader, ThemeModePicker } from '../components';
import { useAuth } from '../context/AuthContext';
import { useAppTheme } from '../context/ThemeContext';
import { useServerConfig } from '../context/ServerConfigContext';
import { canExport } from '../utils/permissions';

const SettingsScreen = () => {
  const { colors, themeMode, setThemeMode } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const navigation = useNavigation();
  const { user, signOut, cleanupError, retrySessionCleanup } = useAuth();
  const { server, refreshServer } = useServerConfig();
  const [testingServer, setTestingServer] = React.useState(false);

  const handleLogout = async () => {
    try {
      await signOut();
      Alert.alert('成功', '已退出登录');
    } catch (error) {
      Alert.alert('已退出，但清理未完成', `${error.message}\n请使用重试清理。`);
    }
  };

  const handleTestServer = async () => {
    setTestingServer(true);
    try {
      await refreshServer();
      Alert.alert('连接正常', '服务器身份与 API 版本验证通过。');
    } catch (error) {
      Alert.alert('连接失败', error.message || '无法连接服务器');
    } finally { setTestingServer(false); }
  };

  const confirmReplacement = () => Alert.alert(
    '更换服务器',
    '新服务器验证成功后，当前账号会立即退出并清理本地会话。是否继续？',
    [
      { text: '取消', style: 'cancel' },
      { text: '继续', style: 'destructive', onPress: () => navigation.navigate(ROUTES.SERVER_SETUP, { replacement: true }) },
    ]
  );

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.container}>
      <View style={styles.page}>
      <CyberPageHeader
        eyebrow="SETTINGS"
        title="设置中心"
        subtitle="把工作台调成最顺手的样子。"
        onAssistant={() => navigation.navigate(ROUTES.AGENT)}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >

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
              <Text style={styles.rowHint}>日间薰衣草云光，夜间深靛星光</Text>
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
            label="组织"
            value={server?.organizationName || '未命名组织'}
            hint={server?.apiBaseUrl}
          />
          <InfoRow styles={styles} colors={colors} icon="git-branch-outline" label="版本" value={`服务端 ${server?.serverVersion || '未知'} · API ${server?.apiVersion || '未知'}`} hint="状态：已验证" />
          <ActionRow styles={styles} colors={colors} icon="pulse-outline" label={testingServer ? '正在测试…' : '测试连接'} hint="重新验证服务器身份和兼容性" onPress={handleTestServer} />
          <ActionRow styles={styles} colors={colors} icon="swap-horizontal-outline" label="更换服务器" hint="验证后退出当前账号并隔离会话" onPress={confirmReplacement} />
        </Card>
      </View>

      {canExport(user) ? <View style={styles.section}>
        <Text style={styles.sectionTitle}>工具</Text>
        <Card style={styles.card} padding="none">
          <ActionRow
            styles={styles}
            colors={colors}
            icon="document-attach-outline"
            label="CSV 导入"
            hint="批量导入订单、耗材或库存数据"
            onPress={() => navigation.navigate(ROUTES.DATA_IMPORT)}
          />
        </Card>
      </View> : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>会话</Text>
        <TouchableOpacity activeOpacity={0.82} style={styles.logoutButton} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={20} color={colors.danger} />
          <Text style={styles.logoutText}>退出登录</Text>
        </TouchableOpacity>
      </View>
      {cleanupError ? (
        <View style={styles.section}>
          <Text style={styles.errorText}>本地会话清理未完成：{cleanupError.message}</Text>
          <Button title="重试清理" onPress={() => retrySessionCleanup().catch(() => undefined)} fullWidth />
        </View>
      ) : null}
      </ScrollView>
      </View>
    </SafeAreaView>
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
  page: {
    flex: 1,
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: SPACING.lg,
    paddingTop: SPACING.xs,
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
  errorText: {
    ...TYPOGRAPHY.meta,
    color: colors.danger,
    marginBottom: SPACING.md,
  },
});

export default SettingsScreen;
