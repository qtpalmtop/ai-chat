/**
 * 工具卡片：HomeScreen 网格中的一项
 */
import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, radius, spacing } from '../constants';
import type { Tool } from '../types';

interface Props {
  tool: Tool;
  onPress: (tool: Tool) => void;
}

function ToolCardComponent({ tool, onPress }: Props) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        pressed && styles.cardPressed,
      ]}
      android_ripple={{ color: 'rgba(77,107,254,0.08)' }}
      onPress={() => onPress(tool)}
    >
      <View style={styles.iconWrap}>
        <Text style={styles.icon}>{tool.icon || '🛠️'}</Text>
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {tool.name}
      </Text>
      {tool.description ? (
        <Text style={styles.desc} numberOfLines={2}>
          {tool.description}
        </Text>
      ) : null}
    </Pressable>
  );
}

export const ToolCard = memo(ToolCardComponent, (prev, next) => {
  return prev.tool.id === next.tool.id && prev.tool === next.tool;
});

const styles = StyleSheet.create({
  card: {
    flex: 1,
    aspectRatio: 1,
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    padding: spacing.md,
    margin: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 2,
  },
  cardPressed: {
    opacity: 0.75,
    transform: [{ scale: 0.98 }],
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: 'rgba(77,107,254,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  icon: {
    fontSize: 26,
  },
  name: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 2,
  },
  desc: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 16,
  },
});
