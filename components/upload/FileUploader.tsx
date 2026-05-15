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
  const [error, setError] = useState<string | null>(null)

  const upload = async (file: File) => {
    setUploading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })
      const data = (await response.json()) as
        | UploadedDataset
        | { error: string; code?: string }
      if (!response.ok) {
        const msg = 'error' in data ? data.error : `HTTP ${response.status}`
        throw new Error(msg)
      }
      onUploaded(data as UploadedDataset)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void upload(file)
          e.target.value = ''
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong px-4 py-3 text-sm text-fg-muted transition duration-150 hover:border-fg-subtle hover:bg-surface active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100"
      >
        {uploading ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            上传中...
          </>
        ) : (
          <>
            <Upload className="size-4" />
            上传 CSV / Excel
          </>
        )}
      </button>
      {error && (
        <div className="mt-2 rounded-md bg-danger-soft px-2 py-1.5 text-xs text-danger border border-danger/30">
          {error}
        </div>
      )}
    </div>
  )
}
