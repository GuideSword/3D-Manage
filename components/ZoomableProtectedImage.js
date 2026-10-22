import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import ProtectedImage from './ProtectedImage';

const MAX_SCALE = 4;

const clamp = (value, min, max) => {
  'worklet';
  return Math.min(max, Math.max(min, value));
};

const maxOffset = (scale, viewportWidth, viewportHeight, imageWidth, imageHeight, axis) => {
  'worklet';
  if (!viewportWidth || !viewportHeight || !imageWidth || !imageHeight) return 0;
  const fit = Math.min(viewportWidth / imageWidth, viewportHeight / imageHeight);
  const imageSize = axis === 'x' ? imageWidth : imageHeight;
  const viewportSize = axis === 'x' ? viewportWidth : viewportHeight;
  return Math.max(0, (imageSize * fit * scale - viewportSize) / 2);
};

export default function ZoomableProtectedImage({ fileUrl, token, fallback }) {
  const scale = useSharedValue(1);
  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  const viewportWidth = useSharedValue(0);
  const viewportHeight = useSharedValue(0);
  const imageWidth = useSharedValue(0);
  const imageHeight = useSharedValue(0);
  const startScale = useSharedValue(1);
  const startOffsetX = useSharedValue(0);
  const startOffsetY = useSharedValue(0);
  const startFocalX = useSharedValue(0);
  const startFocalY = useSharedValue(0);

  const pinch = Gesture.Pinch()
    .onStart((event) => {
      startScale.value = scale.value;
      startOffsetX.value = offsetX.value;
      startOffsetY.value = offsetY.value;
      startFocalX.value = event.focalX - viewportWidth.value / 2;
      startFocalY.value = event.focalY - viewportHeight.value / 2;
    })
    .onUpdate((event) => {
      const nextScale = clamp(startScale.value * event.scale, 1, MAX_SCALE);
      const ratio = nextScale / startScale.value;
      const focalX = event.focalX - viewportWidth.value / 2;
      const focalY = event.focalY - viewportHeight.value / 2;
      const limitX = maxOffset(nextScale, viewportWidth.value, viewportHeight.value, imageWidth.value, imageHeight.value, 'x');
      const limitY = maxOffset(nextScale, viewportWidth.value, viewportHeight.value, imageWidth.value, imageHeight.value, 'y');
      scale.value = nextScale;
      offsetX.value = clamp(focalX - ratio * (startFocalX.value - startOffsetX.value), -limitX, limitX);
      offsetY.value = clamp(focalY - ratio * (startFocalY.value - startOffsetY.value), -limitY, limitY);
    })
    .onEnd(() => {
      const limitX = maxOffset(scale.value, viewportWidth.value, viewportHeight.value, imageWidth.value, imageHeight.value, 'x');
      const limitY = maxOffset(scale.value, viewportWidth.value, viewportHeight.value, imageWidth.value, imageHeight.value, 'y');
      offsetX.value = withTiming(clamp(offsetX.value, -limitX, limitX));
      offsetY.value = withTiming(clamp(offsetY.value, -limitY, limitY));
    });

  const pan = Gesture.Pan()
    .maxPointers(1)
    .onStart(() => {
      startOffsetX.value = offsetX.value;
      startOffsetY.value = offsetY.value;
    })
    .onUpdate((event) => {
      if (scale.value <= 1) return;
      const limitX = maxOffset(scale.value, viewportWidth.value, viewportHeight.value, imageWidth.value, imageHeight.value, 'x');
      const limitY = maxOffset(scale.value, viewportWidth.value, viewportHeight.value, imageWidth.value, imageHeight.value, 'y');
      offsetX.value = clamp(startOffsetX.value + event.translationX, -limitX, limitX);
      offsetY.value = clamp(startOffsetY.value + event.translationY, -limitY, limitY);
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: offsetX.value },
      { translateY: offsetY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <View style={styles.viewport} onLayout={(event) => {
      viewportWidth.value = event.nativeEvent.layout.width;
      viewportHeight.value = event.nativeEvent.layout.height;
    }}>
      <GestureDetector gesture={Gesture.Simultaneous(pinch, pan)}>
        <View style={styles.gestureFrame}>
          <Animated.View style={[styles.imageFrame, animatedStyle]}>
            <ProtectedImage
              fileUrl={fileUrl}
              token={token}
              style={styles.image}
              resizeMode="contain"
              fallback={fallback}
              onLoad={(event) => {
                imageWidth.value = event.nativeEvent.source?.width || 0;
                imageHeight.value = event.nativeEvent.source?.height || 0;
              }}
            />
          </Animated.View>
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: { width: '95%', height: '85%', overflow: 'hidden' },
  gestureFrame: { flex: 1 },
  imageFrame: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
});
