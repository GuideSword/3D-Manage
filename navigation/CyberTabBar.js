import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppTheme } from '../context/ThemeContext';
import { cyberTheme } from '../components/home/theme';

const icons = { Home: 'home', Orders: 'document-text', Models: 'cube', Materials: 'layers', Settings: 'settings' };

export default function CyberTabBar({ state, descriptors, navigation }) {
  const { isDark } = useAppTheme();
  const t = cyberTheme(isDark);
  const insets = useSafeAreaInsets();
  const pageBackground = t.background;
  return <View style={[styles.shell, { backgroundColor: pageBackground,
    paddingBottom: Math.max(insets.bottom, 8), paddingLeft: Math.max(insets.left, 12), paddingRight: Math.max(insets.right, 12) }]}>
    <View style={[styles.bar, { backgroundColor: t.glass, borderColor: t.border }]}>
      {state.routes.map((route, index) => {
        const selected = index === state.index;
        const options = descriptors[route.key].options;
        const title = options.title || route.name;
        const color = selected ? t.primary : t.muted;
        return <Pressable key={route.key} accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={title}
          onPress={() => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!selected && !event.defaultPrevented) navigation.navigate(route.name, route.params);
          }} onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
          style={({ pressed }) => [styles.item, pressed && { opacity: 0.7 }]}>
          <LinearGradient colors={selected ? (isDark ? ['#433567', '#30264C'] : ['#DCD1FF', '#F7F3FF']) : [t.surface + '00', t.surface + '00']}
            style={styles.inner}>
            <Ionicons name={selected ? icons[route.name] : `${icons[route.name]}-outline`} size={25} color={color} />
            <Text style={[styles.label, { color }]}>{title}</Text>
          </LinearGradient>
        </Pressable>;
      })}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  shell: { paddingTop: 5 },
  bar: { flexDirection: 'row', borderWidth: 1, borderRadius: 25, padding: 5, width: '100%', maxWidth: 596, alignSelf: 'center',
    shadowColor: '#7351E8', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.12, shadowRadius: 10, elevation: 3 },
  item: { flex: 1, minWidth: 0 },
  inner: { minHeight: 57, paddingVertical: 5, alignItems: 'center', justifyContent: 'center', borderRadius: 20, gap: 3 },
  label: { fontSize: 11, lineHeight: 16, fontWeight: '700' },
});
