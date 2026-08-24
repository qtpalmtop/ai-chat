/**
 * WebViewScreen：加载豆包 AI 助手页面
 * - 注入 JS Bridge
 * - 监听 web → native 消息，处理后通过 injectJavaScript 回传
 * - 转发 native push 事件给 web
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Linking,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import type { WebView as WebViewType } from 'react-native-webview';
import { useFocusEffect, useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, fontSize, spacing } from '../constants';
import { config } from '../config';
import { useAppStore } from '../store/appStore';
import { pushService } from '../services/push';
import {
  BRIDGE_INJECT_SCRIPT,
  BridgeMessage,
  buildNativeToWebScript,
  handleBridgeCall,
} from '../utils/bridge';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'WebView'>;
type Rt = RouteProp<RootStackParamList, 'WebView'>;

export function WebViewScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const webviewRef = useRef<WebViewType | null>(null);
  const { tool } = route.params;
  const webviewBaseUrl = useAppStore((s) => s.webviewBaseUrl);

  // 实际加载 URL：优先使用后端下发的 baseUrl
  const initialUrl = useMemo(() => {
    if (tool.url) return tool.url;
    const base = webviewBaseUrl || config.webviewUrl;
    // 豆包 AI 助手是首页
    return base.endsWith('/') ? base : `${base}/`;
  }, [tool.url, webviewBaseUrl]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);

  // 接收 web → native 消息
  const onMessage = useCallback(async (e: WebViewMessageEvent) => {
    let msg: BridgeMessage | null = null;
    try {
      const raw = e.nativeEvent.data;
      msg = typeof raw === 'string' ? JSON.parse(raw) : (raw as BridgeMessage);
    } catch {
      return;
    }
    if (!msg || msg.type !== 'web_to_native') return;

    // web 主动 emit（事件，不需回传结果）
    if (msg.event) {
      console.log('[WebView emit]', msg.event, msg.payload);
      return;
    }

    // call：执行 native 方法并回传
    if (msg.method && msg.callbackId) {
      const result = await handleBridgeCall(msg);
      const script = buildNativeToWebScript({
        callbackId: msg.callbackId,
        ...result,
      });
      webviewRef.current?.injectJavaScript(script);
    }
  }, []);

  // 转发 native push 事件给 web
  useEffect(() => {
    const off = pushService.addNotificationListener(
      (n) => {
        const data = n.request.content.data ?? {};
        const event = (data as { event?: string }).event;
        if (event) {
          const script = buildNativeToWebScript({ event, payload: data });
          webviewRef.current?.injectJavaScript(script);
        }
      },
      (r) => {
        // 用户点击通知：尝试打开对应 web 路由
        const data = r.notification.request.content.data ?? {};
        const url = (data as { url?: string }).url;
        if (url) {
          webviewRef.current?.injectJavaScript(
            `window.location.href = ${JSON.stringify(url)}; true;`,
          );
        }
      },
    );
    return off;
  }, []);

  // Android 物理返回键：先 web.goBack，没有历史再退出
  useFocusEffect(
    useCallback(() => {
      const onBack = () => {
        if (canGoBack && webviewRef.current) {
          webviewRef.current.goBack();
          return true;
        }
        return false;
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
      return () => sub.remove();
    }, [canGoBack]),
  );

  // 头部右上角"在浏览器中打开"
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Text
          style={styles.headerBtn}
          onPress={() => Linking.openURL(initialUrl).catch(() => {})}
        >
          浏览器
        </Text>
      ),
    });
  }, [navigation, initialUrl]);

  if (loadError) {
    return (
      <SafeAreaView style={styles.root} edges={['bottom']}>
        <View style={styles.center}>
          <Text style={styles.errIcon}>⚠️</Text>
          <Text style={styles.errText}>页面加载失败</Text>
          <Text style={styles.errSub}>{loadError}</Text>
          <Text
            style={styles.retry}
            onPress={() => {
              setLoadError(null);
              setLoading(true);
              webviewRef.current?.reload();
            }}
          >
            重试
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      <WebView
        ref={webviewRef}
        source={{ uri: initialUrl }}
        style={styles.web}
        // 注入 bridge
        injectedJavaScriptBeforeContentLoaded={BRIDGE_INJECT_SCRIPT}
        // 消息桥
        onMessage={onMessage}
        // 加载状态
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onError={(syntheticEvent) => {
          const { code, description } = syntheticEvent.nativeEvent;
          setLoadError(`[${code}] ${description}`);
          setLoading(false);
        }}
        onHttpError={(syntheticEvent) => {
          const { statusCode, description } = syntheticEvent.nativeEvent;
          if (statusCode >= 500) {
            setLoadError(`HTTP ${statusCode}: ${description}`);
          }
        }}
        onNavigationStateChange={(navState) => {
          setCanGoBack(navState.canGoBack);
        }}
        // 安全与性能
        javaScriptEnabled
        domStorageEnabled
        thirdPartyCookiesEnabled={Platform.OS === 'android'}
        sharedCookiesEnabled
        cacheEnabled
        setSupportMultipleWindows={false}
        // 视频需要用户手势才能播放（iOS Safari 默认）
        allowsFullscreenVideo
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        // 移动端 web 兼容性
        textZoom={100}
        // 调试
        originWhitelist={['*']}
        decelerationRate="normal"
      />
      {loading && (
        <View style={styles.loadingMask} pointerEvents="none">
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#fff',
  },
  web: {
    flex: 1,
  },
  loadingMask: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
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
    color: '#fff',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: 999,
    fontSize: fontSize.md,
    fontWeight: '600',
    overflow: 'hidden',
  },
  headerBtn: {
    color: '#fff',
    fontSize: fontSize.md,
    paddingHorizontal: spacing.md,
  },
});
