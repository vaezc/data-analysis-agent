"use client";

import {
  Database,
  ImagePlus,
  Loader2,
  RotateCcw,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useAgent } from "@/hooks/use-agent";
import { MessageBubble } from "./MessageBubble";

const EXAMPLE_QUESTIONS = [
  "哪个区域销售额最高？",
  "按月份统计销售趋势",
  "不同产品的平均售价",
];

interface ChatPanelProps {
  datasetId: string | null;
}

export function ChatPanel({ datasetId }: ChatPanelProps) {
  const {
    messages,
    send,
    isStreaming,
    isLoadingHistory,
    error,
    clearError,
    reset,
  } = useAgent({
    datasetId,
  });
  const [isResetting, setIsResetting] = useState(false);

  const handleNewChat = async () => {
    if (
      !confirm(
        '确定开始新对话？\n当前对话历史会被清空（数据集保留），且不可恢复。',
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

  // Vision multimodal：附加图片（data URL 数组）
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const handleAttachImages = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    // 单张图上限 4MB（base64 后 ~5.3MB；Vercel body 上限 4.5MB，控制保守）
    const MAX_SIZE = 4 * 1024 * 1024;
    const valid = files.filter((f) => {
      if (!f.type.startsWith("image/")) return false;
      if (f.size > MAX_SIZE) return false;
      return true;
    });

    const dataUrls = await Promise.all(
      valid.map(
        (f) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(f);
          }),
      ),
    );
    setAttachedImages((prev) => [...prev, ...dataUrls]);

    // 重置 input 以便能选同一张图（onChange 才会触发）
    if (imageInputRef.current) imageInputRef.current.value = "";
  };

  const removeAttachedImage = (idx: number) => {
    setAttachedImages((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    const imagesToSend =
      attachedImages.length > 0 ? attachedImages : undefined;
    setInput("");
    setAttachedImages([]);
    await send(text, imagesToSend);
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
            <EmptyState datasetId={datasetId} onPick={(q) => setInput(q)} />
          ) : (
            messages.map((m, i) => (
              <MessageBubble
                key={m.id}
                message={m}
                isStreaming={isStreaming}
                isLast={i === messages.length - 1}
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
          {/* 附加图片预览：每张缩略图 + × 删除 */}
          {attachedImages.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachedImages.map((url, idx) => (
                <div
                  key={idx}
                  className="relative size-16 overflow-hidden rounded-lg border border-border bg-surface"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={`附件 ${idx + 1}`}
                    className="size-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeAttachedImage(idx)}
                    aria-label="移除图片"
                    className="absolute right-0.5 top-0.5 inline-flex size-5 items-center justify-center rounded-full bg-bg/80 text-fg shadow-sm transition duration-150 hover:bg-danger hover:text-accent-fg"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 rounded-2xl border border-border bg-card pl-4 pr-2 py-2 shadow-lg shadow-fg/5 transition duration-150 focus-within:border-accent/40 focus-within:ring-2 focus-within:ring-accent/15">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={!datasetId}
              placeholder={
                datasetId
                  ? "提个问题，例如：哪个区域销售额最高？"
                  : "请先选择数据集"
              }
              className="flex-1 bg-transparent py-1.5 text-sm text-fg placeholder:text-fg-subtle outline-none disabled:text-fg-subtle disabled:placeholder:text-fg-subtle"
            />
            {/* 隐藏 file input，由 📎 按钮触发 */}
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleAttachImages}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              disabled={!datasetId || isStreaming}
              aria-label="附加图片"
              title="附加图片（vision 多模态，需 vision-capable LLM）"
              className="size-9 shrink-0 inline-flex items-center justify-center rounded-xl text-fg-muted transition duration-150 hover:bg-surface hover:text-fg active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            >
              <ImagePlus className="size-4" strokeWidth={1.75} />
            </button>
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
  onPick,
}: {
  datasetId: string | null;
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
        {EXAMPLE_QUESTIONS.map((q) => (
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
