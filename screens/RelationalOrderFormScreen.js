import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as DocumentPicker from 'expo-document-picker';
import { useSavedRecordFiles } from '../utils/useSavedRecordFiles';
import queueCore from '../utils/savedRecordFilesCore.cjs';
import filesCore from '../utils/relationalFilesCore.cjs';
import RelationalFileFeedback from '../components/RelationalFileFeedback';
import { pickerAssetToFormFile } from '../utils/upload';
import { trackPickedAsset } from '../utils/sessionStorage';
import { getServerRuntime, isCurrentRuntime } from '../utils/serverRuntime';
import { Button, Card, Input, Picker } from '../components';
import CustomerSelector from '../components/CustomerSelector';
import MasterDataPage, { useMasterDataStyles } from '../components/MasterDataPage';
import EditLoadState from '../components/EditLoadState';
import { ORDER_STATUS_LABELS, ROUTES } from '../constants';
import { modelsAPI, materialsAPI, isAuthRequiredError } from '../utils/api';
import { customersAPI } from '../utils/masterDataApi';
import { relationalOrdersAPI } from '../utils/relationalOrdersApi';
import { useEditRecord } from '../utils/useEditRecord';
import { useMasterDataMutation } from '../utils/useMasterDataMutation';
import { useAppTheme } from '../context/ThemeContext';
import orderCore from '../utils/relationalOrderCore.cjs';

export default function RelationalOrderFormScreen({ navigation, route }) {
  const orderId = route.params?.orderId;
  const styles = useMasterDataStyles(), mutation = useMasterDataMutation(navigation);
  const savedFiles = useSavedRecordFiles(navigation, 'orders', relationalOrdersAPI);
  const formRuntime = useRef(getServerRuntime());
  const [selectedAttachment, setSelectedAttachment] = useState(null);
  const { colors } = useAppTheme();
  const [form, setForm] = useState(() => orderCore.orderToForm());
  const [choice, setChoice] = useState(null), [latestCustomer, setLatestCustomer] = useState(null);
  const [showDate, setShowDate] = useState(false), [checkingCustomer, setCheckingCustomer] = useState(false);
  const [models, setModels] = useState([]), [materials, setMaterials] = useState([]), [optionsError, setOptionsError] = useState('');
  const [modelSearch, setModelSearch] = useState(''), [query, setQuery] = useState(''), [refreshOptions, setRefreshOptions] = useState(0), [loadingOptions, setLoadingOptions] = useState(true);
  const { record, loadingRecord, loadError, reload } = useEditRecord(orderId, relationalOrdersAPI, data => {
    setForm(orderCore.orderToForm(data)); setChoice(null); setLatestCustomer(null); mutation.resetAfterLoad();
  });
  useEffect(() => {
    let current = true;
    setLoadingOptions(true); setOptionsError('');
    Promise.all([modelsAPI.getAll({ search: query, active: 'true', pageSize: 200 }), materialsAPI.getAll({ active: 'true', pageSize: 200 })])
      .then(([modelRows, materialRows]) => { if (current) { setModels(modelRows); setMaterials(materialRows); } })
      .catch(error => { if (current && !isAuthRequiredError(error) && !error.staleSession) setOptionsError(error.message); })
      .finally(() => { if (current) setLoadingOptions(false); });
    return () => { current = false; };
  }, [query, refreshOptions]);
  const locked = Boolean(mutation.pending) || mutation.loading || checkingCustomer || loadingRecord || Boolean(savedFiles.savedRecord) || savedFiles.busy;
  const commercial = orderCore.commercialEditable(record);
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const changeLine = (index, key, value) => setForm(current => ({ ...current, items: current.items.map((line, position) => position === index
    ? { ...line, [key]: value, ...(key === 'modelId' ? { modelName: models.find(model => model.id === value)?.name || '' } : {}) } : line) }));
  const finishSavedOrder = result => {
    if (!result) return;
    if (record) navigation.goBack();
    else navigation.replace(ROUTES.ORDER_DETAIL, { orderId: result.id });
  };
  const pickAttachment = async () => {
    if (locked || !isCurrentRuntime(formRuntime.current)) return;
    const captured = getServerRuntime();
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
      if (picked.canceled || !isCurrentRuntime(captured)) return;
      const asset = picked.assets?.[0]; await trackPickedAsset(asset);
      if (!isCurrentRuntime(captured)) return;
      filesCore.validateFileAsset('attachments', asset?.file || asset);
      setSelectedAttachment(asset); mutation.setError('');
    } catch (error) { if (!isAuthRequiredError(error) && !error.staleSession) mutation.setError(error.message || '选择附件失败'); }
  };
  const reloadSavedOrder = async () => {
    const fresh = await savedFiles.reload();
    if (fresh) { setForm(orderCore.orderToForm(fresh)); setChoice(null); setLatestCustomer(null); }
  };
  const save = async () => {
    if (!isCurrentRuntime(formRuntime.current)) return;
    try {
      if (savedFiles.savedRecord) { finishSavedOrder(await savedFiles.retry()); return; }
      const files = queueCore.validateFileQueue('orders', selectedAttachment ? [{ child: 'attachments', file: pickerAssetToFormFile(selectedAttachment) }] : []);
      const payload = orderCore.orderPayload(form, record);
      const unchanged = record && !Object.keys(payload.changes).length;
      if (unchanged && !files.length) { mutation.setError('没有需要保存的修改'); return; }
      const result = unchanged ? record : await mutation.run(record ? 'order.update' : 'order.create', payload,
        (body, key) => Promise.resolve(record ? relationalOrdersAPI.update(orderId, body, key) : relationalOrdersAPI.create(body, key))
          .then(saved => queueCore.validateSavedRecord(saved, record ? { id: orderId, version: body.version } : {})));
      if (result && isCurrentRuntime(formRuntime.current)) finishSavedOrder(await savedFiles.start(result, files));
    } catch (error) { mutation.setError(error.message); }
  };
  const compareCustomer = async () => {
    try {
      const current = orderCore.orderPayload(form, record);
      if (Object.keys(current.changes).length) { mutation.setError('请先保存当前修改，再核对客户最新资料'); return; }
      setCheckingCustomer(true); mutation.setError('');
      setLatestCustomer(await customersAPI.getById(record.customerId));
    } catch (error) { if (!isAuthRequiredError(error) && !error.staleSession) mutation.setError(error.message); }
    finally { setCheckingCustomer(false); }
  };
  const refreshCustomer = async () => {
    const payload = { version: record.version };
    const result = await mutation.run('order.refreshCustomer', payload, (body, key) => relationalOrdersAPI.refreshCustomer(orderId, body.version, key));
    if (result) reload();
  };
  if (orderId && !record) return <EditLoadState loading={loadingRecord} error={loadError} onRetry={reload} onCancel={() => navigation.goBack()} />;
  let total = '';
  try { total = orderCore.previewTotal(form.items, record); } catch (_) { /* Incomplete inputs do not have a price preview. */ }
  const currentRecord = savedFiles.savedRecord || record;
  const selected = choice || (currentRecord && form.customerId === currentRecord.customerId ? currentRecord.customer : null);
  const customerLabel = selected ? `${selected.code || form.customerId} · ${selected.name}${selected.phone ? ` · ${selected.phone}` : ''}` : undefined;
  const materialOptions = [...new Set(materials.map(material => material.type || material.materialType).filter(Boolean))].map(type => ({ value: type, label: type }));
  return <MasterDataPage title={record ? '编辑订单' : '新建订单'}>
    <Card>
      <Text style={styles.name}>客户信息</Text>
      {record ? <><Text style={styles.text}>订单原客户：{record.customer?.name || '未填写'} · {record.customer?.phone || '未填写电话'}</Text>
        <Text style={styles.text}>客户档案更名不会自动改变这份订单的历史资料。</Text></> : null}
      {commercial ? <CustomerSelector value={form.customerId} fallbackLabel={customerLabel} disabled={locked || Boolean(latestCustomer)} onSelect={(id, customer) => {
        change('customerId', id); setChoice(record && id === record.customerId ? null : customer); setLatestCustomer(null);
      }} /> : null}
      {selected ? <Text style={styles.text}>所选客户：{selected.name} · {selected.phone || '未填写电话'} · {selected.email || '未填写邮箱'}</Text> : null}
      {!commercial ? <Text style={styles.text}>订单已进入执行，客户和项目规格保持原记录，可修改交期及说明。</Text> : null}
      {record && commercial && form.customerId === record.customerId ? <Button title="核对客户最新资料" variant="outline" disabled={locked || Boolean(latestCustomer)} loading={checkingCustomer} onPress={compareCustomer} /> : null}
      {latestCustomer ? <View>
        <Text style={styles.text}>档案最新资料：{latestCustomer.name} · {latestCustomer.phone || '未填写电话'} · {latestCustomer.email || '未填写邮箱'}</Text>
        <Text style={styles.text}>{latestCustomer.active ? '确认后，仅更新此订单的客户资料快照。' : '客户已停用，可继续保留订单原资料。'}</Text>
        <Button title="确认更新订单客户资料" disabled={!latestCustomer.active || locked} onPress={refreshCustomer} />
        <Button title="保留订单原资料" variant="outline" disabled={Boolean(mutation.pending)} onPress={() => setLatestCustomer(null)} />
      </View> : null}
    </Card>
    <Card>
      <Text style={styles.name}>订单信息</Text>
      {record ? <Text style={styles.text}>状态：{ORDER_STATUS_LABELS[record.status] || record.status}</Text> : <Picker label="保存状态" value={form.status} disabled={locked || Boolean(latestCustomer)}
        options={[{ value: 'draft', label: '草稿' }, { value: 'pending_review', label: '待审核' }]} onValueChange={value => change('status', value)} />}
      <Text style={styles.text}>币种：人民币</Text>
      {Platform.OS === 'web' ? <View><Text style={styles.text}>截止日期</Text><input aria-label="截止日期" type="date" value={form.dueDate.slice(0, 10)} disabled={locked || Boolean(latestCustomer)}
        style={{ width: '100%', boxSizing: 'border-box', padding: 12, fontSize: 16, borderRadius: 10, border: `1px solid ${colors.border}`, color: colors.text, backgroundColor: colors.surfaceElevated }} onChange={event => change('dueDate', event.target.value)} /></View>
        : <><Button title={form.dueDate ? `交期：${form.dueDate.slice(0, 10)}` : '选择交期'} variant="outline" disabled={locked || Boolean(latestCustomer)} onPress={() => setShowDate(true)} />
          {showDate ? <DateTimePicker value={form.dueDate ? new Date(`${form.dueDate.slice(0, 10)}T00:00:00`) : new Date()} mode="date" onChange={(_event, value) => {
            setShowDate(false); if (value) change('dueDate', `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`);
          }} /> : null}</>}
      {form.dueDate ? <Button title="清空交期" variant="outline" disabled={locked || Boolean(latestCustomer)} onPress={() => change('dueDate', '')} /> : null}
      <Input label="订单备注" value={form.notes} multiline numberOfLines={3} maxLength={10000} editable={!locked && !latestCustomer} onChangeText={value => change('notes', value)} />
    </Card>
    <Card><Text style={styles.name}>打印项目</Text>
      {commercial ? <><Input label="模型搜索" placeholder="按模型名称搜索" value={modelSearch} editable={!locked && !latestCustomer} onChangeText={setModelSearch} />
        <Button title="搜索模型" variant="outline" disabled={locked || Boolean(latestCustomer)} loading={loadingOptions} onPress={() => { setQuery(modelSearch); setRefreshOptions(count => count + 1); }} /></> : null}
      {optionsError ? <Text style={styles.error}>{optionsError}</Text> : null}
      {loadingOptions ? <ActivityIndicator /> : null}
    </Card>
    {form.items.map((line, index) => {
      const modelOptions = models.map(model => ({ value: model.id, label: model.name }));
      if (line.modelId && !modelOptions.some(option => option.value === line.modelId)) modelOptions.unshift({ value: line.modelId, label: line.modelName || line.modelId });
      const typeOptions = line.materialType && !materialOptions.some(option => option.value === line.materialType) ? [{ value: line.materialType, label: line.materialType }, ...materialOptions] : materialOptions;
      const editSpecs = commercial && !locked && !latestCustomer;
      return <Card key={line.id || `new-${index}`}>
        <Text style={styles.name}>项目 {index + 1}</Text>
        <Picker label="模型 *" placeholder={line.modelName || '请选择模型'} value={line.modelId} options={modelOptions} disabled={!editSpecs} onValueChange={value => changeLine(index, 'modelId', value)} />
        {line.modelName ? <Text style={styles.text}>记录名称：{line.modelName}</Text> : null}
        <Picker label="材质" value={line.materialType} options={typeOptions} disabled={!editSpecs} onValueChange={value => changeLine(index, 'materialType', value)} />
        <Input label="颜色" value={line.color} maxLength={240} editable={editSpecs} onChangeText={value => changeLine(index, 'color', value)} />
        <Input label="数量 *" value={line.quantity} keyboardType="decimal-pad" editable={editSpecs} onChangeText={value => changeLine(index, 'quantity', value)} />
        <Input label="单价（元）*" value={line.unitPrice} keyboardType="decimal-pad" editable={editSpecs} onChangeText={value => changeLine(index, 'unitPrice', value)} />
        <Input label="层高（毫米）" value={line.layerHeightMm} keyboardType="decimal-pad" editable={editSpecs} onChangeText={value => changeLine(index, 'layerHeightMm', value)} />
        <Input label="外部文件地址" value={line.externalFileUrl} maxLength={2000} autoCapitalize="none" editable={editSpecs} onChangeText={value => changeLine(index, 'externalFileUrl', value)} />
        <Input label="项目说明" value={line.notes} maxLength={10000} multiline numberOfLines={2} editable={!locked && !latestCustomer} onChangeText={value => changeLine(index, 'notes', value)} />
        {commercial ? <Button title={`移除项目 ${index + 1}`} variant="outline" disabled={!editSpecs || form.items.length <= 1} onPress={() => change('items', form.items.filter((_, position) => position !== index))} /> : null}
      </Card>;
    })}
    {commercial ? <Button title="添加打印项目" variant="outline" disabled={locked || Boolean(latestCustomer)} onPress={() => change('items', [...form.items, orderCore.newLine()])} /> : null}
    <Text style={styles.name}>{total ? `订单合计：¥${total}` : '填写数量和单价后显示合计'}</Text>
    {currentRecord?.attachments?.length ? <Card><Text style={styles.name}>已保存附件</Text>{currentRecord.attachments.map((file, index) => <Text key={file.fileKey || index} style={styles.text}>{file.originalName || file.name || file.fileKey}</Text>)}
      <Text style={styles.text}>编辑订单会保留这些附件。</Text></Card> : null}
    <Card>
      <Text style={styles.name}>追加订单附件</Text>
      <Text style={styles.text}>支持 PNG、JPG、JPEG、PDF，单个文件不超过50MiB。</Text>
      {selectedAttachment ? <Text style={styles.text}>{selectedAttachment.name}</Text> : null}
      <Button title={selectedAttachment ? '重新选择订单附件' : '选择订单附件'} variant="outline" disabled={locked} onPress={pickAttachment} />
      {selectedAttachment ? <Button title="清除待上传附件" variant="outline" disabled={locked} onPress={() => setSelectedAttachment(null)} /> : null}
    </Card>
    {savedFiles.savedRecord ? <Card>
      <Text style={styles.text}>订单资料已保存，还有 {savedFiles.remaining} 个附件待完成。请继续完成剩余附件。</Text>
      <RelationalFileFeedback mutation={savedFiles.feedback} onSaved={finishSavedOrder} onReload={reloadSavedOrder} allowCancel={false} />
      {!savedFiles.feedback.uncertain ? <Button title="前往已保存订单，稍后补附件" variant="outline" disabled={savedFiles.busy}
        onPress={async () => finishSavedOrder(await savedFiles.finishLater())} /> : null}
    </Card> : null}
    {mutation.error ? <Text style={styles.error}>{mutation.error}</Text> : null}
    {mutation.pending && !mutation.loading ? <Text style={styles.text}>上次操作结果未知，请重试原操作确认结果。</Text> : null}
    {mutation.conflict ? <Button title="重新加载最新订单（替换当前输入）" variant="outline" onPress={reload} /> : null}
    <Button title={savedFiles.savedRecord ? '继续保存附件' : mutation.pending && !mutation.loading ? '重试原操作' : record ? '保存修改' : '保存订单'} loading={mutation.loading}
      disabled={mutation.conflict || checkingCustomer || savedFiles.busy || savedFiles.feedback.pending || Boolean(latestCustomer && !mutation.pending)} onPress={() => mutation.pending?.operation === 'order.refreshCustomer' ? refreshCustomer() : save()} />
    <Button title="返回" variant="outline" disabled={Boolean(mutation.pending) || Boolean(savedFiles.savedRecord)} onPress={() => navigation.goBack()} />
  </MasterDataPage>;
}
