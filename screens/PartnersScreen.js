import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Button, Card, Input, Picker } from '../components';
import MasterDataPage, { useMasterDataStyles } from '../components/MasterDataPage';
import { useAuth } from '../context/AuthContext';
import { partnerAPI } from '../utils/masterDataApi';
import { canWrite } from '../utils/permissions';
import { isAuthRequiredError } from '../utils/api';
import { ROUTES } from '../constants';

export default function PartnersScreen({ navigation, route }) {
  const kind = route.params.kind;
  const label = kind === 'customers' ? '客户' : '供应商';
  const api = partnerAPI(kind);
  const { user } = useAuth();
  const styles = useMasterDataStyles();
  const [search, setSearch] = useState(''), [query, setQuery] = useState('');
  const [active, setActive] = useState('true'), [page, setPage] = useState(0), [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  useFocusEffect(useCallback(() => {
    let current = true;
    setLoading(true); setError('');
    api.getPage({ search: query, active, limit: 50, offset: page * 50 }).then(value => { if (current) setResult(value); })
      .catch(failure => { if (current && !isAuthRequiredError(failure) && !failure.staleSession) setError(failure.message); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [api, query, active, page, refresh]));
  return <MasterDataPage title={`${label}资料`}>
    {canWrite(user) ? <Button title={`新增${label}`} iconLeft="add-outline" onPress={() => navigation.navigate(ROUTES.EDIT_PARTNER, { kind })} /> : null}
    <Card>
      <Input label="搜索" placeholder="编号、名称、联系人或电话" value={search} onChangeText={setSearch}
        onSubmitEditing={() => { setQuery(search); setPage(0); }} />
      <Picker label="启用状态" value={active} options={[{ value: 'true', label: '已启用' }, { value: 'false', label: '已停用' }, { value: 'all', label: '全部' }]}
        onValueChange={value => { setActive(value); setPage(0); }} />
      <Button title="查询" variant="outline" onPress={() => { setQuery(search); setPage(0); setRefresh(value => value + 1); }} />
    </Card>
    {loading ? <ActivityIndicator /> : null}
    {error ? <><Text style={styles.error}>{error}</Text><Button title="重新加载" variant="outline" onPress={() => setRefresh(value => value + 1)} /></> : null}
    {!loading && !error && !result.items.length ? <Text style={styles.text}>暂无符合条件的{label}。</Text> : null}
    {!error ? result.items.map(item => <TouchableOpacity key={item.id} accessibilityRole="button" accessibilityLabel={`查看${label} ${item.code} ${item.name}`}
      onPress={() => navigation.navigate(ROUTES.PARTNER_DETAIL, { kind, id: item.id })}>
      <Card><Text style={styles.name}>{item.name}</Text><Text style={styles.text}>{item.code} · {item.active ? '已启用' : '已停用'}</Text>
        <Text style={styles.text}>{[item.contactName, item.phone].filter(Boolean).join(' · ') || '未填写联系方式'}</Text></Card>
    </TouchableOpacity>) : null}
    <Text style={styles.text}>共 {result.total} 条 · 第 {page + 1} 页</Text>
    <View style={styles.row}>
      <Button style={styles.grow} title="上一页" variant="outline" disabled={loading || page === 0} onPress={() => setPage(value => value - 1)} />
      <Button style={styles.grow} title="下一页" variant="outline" disabled={loading || (page + 1) * 50 >= result.total} onPress={() => setPage(value => value + 1)} />
    </View>
  </MasterDataPage>;
}
