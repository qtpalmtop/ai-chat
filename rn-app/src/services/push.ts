/**
 * 远程推送：封装 expo-notifications
 * - 获取 expo push token（注册到后端）
 * - 监听远程/本地通知
 *
 * 注意：
 * - iOS 模拟器无法获取真实 push token（生产/真机才行）
 * - Android 走 FCM（需配置 google-services.json + EAS）
 */
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// 必须设置 handler，否则通知到达时不会显示（默认不展示）
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export const pushService = {
  /**
   * 注册推送权限并获取 expo push token
   * - 失败返回 null（不抛异常，调用方可选忽略）
   */
  async register(): Promise<string | null> {
    if (!Device.isDevice) {
      // 模拟器/模拟器不返回真实 token
      return null;
    }

    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      return null;
    }

    // Android 需要设置 channel
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#4d6bfe',
      });
    }

    try {
      // EAS projectId 必须在 app.json 配好，否则会报 ProjectIdNotFound
      const projectId =
        Constants.expoConfig?.extra?.eas?.projectId ??
        (Constants.easConfig as { projectId?: string } | undefined)?.projectId;
      const tokenResp = await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined,
      );
      return tokenResp.data;
    } catch (e) {
      console.warn('[push] getExpoPushTokenAsync failed:', (e as Error).message);
      return null;
    }
  },

  /**
   * 监听远程/本地通知（用户点击/接收到时触发）
   */
  addNotificationListener(
    onReceived: (n: Notifications.Notification) => void,
    onResponse: (r: Notifications.NotificationResponse) => void,
  ): () => void {
    const receivedSub = Notifications.addNotificationReceivedListener(onReceived);
    const responseSub = Notifications.addNotificationResponseReceivedListener(onResponse);
    return () => {
      receivedSub.remove();
      responseSub.remove();
    };
  },

  /** 主动展示本地通知（用于 JS Bridge 调试） */
  async showLocal(title: string, body: string, data?: Record<string, unknown>) {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data, sound: 'default' },
      trigger: null,
    });
  },
};
