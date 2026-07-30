import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // SSR 配置：
  // 1) ssr.noExternal: 这些包不让 Node 解析（让 Vite 当 ESM 处理/打包）
  // 2) ssr.optimizeDeps.include: 这些 CJS 包在 dev 时被 esbuild 预打包成 ESM
  //    （不预打包的话，ssrLoadModule 直接 eval 会报 `module is not defined`）
  ssr: {
    noExternal: [
      // antd 生态
      /^antd/,
      '@ant-design/cssinjs',
      /^@ant-design\//,
      /^@rc-component\//,
      /^rc-/,
      // babel runtime（antd 内部大量依赖，必须预打包）
      /^@babel\/runtime/,
      // markdown 渲染链
      'react-markdown',
      'remark-gfm',
      'remark-breaks',
      'rehype-highlight',
      'unified',
      'bail',
      'trough',
      'vfile',
      'vfile-message',
      /^unist-util-/,
      /^mdast-util-/,
      'micromark',
      /^micromark-/,
      'hast-util-to-jsx-runtime',
      'property-information',
      'space-separated-tokens',
      'comma-separated-tokens',
      'decode-named-character-reference',
      'character-entities',
      'highlight.js',
      'lowlight',
      'refractor',
      'html-void-elements',
      'ccount',
      'escape-string-regexp',
      'hastscript',
      'web-namespaces',
      'zwitch',
      'is-plain-obj',
      'extend',
      'longest-streak',
      // scroll-into-view 链
      'scroll-into-view-if-needed',
      'compute-scroll-into-view',
      // 其它
      'nanoid',
      // emotion（cssinjs 用）
      /^@emotion\//,
    ],
    optimizeDeps: {
      // dev 时预打包 CJS 包（esbuild 把 module.exports 转 ESM）
      // 必须列全，否则动态 require 的 CJS 包会直接报 module is not defined
      include: [
        '@babel/runtime/helpers/esm/typeof',
        '@babel/runtime/helpers/esm/defineProperty',
        '@babel/runtime/helpers/esm/objectSpread2',
        'extend',
        'is-plain-obj',
        'trough',
        'bail',
        'vfile',
        'vfile-message',
        'unified',
        'react-markdown',
        'remark-gfm',
        'remark-breaks',
        'rehype-highlight',
        'micromark',
        'mdast-util-to-hast',
        'unist-util-visit',
        'unist-util-visit-parents',
        'unist-util-is',
        'unist-util-position',
        'unist-util-stringify-position',
        'mdast-util-from-markdown',
        'mdast-util-to-string',
        'hast-util-to-jsx-runtime',
        'property-information',
        'space-separated-tokens',
        'comma-separated-tokens',
        'decode-named-character-reference',
        'character-entities',
        'ccount',
        'escape-string-regexp',
        'hastscript',
        'web-namespaces',
        'zwitch',
        'longest-streak',
        'lowlight',
        'refractor',
        'highlight.js',
      ],
    },
  },
  // 构建：客户端 + 服务端双产物（prod SSR 需要）
  // 客户端：默认入口是 index.html → src/main.tsx（Vite 自动检测）
  // 服务端：通过 `vite build --ssr` 命令单独构建（见 package.json scripts）
  build: {
    rollupOptions: {
      // 不显式声明 input，让 Vite 通过 index.html 自动发现入口
    },
  },
});
