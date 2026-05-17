'use client'

import { BarChart3, Loader2, Trash2, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import {
  FileUploader,
  type UploadedDataset,
} from '@/components/upload/FileUploader'

interface DemoSpec {
  filename: string
  label: string
  meta: string
  icon: typeof BarChart3
}

const DEMOS: DemoSpec[] = [
  {
    filename: 'sales_demo.csv',
    label: '销售数据',
    meta: '45 行 · 6 月 × 3 区域 × 3 产品',
    icon: BarChart3,
  },
  {
    filename: 'employee_performance_demo.csv',
    label: '员工绩效',
    meta: '30 行 · 4 个部门',
    icon: Users,
  },
]

export default function Home() {
  const [datasets, setDatasets] = useState<UploadedDataset[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loadingDemo, setLoadingDemo] = useState<string | null>(null)

  // 启动时从 Supabase 加载已上传的数据集列表（Phase 3 持久化）
  useEffect(() => {
    let cancelled = false
    fetch('/api/datasets')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: UploadedDataset[]) => {
        if (!cancelled) setDatasets(data)
      })
      .catch(() => {
        // 加载失败不致命：用户仍可上传新数据集
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleUploaded = (ds: UploadedDataset) => {
    setDatasets((prev) => [ds, ...prev])
    setActiveId(ds.id)
  }

  /**
   * 删除数据集：confirm → DELETE /api/datasets/[id] → 从前端 state 移除。
   * 如果被删的是当前 active，清空 activeId（回到 EmptyState）。
   */
  const handleDeleteDataset = async (id: string, name: string) => {
    if (!confirm(`确定删除数据集「${name}」？\n该操作会同时清空相关对话历史，且不可恢复。`)) {
      return
    }
    try {
      const res = await fetch(`/api/datasets/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      setDatasets((prev) => prev.filter((d) => d.id !== id))
      if (activeId === id) {
        setActiveId(null)
      }
    } catch (e) {
      console.error('Delete dataset failed:', e)
      alert(`删除失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /**
   * 一键试用样例：fetch /public/demos/xxx.csv → 转 File → 走 /api/upload 标准流程。
   * 重用现有上传链路，不破坏 dataset 创建的单一入口。
   */
  const handleLoadDemo = async (filename: string) => {
    if (loadingDemo) return
    setLoadingDemo(filename)
    try {
      const csvRes = await fetch(`/demos/${filename}`)
      if (!csvRes.ok) throw new Error(`fetch demo failed: ${csvRes.status}`)
      const blob = await csvRes.blob()
      const file = new File([blob], filename, { type: 'text/csv' })

      const formData = new FormData()
      formData.append('file', file)
      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })
      if (!uploadRes.ok) {
        const body = (await uploadRes.json().catch(() => ({}))) as {
          error?: string
        }
        throw new Error(body.error ?? `HTTP ${uploadRes.status}`)
      }
      const ds = (await uploadRes.json()) as UploadedDataset
      handleUploaded(ds)
    } catch (e) {
      console.error('Load demo failed:', e)
    } finally {
      setLoadingDemo(null)
    }
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
            <div className="space-y-3">
              <div className="text-xs text-fg-subtle leading-relaxed">
                上传 CSV / Excel 文件，或试用样例：
              </div>
              <div className="space-y-1">
                {DEMOS.map((demo) => {
                  const isLoading = loadingDemo === demo.filename
                  const Icon = demo.icon
                  return (
                    <button
                      key={demo.filename}
                      type="button"
                      onClick={() => handleLoadDemo(demo.filename)}
                      disabled={loadingDemo !== null}
                      className="w-full text-left rounded-md px-3 py-2 transition duration-150 hover:bg-surface active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                    >
                      <div className="flex items-center gap-2">
                        {isLoading ? (
                          <Loader2 className="size-3.5 text-fg-muted animate-spin" />
                        ) : (
                          <Icon
                            className="size-3.5 text-fg-muted"
                            strokeWidth={1.75}
                          />
                        )}
                        <div className="text-sm font-medium text-fg">
                          {demo.label}
                        </div>
                      </div>
                      <div className="text-[11px] text-fg-muted mt-0.5 pl-[22px] tabular-nums">
                        {demo.meta}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              {datasets.map((ds) => {
                const isActive = ds.id === activeId
                return (
                  <div
                    key={ds.id}
                    className={`group relative rounded-md transition duration-150 ${
                      isActive
                        ? 'bg-accent-soft ring-1 ring-inset ring-accent/30'
                        : 'hover:bg-surface'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setActiveId(ds.id)}
                      className="w-full text-left px-3 py-2 pr-9 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-md"
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
                    {/* hover/active 时显示删除按钮，绝对定位避免影响主按钮 click area */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteDataset(ds.id, ds.name)
                      }}
                      aria-label={`删除 ${ds.name}`}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-fg-subtle opacity-0 transition duration-150 group-hover:opacity-100 hover:bg-danger/10 hover:text-danger focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40"
                    >
                      <Trash2 className="size-3.5" strokeWidth={1.75} />
                    </button>
                  </div>
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

        <ChatPanel datasetId={activeId} columns={active?.columns} />
      </main>
    </div>
  )
}
