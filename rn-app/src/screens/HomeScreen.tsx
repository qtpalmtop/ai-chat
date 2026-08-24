/**
 * HomeScreen：工具列表
 * - 启动时触发 store.bootstrap()（注册设备 + 拉取工具）
 * - grid 布局 2 列
 * - 错误态可重试
 */
import React, { useCallback, useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ToolCard } from '../components/ToolCard';
import { OfflineBanner } from '../components/OfflineBanner';
import { useAppStore } from '../store/appStore';
import { colors, fontSize, spacing } from '../constants';
import type { RootStackParamList } from '../navigation/types';
import type { Tool } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Home'>;

export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const { tools, toolsStatus, toolsError, bootDone, bootstrap, retry } =
    useAppStore();

  // 启动一次
  useEffect(() => {
    if (!bootDone) {
      bootstrap();
    }
  }, [bootDone, bootstrap]);

  const onPressTool = useCallback(
    (tool: Tool) => {
      switch (tool.type) {
        case 'webview':
          navigation.navigate('WebView', { tool });
          break;
        case 'deeplink':
          if (tool.deeplink) {
            // 用 Linking 打开外部 deeplink
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { Linking } = require('react-native');
            Linking.openURL(tool.deeplink).catch(() => {});
          }
          break;
        case 'native':
          // 暂不处理，预留给后续原生页面
          break;
      }
    },
    [navigation],
  );

  const renderItem = useCallback(
    ({ item }: { item: Tool }) => <ToolCard tool={item} onPress={onPressTool} />,
    [onPressTool],
  );

  const keyExtractor = useCallback((item: Tool) => item.id, []);

  const onRefresh = useCallback(() => {
    retry();
  }, [retry]);

  const listContent = useMemo(() => {
    if (toolsStatus === 'loading' && tools.length === 0) {
      return (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.hint}>加载中...</Text>
        </View>
      );
    }
    if (toolsStatus === 'error' && tools.length === 0) {
      return (
        <View style={styles.center}>
          <Text style={styles.errIcon}>😕</Text>
          <Text style={styles.errText}>工具列表加载失败</Text>
          <Text style={styles.errSub}>{toolsError}</Text>
          <Pressable style={styles.retry} onPress={retry}>
            <Text style={styles.retryText}>重试</Text>
          </Pressable>
        </View>
      );
    }
    if (tools.length === 0) {
      return (
        <View style={styles.center}>
          <Text style={styles.errIcon}>📭</Text>
          <Text style={styles.errText}>暂无可用工具</Text>
        </View>
      );
    }
    return null;
  }, [toolsStatus, tools.length, toolsError, retry]);

  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      <OfflineBanner />
      {listContent ?? (
        <FlatList
          data={tools}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          numColumns={2}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={toolsStatus === 'loading'}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          // 性能优化
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={5}
          removeClippedSubviews
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  listContent: {
    padding: spacing.sm,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  hint: {
    marginTop: spacing.md,
    color: colors.textMuted,
    fontSize: fontSize.md,
  },
  errIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  errText: {
    fontSize: fontSize.lg,
    color: colors.text,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  errSub: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  retry: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: 999,
  },
  retryText: {
    color: '#fff',
    fontSize: fontSize.md,
    fontWeight: '600',
  },
});
