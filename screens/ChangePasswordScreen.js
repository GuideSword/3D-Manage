import React, { useRef, useState } from 'react';
import { Text } from 'react-native';
import { Button, Card, Input } from '../components';
import MasterDataPage, { useMasterDataStyles } from '../components/MasterDataPage';
import EditLoadState from '../components/EditLoadState';
import { useAuth } from '../context/AuthContext';
import { useServerConfig } from '../context/ServerConfigContext';
import { authAPI, isAuthRequiredError } from '../utils/api';
import { relationalUsersAPI } from '../utils/relationalUsersApi';
import { useEditRecord } from '../utils/useEditRecord';
import { useMasterDataMutation } from '../utils/useMasterDataMutation';
import masterDataCore from '../utils/masterDataCore.cjs';
import usersCore from '../utils/relationalUsersCore.cjs';

const ownRecord = { getById: async () => {
  const result = await authAPI.me();
  return result.user || result;
} };
const blank = () => ({ currentPassword: '', newPassword: '', confirmPassword: '' });
export default function ChangePasswordScreen({ navigation }) {
  const { user, signOut } = useAuth(), { server } = useServerConfig();
  const relational = masterDataCore.supportsMasterData(server), styles = useMasterDataStyles();
  const [form, setForm] = useState(blank), [legacyBusy, setLegacyBusy] = useState(false), [legacyUnknown, setLegacyUnknown] = useState(false);
  const submitting = useRef(false);
  const mutation = useMasterDataMutation(navigation);
  const { record, loadingRecord, loadError, reload } = useEditRecord(user?.id, ownRecord, () => mutation.resetAfterLoad());
  const locked = mutation.loading || Boolean(mutation.pending) || mutation.conflict || legacyBusy || legacyUnknown;
  const exit = async () => { setForm(blank()); try { await signOut(); } catch (_) { /* AuthContext exposes cleanup retry on login/settings. */ } };
  const save = async () => {
    if (submitting.current) return;
    submitting.current = true;
    try {
      if (relational) {
        const payload = mutation.pending?.payload || usersCore.ownPasswordPayload(form, record);
        const result = await mutation.run('account.changePassword', payload, (body, key) => relationalUsersAPI.changeOwnPassword(body, key));
        if (result !== null) await exit();
      } else {
        if (legacyUnknown) return;
        // Legacy servers do not offer idempotent account writes. Never auto-replay an unknown result.
        const payload = usersCore.ownPasswordPayload(form, { version: '1' });
        setLegacyBusy(true); mutation.setError('');
        await authAPI.changePassword({ currentPassword: payload.currentPassword, newPassword: payload.newPassword });
        await exit();
      }
    } catch (error) {
      if (!isAuthRequiredError(error) && !error.staleSession) {
        mutation.setError(error.message || '修改密码失败');
        if (!relational && !(error.status >= 400 && error.status < 500)) setLegacyUnknown(true);
      }
    } finally { submitting.current = false; setLegacyBusy(false); }
  };
  if (!record) return <EditLoadState loading={loadingRecord} error={loadError} onRetry={reload} onCancel={() => navigation.goBack()} />;
  return <MasterDataPage title="修改本人密码">
    <Text style={styles.text}>修改成功后会退出登录，请使用新密码重新登录。若提交后连接中断，新密码可能已生效。</Text>
    <Card>
      <Text style={styles.text}>{record.email}</Text>
      {[
        ['currentPassword', '当前密码'], ['newPassword', '新密码'], ['confirmPassword', '确认新密码'],
      ].map(([key, label]) => <Input key={key} label={label} secureTextEntry autoCapitalize="none" autoCorrect={false}
        value={form[key]} editable={!locked} onChangeText={value => setForm(old => ({ ...old, [key]: value }))} />)}
      <Text style={styles.text}>新密码至少12个字符，最多72个UTF-8字节；空格也属于密码。</Text>
    </Card>
    {mutation.error ? <Text style={styles.error}>{mutation.error}</Text> : null}
    {mutation.pending || legacyUnknown ? <Text style={styles.text}>上次修改结果尚未确认。你可以退出后尝试用新密码登录；如未生效，再用原密码登录。</Text> : null}
    {mutation.conflict ? <Button title="重新加载本人资料" variant="outline" onPress={reload} /> : null}
    <Button title={mutation.pending && !mutation.loading ? '重试原改密请求' : '确认修改密码'}
      loading={mutation.loading || legacyBusy} disabled={mutation.conflict || legacyUnknown} onPress={save} />
    {mutation.pending || legacyUnknown ? <Button title="退出并重新登录" variant="outline" disabled={mutation.loading || legacyBusy} onPress={exit} /> : null}
    <Button title="取消" variant="outline" disabled={locked} onPress={() => navigation.goBack()} />
  </MasterDataPage>;
}
