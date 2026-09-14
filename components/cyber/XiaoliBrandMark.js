import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '../../context/ThemeContext';
import { cyberTheme } from './theme';

const xiaoliImage = require('../../assets/xiaoli/hero.png');

export default function XiaoliBrandMark({ size = 72, showBadge = false, style }) {
  const { isDark } = useAppTheme();
  const theme = cyberTheme(isDark);

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={showBadge ? '小鲤 AI 助手' : '小鲤'}
      style={[
        styles.shell,
        {
          width: size,
          height: size,
          borderRadius: size * 0.31,
          borderColor: theme.borderStrong,
          backgroundColor: theme.primarySoft,
        },
        style,
      ]}
    >
      <View style={[styles.crop, { borderRadius: size * 0.29 }]}>
        <Image
          source={xiaoliImage}
          resizeMode="cover"
          style={{
            width: size * 1.28,
            height: size * 1.44,
            left: size * -0.18,
            top: size * -0.02,
          }}
        />
      </View>
      {showBadge ? (
        <View
          style={[
            styles.badge,
            {
              minWidth: Math.max(22, size * 0.35),
              height: Math.max(18, size * 0.27),
              borderRadius: size * 0.14,
              backgroundColor: theme.primary,
              borderColor: theme.background,
            },
          ]}
        >
          <Text style={[styles.badgeText, { color: theme.onAccent }]}>AI</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderWidth: 1,
    position: 'relative',
  },
  crop: {
    flex: 1,
    overflow: 'hidden',
  },
  badge: {
    position: 'absolute',
    right: -5,
    bottom: -4,
    paddingHorizontal: 4,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 9,
    lineHeight: 11,
    fontWeight: '900',
  },
});
