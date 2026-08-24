/**
 * 网络状态：封装 @react-native-community/netinfo
 * - 提供当前网络信息 hook
 * - 提供离线/在线变化回调
 */
import NetInfo, { NetInfoState, NetInfoStateType } from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

export type ConnectivityState = {
  isConnected: boolean;
  isInternetReachable: boolean | null;
  type: NetInfoStateType | 'unknown';
};

const initial: ConnectivityState = {
  isConnected: true,
  isInternetReachable: null,
  type: 'unknown',
};

/**
 * React hook：实时返回当前网络状态
 */
export function useConnectivity(): ConnectivityState {
  const [state, setState] = useState<ConnectivityState>(initial);

  useEffect(() => {
    const unsub = NetInfo.addEventListener((s) => {
      setState({
        isConnected: Boolean(s.isConnected),
        isInternetReachable: s.isInternetReachable,
        type: s.type,
      });
    });
    // 立刻拉一次，避免初始空值
    NetInfo.fetch().then((s) => {
      setState({
        isConnected: Boolean(s.isConnected),
        isInternetReachable: s.isInternetReachable,
        type: s.type,
      });
    });
    return unsub;
  }, []);

  return state;
}

/** 主动查询一次（hook 外的命令式 API） */
export async function fetchConnectivity(): Promise<ConnectivityState> {
  const s = await NetInfo.fetch();
  return {
    isConnected: Boolean(s.isConnected),
    isInternetReachable: s.isInternetReachable,
    type: s.type,
  };
}
