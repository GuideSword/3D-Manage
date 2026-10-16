import React, { useState } from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';
import { Button, Card, Input, Picker } from '../components';
import MasterDataPage, { useMasterDataStyles } from '../components/MasterDataPage';
import PaginationControls from '../components/PaginationControls';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABELS } from '../constants';
import { relationalUsersAPI as api } from '../utils/relationalUsersApi';
import { useRelationalPage } from '../utils/useRelationalPage';
import { useMasterDataMutation } from '../utils/useMasterDataMutation';
import { confirmAction } from '../utils/confirmAction';
import { isAuthRequiredError } from '../utils/api';
import usersCore from '../utils/relationalUsersCore.cjs';

const ROLES = ['staff', 'viewer'].map(value => ({ value, label: ROLE_LABELS[value] }));
const blank = () => ({ name: '', email: '', role: 'staff', password: '' });
export default function RelationalUsersScreen({ navigation }) {
  const styles = useMasterDataStyles(), { user: actor } = useAuth();
  const [search, setSearch] = useState(''), [form, setForm] = useState(blank);
  const page = useRelationalPage(api.getPage, { search: search.trim() });
  const mutation = useMasterDataMutation(navigation);
  const [edit, setEdit] = useState(null), [editName, setEditName] = useState(''), [password, setPassword] = useState('');
  const [affectedId, setAffectedId] = useState(null), [reloading, setReloading] = useState(false);
  const locked = mutation.loading || Boolean(mutation.pending) || mutation.conflict || reloading;
  const finish = async operation => { setEdit(null); setPassword(''); if (operation === 'user.create') setForm(blank()); await page.refresh(); };
  const perform = async (operation, payload, send) => {
    setAffectedId(payload.id || null);
    const result = await mutation.run(operation, payload, send);
    if (result !== null) await finish(operation);
  };
  const create = async () => {
    try { await perform('user.create', usersCore.userCreate(form), (body, key) => api.create(body, key)); }
    catch (error) { mutation.setError(error.message); }
  };
  const saveEdit = async () => {
    try {
      if (edit.mode === 'name') {
        const payload = { id: edit.user.id, version: edit.user.version, changes: usersCore.userChanges({ name: editName }) };
        await perform('user.update', payload, (body, key) => api.update(body.id, { version: body.version, changes: body.changes }, key));
      } else {
        const payload = { id: edit.user.id, version: edit.user.version, password: usersCore.validatePassword(password) };
        await perform('user.resetPassword', payload, (body, key) => api.resetPassword(body.id, { version: body.version, password: body.password }, key));
      }
    } catch (error) { mutation.setError(error.message); }
  };
  const update = async (user, changes) => {
    if (!await confirmAction('确认修改用户', changes.active === false ? `停用 ${user.name} 后，该账号现有会话将失效。` : `确认修改 ${user.name}？`)) return;
    await perform('user.update', { id: user.id, version: user.version, changes },
      (body, key) => api.update(body.id, { version: body.version, changes: body.changes }, key));
  };
  const remove = async user => {
    if (!await confirmAction('删除用户', `确认删除 ${user.name}？已有登录或业务历史的账号请使用停用。`, '删除')) return;
    await perform('user.delete', { id: user.id, version: user.version }, (body, key) => api.delete(body.id, body.version, key));
  };
  const reload = async () => {
    setReloading(true);
    try {
      if (affectedId) {
        const latest = await api.getById(affectedId);
        if (edit) { setEdit({ ...edit, user: latest }); setEditName(latest.name); setPassword(''); }
      }
      mutation.resetAfterLoad(); await page.refresh();
    } catch (error) { if (!isAuthRequiredError(error) && !error.staleSession) mutation.setError(error.message); }
    finally { setReloading(false); }
  };
  const feedback = () => <>
    {mutation.error ? <Text style={styles.error}>{mutation.error}</Text> : null}
    {mutation.pending && !mutation.loading ? <>
      <Text style={styles.text}>上次操作结果尚未确认，请重试原操作。</Text>
      <Button title="重试原操作" onPress={async () => {
        const command = mutation.pending;
        const result = await mutation.run(command.operation, command.payload, command.send);
        if (result !== null) await finish(command.operation);
      }} />
    </> : null}
    {mutation.conflict ? <Button title="重新加载用户资料" loading={reloading} onPress={reload} /> : null}
  </>;
  const open = (mode, user) => { mutation.resetAfterLoad(); setEdit({ mode, user }); setEditName(user.name); setPassword(''); };
  const close = () => { if (!locked) { setEdit(null); setPassword(''); mutation.resetAfterLoad(); } };
  return <MasterDataPage title="用户与权限">
    <Text style={styles.text}>创建员工或查看者；角色、停用与密码变更会使旧会话失效。</Text>
    {!edit ? feedback() : null}
    <Card>
      <Text style={styles.name}>创建用户</Text>
      <Input label="姓名" value={form.name} editable={!locked} onChangeText={name => setForm(old => ({ ...old, name }))} />
      <Input label="邮箱" value={form.email} editable={!locked} autoCapitalize="none" keyboardType="email-address" onChangeText={email => setForm(old => ({ ...old, email }))} />
      <Input label="初始密码" value={form.password} editable={!locked} secureTextEntry onChangeText={password => setForm(old => ({ ...old, password }))} />
      <Picker label="角色" value={form.role} options={ROLES} disabled={locked} onValueChange={role => setForm(old => ({ ...old, role }))} />
      <Button title="创建用户" disabled={locked} loading={mutation.loading && !edit} onPress={create} />
    </Card>
    <Input label="搜索用户" value={search} editable={!locked} onChangeText={setSearch} placeholder="姓名或邮箱" />
    <Button title="刷新用户列表" variant="outline" disabled={locked} onPress={page.refresh} />
    {page.items.map(user => <Card key={user.id}>
      <Text style={styles.name}>{user.name}</Text><Text style={styles.text}>{user.email}</Text>
      <Text style={styles.text}>{ROLE_LABELS[user.role]} · {user.active === false ? '已停用' : '已启用'}{user.role === 'owner' ? ' · 受保护' : ''}</Text>
      <Button title="编辑姓名" variant="outline" disabled={locked} onPress={() => open('name', user)} />
      {user.role !== 'owner' ? <>
        <Picker label="角色" value={user.role} options={ROLES} disabled={locked} onValueChange={role => { if (role !== user.role) update(user, { role }); }} />
        <Button title={user.active === false ? '启用' : '停用'} variant="outline" disabled={locked} onPress={() => update(user, { active: user.active === false })} />
        <Button title="重置密码" variant="outline" disabled={locked} onPress={() => open('password', user)} />
        {user.id !== actor?.id ? <Button title="删除用户" variant="danger" disabled={locked} onPress={() => remove(user)} /> : null}
      </> : null}
    </Card>)}
    {!locked ? <PaginationControls page={page} /> : null}
    <Modal visible={Boolean(edit)} transparent animationType="fade" onRequestClose={close}>
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: '#0008', padding: 20 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
          <Card style={{ width: '100%', maxWidth: 600, alignSelf: 'center' }}>
            <Text style={styles.name}>{edit?.mode === 'name' ? '编辑用户姓名' : '重置用户密码'}</Text>
            <Text style={styles.text}>{edit?.user.email}</Text>
            {edit?.mode === 'name' ? <Input label="姓名 *" value={editName} editable={!locked} onChangeText={setEditName} />
              : <><Text style={styles.text}>重置后该用户现有会话将失效。</Text><Input label="新密码" secureTextEntry value={password} editable={!locked} onChangeText={setPassword} /></>}
            {feedback()}
            <Button title="保存修改" disabled={locked} loading={mutation.loading} onPress={saveEdit} />
            <Button title="取消" variant="outline" disabled={locked} onPress={close} />
          </Card>
        </ScrollView>
      </View>
    </Modal>
  </MasterDataPage>;
}
