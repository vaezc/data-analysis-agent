'use client'

// ============================================================
// 报告卡片：generate_report 工具产物的展示 + HTML 下载
//
// 设计：
//   - 头部：title + 元信息（N 章节）+ 主操作"下载"+ 次操作"预览/收起"
//   - 默认折叠：报告通常较长，不挤占对话流；点预览展开 summary + sections
//   - 下载：纯前端 Blob + URL.createObjectURL，不走后端
//   - 输出格式：HTML（带 inline CSS）— 普通用户双击文件即用浏览器打开看到渲染后效果
//   - 图表嵌入：本消息里已经渲染的 Recharts SVG 通过 data-chart-key 抓 outerHTML，
//     直接 inline 到 HTML 文档里。报告 offline 双击也能看到完整图。
// ============================================================

import { Download, FileText } from 'lucide-react'
import { marked } from 'marked'
import { useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChartConfig, ReportConfig } from '@/types'

interface ReportCardProps {
  report: ReportConfig
  /** 同一条 assistant 消息里的图表（用于在导出 HTML 时嵌入 SVG） */
  charts?: ChartConfig[]
  /** 与 charts 一一对应的 data-chart-key，用于从 DOM 抓 SVG */
  chartKeys?: string[]
}

interface EmbeddedChart {
  title: string
  svgHtml: string
}

export function ReportCard({ report, charts = [], chartKeys = [] }: ReportCardProps) {
  const [expanded, setExpanded] = useState(false)

  const handleDownload = () => {
    const embedded = collectChartSvgs(charts, chartKeys)
    const html = toStandaloneHtml(report, embedded)
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${sanitizeFilename(report.title)}.html`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden animate-fade-in">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="size-9 shrink-0 rounded-lg bg-accent-soft grid place-items-center text-accent">
          <FileText className="size-[18px]" strokeWidth={1.75} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-fg truncate">
            {report.title}
          </div>
          <div className="text-[11px] text-fg-muted mt-0.5 tabular-nums">
            分析报告 · {report.sections.length} 个章节
            {charts.length > 0 && ` · 含 ${charts.length} 张图表`}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 rounded-md px-2 py-1 text-xs text-fg-muted transition duration-150 hover:bg-surface hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {expanded ? '收起' : '预览'}
        </button>
        <button
          type="button"
          onClick={handleDownload}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg shadow-sm shadow-accent/25 transition duration-150 hover:opacity-90 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        >
          <Download className="size-3.5" strokeWidth={2} />
          下载 .html
        </button>
      </div>

      {expanded && (
        <div className="border-t border-border bg-bg px-4 py-3 animate-fade-in">
          <div className="rounded-md bg-accent-soft px-3 py-2.5 text-[13px] leading-relaxed text-fg">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={REPORT_MD}>
              {report.summary}
            </ReactMarkdown>
          </div>
          {report.sections.map((section, i) => (
            <div key={i} className="mt-4 first:mt-3">
              <div className="mb-1.5 text-sm font-semibold text-fg">
                {section.heading}
              </div>
              <div className="text-[13px] leading-relaxed text-fg-muted">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={REPORT_MD}>
                  {stripMarkdownImages(section.content)}
                </ReactMarkdown>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================
// 抓 chart SVG：从 DOM 拿当前已渲染的 Recharts SVG outerHTML
// ============================================================

function collectChartSvgs(
  charts: ChartConfig[],
  chartKeys: string[],
): EmbeddedChart[] {
  if (typeof document === 'undefined') return [] // SSR 防御
  const result: EmbeddedChart[] = []
  for (let i = 0; i < charts.length; i++) {
    const key = chartKeys[i]
    if (!key) continue
    const container = document.querySelector(`[data-chart-key="${key}"]`)
    const svg = container?.querySelector('svg')
    if (!svg) continue
    result.push({
      title: charts[i].title,
      svgHtml: ensureSvgNamespace(svg.outerHTML),
    })
  }
  return result
}

/** SVG 内嵌 HTML 时通常不需要 xmlns，但加上能让文件单独打开 / XHTML 解析也正常 */
function ensureSvgNamespace(svgHtml: string): string {
  if (svgHtml.startsWith('<svg ') && !/\sxmlns=/.test(svgHtml)) {
    return svgHtml.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')
  }
  return svgHtml
}

// ============================================================
// 报告 → 独立可双击打开的 HTML 文档
//
// 不再单次 marked.parse 整篇 markdown，而是分段拼接：
//   <h1>title</h1>
//   <section class="summary">{summary md}</section>
//   <section class="charts">{N 张图表}</section>   ← 自动插入，不依赖 LLM
//   {section.heading + section.content} × N
//
// 这样图表位置稳定（在 summary 后、详细分析前），
// 且 sections 里 LLM 仍然写的 ![]() 会被 stripMarkdownImages 防御去除。
// ============================================================

function toStandaloneHtml(report: ReportConfig, charts: EmbeddedChart[]): string {
  const titleHtml = `<h1>${escapeHtml(report.title)}</h1>`
  const summaryHtml = `<section class="summary">${parseMd(report.summary)}</section>`
  const chartsHtml =
    charts.length > 0
      ? `<section class="charts"><h2>可视化图表</h2>${charts
          .map(
            (c) =>
              `<figure><figcaption>${escapeHtml(c.title)}</figcaption><div class="chart-canvas">${c.svgHtml}</div></figure>`,
          )
          .join('')}</section>`
      : ''
  const sectionsHtml = report.sections
    .map(
      (s) =>
        `<section><h2>${escapeHtml(s.heading)}</h2>${parseMd(stripMarkdownImages(s.content))}</section>`,
    )
    .join('')

  return wrapDocument(
    report.title,
    titleHtml + summaryHtml + chartsHtml + sectionsHtml,
  )
}

/** marked v12 默认返回 string|Promise<string>；async:false 时同步，断言为 string */
function parseMd(md: string): string {
  return marked.parse(md, { gfm: true, async: false }) as string
}

/** 去掉 `![alt](url)` —— LLM 偶尔会写图片引用，但我们没真实图片 URL，会显示破图 */
function stripMarkdownImages(md: string): string {
  return md.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\n{3,}/g, '\n\n')
}

function wrapDocument(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<main>
${bodyHtml}
</main>
</body>
</html>
`
}

/** title 写进 <title> 时必须 escape，防止 LLM 输出 </title><script>... 之类 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      case "'":
        return '&#39;'
      default:
        return c
    }
  })
}

/** 跨平台合法的文件名：去掉 < > : " / \ | ? * 和控制字符，限长 80 */
function sanitizeFilename(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim()
  return cleaned.slice(0, 80) || 'report'
}

// 独立 HTML 的样式：与 app 的设计语言一致（indigo accent + Notion 风表格）
// :root 变量让嵌入的 SVG 引用的 var(--xxx) 在独立文档里也能 resolve
const REPORT_CSS = `
:root {
  --bg: #fafafa;
  --fg: #18181b;
  --fg-muted: #52525b;
  --fg-subtle: #a1a1aa;
  --card: #ffffff;
  --surface: #f4f4f5;
  --border: #e4e4e7;
}
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  padding: 32px 16px 64px;
  background: var(--bg);
  color: var(--fg);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  font-size: 15px;
  line-height: 1.75;
  -webkit-font-smoothing: antialiased;
}
main {
  max-width: 720px;
  margin: 0 auto;
  padding: 48px 56px;
  background: var(--card);
  border-radius: 12px;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.04), 0 8px 24px rgb(0 0 0 / 0.04);
}
h1 {
  margin: 0 0 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
  color: #4f46e5;
  font-size: 28px;
  font-weight: 700;
  line-height: 1.3;
}
h2 {
  margin: 32px 0 12px;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.4;
}
h3 {
  margin: 24px 0 8px;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.5;
}
p { margin: 0 0 12px; }
ul, ol { margin: 0 0 12px; padding-left: 24px; }
li { margin: 4px 0; }
li > p { margin: 0; }
strong { font-weight: 600; color: var(--fg); }
em { font-style: italic; }
a { color: #4f46e5; text-decoration: none; }
a:hover { text-decoration: underline; }
hr { border: none; border-top: 1px solid var(--border); margin: 24px 0; }
blockquote {
  margin: 12px 0;
  padding: 4px 0 4px 16px;
  border-left: 3px solid #d4d4d8;
  color: var(--fg-muted);
}
code {
  padding: 2px 6px;
  background: var(--surface);
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.9em;
}
pre {
  margin: 12px 0;
  padding: 14px 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.6;
}
pre code { padding: 0; background: none; font-size: inherit; }
table {
  width: 100%;
  margin: 16px 0;
  border-collapse: collapse;
  font-size: 14px;
}
thead { background: var(--surface); }
th, td { padding: 10px 14px; text-align: left; }
th { font-weight: 600; color: var(--fg-muted); }
tr { border-bottom: 1px solid var(--border); }
tbody tr:last-child { border-bottom: none; }

/* 图表段落 */
section.charts { margin: 24px 0; }
figure {
  margin: 16px 0 24px;
  padding: 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
}
figcaption {
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--fg-muted);
}
.chart-canvas { display: flex; justify-content: center; }
.chart-canvas svg { max-width: 100%; height: auto; }

@media (max-width: 600px) {
  main { padding: 32px 24px; border-radius: 8px; }
  h1 { font-size: 24px; }
}
@media print {
  body { background: #fff; padding: 0; }
  main { box-shadow: none; padding: 32px 0; max-width: 100%; }
  h1 { color: var(--fg); }
  figure { break-inside: avoid; background: #fff; }
}
`

// ============================================================
// 卡片内 markdown 样式（对话流里预览用，比对话气泡更紧凑）
// ============================================================

const REPORT_MD: Components = {
  p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
  ul: ({ children }) => (
    <ul className="mb-1.5 ml-4 list-disc space-y-0.5 last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-1.5 ml-4 list-decimal space-y-0.5 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li>{children}</li>,
  strong: ({ children }) => (
    <strong className="font-semibold text-fg">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent hover:underline underline-offset-2"
    >
      {children}
    </a>
  ),
  // 卡片内预览 strip 掉图片：与下载产物保持一致，不让破图占位符出现在 UI 里
  img: () => null,
  code: ({ children }) => (
    <code className="rounded bg-surface px-1 py-0.5 font-mono text-[12px] text-fg">
      {children}
    </code>
  ),
  table: ({ children }) => (
    <div className="my-1.5 overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-[12px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-surface">{children}</thead>,
  tr: ({ children }) => (
    <tr className="border-b border-border last:border-b-0">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="px-2.5 py-1.5 text-left font-semibold text-fg-muted">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-2.5 py-1.5 text-fg-muted">{children}</td>
  ),
}
