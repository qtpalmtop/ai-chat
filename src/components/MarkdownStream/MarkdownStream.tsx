/**
 * Markdown 流式渲染组件
 * - 已闭合段（parts）逐段独立渲染，享受完整 Markdown 体验
 * - pendingText 用纯文本 + 闪烁光标做打字机效果
 * - 代码块高亮使用 rehype-highlight（在 <code> 内注入 <span>）
 * - 自定义 pre 组件包裹 CodeBlock 外壳（复制按钮 + 语言标签），
 *   不自定义 code 组件，避免破坏 rehype-highlight 的 DOM 结构
 *
 * 性能优化：
 *   - DoneMarkdown 用 React.memo + content 字符串等值比较，
 *     pendingText 变化时不再触发 remark/rehype AST 重新解析
 *   - PendingText 用 ref + useLayoutEffect 直接写 textContent，
 *     绕过 React 文本节点的 diff，零虚拟 DOM 开销
 *   - 高频更新集中在"打字机文本"上，不污染已渲染的 Markdown 树
 */

import React, { useRef, useState } from 'react';
import useIsomorphicLayoutEffect from '@/hooks/useIsomorphicLayoutEffect';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import { CheckOutlined, CopyOutlined } from '@ant-design/icons';

interface Props {
  content: string;
  pending?: string;
  streaming?: boolean;
}

/**
 * 已闭合段：React.memo + 自定义比较
 * 只有 content 字符串真正变化（也就是新段闭合被 flush 进 parts）时才重解析
 * pending 变化 / streaming 切换都不会重跑 AST
 */
const DoneMarkdown = React.memo<{ content: string }>(
  ({ content }) => (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }]]}
      components={{
        a: ({ node, ...props }) => <a target="_blank" rel="noreferrer" {...props} />,
        pre: ({ node, className, children, ...rest }: any) => (
          <PreBlock className={className}>{children}</PreBlock>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  ),
  (prev, next) => prev.content === next.content,
);

/**
 * 未闭合段：ref + useLayoutEffect 直接写 textContent
 * - React 不参与文本 diff（<pre> 内部为空）
 * - useLayoutEffect 在 commit 前同步执行，无闪烁
 * - 这是打字机场景的"教科书"做法
 *
 * 尾段渐隐效果由 CSS mask-image 实现（见 .md-stream__pending-text），
 * 这里不做字符拆分——保持 ref 写 DOM 的零开销路径。
 */
const PendingText: React.FC<{ pending: string; streaming: boolean }> = ({
  pending,
  streaming,
}) => {
  const ref = useRef<HTMLPreElement>(null);
  useIsomorphicLayoutEffect(() => {
    if (ref.current) {
      ref.current.textContent = pending;
    }
  }, [pending]);
  return (
    <div className="md-stream__pending">
      <pre ref={ref} className="md-stream__pending-text" />
      {/* 打字机"渐隐尾段"由 mask-image 完成，不再用光标字符 */}
    </div>
  );
};

export const MarkdownStream: React.FC<Props> = ({ content, pending, streaming }) => {
  return (
    <div className="md-stream">
      {content && (
        <div className="md-stream__done">
          <DoneMarkdown content={content} />
        </div>
      )}
      {pending !== undefined && (
        <PendingText pending={pending} streaming={!!streaming} />
      )}
    </div>
  );
};

/**
 * 从 code 子元素中提取纯文本（用于复制）
 * rehype-highlight 会把 code 里的内容包装成多层 span，
 * 必须通过 DOM/递归的方式把文本拼回来
 */
function extractText(node: React.ReactNode): string {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (typeof node === 'object' && 'props' in (node as any)) {
    return extractText((node as any).props?.children);
  }
  return '';
}

const PreBlock: React.FC<{ className?: string; children?: React.ReactNode }> = ({
  className,
  children,
}) => {
  const [copied, setCopied] = useState(false);
  // children 通常是 <code> 元素
  const codeEl = React.Children.toArray(children).find(
    (c) => typeof c === 'object' && c !== null && (c as any).type === 'code',
  );
  const lang =
    /language-(\w+)/.exec((codeEl as any)?.props?.className || '')?.[1] || 'text';

  const onCopy = async () => {
    try {
      const text = extractText((codeEl as any)?.props?.children);
      await navigator.clipboard.writeText(text.replace(/\n$/, ''));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <div className="md-codeblock">
      <div className="md-codeblock__header">
        <span className="md-codeblock__lang">{lang}</span>
        <button className="md-codeblock__copy" onClick={onCopy}>
          {copied ? <CheckOutlined /> : <CopyOutlined />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className={className}>{children}</pre>
    </div>
  );
};
