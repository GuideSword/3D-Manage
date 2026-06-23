import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { COLORS } from '../constants';

const Card = ({ children, style, ...props }) => {
  return (
    <View style={[styles.card, style]} {...props}>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    padding: 16,
    marginVertical: 4,
    marginHorizontal: 8,
    ...Platform.select({
      web: {
        boxShadow: '0 1px 3px rgba(28, 28, 30, 0.22)',
      },
      default: {
        shadowColor: COLORS.dark,
        shadowOffset: {
          width: 0,
          height: 1,
        },
        shadowOpacity: 0.22,
        shadowRadius: 2.22,
        elevation: 3,
      },
    }),
  },
});

export default Card;

