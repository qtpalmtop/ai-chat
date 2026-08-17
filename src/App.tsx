import React, { useEffect, useState } from 'react';
import { ConfigProvider, App as AntdApp, theme } from 'antd';
import type { Locale } from 'antd/es/locale';
import { ChatWindow } from '@/components/ChatWindow/ChatWindow';
import { AgentWorkbench } from '@/pages/AgentWorkbench/AgentWorkbench';
import { useRouter } from '@/router';

/**
 * locale 在 SSR 阶段不加载
 * - 原因：antd/locale/* 是 CJS 文件，Vite ssrLoadModule 加载会报 `module is not defined`
 * - 策略：SSR 渲染 locale=undefined（用 antd 默认英文），
 *   客户端 hydrate 完成后用 useEffect 动态 import，触发 re-render 切换为中文
 * - Hydration 安全：SSR 输出 undefined === 客户端首次 render 输出 undefined，结构一致
 */
const App: React.FC = () => {
  const [locale, setLocale] = useState<Locale | undefined>(undefined);
  const { path } = useRouter();

  if (typeof window !== 'undefined') {
    (window as any).__diag_path = path;
  }

  React.useEffect(() => {
    console.log('[diag] App MOUNT');
    return () => console.log('[diag] App UNMOUNT');
  }, []);

  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      console.log('[diag] path effect:', path);
    }
  }, [path]);

  useEffect(() => {
    // 只在客户端动态加载 locale（避开 SSR 阶段 CJS 加载问题）
    import('antd/locale/zh_CN').then((mod) => {
      setLocale(mod.default);
    });
  }, []);

  return (
    <ConfigProvider
      locale={locale}
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#4D6BFE',
          colorInfo: '#4D6BFE',
          colorLink: '#4D6BFE',
          colorSuccess: '#52c41a',
          borderRadius: 10,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        },
        components: {
          Button: {
            controlHeight: 36,
            borderRadius: 10,
            fontWeight: 500,
          },
        },
      }}
    >
      <AntdApp>
        {path === '/agent' ? <AgentWorkbench /> : <ChatWindow />}
      </AntdApp>
    </ConfigProvider>
  );
};

export default App;
