/**
 * Audit Plugin - 审计插件
 *
 * 这个插件展示如何创建一个审计工具，记录所有工具调用。
 * 它提供了 before 和 after hooks 来跟踪工具使用情况。
 *
 * 使用方法：
 * 1. 将此文件复制到你的项目中
 * 2. 在 .covalo/plugins.json 中添加此插件路径
 * 3. 重启 covalo
 */

interface AuditEntry {
  timestamp: string
  toolName: string
  args: Record<string, unknown>
  result?: string
  duration?: number
}

const auditLog: AuditEntry[] = []

export default {
  id: "audit",

  server: () => ({
    getAuditLog: async () => {
      return JSON.stringify(auditLog, null, 2)
    },

    clearAuditLog: async () => {
      auditLog.length = 0
      return "Audit log cleared"
    },
  }),
}
