import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Button, Card, Input, Picker } from '../components';
import { ROLE_LABELS, ROLES, SPACING, TYPOGRAPHY } from '../constants';
import { useAppTheme } from '../context/ThemeContext';
import { usersAPI } from '../utils/api';

const ROLE_OPTIONS = [ROLES.STAFF, ROLES.VIEWER].map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
}));

const emptyForm = () => ({ name: '', email: '', password: '', role: ROLES.STAFF });

const UsersScreen = () => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [resetTarget, setResetTarget] = useState(null);
  const [resetPassword, setResetPassword] = useState('');

  const loadUsers = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    try {
      const result = await usersAPI.getAll();
      setUsers(result.items || []);
    } catch (error) {
      Alert.alert('加载失败', error.message || '无法获取用户');
    } finally {
      refresh ? setRefreshing(false) : setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    loadUsers();
  }, [loadUsers]));

  const createUser = async () => {
    if (!form.name.trim() || !form.email.trim() || form.password.length < 12) {
      Alert.alert('请检查输入', '姓名、邮箱必填，密码至少 12 位');
      return;
    }
    setLoading(true);
    try {
      await usersAPI.create({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        role: form.role,
      });
      setForm(emptyForm());
      await loadUsers();
    } catch (error) {
      Alert.alert('创建失败', error.message || '无法创建用户');
    } finally {
      setLoading(false);
    }
  };

  const updateUser = async (user, changes) => {
    try {
      const updated = await usersAPI.update(user.id, changes);
      setUsers((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (error) {
      Alert.alert('更新失败', error.message || '无法更新用户');
      await loadUsers();
    }
  };

  const toggleActive = (user) => {
    const nextActive = user.active === false;
    Alert.alert(
      nextActive ? '启用用户' : '停用用户',
      nextActive ? `确认启用 ${user.name}？` : `停用后 ${user.name} 的现有会话将立即失效。`,
      [
        { text: '取消', style: 'cancel' },
        { text: '确认', style: nextActive ? 'default' : 'destructive', onPress: () => updateUser(user, { active: nextActive }) },
      ]
    );
  };

  const submitReset = async () => {
    if (resetPassword.length < 12) {
      Alert.alert('请检查输入', '新密码至少 12 位');
      return;
    }
    setLoading(true);
    try {
      await usersAPI.resetPassword(resetTarget.id, resetPassword);
      setResetTarget(null);
      setResetPassword('');
      Alert.alert('已重置', '该用户的现有会话已失效');
    } catch (error) {
      Alert.alert('重置失败', error.message || '无法重置密码');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadUsers(true)} />}
      >
        <Text style={styles.title}>用户与权限</Text>
        <Text style={styles.subtitle}>Owner 创建 Staff 或 Viewer；角色、停用和密码变更会使旧会话失效。</Text>

        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>创建用户</Text>
          <Input label="姓名" value={form.name} onChangeText={(name) => setForm((value) => ({ ...value, name }))} />
          <Input label="邮箱" keyboardType="email-address" autoCapitalize="none" value={form.email} onChangeText={(email) => setForm((value) => ({ ...value, email }))} />
          <Input label="初始密码" secureTextEntry value={form.password} onChangeText={(password) => setForm((value) => ({ ...value, password }))} />
          <Picker label="角色" value={form.role} options={ROLE_OPTIONS} onValueChange={(role) => setForm((value) => ({ ...value, role }))} />
          <Button title="创建用户" loading={loading} onPress={createUser} fullWidth iconLeft="person-add-outline" />
        </Card>

        <Text style={styles.sectionTitle}>现有用户</Text>
        {users.map((user) => (
          <Card key={user.id} style={styles.card}>
            <View style={styles.userHeader}>
              <View style={styles.userIdentity}>
                <Text style={styles.userName}>{user.name}</Text>
                <Text style={styles.meta}>{user.email}</Text>
              </View>
              <Text style={[styles.state, user.active === false && styles.inactive]}>
                {user.active === false ? '已停用' : '已启用'}
              </Text>
            </View>
            {user.role === ROLES.OWNER ? (
              <Text style={styles.ownerLabel}>{ROLE_LABELS[ROLES.OWNER]}（受保护）</Text>
            ) : (
              <>
                <Picker label="角色" value={user.role} options={ROLE_OPTIONS} onValueChange={(role) => updateUser(user, { role })} />
                <View style={styles.actions}>
                  <Button title={user.active === false ? '启用' : '停用'} variant={user.active === false ? 'outline' : 'danger'} size="small" onPress={() => toggleActive(user)} style={styles.action} />
                  <Button title="重置密码" variant="outline" size="small" onPress={() => setResetTarget(user)} style={styles.action} />
                </View>
              </>
            )}
          </Card>
        ))}
      </ScrollView>

      <Modal visible={Boolean(resetTarget)} transparent animationType="fade" onRequestClose={() => setResetTarget(null)}>
        <View style={styles.overlay}>
          <Card style={styles.modalCard}>
            <Text style={styles.sectionTitle}>重置 {resetTarget?.name} 的密码</Text>
            <Input label="新密码" secureTextEntry value={resetPassword} onChangeText={setResetPassword} />
            <View style={styles.actions}>
              <Button title="取消" variant="ghost" onPress={() => setResetTarget(null)} style={styles.action} />
              <Button title="确认重置" loading={loading} onPress={submitReset} style={styles.action} />
            </View>
          </Card>
        </View>
      </Modal>
    </>
  );
};

const createStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: SPACING.lg, paddingBottom: SPACING.xxl },
  title: { ...TYPOGRAPHY.screenTitle, color: colors.text },
  subtitle: { ...TYPOGRAPHY.body, color: colors.textSecondary, marginTop: SPACING.xs, marginBottom: SPACING.lg },
  sectionTitle: { ...TYPOGRAPHY.sectionTitle, color: colors.text, marginBottom: SPACING.sm },
  card: { marginHorizontal: 0, marginBottom: SPACING.md },
  userHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.md },
  userIdentity: { flex: 1 },
  userName: { ...TYPOGRAPHY.sectionTitle, color: colors.text },
  meta: { ...TYPOGRAPHY.caption, color: colors.textSecondary, marginTop: 2 },
  state: { ...TYPOGRAPHY.caption, color: colors.success },
  inactive: { color: colors.danger },
  ownerLabel: { ...TYPOGRAPHY.meta, color: colors.primary, marginTop: SPACING.md },
  actions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md },
  action: { flex: 1 },
  overlay: { flex: 1, justifyContent: 'center', padding: SPACING.xl, backgroundColor: colors.overlay },
  modalCard: { width: '100%', maxWidth: 480, alignSelf: 'center', marginHorizontal: 0 },
});

export default UsersScreen;
