import React, { useEffect, useMemo, useState } from 'react';
import { Text } from 'react-native';
import { Button, Input, Picker } from './index';
import { customersAPI } from '../utils/masterDataApi';
import { isAuthRequiredError } from '../utils/api';
import { useMasterDataStyles } from './MasterDataPage';

export default function CustomerSelector({ value, fallbackLabel, onSelect, disabled = false }) {
  const styles = useMasterDataStyles();
  const [search, setSearch] = useState(''), [query, setQuery] = useState(''), [page, setPage] = useState(0), [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState({ items: [], total: 0 }), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  useEffect(() => {
    if (disabled) return undefined;
    let current = true;
    setLoading(true); setError('');
    customersAPI.getPage({ search: query, active: 'true', limit: 50, offset: page * 50 }).then(data => { if (current) setResult(data); })
      .catch(failure => { if (current && !isAuthRequiredError(failure) && !failure.staleSession) setError(failure.message); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [query, page, refresh, disabled]);
  const options = useMemo(() => {
    const rows = result.items.map(row => ({ value: row.id, label: `${row.code} · ${row.name}${row.phone ? ` · ${row.phone}` : ''}` }));
    if (value && fallbackLabel) {
      const index = rows.findIndex(row => row.value === value);
      const selected = { value, label: fallbackLabel };
      if (index >= 0) rows[index] = selected; else rows.unshift(selected);
    }
    return [{ value: '', label: '请选择客户' }, ...rows];
  }, [result.items, value, fallbackLabel]);
  return <>
    <Input label="客户搜索" placeholder="编号、名称或电话" value={search} onChangeText={setSearch} editable={!disabled} />
    <Button title="搜索客户" variant="outline" loading={loading} disabled={disabled} onPress={() => { setQuery(search); setPage(0); setRefresh(count => count + 1); }} />
    <Picker label="客户 *" value={value} options={options} disabled={disabled || loading}
      onValueChange={id => onSelect(id, result.items.find(row => row.id === id) || null)} />
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {!disabled ? <>
      <Text style={styles.text}>搜索结果共 {result.total} 位客户 · 第 {page + 1} 页。同名客户请核对编号和电话。</Text>
      {result.total > 50 || page > 0 ? <>
        <Button title="上一页客户" variant="outline" disabled={loading || page === 0} onPress={() => setPage(count => count - 1)} />
        <Button title="下一页客户" variant="outline" disabled={loading || (page + 1) * 50 >= result.total} onPress={() => setPage(count => count + 1)} />
      </> : null}
    </> : null}
  </>;
}
