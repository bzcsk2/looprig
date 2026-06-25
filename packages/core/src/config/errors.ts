export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly path?: string,
    public readonly source?: string
  ) {
    super(message)
    this.name = "ConfigError"
  }
}

export class ConfigValidationError extends ConfigError {
  constructor(
    message: string,
    public readonly issues: Array<{ path: string; message: string }>,
    source?: string
  ) {
    super(message, undefined, source)
    this.name = "ConfigValidationError"
  }

  toString(): string {
    const issuesStr = this.issues
      .map(issue => `[${issue.path}] ${issue.message}`)
      .join("\n")
    return `${this.message}:\n${issuesStr}`
  }
}

export class ConfigLoadError extends ConfigError {
  constructor(
    message: string,
    public readonly filePath: string,
    public readonly cause?: Error
  ) {
    super(message, filePath)
    this.name = "ConfigLoadError"
  }
}

export class ConfigMigrationError extends ConfigError {
  constructor(
    message: string,
    public readonly fromVersion: number,
    public readonly toVersion: number
  ) {
    super(message)
    this.name = "ConfigMigrationError"
  }
}

export class ConfigAccessError extends ConfigError {
  constructor(
    message: string,
    public readonly key: string
  ) {
    super(message, key)
    this.name = "ConfigAccessError"
  }
}