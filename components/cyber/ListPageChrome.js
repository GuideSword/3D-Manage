import React from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../context/ThemeContext';
import XiaoliAssistantButton from './XiaoliAssistantButton';
import { cyberTheme } from './theme';

const emptyImage = require('../../assets/xiaoli/review.png');

const useCyberStyles = () => {
  const { isDark } = useAppTheme();
  const theme = React.useMemo(() => cyberTheme(isDark), [isDark]);
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  return { theme, styles };
};

export function CyberPageHeader({ eyebrow, title, subtitle, onAssistant, actions }) {
  const { theme, styles } = useCyberStyles();
  return (
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
      </View>
      <View style={styles.headerActions}>
        {actions}
        <XiaoliAssistantButton onPress={onAssistant} theme={theme} />
      </View>
    </View>
  );
}

export function CyberIconButton({ icon, label, active = false, onPress }) {
  const { theme, styles } = useCyberStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        active && styles.iconButtonActive,
        pressed && styles.pressed,
      ]}
    >
      <Ionicons name={icon} size={20} color={active ? theme.primary : theme.muted} />
    </Pressable>
  );
}

export function CyberSearchField({ value, onChangeText, placeholder }) {
  const { theme, styles } = useCyberStyles();
  return (
    <View style={styles.search}>
      <Ionicons name="search" size={19} color={theme.muted} />
      <TextInput
        accessibilityLabel={placeholder}
        placeholder={placeholder}
        placeholderTextColor={theme.muted}
        value={value}
        onChangeText={onChangeText}
        returnKeyType="search"
        style={styles.searchInput}
      />
      {value ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="清除搜索"
          onPress={() => onChangeText('')}
          style={styles.clear}
        >
          <Ionicons name="close" size={17} color={theme.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function CyberChip({ label, active, color, onPress }) {
  const { theme, styles } = useCyberStyles();
  const tint = color || theme.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        active && { backgroundColor: `${tint}18`, borderColor: tint },
        pressed && styles.pressed,
      ]}
    >
      <Text numberOfLines={1} style={[styles.chipText, active && { color: tint }]}>{label}</Text>
    </Pressable>
  );
}

export function CyberMetricStrip({ metrics }) {
  const { theme, styles } = useCyberStyles();
  const tones = {
    primary: [theme.primary, theme.primarySoft],
    pink: [theme.pink, theme.pinkSoft],
    blue: [theme.blue, theme.blueSoft],
  };

  return (
    <View style={styles.metrics}>
      {metrics.map((metric) => {
        const [color, backgroundColor] = tones[metric.tone] || tones.primary;
        return (
          <View key={metric.label} style={[styles.metric, { backgroundColor, borderColor: `${color}55` }]}>
            <Text style={styles.metricLabel} numberOfLines={1}>{metric.label}</Text>
            <Text style={[styles.metricValue, { color }]}>{metric.value}</Text>
          </View>
        );
      })}
    </View>
  );
}

export function CyberSectionHeading({ title, hint }) {
  const { styles } = useCyberStyles();
  return (
    <View style={styles.sectionHeading}>
      <View style={styles.sectionTitleRow}>
        <Ionicons name="sparkles" size={14} style={styles.sectionIcon} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {hint ? <Text style={styles.sectionHint} numberOfLines={1}>{hint}</Text> : null}
    </View>
  );
}

export function CyberEmptyState({ title, description, actionLabel, onAction }) {
  const { theme, styles } = useCyberStyles();
  return (
    <View style={styles.emptyState}>
      <View style={[styles.emptyImageWrap, { backgroundColor: theme.primarySoft, borderColor: theme.border }]}>
        <Image source={emptyImage} resizeMode="contain" style={styles.emptyImage} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDescription}>{description}</Text>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          style={({ pressed }) => [styles.emptyAction, pressed && styles.pressed]}
        >
          <Ionicons name="add" size={17} color={theme.onAccent} />
          <Text style={[styles.emptyActionText, { color: theme.onAccent }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const createStyles = (t) => StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 10,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  eyebrow: { color: t.primary, fontSize: 10, lineHeight: 14, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: t.text, fontSize: 27, lineHeight: 33, fontWeight: '900', letterSpacing: -0.7 },
  subtitle: { color: t.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.glass,
    borderWidth: 1,
    borderColor: t.border,
  },
  iconButtonActive: { backgroundColor: t.primarySoft, borderColor: t.borderStrong },
  pressed: { opacity: 0.72 },
  search: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 10,
    paddingLeft: 14,
    paddingRight: 4,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 17,
    backgroundColor: t.glass,
  },
  searchInput: { flex: 1, minWidth: 0, paddingVertical: 11, color: t.text, fontSize: 14, lineHeight: 20 },
  clear: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  chip: {
    height: 34,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 999,
    backgroundColor: t.glass,
  },
  chipText: { color: t.muted, fontSize: 11, lineHeight: 15, fontWeight: '800' },
  metrics: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 10 },
  metric: { flex: 1, minWidth: 0, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 15, borderWidth: 1 },
  metricLabel: { color: t.muted, fontSize: 10, lineHeight: 14 },
  metricValue: { marginTop: 1, fontSize: 18, lineHeight: 22, fontWeight: '900' },
  sectionHeading: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 18,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  sectionIcon: { color: t.primary },
  sectionTitle: { color: t.text, fontSize: 14, lineHeight: 19, fontWeight: '900' },
  sectionHint: { flexShrink: 1, color: t.muted, fontSize: 10, lineHeight: 14 },
  emptyState: { flex: 1, minHeight: 330, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 32 },
  emptyImageWrap: { width: 104, height: 104, borderRadius: 32, borderWidth: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  emptyImage: { width: 106, height: 106 },
  emptyTitle: { marginTop: 12, color: t.text, fontSize: 17, lineHeight: 22, fontWeight: '900', textAlign: 'center' },
  emptyDescription: { maxWidth: 300, marginTop: 5, color: t.muted, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  emptyAction: { minHeight: 44, marginTop: 16, paddingHorizontal: 16, borderRadius: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: t.primary },
  emptyActionText: { fontSize: 13, lineHeight: 18, fontWeight: '800' },
});
