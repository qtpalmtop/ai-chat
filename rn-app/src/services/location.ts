/**
 * 定位：封装 expo-location
 * - 提供 getCurrentPosition（一次性）和 watchPosition（订阅式）
 * - 统一处理权限拒绝、超时、错误
 */
import * as Location from 'expo-location';
import { Alert } from 'react-native';

export interface Coords {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

let watchingSubscription: Location.LocationSubscription | null = null;

export const locationService = {
  async getCurrent(): Promise<Coords | null> {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('需要定位权限', '请在系统设置中允许 AI Tools 使用位置');
      return null;
    }
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy: pos.coords.accuracy ?? undefined,
    };
  },

  /**
   * 订阅位置变化
   * @param onChange 位置更新回调
   * @returns 取消订阅的函数
   */
  async watch(onChange: (c: Coords) => void): Promise<() => void> {
    if (watchingSubscription) {
      watchingSubscription.remove();
      watchingSubscription = null;
    }
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('需要定位权限', '请在系统设置中允许 AI Tools 使用位置');
      return () => {};
    }
    watchingSubscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 30_000,
        distanceInterval: 50,
      },
      (pos) => {
        onChange({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? undefined,
        });
      },
    );
    return () => {
      watchingSubscription?.remove();
      watchingSubscription = null;
    };
  },

  stopWatch(): void {
    watchingSubscription?.remove();
    watchingSubscription = null;
  },
};
