'use client'

import { Loader2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import type { Column } from '@/types'

export interface UploadedDataset {
  id: string
  name: string
  columns: Column[]
  rowCount: number
  createdAt: number
}

interface FileUploaderProps {
  onUploaded: (dataset: UploadedDataset) => void
}

export function FileUploader({ onUploaded }: FileUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  // 上传字节进度 0~100；达到 100 后进入服务端"解析中"阶段（无进度，转 spinner 文案）
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // 用 XHR 而非 fetch：fetch 不暴露 upload progress 事件，拿不到上传百分比。
  const upload = (file: File): void => {
    setUploading(true)
    setError(null)
    setProgress(0)

    const formData = new FormData()
    formData.append('file', file)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/upload')

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        setProgress(Math.round((e.loaded / e.total) * 100))
      }
    }

    xhr.onload = () => {
      setUploading(false)
      let data: UploadedDataset | { error?: string }
      try {
        data = JSON.parse(xhr.responseText)
      } catch {
        setError('响应解析失败')
        return
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        onUploaded(data as UploadedDataset)
      } else {
        setError(('error' in data && data.error) || `HTTP ${xhr.status}`)
      }
    }

    xhr.onerror = () => {
      setUploading(false)
      setError('网络错误，上传失败')
    }

    xhr.send(formData)
  }

  // 字节传完（100%）后还要等服务端解析，文案切到"解析中"，避免卡在 100% 像是卡死
  const parsing = uploading && progress >= 100

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) upload(file)
          e.target.value = ''
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="relative w-full overflow-hidden flex items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong px-4 py-3 text-sm text-fg-muted transition duration-150 hover:border-fg-subtle hover:bg-surface active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:active:scale-100"
      >
        {/* 进度填充：上传阶段按百分比，解析阶段铺满 + pulse */}
        {uploading && (
          <div
            className={`absolute inset-y-0 left-0 bg-accent-soft transition-[width] duration-200 ease-out ${
              parsing ? 'animate-pulse' : ''
            }`}
            style={{ width: parsing ? '100%' : `${progress}%` }}
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        )}
        <span className="relative flex items-center gap-2">
          {uploading ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {parsing ? '解析中...' : `上传中 ${progress}%`}
            </>
          ) : (
            <>
              <Upload className="size-4" />
              上传 CSV / Excel
            </>
          )}
        </span>
      </button>
      {error && (
        <div className="mt-2 rounded-md bg-danger-soft px-2 py-1.5 text-xs text-danger border border-danger/30">
          {error}
        </div>
      )}
    </div>
  )
}
