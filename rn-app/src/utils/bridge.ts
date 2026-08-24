/**
 * JS Bridge: web 调 native
 * - 注入 window.AINative 到 web 页面
 * - web 调用 window.AINative.xxx() 后，native 处理后通过 postMessage 回传
 *
 * 协议：
 * - Web → Native:  window.AINative.call(method, params, callbackId)
 *   native 端监听到 message，解析后执行对应方法，通过 injectJavaScript 回调
 * - Native → Web:  injectJavaScript('window.AINative.emit("event", payload)')
 *
 * method 列表（按需扩展）：
 * - getDeviceInfo
 * - getLocation
 * - takePhoto
 * - pickFromLibrary
 * - showToast
 * - getNetworkState
 * - reportEvent
 */
import { cameraService } from '../services/camera';
import { locationService } from '../services/location';
import { fetchConnectivity } from '../services/network';
import { deviceInfo } from '../services/deviceInfo';
import { Alert, ToastAndroid, Platform } from 'react-native';

export interface BridgeMessage {
  /** 'web_to_native' 来自 web 调 native；'native_to_web' 来自 native 推 web */
  type: 'web_to_native' | 'native_to_web';
  method?: string;
  params?: unknown;
  callbackId?: string;
  event?: string;
  payload?: unknown;
  /** 响应状态：'ok' | 'error' */
  status?: 'ok' | 'error';
  result?: unknown;
  error?: { code: string; message: string };
}

type BridgeHandler = (msg: BridgeMessage) => void | Promise<void>;

/**
 * 处理 web 调 native 的方法调用
 */
export async function handleBridgeCall(
  msg: BridgeMessage,
): Promise<Omit<BridgeMessage, 'type' | 'method' | 'params' | 'callbackId'>> {
  const { method, params } = msg;
  try {
    switch (method) {
      case 'getDeviceInfo': {
        return {
          status: 'ok',
          result: {
            platform: deviceInfo.platform,
            model: deviceInfo.model,
            osVersion: deviceInfo.osVersion,
            appVersion: deviceInfo.appVersion,
            isDevice: deviceInfo.isDevice,
            timezone: deviceInfo.timezone,
            locale: deviceInfo.locale,
          },
        };
      }
      case 'getLocation': {
        const loc = await locationService.getCurrent();
        return { status: 'ok', result: loc };
      }
      case 'takePhoto': {
        const photo = await cameraService.takePhoto();
        return { status: 'ok', result: photo };
      }
      case 'pickFromLibrary': {
        const max = (params as { max?: number } | undefined)?.max ?? 1;
        const list = await cameraService.pickFromLibrary(max);
        return { status: 'ok', result: list };
      }
      case 'getNetworkState': {
        const net = await fetchConnectivity();
        return { status: 'ok', result: net };
      }
      case 'showToast': {
        const text = (params as { text?: string } | undefined)?.text ?? '';
        if (Platform.OS === 'android') {
          ToastAndroid.show(text, ToastAndroid.SHORT);
        } else {
          Alert.alert('提示', text);
        }
        return { status: 'ok' };
      }
      case 'reportEvent': {
        // 占位：埋点
        console.log('[AINative.reportEvent]', params);
        return { status: 'ok' };
      }
      default:
        return {
          status: 'error',
          error: { code: 'METHOD_NOT_FOUND', message: `unknown method: ${method}` },
        };
    }
  } catch (e) {
    return {
      status: 'error',
      error: {
        code: 'NATIVE_ERROR',
        message: (e as Error).message ?? 'native error',
      },
    };
  }
}

/**
 * 注入到 web 页面 的 bridge 脚本
 * - 暴露 window.AINative.call/emit
 * - 自动 dispatch AINativeReady 事件
 */
export const BRIDGE_INJECT_SCRIPT = `
(function () {
  if (window.AINative && window.AINative.__injected) return;
  var pendingCallbacks = {};
  var eventListeners = {};
  var callbackSeq = 0;

  function genCallbackId() {
    return 'cb_' + Date.now() + '_' + (++callbackSeq);
  }

  function onMessage(e) {
    try {
      var data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      if (!data || data.type !== 'native_to_web') return;
      if (data.callbackId && pendingCallbacks[data.callbackId]) {
        var cb = pendingCallbacks[data.callbackId];
        delete pendingCallbacks[data.callbackId];
        if (data.status === 'ok') cb.resolve(data.result);
        else cb.reject(new Error(data.error && data.error.message || 'native error'));
      } else if (data.event) {
        (eventListeners[data.event] || []).forEach(function (fn) {
          try { fn(data.payload); } catch (err) { console.error('[AINative listener]', err); }
        });
      }
    } catch (err) {
      console.error('[AINative onMessage]', err);
    }
  }
  window.addEventListener('message', onMessage);
  document.addEventListener('message', onMessage);

  function call(method, params) {
    return new Promise(function (resolve, reject) {
      var callbackId = genCallbackId();
      pendingCallbacks[callbackId] = { resolve: resolve, reject: reject };
      var msg = { type: 'web_to_native', method: method, params: params, callbackId: callbackId };
      // 优先用 ReactNativeWebView 注入的 postMessage
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(msg));
      } else {
        window.postMessage(JSON.stringify(msg), '*');
      }
      // 30s 超时
      setTimeout(function () {
        if (pendingCallbacks[callbackId]) {
          delete pendingCallbacks[callbackId];
          reject(new Error('native call timeout: ' + method));
        }
      }, 30000);
    });
  }

  function on(event, fn) {
    if (!eventListeners[event]) eventListeners[event] = [];
    eventListeners[event].push(fn);
    return function off() {
      eventListeners[event] = (eventListeners[event] || []).filter(function (x) { return x !== fn; });
    };
  }

  function emit(event, payload) {
    // web 端主动 emit（一般用于通知 native）
    var msg = { type: 'web_to_native', event: event, payload: payload };
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    } else {
      window.postMessage(JSON.stringify(msg), '*');
    }
  }

  window.AINative = {
    call: call,
    on: on,
    emit: emit,
    __injected: true,
    platform: 'unknown',
  };
  // 通知 web 端 bridge 已就绪
  setTimeout(function () {
    try {
      window.dispatchEvent(new Event('AINativeReady'));
    } catch (e) {}
  }, 0);
})();
`;

/**
 * 构造 native→web 的回调消息（用于 injectJavaScript 回传）
 */
export function buildNativeToWebScript(msg: Omit<BridgeMessage, 'type' | 'method' | 'params' | 'callbackId'> & {
  callbackId?: string;
  event?: string;
}): string {
  const payload = JSON.stringify({ type: 'native_to_web', ...msg });
  // 用 postMessage 传回，web 端 window.message listener 会接住
  return `
    (function () {
      try {
        window.postMessage(${JSON.stringify(payload)}, '*');
      } catch (e) { console.error('[bridge back]', e); }
    })();
    true;
  `;
}
