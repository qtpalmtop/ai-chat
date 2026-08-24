# AI Tools (rn-app)

跨平台 AI 工具 App（iOS + Android），基于 **Expo SDK 54 + TypeScript + React 19**。

## 架构
```
rn-app/
├── App.tsx                    # 根组件
├── app.json                   # Expo 配置（含 iOS/Android 原生权限、bundleId）
├── babel.config.js            # babel-preset-expo + react-native-worklets/plugin
├── src/
│   ├── api/                   # HTTP 客户端 + 业务 API
│   ├── components/            # 通用 UI
│   ├── config.ts              # 环境变量（EXPO_PUBLIC_*）
│   ├── constants/             # 颜色、间距、字号
│   ├── navigation/            # 根导航（Home → WebView）
│   ├── screens/
│   │   ├── HomeScreen.tsx     # 工具列表（grid）
│   │   └── WebViewScreen.tsx  # WebView + JS Bridge
│   ├── services/              # 相机/相册、定位、推送、网络、设备信息
│   ├── store/                 # zustand
│   ├── types/                 # 公共类型
│   └── utils/bridge.ts        # JS Bridge 协议
```

## 启动
```bash
# 1. 安装依赖（首次）
cd rn-app && npm install

# 2. 用 Expo Go 直接扫码（推荐，已装 SDK 54）
npm start

# 3. 真机/模拟器（prebuild 后用 dev client 跑）
npm run prebuild
npm run start:dev       # 在一个终端
npm run ios             # 另一个终端（需 Xcode）
# 或
npm run android         # 另一个终端（需 Android Studio + adb）
```

## 关键设计
- **工具列表走后端 API**：`POST /api/devices` 同时下发工具列表和 webview 域名，避免冷启动串行请求。
- **WebView URL 走配置下发**：dev/prod 域名由后端通过 `GET /api/tools/:id` 字段下发。
- **JS Bridge 双向**：
  - web → native：`window.AINative.call('takePhoto', {})` → 调相机/相册/定位
  - native → web：推送事件转发到 web
- **离线降级**：启动失败时只拉取 tools；网络断时顶部黄条提示。

## SDK 54 注意事项
- React 19.1 + React Native 0.81 + Reanimated 4
- Reanimated v4 不再自带 babel 插件，必须装 `react-native-worklets` 并在 babel.config.js 末尾加 `'react-native-worklets/plugin'`
- New Architecture 默认开启，大部分包已经适配；如遇 native module 报错可临时关：`app.json` 加 `"newArchEnabled": false`
