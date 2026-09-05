import React, { useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  PanResponder,
  Dimensions,
  TouchableOpacity,
} from 'react-native';

// Draggable FAB.
//
// MVP behavior (per task brief):
//   - On release, snap horizontally to the nearest screen edge.
//   - Position is NOT persisted (AsyncStorage is not installed).
//     The FAB resets to its initial position on every mount.
//
// Upgrade path: persist {x, y} via the existing utils/storage helper
// (which already wraps expo-secure-store). Replace the initial pan
// value in the useState initializer with the stored values on mount
// and write them back on PanResponderRelease.

const FAB_SIZE = 56;
const EDGE_PADDING = 16;
const BOTTOM_OFFSET = 80; // leave room above bottom tabs / safe area

export default function DraggableFab({ onPress }) {
  const window = Dimensions.get('window');
  const initialX = window.width - FAB_SIZE - EDGE_PADDING;
  const initialY = window.height - FAB_SIZE - EDGE_PADDING - BOTTOM_OFFSET;

  const pan = useRef(new Animated.ValueXY({ x: initialX, y: initialY })).current;

  // Re-clamp position if the window dimensions change (rotation, split-view).
  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window: w }) => {
      const maxX = w.width - FAB_SIZE - EDGE_PADDING;
      const maxY = w.height - FAB_SIZE - EDGE_PADDING;
      const cur = pan.__getValue();
      const x = Math.min(Math.max(EDGE_PADDING, cur.x), maxX);
      const y = Math.min(Math.max(EDGE_PADDING, cur.y), maxY);
      pan.setValue({ x, y });
    });
    return () => sub?.remove?.();
  }, [pan]);

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2,
      onPanResponderGrant: () => {
        pan.extractOffset();
      },
      onPanResponderMove: Animated.event(
        [null, { dx: pan.x, dy: pan.y }],
        { useNativeDriver: false }
      ),
      onPanResponderRelease: (_, g) => {
        pan.flattenOffset();

        const { width, height } = Dimensions.get('window');
        const cur = pan.__getValue();
        const finalX = cur.x;
        const finalY = cur.y;

        // Snap horizontally to the nearest edge.
        const fabCenterX = finalX + FAB_SIZE / 2;
        const snapX =
          fabCenterX < width / 2
            ? EDGE_PADDING
            : width - FAB_SIZE - EDGE_PADDING;

        // Clamp vertically so the FAB never disappears off the top/bottom.
        const maxY = height - FAB_SIZE - EDGE_PADDING;
        const snapY = Math.min(Math.max(EDGE_PADDING, finalY), maxY);

        Animated.spring(pan, {
          toValue: { x: snapX, y: snapY },
          useNativeDriver: false,
          friction: 7,
        }).start();
      },
    })
  ).current;

  return (
    <Animated.View
      style={[styles.fab, { transform: pan.getTranslateTransform() }]}
      {...responder.panHandlers}
    >
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.85}
        style={styles.touchable}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.icon}>✨</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: '#5856D6',
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  touchable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    color: '#fff',
    fontSize: 24,
    lineHeight: 28,
  },
});
