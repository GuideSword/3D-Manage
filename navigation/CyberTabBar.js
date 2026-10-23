import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useServerConfig } from '../context/ServerConfigContext';
import { ROUTES } from '../constants';
import { canExport, canManage, canWrite } from '../utils/permissions';
import masterDataCore from '../utils/masterDataCore.cjs';
import responsiveLayout from '../utils/responsiveLayout.cjs';
import XiaoliBrandMark from '../components/cyber/XiaoliBrandMark';
import { cyberTheme } from '../components/home/theme';

const icons = { Home: 'home', Orders: 'document-text', Models: 'cube', Materials: 'layers', Settings: 'settings' };

export default function CyberTabBar({ state, descriptors, navigation }) {
  const { isDark } = useAppTheme();
  const { user } = useAuth();
  const { server } = useServerConfig();
  const { width } = useWindowDimensions();
  const t = cyberTheme(isDark);
  const insets = useSafeAreaInsets();
  const { isDesktop } = responsiveLayout.getResponsiveLayout(width, Platform.OS);
  const pageBackground = t.background;

  const navigateTo = routeName => navigation.navigate(routeName);
  const renderTab = (route, index, desktop = false) => {
    const selected = index === state.index;
    const options = descriptors[route.key].options;
    const title = options.title || route.name;
    const color = selected ? t.primary : t.muted;
    return <Pressable key={route.key} accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={title}
      onPress={() => {
        const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
        if (!selected && !event.defaultPrevented) navigation.navigate(route.name, route.params);
      }} onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
      style={({ pressed }) => [desktop ? styles.desktopItem : styles.item, pressed && { opacity: 0.7 }]}>
      {desktop ? <><View style={[styles.desktopIcon, selected && { backgroundColor: t.primarySoft }]}><Ionicons name={selected ? icons[route.name] : `${icons[route.name]}-outline`} size={19} color={color} /></View><Text style={[styles.desktopLabel, { color }]}>{title}</Text></> : <LinearGradient colors={selected ? (isDark ? ['#433567', '#30264C'] : ['#DCD1FF', '#F7F3FF']) : [t.surface + '00', t.surface + '00']} style={styles.inner}><Ionicons name={selected ? icons[route.name] : `${icons[route.name]}-outline`} size={25} color={color} /><Text style={[styles.label, { color }]}>{title}</Text></LinearGradient>}
    </Pressable>;
  };

  if (isDesktop) {
    const supportsMasterData = masterDataCore.supportsMasterData(server);
    return <View style={[styles.rail, { backgroundColor: t.surfaceElevated, borderRightColor: t.border, paddingTop: Math.max(insets.top, 14), paddingBottom: Math.max(insets.bottom, 14) }]}>
      <View style={styles.brand}><XiaoliBrandMark size={38} /><View><Text style={[styles.brandTitle, { color: t.text }]}>3D Manage</Text><Text style={[styles.brandSubtitle, { color: t.muted }]}>PRINT WORKSPACE</Text></View></View>
      <Text style={[styles.groupLabel, { color: t.muted }]}>工作台</Text>
      {state.routes.map((route, index) => renderTab(route, index, true))}
      <Text style={[styles.groupLabel, { color: t.muted }]}>业务协同</Text>
      {supportsMasterData ? <><DesktopShortcut label="客户管理" icon="people-outline" onPress={() => navigateTo(ROUTES.CUSTOMERS)} theme={t} /><DesktopShortcut label="供应商" icon="business-outline" onPress={() => navigateTo(ROUTES.SUPPLIERS)} theme={t} /><DesktopShortcut label="仓库设置" icon="storefront-outline" onPress={() => navigateTo(ROUTES.WAREHOUSE_SETTINGS)} theme={t} /></> : null}
      {canExport(user) ? <DesktopShortcut label="数据中心" icon="server-outline" onPress={() => navigateTo(ROUTES.DATA_IMPORT)} theme={t} /> : null}
      {canManage(user) ? <DesktopShortcut label="用户管理" icon="people-circle-outline" onPress={() => navigateTo(ROUTES.USERS)} theme={t} /> : null}
      {canWrite(user) ? <DesktopShortcut label="新建订单" icon="add-circle-outline" onPress={() => navigateTo(ROUTES.CREATE_ORDER)} theme={t} /> : null}
      <View style={styles.railSpacer} />
      <DesktopShortcut label="服务器设置" icon="settings-outline" onPress={() => navigateTo(ROUTES.SERVER_SETUP)} theme={t} />
      <View style={[styles.profile, { backgroundColor: t.surfaceMuted, borderColor: t.border }]}><View style={[styles.profileAvatar, { backgroundColor: t.primarySoft }]}><Text style={{ color: t.primary, fontWeight: '900' }}>{String(user?.name || user?.username || '管').slice(0, 1)}</Text></View><View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} style={[styles.profileName, { color: t.text }]}>{user?.name || user?.username || '管理员'}</Text><Text style={[styles.profileMeta, { color: t.muted }]}>在线</Text></View></View>
    </View>;
  }

  return <View style={[styles.shell, { backgroundColor: pageBackground,
    paddingBottom: Math.max(insets.bottom, 8), paddingLeft: Math.max(insets.left, 12), paddingRight: Math.max(insets.right, 12) }]}>
    <View style={[styles.bar, { backgroundColor: t.glass, borderColor: t.border }]}>
      {state.routes.map((route, index) => renderTab(route, index))}
    </View>
  </View>;
}

function DesktopShortcut({ label, icon, onPress, theme }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.shortcut, pressed && { opacity: 0.7 }]}><Ionicons name={icon} size={18} color={theme.muted} /><Text style={[styles.shortcutLabel, { color: theme.muted }]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  shell: { paddingTop: 5 },
  rail: { width: 236, flex: 1, borderRightWidth: 1, paddingHorizontal: 14 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 8, paddingBottom: 24 },
  brandTitle: { fontSize: 14, fontWeight: '900' },
  brandSubtitle: { fontSize: 9, letterSpacing: 0.8, marginTop: 2 },
  groupLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 1.1, paddingHorizontal: 10, paddingTop: 10, paddingBottom: 7 },
  desktopItem: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 9, borderRadius: 13, marginVertical: 2 },
  desktopIcon: { width: 31, height: 31, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  desktopLabel: { fontSize: 12, fontWeight: '800' },
  shortcut: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderRadius: 11 },
  shortcutLabel: { fontSize: 11, fontWeight: '700' },
  railSpacer: { flex: 1 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 52, marginTop: 9, padding: 8, borderRadius: 13, borderWidth: 1 },
  profileAvatar: { width: 29, height: 29, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  profileName: { fontSize: 10, fontWeight: '800' },
  profileMeta: { fontSize: 9, marginTop: 2 },
  bar: { flexDirection: 'row', borderWidth: 1, borderRadius: 25, padding: 5, width: '100%', maxWidth: 596, alignSelf: 'center',
    shadowColor: '#7351E8', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.12, shadowRadius: 10, elevation: 3 },
  item: { flex: 1, minWidth: 0 },
  inner: { minHeight: 57, paddingVertical: 5, alignItems: 'center', justifyContent: 'center', borderRadius: 20, gap: 3 },
  label: { fontSize: 11, lineHeight: 16, fontWeight: '700' },
});
