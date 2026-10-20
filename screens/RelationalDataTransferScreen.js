import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Text } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Button, Card, Input, Picker } from '../components';
import MasterDataPage, { useMasterDataStyles } from '../components/MasterDataPage';
import { useAuth } from '../context/AuthContext';
import { canManage } from '../utils/permissions';
import { isAuthRequiredError } from '../utils/api';
import { getServerRuntime, isCurrentRuntime, StaleSessionError } from '../utils/serverRuntime';
import { isAppCacheFile, trackSessionFile } from '../utils/sessionFiles';
import { relationalCsvAPI } from '../utils/relationalCsvApi';
import { exportCsvFile } from '../utils/csvFileExport';
import { useMasterDataMutation } from '../utils/useMasterDataMutation';
import csvCore from '../utils/relationalCsvCore.cjs';
import assetCore from '../utils/csvAssetCore.cjs';

const KINDS = ['orders', 'models', 'materials', 'lots', 'transactions'];
export default function RelationalDataTransferScreen({ navigation }) {
  const styles = useMasterDataStyles(), { user } = useAuth();
  const [mode, setMode] = useState('import'), [kind, setKind] = useState('orders');
  const [csv, setCsv] = useState(''), [filename, setFilename] = useState('');
  const [search, setSearch] = useState(''), [active, setActive] = useState('all');
  const [busy, setBusy] = useState(false), [success, setSuccess] = useState('');
  const mutation = useMasterDataMutation(navigation), mounted = useRef(true), activity = useRef(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => navigation.addListener('beforeRemove', event => {
    if (activity.current && isCurrentRuntime(activity.current)) {
      event.preventDefault(); mutation.setError('请等待文件处理完成后再离开。');
    }
  }), [navigation]);
  const reader = useMemo(() => assetCore.createScopedCsvReader({
    pick: () => DocumentPicker.getDocumentAsync({ type: [...assetCore.CSV_MIME_TYPES], copyToCacheDirectory: true }),
    isCurrent: captured => mounted.current && isCurrentRuntime(captured), staleError: () => new StaleSessionError(),
    isOwned: isAppCacheFile,
    read: asset => asset.file && typeof asset.file.text === 'function' ? asset.file.text()
      : FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.UTF8 }),
    track: trackSessionFile, remove: uri => FileSystem.deleteAsync(uri, { idempotent: true }),
  }), []);
  const locked = busy || mutation.loading || Boolean(mutation.pending);
  const definition = csvCore.csvDefinition(kind);
  const reportError = error => {
    if (mounted.current && !isAuthRequiredError(error) && !error.staleSession) mutation.setError(error.message || '文件处理失败，请重试');
  };
  const pick = async () => {
    if (activity.current || locked) return;
    const captured = getServerRuntime(); activity.current = captured; setBusy(true); mutation.setError(''); setSuccess('');
    try { const result = await reader(captured); if (result) { setCsv(result.csv); setFilename(result.filename); } }
    catch (error) { reportError(error); }
    finally { activity.current = null; if (mounted.current) setBusy(false); }
  };
  const importRecords = async () => {
    setSuccess('');
    try {
      const command = mutation.pending;
      const payload = command?.payload || { kind, ...csvCore.csvImportPayload({ csv }) };
      const result = await mutation.run(command?.operation || `csv.${kind}.import`, payload,
        command?.send || ((body, key) => relationalCsvAPI.importRecords(body.kind, { csv: body.csv }, key)));
      if (result !== null) { setSuccess(`已导入 ${result.imported} 条数据`); setCsv(''); setFilename(''); }
    } catch (error) { reportError(error); }
  };
  const exportRecords = async () => {
    if (activity.current || locked) return;
    const captured = getServerRuntime(); activity.current = captured; setBusy(true); mutation.setError(''); setSuccess('');
    try {
      const file = await relationalCsvAPI.exportRecords(kind, { ...(search.trim() ? { search: search.trim() } : {}),
        ...(kind !== 'transactions' && active !== 'all' ? { active: active === 'true' } : {}) });
      if (!mounted.current || !isCurrentRuntime(captured)) throw new StaleSessionError();
      await exportCsvFile(file, captured);
      if (mounted.current && isCurrentRuntime(captured)) setSuccess(`已导出 ${file.count} 行数据：${file.filename}`);
    } catch (error) { reportError(error); }
    finally { activity.current = null; if (mounted.current) setBusy(false); }
  };
  if (!canManage(user)) return <MasterDataPage title="CSV导入导出"><Text style={styles.error}>只有Owner可使用此入口。</Text></MasterDataPage>;
  return <MasterDataPage title="CSV导入导出">
    <Text style={styles.text}>CSV导入只新建资料，不覆盖原记录。CSV不包含附件、账号、审计或AI对话，不能代替完整备份。</Text>
    <Card>
      <Picker label="操作" value={mode} options={[{ value: 'import', label: '导入' }, { value: 'export', label: '导出' }]} disabled={locked}
        onValueChange={value => { setMode(value); setSuccess(''); mutation.resetAfterLoad(); if (value === 'import' && kind === 'transactions') setKind('orders'); }} />
      <Picker label="模块" value={kind} options={KINDS.filter(value => mode === 'export' || csvCore.csvDefinition(value).canImport).map(value => ({ value, label: csvCore.csvDefinition(value).label }))}
        disabled={locked} onValueChange={value => { setKind(value); setCsv(''); setFilename(''); setSuccess(''); mutation.resetAfterLoad(); }} />
    </Card>
    {mode === 'import' ? <Card>
      <Text style={styles.name}>示例表头</Text><Text style={styles.text} selectable>{definition.header}</Text>
      <Text style={styles.text}>{definition.hint}</Text>
      <Text style={styles.text}>每次最多1000行、10MiB；整批校验失败不会部分导入。金额与数量请保留小数文本。</Text>
      {filename ? <Text style={styles.text}>已选文件：{filename}</Text> : null}
      <Button title="选择CSV文件" variant="outline" disabled={locked} onPress={pick} />
      <Input label="CSV" placeholder="粘贴CSV内容" value={csv} editable={!locked} multiline numberOfLines={10}
        onChangeText={value => { setCsv(value); setFilename(''); setSuccess(''); }} />
    </Card> : <Card>
      <Text style={styles.text}>按所选筛选导出完整结果，不受列表分页影响。订单一行代表一条明细，行数可能大于订单数。</Text>
      <Input label="搜索筛选" placeholder="留空导出全部" value={search} editable={!locked} onChangeText={setSearch} />
      {kind !== 'transactions' ? <Picker label="启用状态" value={active} disabled={locked} options={[{ value: 'all', label: '全部' }, { value: 'true', label: '已启用' }, { value: 'false', label: '已停用' }]} onValueChange={setActive} /> : null}
    </Card>}
    {mutation.error ? <Text style={styles.error}>{mutation.error}</Text> : null}
    {mutation.pending && !mutation.loading ? <Text style={styles.text}>上次导入结果尚未确认，请重试原操作；模块和CSV内容已锁定。</Text> : null}
    {success ? <><Text style={styles.text}>{success}</Text><Button title="完成并返回" variant="outline" onPress={() => navigation.goBack()} /></> : null}
    <Button title={mutation.pending && !mutation.loading ? '重试原导入' : mode === 'import' ? '确认导入' : '导出CSV文件'}
      loading={mutation.loading || busy} disabled={busy} onPress={mode === 'import' ? importRecords : exportRecords} />
    <Button title="取消" variant="outline" disabled={locked} onPress={() => navigation.goBack()} />
  </MasterDataPage>;
}
