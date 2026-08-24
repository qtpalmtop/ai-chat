/**
 * 设备信息：封装 expo-device / expo-constants
 * - 提供 iOS/Android 平台判定
 * - 提供应用版本、构建号、设备型号等
 */
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

export const deviceInfo = {
  platform: Platform.OS as 'ios' | 'android',
  isDevice: Device.isDevice,
  model: Device.modelName ?? 'unknown',
  osVersion: Device.osVersion ?? 'unknown',
  appVersion:
    (Constants.expoConfig?.version as string | undefined) ?? '0.0.0',
  timezone:
    Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'Asia/Shanghai',
  locale:
    Intl.DateTimeFormat().resolvedOptions().locale ?? 'zh-CN',
};
