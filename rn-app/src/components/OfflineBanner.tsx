/**
 * 离线提示条
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useConnectivity } from '../services/network';
import { colors, fontSize, spacing } from '../constants';

export function OfflineBanner() {
  const { isConnected, isInternetReachable } = useConnectivity();
  const offline = !isConnected || isInternetReachable === false;
  if (!offline) return null;
  return (
    <View style={styles.bar}>
      <Text style={styles.text}>当前网络不可用，部分功能可能受限</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.warning,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  text: {
    color: '#fff',
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
});
