import { ConfigMigrationError } from "./errors.js"

export type ConfigMigration = {
  from: number
  to: number
  migrate: (raw: unknown) => unknown
}

const migrations: ConfigMigration[] = [
  // 示例：从版本 0 迁移到版本 1
  {
    from: 0,
    to: 1,
    migrate: (raw: unknown) => {
      const data = raw as Record<string, unknown>
      // 添加 version 字段
      return {
        ...data,
        version: 1,
      }
    },
  },
  // 从版本 1 迁移到版本 2（示例）
  // {
  //   from: 1,
  //   to: 2,
  //   migrate: (raw: unknown) => {
  //     const data = raw as Record<string, unknown>
  //     // 执行迁移逻辑
  //     return data
  //   },
  // },
]

export function migrateConfig(raw: unknown): unknown {
  const data = raw as Record<string, unknown>
  let currentVersion = (data?.version as number) ?? 0
  let currentData = data

  // 执行所有必要的迁移
  while (true) {
    const migration = migrations.find(m => m.from === currentVersion)
    if (!migration) break

    try {
      currentData = migration.migrate(currentData) as Record<string, unknown>
      currentVersion = migration.to
    } catch (error) {
      throw new ConfigMigrationError(
        `迁移失败: ${error instanceof Error ? error.message : String(error)}`,
        migration.from,
        migration.to
      )
    }
  }

  return currentData
}

export function getLatestVersion(): number {
  if (migrations.length === 0) return 0
  return Math.max(...migrations.map(m => m.to))
}

export function needsMigration(version: number): boolean {
  const latestVersion = getLatestVersion()
  return version < latestVersion
}

export function getMigrationPath(fromVersion: number): number[] {
  const path: number[] = []
  let currentVersion = fromVersion

  while (true) {
    const migration = migrations.find(m => m.from === currentVersion)
    if (!migration) break
    path.push(migration.to)
    currentVersion = migration.to
  }

  return path
}