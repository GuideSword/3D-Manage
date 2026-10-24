import React from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { ORDER_STATUSES, ORDER_STATUS_LABELS } from '../../constants';
import { cyberTheme } from './theme';

const hero = require('../../assets/xiaoli/hero.png');
const statusColor = (status, t) => ({ pending_review: t.pink, in_progress: t.blue, completed: t.success, cancelled: t.danger }[status] || t.muted);
const dateText = value => value ? String(value).slice(0, 10) : '未设置';

function Action({ label, icon, onPress, t, primary, disabled }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
    style={({ hovered, pressed }) => [s.action, { backgroundColor: primary ? t.primary : t.glass, borderColor: t.border, opacity: disabled ? 0.5 : pressed ? 0.65 : hovered ? 0.82 : 1 }]}>
    <Ionicons name={icon} size={17} color={primary ? t.onPrimary : t.primary} /><Text style={[s.actionText, { color: primary ? t.onPrimary : t.text }]}>{label}</Text>
  </Pressable>;
}

export default function DesktopHome({ dark, stats, recentOrders, loading, refreshing, error, onRefresh, onOrders, onOrder, onInventory, onAgent, onCreate, onModel, onAdjust, onExport, exporting }) {
  const t = cyberTheme(dark);
  const busy = loading && !refreshing;
  const value = n => busy || n == null ? '—' : n;
  const panel = { backgroundColor: t.glass, borderColor: t.border };
  const metrics = [
    ['待审核订单', stats.pendingReview, 'document-text-outline', t.pink, () => onOrders(ORDER_STATUSES.PENDING_REVIEW), '确认委托，推进交付'],
    ['执行中订单', stats.inProgress, 'cube-outline', t.blue, () => onOrders(ORDER_STATUSES.IN_PROGRESS), '跟进正在执行的任务'],
    ['库存风险', stats.lowStock, 'layers-outline', t.danger, onInventory, '在库余量 ≤ 100g 的批次'],
  ];
  return <ScrollView style={{ flex: 1, backgroundColor: t.background }} contentContainerStyle={s.scroll}>
    <View style={s.page}>
      <View style={s.topbar}><Text style={[s.breadcrumb, { color: t.muted }]}>工作台  /  <Text style={{ color: t.text }}>运营概览</Text></Text>
        <View style={s.actions}><Action label={refreshing ? '刷新中…' : '刷新数据'} icon="refresh-outline" onPress={onRefresh} disabled={loading || refreshing} t={t} /><Action label="小鲤助手" icon="sparkles-outline" onPress={onAgent} t={t} />{onCreate && <Action label="新建订单" icon="add" onPress={onCreate} t={t} primary />}</View>
      </View>
      <LinearGradient colors={t.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
        <View style={s.heroCopy}><Text style={[s.eyebrow, { color: t.primary }]}>XIAOLI · PRINT WORKSPACE</Text><Text style={[s.title, { color: t.text }]}>把工坊的每一单，安排明白。</Text><Text style={[s.subtitle, { color: t.muted }]}>订单、模型与耗材，一处掌握。小鲤陪你专注创造。</Text>
          <Pressable accessibilityRole="button" onPress={() => onOrders('all')} style={s.heroLink}><Text style={{ color: t.primary, fontSize: 12, fontWeight: '800' }}>进入订单中心</Text><Ionicons name="arrow-forward" color={t.primary} size={17} /></Pressable>
        </View><Image source={hero} style={s.character} resizeMode="contain" />
      </LinearGradient>
      {!!error && <View accessibilityRole="alert" style={[s.error, { backgroundColor: t.dangerSoft }]}><Text style={{ color: t.danger }}>{error}，请点击刷新数据重试。</Text></View>}
      <View style={s.metrics}>{metrics.map(([label, count, icon, color, action, note]) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={`${label} ${value(count)}`} onPress={action} style={({ hovered }) => [s.metric, panel, hovered && { borderColor: color }]}>
        <View style={s.spread}><Text style={[s.metricLabel, { color: t.muted }]}>{label}</Text><View style={[s.metricIcon, { backgroundColor: `${color}14` }]}><Ionicons name={icon} size={20} color={color} /></View></View>
        <Text style={[s.number, { color: t.text }]}>{value(count)}<Text style={[s.unit, { color: t.muted }]}>  {label === '库存风险' ? '批次' : '单'}</Text></Text>
        <View style={s.spread}><Text style={[s.note, { color: t.muted }]}>{note}</Text><Ionicons name="arrow-forward" color={color} size={17} /></View>
      </Pressable>)}</View>
      <View style={s.columns}>
        <View style={[s.orderPanel, panel]}>
          <View style={s.panelHead}><View><Text style={[s.heading, { color: t.text }]}>最近订单</Text><Text style={[s.note, { color: t.muted, marginTop: 5 }]}>最近创建的委托与当前状态</Text></View><Pressable accessibilityRole="button" accessibilityLabel="查看全部订单" onPress={() => onOrders('all')}><Text style={{ color: t.primary, fontSize: 12 }}>查看全部 →</Text></Pressable></View>
          {busy ? <View style={s.empty}><ActivityIndicator color={t.primary} /><Text style={{ color: t.muted }}>正在整理订单…</Text></View> : recentOrders.length ? <>
            <View style={[s.tableHead, { backgroundColor: t.surfaceMuted }]}>{['客户 / 订单编号', '金额', '交期', '状态'].map((label, i) => <Text key={label} style={[i === 0 ? s.customer : s.cell, s.note, { color: t.muted }]}>{label}</Text>)}</View>
            {recentOrders.slice(0, 4).map(order => <Pressable key={order.id} accessibilityRole="button" accessibilityLabel={`查看订单 ${order.id}`} onPress={() => onOrder(order.id)} style={({ hovered }) => [s.tableRow, { borderTopColor: t.border, backgroundColor: hovered ? t.surfaceMuted : 'transparent' }]}>
              <View style={s.customer}><Text numberOfLines={1} style={[s.customerName, { color: t.text }]}>{order.customer?.name || order.customerName || '未知客户'}</Text><Text numberOfLines={1} style={[s.note, { color: t.muted, marginTop: 5 }]}>#{order.id}</Text></View>
              <Text numberOfLines={1} style={[s.cell, { color: t.text, fontSize: 12 }]}>¥{Number(order.total || 0).toLocaleString('zh-CN')}</Text>
              <Text numberOfLines={1} style={[s.cell, s.note, { color: t.muted }]}>{dateText(order.dueDate || order.due_date)}</Text>
              <View style={s.cell}><Text style={[s.status, { color: statusColor(order.status, t), backgroundColor: `${statusColor(order.status, t)}12` }]}>{ORDER_STATUS_LABELS[order.status] || '未知状态'}</Text></View>
            </Pressable>)}
          </> : <View style={s.empty}><Ionicons name="file-tray-outline" size={32} color={t.primary} /><Text style={{ color: t.text, fontWeight: '700' }}>{error ? '订单暂时未能加载' : '工坊还没有订单'}</Text><Text style={{ color: t.muted, fontSize: 12 }}>{error ? '刷新后重试，继续跟进委托。' : '创建第一份委托，从这里开启生产。'}</Text>{onCreate && !error && <Action label="新建订单" icon="add" onPress={onCreate} t={t} />}</View>}
        </View>
        <View style={s.sideColumn}>
          <View style={[s.panel, panel]}><Text style={[s.heading, { color: t.text }]}>优先关注</Text>
            {metrics.filter((_, i) => i !== 1).map(([label, count, icon, color, action]) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={`处理${label}`} onPress={action} style={[s.task, { borderBottomColor: t.border }]}><Ionicons name={icon} color={color} size={20} /><View style={{ flex: 1 }}><Text style={[s.taskTitle, { color: t.text }]}>{label}</Text><Text style={[s.note, { color: t.muted, marginTop: 4 }]}>{count == null || busy ? '等待数据加载' : count > 0 ? `${count} 项需要关注` : '当前暂无待办'}</Text></View><Ionicons name="chevron-forward" color={t.muted} size={15} /></Pressable>)}
          </View>
          <View style={[s.panel, panel]}><Text style={[s.heading, { color: t.text }]}>常用操作</Text><View style={s.quickActions}>{[[onModel, '新增模型', 'cube-outline'], [onAdjust, '库存盘点', 'scan-outline'], [onExport, exporting ? '导出中…' : '导出数据', 'download-outline']].map(([action, label, icon]) => action && <Action key={label} label={label} icon={icon} onPress={action} disabled={exporting && action === onExport} t={t} />)}<Action label="查看耗材库存" icon="layers-outline" onPress={onInventory} t={t} /></View></View>
        </View>
      </View>
      <View style={s.footer}><Text style={[s.note, { color: t.muted }]}>3D Manage · 小鲤工坊</Text><Text style={[s.note, { color: t.muted }]}>让每一份创意，稳稳落地。</Text></View>
    </View>
  </ScrollView>;
}

const s = StyleSheet.create({
  scroll: { flexGrow: 1 }, page: { width: '100%', maxWidth: 1640, alignSelf: 'center', padding: 26, gap: 20 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }, breadcrumb: { fontSize: 12 }, actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  action: { minHeight: 38, borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, actionText: { fontSize: 12, fontWeight: '700' },
  hero: { borderRadius: 22, minHeight: 180, padding: 26, overflow: 'hidden', justifyContent: 'center' }, heroCopy: { width: '76%', zIndex: 1 }, eyebrow: { fontSize: 10, fontWeight: '900', letterSpacing: 1.8 }, title: { fontSize: 27, fontWeight: '900', marginTop: 12, letterSpacing: -0.8 }, subtitle: { fontSize: 12, lineHeight: 20, marginTop: 9 }, heroLink: { flexDirection: 'row', gap: 8, alignItems: 'center', alignSelf: 'flex-start', minHeight: 36, marginTop: 8 }, character: { position: 'absolute', right: 8, bottom: -24, width: '24%', height: 218 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 }, metric: { flexGrow: 1, flexBasis: 180, minWidth: 0, borderWidth: 1, padding: 18, borderRadius: 18 }, metricLabel: { fontSize: 12, fontWeight: '700' }, metricIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 6 }, number: { fontSize: 34, fontWeight: '900', marginVertical: 8 }, unit: { fontSize: 11, fontWeight: '500' }, note: { fontSize: 11, lineHeight: 16 },
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }, orderPanel: { flexGrow: 3, flexBasis: 520, minWidth: 0, borderWidth: 1, borderRadius: 18, overflow: 'hidden' }, sideColumn: { flexGrow: 1, flexBasis: 248, gap: 16, minWidth: 0 }, panel: { borderWidth: 1, borderRadius: 18, padding: 18 }, heading: { fontSize: 15, fontWeight: '800' }, panelHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, gap: 8 },
  tableHead: { flexDirection: 'row', paddingHorizontal: 20, paddingVertical: 12, gap: 12 }, tableRow: { flexDirection: 'row', alignItems: 'center', padding: 20, gap: 12, borderTopWidth: 1, minHeight: 76 }, customer: { flex: 2, minWidth: 0 }, cell: { flex: 1, minWidth: 0 }, customerName: { fontSize: 13, fontWeight: '700' }, status: { fontSize: 10, fontWeight: '700', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 5, alignSelf: 'flex-start' }, empty: { minHeight: 220, padding: 24, justifyContent: 'center', alignItems: 'center', gap: 12 },
  task: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1 }, taskTitle: { fontSize: 12, fontWeight: '700' }, quickActions: { marginTop: 16, gap: 9 }, error: { padding: 14, borderRadius: 12 }, footer: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 4 },
});
