import React, { useMemo, useState } from 'react';
import { Alert, Platform, Text } from 'react-native';
import { Button, Card, Input, Picker } from '../components';
import MasterDataPage, { useMasterDataStyles } from '../components/MasterDataPage';
import PaginationControls from '../components/PaginationControls';
import { useAuth } from '../context/AuthContext';
import { canManage } from '../utils/permissions';
import { isAuthRequiredError } from '../utils/api';
import { relationalMaterialsAPI } from '../utils/relationalCatalogApi';
import { relationalInventoryAPI } from '../utils/relationalInventoryApi';
import { useInventorySummary } from '../utils/useInventorySummary';
import { useRelationalPage } from '../utils/useRelationalPage';
import { useMasterDataMutation } from '../utils/useMasterDataMutation';
import inventoryCore from '../utils/relationalInventoryCore.cjs';

const TITLES = { in: '入库', out: '出库', adjust: '盘点' };
export default function RelationalInventoryTransactionScreen({ kind, navigation }) {
  const { user } = useAuth(), styles = useMasterDataStyles();
  const mutation = useMasterDataMutation(navigation);
  const [form, setForm] = useState({ mode: 'new', materialId: '', lotId: '', lotNo: '', location: '', qty: '', notes: '' });
  const [materialSearch, setMaterialSearch] = useState(''), [lotSearch, setLotSearch] = useState('');
  const [material, setMaterial] = useState(null), [lot, setLot] = useState(null), [reloading, setReloading] = useState(false);
  const creating = kind === 'in' && form.mode === 'new';
  const materials = useRelationalPage(relationalMaterialsAPI.getPage, { search: materialSearch, active: true }, creating);
  const lots = useRelationalPage(relationalInventoryAPI.getLotsPage, { search: lotSearch, active: true, state: 'in_stock' }, !creating);
  const summary = useInventorySummary();
  const summaries = useMemo(() => new Map((summary.rows || []).map(row => [row.materialId, row])), [summary.rows]);
  const locked = mutation.loading || Boolean(mutation.pending) || mutation.conflict || reloading;
  const title = TITLES[kind];
  const change = (key, value) => setForm(previous => ({ ...previous, [key]: value }));
  const materialLabel = row => [row.type || row.materialType, row.brand, row.color].filter(Boolean).join(' · ');
  const lotLabel = row => `${row.lotNo || row.lot_no || row.id} · ${summaries.get(row.materialId)?.materialName || ''}（${row.qty}g）`;
  const success = () => {
    if (Platform.OS === 'web') navigation.goBack();
    else Alert.alert('成功', `${title}操作成功`, [{ text: '确定', onPress: () => navigation.goBack() }]);
  };
  const save = async () => {
    try {
      if (mutation.pending) {
        const command = mutation.pending;
        const result = await mutation.run(command.operation, command.payload, command.send);
        if (result !== null) success();
        return;
      }
      const payload = inventoryCore.inventoryTransactionPayload(kind, form, lot);
      const result = await mutation.run(creating ? 'lot.create' : 'inventory.post', payload,
        (body, key) => creating ? relationalInventoryAPI.createLot(body, key) : relationalInventoryAPI.post(body, key));
      if (result !== null) success();
    } catch (error) { if (!isAuthRequiredError(error) && !error.staleSession) mutation.setError(error.message); }
  };
  const reloadLot = async () => {
    try {
      setReloading(true);
      const latest = await relationalInventoryAPI.getLotById(form.lotId);
      setLot(latest); mutation.resetAfterLoad(); await lots.refresh();
    } catch (error) { if (!isAuthRequiredError(error) && !error.staleSession) mutation.setError(error.message); }
    finally { setReloading(false); }
  };
  if (kind === 'adjust' && !canManage(user)) return <MasterDataPage title="盘点"><Text style={styles.error}>只有 Owner 可以执行盘点。</Text></MasterDataPage>;
  return <MasterDataPage title={title}>
    <Card>
      {kind === 'in' ? <Picker label="入库方式" value={form.mode} disabled={locked}
        options={[{ value: 'new', label: '新建批次入库' }, { value: 'existing', label: '已有批次入库' }]}
        onValueChange={value => change('mode', value)} /> : null}
      {creating ? <>
        <Picker label="耗材 *" placeholder="请选择耗材" value={form.materialId} selectedLabel={material && materialLabel(material)} disabled={locked}
          options={materials.items.map(row => ({ value: row.id, label: materialLabel(row) }))}
          searchValue={materialSearch} onSearchChange={setMaterialSearch} searchPlaceholder="搜索耗材类型、品牌或颜色"
          listFooter={<PaginationControls page={materials} />}
          onValueChange={value => { setMaterial(materials.items.find(row => row.id === value)); change('materialId', value); }} />
        <Input label="批次号 *" value={form.lotNo} editable={!locked} onChangeText={value => change('lotNo', value)} />
        <Input label="库位" value={form.location} editable={!locked} onChangeText={value => change('location', value)} />
      </> : <Picker label="库存批次 *" placeholder="请选择库存批次" value={form.lotId} selectedLabel={lot && lotLabel(lot)} disabled={locked}
        options={lots.items.map(row => ({ value: row.id, label: lotLabel(row) }))}
        searchValue={lotSearch} onSearchChange={setLotSearch} searchPlaceholder="搜索批次号、库位或备注"
        listFooter={<PaginationControls page={lots} />}
        onValueChange={value => { const selected = lots.items.find(row => row.id === value); setLot(selected); setForm(previous => ({ ...previous, lotId: value, ...(kind === 'adjust' ? { qty: selected?.qty ?? '' } : {}) })); }} />}
      {!creating && lot ? <Text style={styles.text}>当前库存：{lot.qty}g{lot.balanceStatus === 'legacy_unverified' ? ' · 历史余额待核对' : ''}</Text> : null}
      <Input label={kind === 'adjust' ? '实盘数量 (g) *' : '数量 (g) *'} value={form.qty} editable={!locked} keyboardType="decimal-pad" onChangeText={value => change('qty', value)} />
      <Input label="备注" value={form.notes} editable={!locked} multiline onChangeText={value => change('notes', value)} />
    </Card>
    {summary.error ? <><Text style={styles.error}>{summary.error}</Text><Button title="重试耗材信息" variant="outline" onPress={summary.refresh} disabled={locked} /></> : null}
    {mutation.error ? <Text style={styles.error}>{mutation.error}</Text> : null}
    {mutation.pending && !mutation.loading ? <Text style={styles.text}>上次操作结果尚未确认，请重试原操作。</Text> : null}
    {mutation.conflict ? <Button title="重新加载批次" variant="outline" onPress={reloadLot} loading={reloading} /> : null}
    <Button title={mutation.pending && !mutation.loading ? '重试原操作' : `确认${title}`} loading={mutation.loading}
      disabled={mutation.conflict || reloading} onPress={save} />
    <Button title="取消" variant="outline" disabled={Boolean(mutation.pending) || mutation.loading} onPress={() => navigation.goBack()} />
  </MasterDataPage>;
}
