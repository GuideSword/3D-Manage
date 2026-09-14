import React from 'react';
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ORDER_STATUS_LABELS, ORDER_STATUSES } from '../../constants';
import { cyberTheme } from './theme';

const heroImage = require('../../assets/xiaoli/hero.png');
const reviewImage = require('../../assets/xiaoli/review.png');
const productionImage = require('../../assets/xiaoli/production.png');

function Touch({ children, style, label, ...props }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} {...props}
    style={({ pressed }) => [style, pressed && { opacity: 0.76 }]}>{children}</Pressable>;
}

function HomeHero({ theme: t, dark, stats, value, onOrders, onAgent, compact }) {
  return <LinearGradient colors={t.hero} style={s.hero}>
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Image source={require('../../assets/xiaoli/workshop.png')} style={[StyleSheet.absoluteFillObject, { width: '100%', height: '100%', opacity: dark ? 0.18 : 0.62 }]} resizeMode="cover" />
      <Text style={[s.star, { left: '42%', top: 50 }]}>✦</Text>
      <Text style={[s.star, { left: '56%', top: 122, fontSize: 17 }]}>✧</Text>
      <Text style={[s.star, { left: '9%', top: 208, fontSize: 16 }]}>✦</Text>
      <Image source={heroImage} style={[s.heroCharacter, compact && { width: '64%', right: -28 }, dark && { opacity: 0.83 }]} resizeMode="contain" />
    </View>
    <View style={s.heroTop}>
      <View style={s.row}>
        <View style={[s.avatar, { backgroundColor: t.glass }]}><Image source={heroImage} style={s.avatarImage} /></View>
        <View style={[s.pill, { backgroundColor: t.glass }]}>
          <Ionicons name="stats-chart" size={15} color={t.primary} />
          <Text style={{ color: t.primary, fontWeight: '800', fontSize: 13 }}>运营概览</Text>
        </View>
      </View>
      <Touch onPress={onAgent} label="小鲤助手" style={[s.bell, { backgroundColor: t.glass }]}>
        <Ionicons name="notifications-outline" size={25} color={t.primary} />
      </Touch>
    </View>
    <View style={s.heroCopy}>
      <Text style={[s.welcome, { color: dark ? '#F7F2FF' : '#4934B9', fontSize: compact ? 32 : 40 }]}>欢迎回来！</Text>
      <Text style={[s.heroSubtitle, { color: t.text }]}>关注订单进度，{ '\n' }掌控生产全局</Text>
      <Text style={[s.assistantName, { color: t.muted }]}>{dark ? '小鲤陪你，轻松收尾' : '小鲤陪你，开工啦'}</Text>
    </View>
    <View style={s.summaryRow}>
      {[[ORDER_STATUSES.PENDING_REVIEW, '待审核订单', stats.pendingReview, 'document-text-outline'],
        [ORDER_STATUSES.IN_PROGRESS, '执行中订单', stats.inProgress, 'rocket-outline']].map(([status, title, count, icon]) =>
        <Touch key={status} label={`${title} ${value(count)}`} onPress={() => onOrders(status)}
          style={[s.summary, { backgroundColor: t.glass, borderColor: t.border }]}>
          <Text style={[s.summaryTitle, { color: t.text }]}>{title}</Text>
          <View style={s.between}><Text style={[s.summaryValue, { color: t.text }]}>{value(count)}</Text>
            <Ionicons name={icon} size={29} color={t.primary} /></View>
        </Touch>)}
    </View>
  </LinearGradient>;
}

function OrderStatusCard({ theme: t, production, count, onPress }) {
  const color = production ? t.blue : t.pink;
  return <Touch onPress={onPress} label={`${production ? '执行中订单' : '待审核订单'} ${count}`} style={s.statusOuter}>
    <LinearGradient colors={production ? t.blueCard : t.pinkCard} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={[s.statusGradient, { borderColor: `${color}60`, shadowColor: color }]}>
      <View style={[s.characterPanel, { borderColor: `${color}30` }]}>
        <Image source={production ? productionImage : reviewImage} style={s.chibi} resizeMode="contain" />
      </View>
      <View style={s.statusContent}>
        <View style={s.between}>
          <View style={[s.row, { gap: 6 }]}><Ionicons name={production ? 'rocket' : 'hourglass'} size={17} color={color} />
            <Text style={[s.statusTitle, { color: t.text }]}>{production ? '执行中订单' : '待审核订单'}</Text></View>
          <Text style={[s.statusBadge, { color, backgroundColor: `${color}12` }]}>{production ? '进行中' : '待处理'}</Text>
        </View>
        <View pointerEvents="none" style={s.watermark}><Ionicons name={production ? 'cube-outline' : 'clipboard-outline'} size={76} color={`${color}20`} /></View>
        <Text style={[s.statusNumber, { color }]}>{count}</Text>
        <View style={s.between}>
          <Text style={[s.statusNote, { color: t.muted }]}>{production ? '正在生产或准备中' : '需要确认后进入执行'}</Text>
          <View style={[s.arrow, { backgroundColor: color }]}><Ionicons name="chevron-forward" size={22} color="#FFFFFF" /></View>
        </View>
      </View>
    </LinearGradient>
  </Touch>;
}

function SectionTitle({ theme: t, title, action }) {
  return <View style={[s.between, s.sectionHeading]}><View style={s.row}>
    <Ionicons name="sparkles" size={17} color={t.primary} /><Text style={[s.sectionTitle, { color: t.text }]}>{title}</Text>
  </View>{action}</View>;
}

function RecentOrdersSection({ theme: t, orders, loading, failed, onOrders, onOrder, onCreate }) {
  return <View>
    <SectionTitle theme={t} title="最近订单" action={<Touch label="查看全部订单" onPress={() => onOrders('all')} style={s.more}>
      <Text style={{ color: t.muted, fontSize: 12 }}>查看全部</Text><Ionicons name="chevron-forward" size={16} color={t.primary} /></Touch>} />
    {loading ? <View style={s.empty}><ActivityIndicator color={t.primary} /><Text style={{ color: t.muted }}>小鲤正在整理订单…</Text></View>
      : orders.length ? orders.slice(0, 4).map(order => <Touch key={order.id} onPress={() => onOrder(order.id)}
        style={[s.order, { backgroundColor: t.glass, borderColor: t.border }]}>
        <View style={[s.orderIcon, { backgroundColor: `${t.primary}12` }]}><Ionicons name="cube-outline" size={28} color={t.primary} /></View>
        <View style={s.orderCopy}><Text numberOfLines={1} style={[s.orderTitle, { color: t.text }]}>{order.customer?.name || '未知客户'}</Text>
          <Text numberOfLines={1} style={[s.orderMeta, { color: t.muted }]}>#{order.id}{order.createdAt ? ` · ${String(order.createdAt).slice(0, 10)}` : ''}</Text></View>
        <Text style={[s.orderBadge, { color: order.status === ORDER_STATUSES.IN_PROGRESS ? t.blue : t.primary,
          backgroundColor: `${t.primary}10` }]}>{ORDER_STATUS_LABELS[order.status] || '未知状态'}</Text>
        <Ionicons name="chevron-forward" size={16} color={t.muted} />
      </Touch>) : <View style={[s.empty, { backgroundColor: t.glass, borderRadius: 20 }]}>
        <Text style={{ color: t.text, fontWeight: '700' }}>{failed ? '订单暂时未能加载' : '工坊还很安静'}</Text>
        <Text style={{ color: t.muted }}>{failed ? '请下拉刷新后重试。' : '小鲤会在这里帮你盯住进度。'}</Text>
        {!failed && onCreate && <Touch onPress={onCreate} style={s.more}><Text style={{ color: t.primary }}>＋ 新建订单</Text></Touch>}
      </View>}
  </View>;
}

export default function CyberHome({ dark, stats, recentOrders, loading, refreshing, error, onRefresh, onOrders, onOrder, onInventory, onAgent, onCreate, onModel, onAdjust, onExport, exporting }) {
  const t = cyberTheme(dark);
  const { width } = useWindowDimensions();
  const value = count => count == null || (loading && !refreshing) ? '—' : count;
  const shortcuts = [['全部订单', 'document-text-outline', () => onOrders('all')], ['生产进度', 'stats-chart-outline', () => onOrders(ORDER_STATUSES.IN_PROGRESS)],
    ['库存风险', 'shield-checkmark-outline', onInventory], ['消息中心', 'notifications-outline', onAgent]];
  return <SafeAreaView edges={['top', 'left', 'right']} style={[s.screen, { backgroundColor: dark ? '#292559' : '#969DF6' }]}>
    <ScrollView style={{ backgroundColor: t.background }} contentContainerStyle={s.scrollContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} colors={[t.primary]} />}>
      <View style={s.page}>
        <HomeHero theme={t} dark={dark} stats={stats} value={value} onOrders={onOrders} onAgent={onAgent} compact={width < 380} />
        <View style={[s.body, { backgroundColor: t.background }]}>
          {!!error && <Touch onPress={onRefresh} style={[s.error, { borderColor: t.border }]}><Text style={{ color: t.muted }}>{error} · 点击重试</Text></Touch>}
          <OrderStatusCard theme={t} count={value(stats.pendingReview)} onPress={() => onOrders(ORDER_STATUSES.PENDING_REVIEW)} />
          <OrderStatusCard theme={t} production count={value(stats.inProgress)} onPress={() => onOrders(ORDER_STATUSES.IN_PROGRESS)} />
          <SectionTitle theme={t} title="快速入口" />
          <View style={s.shortcuts}>{shortcuts.map(([label, icon, onPress], index) =>
            <Touch key={label} label={label === '消息中心' ? '消息中心，打开小鲤助手' : label} onPress={onPress} style={s.shortcut}>
              <LinearGradient colors={dark ? ['#393053', '#25213E'] : ['#FFFFFF', '#EEE9FF']} style={[s.shortcutIcon, { borderColor: t.border }]}>
                <Ionicons name={icon} size={32} color={index === 2 ? t.blue : t.primary} />
                {index === 2 && stats.lowStock > 0 && <View style={[s.riskBadge, { backgroundColor: t.pink }]}><Text style={s.riskText}>{stats.lowStock}</Text></View>}
              </LinearGradient><Text style={[s.shortcutLabel, { color: t.text }]}>{label}</Text>
            </Touch>)}</View>
          <Text style={[s.hint, { color: t.muted }]}>消息中心由小鲤助手为你服务 · 库存风险 ≤100g</Text>
          <RecentOrdersSection theme={t} orders={recentOrders} loading={loading && !refreshing} failed={!!error} onOrders={onOrders} onOrder={onOrder} onCreate={onCreate} />
          <View style={s.tools}>{[[onCreate, '新建订单'], [onModel, '新增模型'], [onAdjust, '库存盘点'], [onExport, exporting ? '导出中…' : '导出数据']].map(([action, label]) => action &&
            <Touch key={label} onPress={action} disabled={label === '导出中…'} style={s.tool}><Text style={{ color: t.primary, fontSize: 12 }}>{label}</Text></Touch>)}</View>
        </View>
      </View>
    </ScrollView>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  screen: { flex: 1 }, scrollContent: { flexGrow: 1 }, page: { width: '100%', maxWidth: 620, alignSelf: 'center' },
  hero: { minHeight: 320, padding: 18, paddingBottom: 34, overflow: 'hidden' },
  star: { position: 'absolute', fontSize: 28, color: '#FFF6BA' },
  heroCharacter: { position: 'absolute', width: '61%', height: 288, right: -10, bottom: 4 },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 }, between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  avatar: { width: 36, height: 36, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: '#FFFFFF90' },
  avatarImage: { width: 45, height: 50, left: -3, top: 0 }, pill: { flexDirection: 'row', gap: 6, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 22 },
  bell: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  heroCopy: { marginTop: 22, marginBottom: 23, width: '61%' },
  welcome: { fontWeight: '900', letterSpacing: -1, textShadowColor: '#FFFFFFB0', textShadowRadius: 3, textShadowOffset: { width: 1, height: 2 } },
  heroSubtitle: { fontSize: 13, fontWeight: '600', lineHeight: 21, marginTop: 7 }, assistantName: { fontSize: 11, marginTop: 8 },
  summaryRow: { flexDirection: 'row', gap: 10, width: '76%' },
  summary: { flex: 1, minWidth: 0, padding: 11, borderRadius: 17, borderWidth: 1 }, summaryTitle: { fontSize: 12, fontWeight: '800' }, summaryValue: { fontSize: 31, fontWeight: '800' },
  body: { marginTop: -20, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 16, paddingTop: 24, paddingBottom: 25 },
  statusOuter: { marginBottom: 20 }, statusGradient: { borderWidth: 1.5, borderRadius: 23, flexDirection: 'row', minHeight: 145,
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 10, elevation: 2 },
  characterPanel: { width: '25%', borderRightWidth: 1, justifyContent: 'flex-end' }, chibi: { width: '118%', height: 150, marginLeft: -6 },
  statusContent: { flex: 1, padding: 12 }, statusTitle: { fontSize: 15, fontWeight: '800' }, statusBadge: { fontSize: 10, paddingHorizontal: 5, paddingVertical: 4, borderRadius: 9, fontWeight: '700' },
  statusNumber: { fontSize: 42, lineHeight: 51, fontWeight: '800', marginTop: 5 }, statusNote: { fontSize: 11, flex: 1 },
  watermark: { position: 'absolute', right: 14, top: 37 }, arrow: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  sectionHeading: { minHeight: 36, marginBottom: 7 }, sectionTitle: { fontSize: 18, fontWeight: '800' },
  shortcuts: { flexDirection: 'row', gap: 10 }, shortcut: { flex: 1, alignItems: 'center' },
  shortcutIcon: { width: '100%', height: 64, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  shortcutLabel: { fontSize: 12, fontWeight: '700', marginTop: 7 }, hint: { fontSize: 10, marginTop: 13, marginBottom: 12 },
  riskBadge: { position: 'absolute', top: 3, right: 3, minWidth: 16, height: 16, paddingHorizontal: 3, borderRadius: 8, alignItems: 'center' }, riskText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
  order: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 11, minHeight: 73, borderRadius: 18, borderWidth: 1, marginBottom: 9 },
  orderIcon: { width: 43, height: 43, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, orderCopy: { flex: 1, minWidth: 0 },
  orderTitle: { fontSize: 14, fontWeight: '700' }, orderMeta: { fontSize: 11, marginTop: 6 }, orderBadge: { fontSize: 10, padding: 5, borderRadius: 8 },
  empty: { padding: 20, alignItems: 'center', gap: 9 }, more: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4 },
  tools: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', marginTop: 10 }, tool: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' },
  error: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 16 },
});
