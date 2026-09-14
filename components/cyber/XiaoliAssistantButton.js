import React from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

const xiaoliImage = require('../../assets/xiaoli/hero.png');

export default function XiaoliAssistantButton({ onPress, theme }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="打开小鲤 AI 助手"
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: theme.primarySoft,
          borderColor: theme.borderStrong,
          shadowColor: theme.glow,
        },
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.crop, { backgroundColor: theme.primarySoft }]}>
        <Image source={xiaoliImage} resizeMode="cover" style={styles.image} />
      </View>
      <View style={[styles.badge, { backgroundColor: theme.primary, borderColor: theme.background }]}>
        <Text style={[styles.badgeText, { color: theme.onAccent }]}>AI</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 9,
    elevation: 3,
    ...Platform.select({ web: { cursor: 'pointer' } }),
  },
  crop: {
    width: 38,
    height: 38,
    borderRadius: 12,
    overflow: 'hidden',
  },
  image: {
    width: 54,
    height: 61,
    left: -8,
    top: -1,
  },
  badge: {
    position: 'absolute',
    right: -5,
    bottom: -4,
    minWidth: 19,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 7,
    lineHeight: 9,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  pressed: {
    opacity: 0.72,
    transform: [{ scale: 0.97 }],
  },
});
