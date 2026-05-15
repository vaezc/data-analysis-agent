'use client'

import { useState } from 'react'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import {
  FileUploader,
  type UploadedDataset,
} from '@/components/upload/FileUploader'

export default function Home() {
  const [datasets, setDatasets] = useState<UploadedDataset[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  const handleUploaded = (ds: UploadedDataset) => {
    setDatasets((prev) => [ds, ...prev])
    setActiveId(ds.id)
  }

  const active = datasets.find((d) => d.id === activeId) ?? null

  return (
    <div className="flex h-screen bg-bg text-fg">
      {/* ---------- Sidebar ---------- */}
      <aside className="w-72 shrink-0 border-r border-border bg-card flex flex-col">
        <div className="flex items-center gap-3 px-5 h-14 border-b border-border">
          {/* logo icon —— 用品牌图 crop 出机器人主体；rounded-lg 区分于 AI 头像（rounded-full） */}
          <div
            className="size-9 shrink-0 rounded-lg bg-no-repeat shadow-sm shadow-fg/10"
            style={{
              backgroundImage: 'url(/image.png)',
              backgroundSize: '320%',
              backgroundPosition: '50% 30%',
            }}
            aria-hidden
          />
          <div className="leading-tight">
            <div className="text-sm font-semibold text-fg">Data Analysis</div>
            <div className="text-[11px] text-fg-muted -mt-0.5">AI Agent</div>
          </div>
        </div>

        <div className="px-4 pt-4">
          <FileUploader onUploaded={handleUploaded} />
        </div>

        <div className="px-4 pt-5 pb-4 flex-1 overflow-y-auto">
          <div className="flex items-center justify-between mb-2.5">
            <div className="text-[11px] font-semibold text-fg-muted uppercase tracking-wider">
              数据集
            </div>
            {datasets.length > 0 && (
              <span className="text-[11px] text-fg-subtle tabular-nums">
                {datasets.length}
              </span>
            )}
          </div>

          {datasets.length === 0 ? (
            <div className="text-xs text-fg-subtle leading-relaxed">
              上传 CSV / Excel 文件后
              <br />
              在这里管理
            </div>
          ) : (
            <div className="space-y-1">
              {datasets.map((ds) => {
                const isActive = ds.id === activeId
                return (
                  <button
                    key={ds.id}
                    type="button"
                    onClick={() => setActiveId(ds.id)}
                    className={`w-full text-left rounded-md px-3 py-2 transition duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                      isActive
                        ? 'bg-accent-soft ring-1 ring-inset ring-accent/30'
                        : 'hover:bg-surface'
                    }`}
                  >
                    <div
                      className={`text-sm font-medium truncate ${
                        isActive ? 'text-accent' : 'text-fg'
                      }`}
                    >
                      {ds.name}
                    </div>
                    <div className="text-[11px] text-fg-muted mt-0.5 tabular-nums">
                      {ds.rowCount} 行 · {ds.columns.length} 列
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="border-t border-border px-3 py-2">
          <ThemeToggle />
        </div>
      </aside>

      {/* ---------- Main ---------- */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-14 shrink-0 border-b border-border bg-card px-6 flex items-center">
          {active ? (
            <div className="min-w-0">
              <div className="text-sm font-medium text-fg truncate">
                {active.name}
              </div>
              <div className="text-[11px] text-fg-muted mt-0.5 truncate">
                {active.columns
                  .map((c) => `${c.name}(${c.type})`)
                  .join(' · ')}
              </div>
            </div>
          ) : (
            <div className="text-sm text-fg-subtle">未选择数据集</div>
          )}
        </header>

        <ChatPanel datasetId={activeId} />
      </main>
    </div>
  )
}
