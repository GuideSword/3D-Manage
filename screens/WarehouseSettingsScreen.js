import React, { useState } from 'react';
import { Text } from 'react-native';
import { Button, Card, Input } from '../components';
import MasterDataPage, { useMasterDataStyles } from '../components/MasterDataPage';
import EditLoadState from '../components/EditLoadState';
import { warehousesAPI } from '../utils/masterDataApi';
import { useEditRecord } from '../utils/useEditRecord';
import { useMasterDataMutation } from '../utils/useMasterDataMutation';
import { useAuth } from '../context/AuthContext';
import { canManage } from '../utils/permissions';

const defaultWarehouseAPI = { getById: () => warehousesAPI.getDefault() };
export default function WarehouseSettingsScreen({ navigation }) {
  const { user } = useAuth(), styles = useMasterDataStyles();
  const mutation = useMasterDataMutation(navigation);
  const [name, setName] = useState('');
  const { record, loadingRecord, loadError, reload } = useEditRecord('default', defaultWarehouseAPI, value => {
    setName(value.name); mutation.resetAfterLoad();
  });
  const save = async () => {
    const result = await mutation.run('warehouse.update', { id: record.id, version: record.version, name }, (body, key) => warehousesAPI.update(body, key));
    if (result) reload();
  };
  if (!record) return <EditLoadState loading={loadingRecord} error={loadError} onRetry={reload} onCancel={() => navigation.goBack()} />;
  return <MasterDataPage title="默认仓库">
    <Card><Text style={styles.text}>当前库存统一存放在这个仓库。仓库编号：{record.code}</Text>
      <Input label="仓库名称 *" value={name} maxLength={240} onChangeText={setName}
        editable={canManage(user) && !mutation.pending && !mutation.loading} /></Card>
    {!canManage(user) ? <Text style={styles.text}>仅管理员可修改仓库名称。</Text> : null}
    {mutation.error ? <Text style={styles.error}>{mutation.error}</Text> : null}
    {mutation.conflict ? <Button title="重新加载最新资料（替换当前输入）" variant="outline" onPress={reload} /> : null}
    {canManage(user) ? <Button title={mutation.pending && !mutation.loading ? '重试原保存' : '保存仓库名称'}
      loading={mutation.loading} disabled={mutation.conflict} onPress={save} /> : null}
  </MasterDataPage>;
}
