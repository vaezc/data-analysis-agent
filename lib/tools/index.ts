// ============================================================
// 工具包入口
//
// 业务侧只需 `import '@/lib/tools'` 触发 4 个工具的 defineTool 副作用，
// 然后从这里拿 registry 的 API。新增工具时只要在下方加一行 import。
// ============================================================

import './inspect-data'
import './run-analysis'
import './create-chart'
import './generate-report'

export {
  executeTool,
  getToolList,
  getToolUiDescription,
  isToolName,
  type ToolExecutionContext,
  type ToolDefinition,
} from './registry'
