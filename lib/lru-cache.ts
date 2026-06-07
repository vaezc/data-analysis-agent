// ============================================================
// 极简 LRU 缓存（Map 保序实现）
//
// JS 的 Map 按插入顺序遍历，利用这一点实现 LRU：
//   - get 命中：先 delete 再 set，把 key 挪到"最近"端
//   - set 溢出：删掉迭代器第一个（最久未用）key
//
// 用途：缓存二次 LLM 生成的 SQL（见 lib/tools/run-analysis.ts）。
// serverless 下是 per-instance 内存缓存，best-effort：暖实例内复用，
// 冷启动清零。键值都不持久化，无需失效逻辑（数据集上传后不可变）。
// ============================================================

export class LruCache<K, V> {
  private readonly map = new Map<K, V>()

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error('LruCache capacity 必须是正整数')
    }
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined
    const value = this.map.get(key) as V
    // 刷新最近使用：移到 Map 末尾
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }

  set(key: K, value: V): void {
    // 已存在先删，保证重新插入到末尾（刷新 recency）
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, value)
    if (this.map.size > this.capacity) {
      // 淘汰最久未用：迭代器首个 key
      const oldest = this.map.keys().next().value as K | undefined
      if (oldest !== undefined) this.map.delete(oldest)
    }
  }

  has(key: K): boolean {
    return this.map.has(key)
  }

  get size(): number {
    return this.map.size
  }

  clear(): void {
    this.map.clear()
  }
}
