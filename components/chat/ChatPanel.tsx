"use client";

import { Database, Loader2, Send, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
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
  const { messages, send, isStreaming, error } = useAgent({ datasetId });
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  // sticky 状态：用户当前是否"贴底"。新内容来时只在此状态为 true 才跟随。
  // 由用户的实际滚动位置维护（scrollHeight 变化不触发 scroll 事件，所以程序滚动不会污染状态）
  const stickyRef = useRef(true);
  // 跟踪上一帧 messages 数量：区分"新消息"和"流式更新"两种场景
  const prevCountRef = useRef(messages.length);

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

  // 滚动策略：
  //   - 新消息（length 增加）→ smooth 滚动到底部，视觉自然
  //   - 流式更新（同一条 assistant message 在变）→ 仅在 sticky 为 true 时瞬时跟随，
  //     避免动画排队；用户主动上翻后 sticky 转 false，流式不再打扰
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

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
  }, [messages]);

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
    <div className="flex-1 flex flex-col min-h-0">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
          {messages.length === 0 ? (
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
          <div className="mx-auto max-w-3xl px-6 py-2.5 text-sm text-danger">
            {error}
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
              placeholder={
                datasetId
                  ? "提个问题，例如：哪个区域销售额最高？"
                  : "请先选择数据集"
              }
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
