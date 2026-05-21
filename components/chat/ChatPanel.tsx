"use client";

import { Database, Loader2, RotateCcw, Send, Sparkles, X } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useAgent } from "@/hooks/use-agent";
import type { Column } from "@/types";
import { MessageBubble } from "./MessageBubble";

interface ChatPanelProps {
  datasetId: string | null;
  /** 当前激活数据集的列 schema —— 用于动态生成示例问题 + 输入框 placeholder */
  columns?: Column[];
}

// ============================================================
// 动态提示生成：根据 columns 的类型组合套模板，生成 2~3 个有针对性的问题
//
// 不调 LLM（即时、无网络成本、不烧 token）。模板覆盖三种典型分析场景：
//   1. 分类对比：string × number → "哪个 X 的 Y 最高"
//   2. 时间趋势：date × number → "按 X 看 Y 的趋势"
//   3. 单变量统计：number → "X 的统计指标"
// ============================================================

const DEFAULT_SUGGESTIONS = [
  "这份数据一共有多少行？",
  "每列分别是什么类型？",
  "数据里有缺失值吗？",
];

function generateSuggestions(columns: Column[] | undefined): string[] {
  if (!columns || columns.length === 0) return DEFAULT_SUGGESTIONS;

  const numCols = columns.filter((c) => c.type === "number");
  const strCols = columns.filter((c) => c.type === "string");
  const dateCols = columns.filter((c) => c.type === "date");

  const out: string[] = [];

  // 分类对比
  if (strCols.length > 0 && numCols.length > 0) {
    out.push(`哪个 ${strCols[0].name} 的 ${numCols[0].name} 最高？`);
  }

  // 时间趋势 / 二级分组
  if (dateCols.length > 0 && numCols.length > 0) {
    out.push(`按 ${dateCols[0].name} 看 ${numCols[0].name} 的变化趋势`);
  } else if (strCols.length > 1 && numCols.length > 0) {
    out.push(`按 ${strCols[1].name} 分组统计 ${numCols[0].name} 的总和`);
  }

  // 单变量统计
  if (numCols.length > 0) {
    out.push(`${numCols[0].name} 的平均值、最大值、最小值分别是多少？`);
  } else if (strCols.length > 0) {
    out.push(`${strCols[0].name} 有哪些不同的取值？`);
  }

  // 兜底凑齐 3 条（避免列结构极简时只显示 1~2 条建议）
  const fallbacks = DEFAULT_SUGGESTIONS;
  let idx = 0;
  while (out.length < 3 && idx < fallbacks.length) {
    if (!out.includes(fallbacks[idx])) out.push(fallbacks[idx]);
    idx++;
  }

  return out.slice(0, 3);
}

function generatePlaceholder(columns: Column[] | undefined): string {
  if (!columns || columns.length === 0) {
    return "提个问题，让 Agent 帮你分析这份数据";
  }
  const numCols = columns.filter((c) => c.type === "number");
  const strCols = columns.filter((c) => c.type === "string");

  if (strCols.length > 0 && numCols.length > 0) {
    return `例如：哪个 ${strCols[0].name} 的 ${numCols[0].name} 最高？`;
  }
  if (numCols.length > 0) {
    return `例如：${numCols[0].name} 的平均值是多少？`;
  }
  return "提个问题，让 Agent 帮你分析这份数据";
}

export function ChatPanel({ datasetId, columns }: ChatPanelProps) {
  // 模板 fallback —— LLM suggestions 未返回前显示
  const templateSuggestions = useMemo(
    () => generateSuggestions(columns),
    [columns],
  );
  const placeholder = useMemo(() => {
    if (!datasetId) return "请先选择数据集";
    return generatePlaceholder(columns);
  }, [datasetId, columns]);

  // LLM 生成的更自然 suggestions（异步加载）
  // 会话内 cache by datasetId 避免切回时重复调用
  const [llmSuggestions, setLlmSuggestions] = useState<string[] | null>(null);
  const suggestionsCacheRef = useRef<Map<string, string[]>>(new Map());

  useEffect(() => {
    if (!datasetId) {
      // Switching datasets intentionally resets the suggestion slot before async data arrives.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLlmSuggestions(null);
      return;
    }
    // 命中缓存：直接用，不发请求
    const cached = suggestionsCacheRef.current.get(datasetId);
    if (cached) {
      // Cache hits should update immediately so old dataset suggestions do not flash.
      setLlmSuggestions(cached);
      return;
    }
    // 切 dataset 时先清空，避免上一个 dataset 的 LLM 建议短暂残留
    setLlmSuggestions(null);

    let cancelled = false;
    fetch(`/api/datasets/${encodeURIComponent(datasetId)}/suggestions`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ suggestions: string[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        if (Array.isArray(data.suggestions) && data.suggestions.length > 0) {
          suggestionsCacheRef.current.set(datasetId, data.suggestions);
          setLlmSuggestions(data.suggestions);
        }
      })
      .catch(() => {
        // 失败不影响主流程：fallback 到模板
      });
    return () => {
      cancelled = true;
    };
  }, [datasetId]);

  const suggestions = llmSuggestions ?? templateSuggestions;

  const {
    messages,
    send,
    isStreaming,
    isLoadingHistory,
    error,
    clearError,
    reset,
    deleteMessage,
    deletingIds,
  } = useAgent({
    datasetId,
  });

  const handleDeleteMessage = async (messageId: string) => {
    if (
      !confirm(
        "确定删除这条对话？\n配对的 user/assistant 消息会一起删除，不可恢复。",
      )
    )
      return;
    await deleteMessage(messageId);
  };
  const [isResetting, setIsResetting] = useState(false);

  const handleNewChat = async () => {
    if (
      !confirm(
        "确定开始新对话？\n当前对话历史会被清空（数据集保留），且不可恢复。",
      )
    )
      return;
    setIsResetting(true);
    try {
      await reset();
    } finally {
      setIsResetting(false);
    }
  };
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  // sticky 状态：用户当前是否"贴底"。新内容来时只在此状态为 true 才跟随。
  // 由用户的实际滚动位置维护（scrollHeight 变化不触发 scroll 事件，所以程序滚动不会污染状态）
  const stickyRef = useRef(true);
  // 跟踪上一帧 messages 数量：区分"新消息"和"流式更新"两种场景
  const prevCountRef = useRef(messages.length);
  // 跟踪上一帧 isLoadingHistory：检测 true→false 的转换（=刚加载完历史的瞬间）
  const prevLoadingRef = useRef(false);

  // 监听用户滚动位置，维护 sticky 状态。
  // 阈值 60px：留点容差处理浏览器渲染细节（行高、padding 等）
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickyRef.current = distance < 60;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // 滚动策略（三种场景区分）：
  //   1. 切换 dataset 加载完历史（isLoadingHistory: true→false）
  //      → useLayoutEffect 同步瞬时定位到底，浏览器不会 paint 顶部那一帧
  //   2. 用户发新消息（messages.length 增加）
  //      → smooth 滚动，视觉自然
  //   3. 流式更新（同一条 assistant message 在变，length 不变）
  //      → 仅在 sticky 为 true 时瞬时跟随，避免动画排队
  //
  // 关键：场景 1 用 useLayoutEffect 是为了让 scrollTop 设置在浏览器 paint 之前完成，
  // 用户视觉上直接看到内容"已经在底部"，没有"从顶部滚下来"的动画感
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const justFinishedLoading = prevLoadingRef.current && !isLoadingHistory;
    prevLoadingRef.current = isLoadingHistory;

    if (isLoadingHistory) {
      // 加载中：不动滚动
      return;
    }

    if (justFinishedLoading) {
      // 刚加载完历史：瞬时定位到底（不 smooth），同时重置 sticky 状态
      el.scrollTop = el.scrollHeight;
      stickyRef.current = true;
      prevCountRef.current = messages.length;
      return;
    }

    // 后续：新消息 smooth，流式瞬时
    const isNewMessage = messages.length > prevCountRef.current;
    prevCountRef.current = messages.length;

    if (isNewMessage) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      stickyRef.current = true;
      return;
    }
    if (stickyRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, isLoadingHistory]);

  // Vision multimodal 前端 UI 暂时下线（DeepSeek 当前 chat completions 不支持
  // image_url；切到 vision-capable LLM 如 gpt-4o 时再恢复）。
  // 后端协议层（types / agent.ts / messages-store.ts / /api/agent）仍支持
  // images 字段，历史消息中已有图片仍能正常显示。

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    await send(text);
  };

  const canSubmit =
    Boolean(datasetId) && !isStreaming && input.trim().length > 0;

  return (
    <div className="flex-1 flex flex-col min-h-0 relative">
      {/* New Chat 按钮：右上角 floating，仅在有对话时显示 */}
      {messages.length > 0 && !isLoadingHistory && (
        <button
          type="button"
          onClick={handleNewChat}
          disabled={isResetting || isStreaming}
          aria-label="开始新对话"
          className="absolute right-4 top-4 z-10 inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-fg-muted shadow-sm transition duration-150 hover:bg-surface hover:text-fg active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {isResetting ? (
            <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
          ) : (
            <RotateCcw className="size-3.5" strokeWidth={1.75} />
          )}
          新对话
        </button>
      )}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
          {isLoadingHistory ? (
            <HistorySkeleton />
          ) : messages.length === 0 ? (
            <EmptyState
              datasetId={datasetId}
              suggestions={suggestions}
              onPick={(q) => setInput(q)}
            />
          ) : (
            messages.map((m, i) => (
              <MessageBubble
                key={m.id}
                message={m}
                isStreaming={isStreaming}
                isLast={i === messages.length - 1}
                // streaming 期间禁删，防止删进行中的（DB 还没存 assistant，会 404）
                onDelete={
                  isStreaming ? undefined : () => handleDeleteMessage(m.id)
                }
                isDeleting={deletingIds.includes(m.id)}
              />
            ))
          )}
        </div>
      </div>

      {error && (
        <div className="border-t border-danger/20 bg-danger-soft">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-6 py-2.5 text-sm text-danger">
            <span className="flex-1 min-w-0">{error}</span>
            <button
              type="button"
              onClick={clearError}
              aria-label="关闭错误提示"
              className="shrink-0 rounded p-0.5 text-danger/70 transition duration-150 hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      {/* Floating input 区：上方 gradient mask 让滚动文本柔和渐隐 */}
      <div className="relative bg-bg">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-8 left-0 right-0 h-8 bg-linear-to-t from-bg to-transparent"
        />
        <form
          onSubmit={handleSubmit}
          className="mx-auto max-w-3xl px-6 pt-2 pb-4"
        >
          <div className="flex items-center gap-2 rounded-2xl border border-border bg-card pl-4 pr-2 py-2 shadow-lg shadow-fg/5 transition duration-150 focus-within:border-accent/40 focus-within:ring-2 focus-within:ring-accent/15">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={!datasetId}
              placeholder={placeholder}
              className="flex-1 bg-transparent py-1.5 text-sm text-fg placeholder:text-fg-subtle outline-none disabled:text-fg-subtle disabled:placeholder:text-fg-subtle"
            />
            <button
              type="submit"
              disabled={!canSubmit}
              aria-label="发送"
              className="size-9 shrink-0 inline-flex items-center justify-center rounded-xl bg-accent text-accent-fg shadow-sm shadow-accent/25 transition duration-150 hover:opacity-90 active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:bg-surface disabled:text-fg-subtle disabled:shadow-none disabled:cursor-not-allowed disabled:active:scale-100 disabled:hover:opacity-100"
            >
              {isStreaming ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EmptyState({
  datasetId,
  suggestions,
  onPick,
}: {
  datasetId: string | null;
  suggestions: string[];
  onPick: (q: string) => void;
}) {
  if (!datasetId) {
    return (
      <div className="text-center pt-24">
        <div className="mx-auto size-14 rounded-2xl bg-surface grid place-items-center">
          <Database className="size-6 text-fg-muted" strokeWidth={1.5} />
        </div>
        <div className="mt-5 text-base font-semibold text-fg">
          尚未选择数据集
        </div>
        <div className="mt-1.5 text-sm text-fg-muted">
          请从左侧上传 CSV / Excel 文件
        </div>
      </div>
    );
  }
  return (
    <div className="text-center pt-20">
      <div className="mx-auto size-14 rounded-2xl bg-accent-soft grid place-items-center">
        <Sparkles className="size-6 text-accent" strokeWidth={1.5} />
      </div>
      <div className="mt-5 text-base font-semibold text-fg">开始分析</div>
      <div className="mt-1.5 text-sm text-fg-muted">
        提个问题，Agent 会自动调用工具完成多步分析
      </div>
      <div className="mt-7 flex flex-wrap justify-center gap-2">
        {suggestions.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onPick(q)}
            className="text-xs px-3 py-1.5 rounded-full border border-border bg-card text-fg-muted transition duration-150 hover:border-border-strong hover:bg-surface hover:text-fg active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// 历史加载骨架：切换 dataset 时占位，避免空白闪烁 / EmptyState 误导
//
// 设计原则：
//   - 形态贴近真实对话气泡（user 右气泡 + assistant 左气泡 + 头像）
//   - 用 bg-surface（语义 token，明暗主题自动跟随）
//   - animate-pulse 提示"加载中"
//   - 渲染 1 对（user + assistant），数量适中：太多假数据有戏精感，太少又像 bug
// ============================================================
function HistorySkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="加载对话历史">
      {/* user bubble skeleton */}
      <div className="flex justify-end">
        <div className="h-10 w-56 rounded-2xl rounded-br-sm bg-surface animate-pulse" />
      </div>
      {/* assistant bubble skeleton (头像 + 内容) */}
      <div className="flex gap-3">
        <div className="size-8 shrink-0 rounded-full bg-surface animate-pulse" />
        <div className="flex-1 space-y-2.5">
          <div className="h-4 w-3/4 rounded bg-surface animate-pulse" />
          <div className="h-4 w-1/2 rounded bg-surface animate-pulse" />
          <div className="h-4 w-5/6 rounded bg-surface animate-pulse" />
        </div>
      </div>
    </div>
  );
}
