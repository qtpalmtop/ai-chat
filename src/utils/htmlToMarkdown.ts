/**
 * 简化版富文本 -> Markdown 转换器
 * 用于"富文本工具栏"输入：把粘贴的 HTML 转成 Markdown 写入输入框
 * 仅做最常用标签：b/strong/i/em/code/br/p/ul/ol/li/h1-h3/a
 */
export function htmlToMarkdown(html: string): string {
  if (!html) return '';
  let md = html;
  md = md.replace(/<br\s*\/?>/gi, '\n');
  md = md.replace(/<\/(p|div)>/gi, '\n\n');
  md = md.replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, '**$2**');
  md = md.replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, '*$2*');
  md = md.replace(/<code>([\s\S]*?)<\/code>/gi, '`$1`');
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n');
  md = md.replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
  md = md.replace(/<\/?(ul|ol)[^>]*>/gi, '\n');
  // 兜底：剥掉所有剩余标签
  md = md.replace(/<[^>]+>/g, '');
  // 还原转义
  md = md.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  return md.trim();
}
