import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { homedir } from "node:os"
import { execSync } from "node:child_process"
import { stringify } from "smol-toml"
import { parse } from "smol-toml"
import { ConfigManager, getConfigPath, DEFAULT_CONFIG, CONFIG_TEMPLATES } from "@deepreef/core"
import type { DeepReefConfig } from "@deepreef/core"

interface ConfigCommandOptions {
  json?: boolean
  toml?: boolean
  redact?: boolean
  project?: boolean
  template?: string
}

export async function configCommand(subcommand: string, args: string[]): Promise<void> {
  switch (subcommand) {
    case "path":
      await configPath()
      break
    case "print":
      await configPrint(args)
      break
    case "validate":
      await configValidate()
      break
    case "init":
      await configInit(args)
      break
    case "edit":
      await configEdit(args)
      break
    case "doctor":
      await configDoctor()
      break
    default:
      printConfigHelp()
  }
}

function printConfigHelp(): void {
  console.log(`deepreef config - Configuration management

Usage:
  deepreef config path              Show config file paths
  deepreef config print [options]   Print effective config
  deepreef config validate          Validate config files
  deepreef config init [options]    Initialize config file
  deepreef config edit [options]    Open config in editor
  deepreef config doctor            Check config health

Options:
  --json              Output as JSON (for print)
  --toml              Output as TOML (for print)
  --redact            Redact secrets (for print)
  --project           Use project config (for init/edit)
  --template <name>   Config template (for init)
                      Templates: default, local-first, safe-readonly, autonomous-coding
`)
}

async function configPath(): Promise<void> {
  const userPath = getConfigPath("user")
  const projectPath = getConfigPath("project")
  
  console.log(`User config:    ${userPath}`)
  console.log(`Project config: ${projectPath}`)
  console.log(`Effective:      user + project + defaults`)
}

async function configPrint(args: string[]): Promise<void> {
  const options = parsePrintOptions(args)
  
  try {
    const manager = await ConfigManager.create({ cwd: process.cwd() })
    let config = manager.get()
    
    // Redact secrets if requested
    if (options.redact) {
      config = redactSecrets(config)
    }
    
    if (options.json) {
      console.log(JSON.stringify(config, null, 2))
    } else {
      // Default to TOML
      console.log(stringify(config))
    }
  } catch (error) {
    console.error(`Error loading config: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

async function configValidate(): Promise<void> {
  const cwd = process.cwd()
  const userPath = getConfigPath("user")
  const projectPath = getConfigPath("project")
  
  let hasError = false
  
  // Validate user config
  if (existsSync(userPath)) {
    try {
      const content = readFileSync(userPath, "utf-8")
      parse(content)
      console.log(`✓ User config valid: ${userPath}`)
    } catch (error) {
      console.error(`✗ User config invalid: ${userPath}`)
      console.error(`  ${error instanceof Error ? error.message : String(error)}`)
      hasError = true
    }
  } else {
    console.log(`- User config not found: ${userPath}`)
  }
  
  // Validate project config
  if (existsSync(projectPath)) {
    try {
      const content = readFileSync(projectPath, "utf-8")
      parse(content)
      console.log(`✓ Project config valid: ${projectPath}`)
    } catch (error) {
      console.error(`✗ Project config invalid: ${projectPath}`)
      console.error(`  ${error instanceof Error ? error.message : String(error)}`)
      hasError = true
    }
  } else {
    console.log(`- Project config not found: ${projectPath}`)
  }
  
  // Validate effective config
  try {
    await ConfigManager.create({ cwd })
    console.log(`✓ Effective config valid`)
  } catch (error) {
    console.error(`✗ Effective config invalid`)
    console.error(`  ${error instanceof Error ? error.message : String(error)}`)
    hasError = true
  }
  
  if (hasError) {
    process.exit(1)
  }
}

async function configInit(args: string[]): Promise<void> {
  const options = parseInitOptions(args)
  const targetPath = options.project 
    ? getConfigPath("project")
    : getConfigPath("user")
  
  // Check if config already exists
  if (existsSync(targetPath)) {
    console.error(`Config file already exists: ${targetPath}`)
    console.error(`Use --force to overwrite or delete the file first.`)
    process.exit(1)
  }
  
  // Get template
  const templateName = options.template || "default"
  const template = CONFIG_TEMPLATES[templateName]
  
  if (!template) {
    console.error(`Unknown template: ${templateName}`)
    console.error(`Available templates: ${Object.keys(CONFIG_TEMPLATES).join(", ")}`)
    process.exit(1)
  }
  
  // Merge with defaults to get complete config
  const config = { ...DEFAULT_CONFIG, ...template } as DeepReefConfig
  
  // Create directory if needed
  const dir = dirname(targetPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  
  // Write config file
  try {
    writeFileSync(targetPath, stringify(config), "utf-8")
    console.log(`Created config file: ${targetPath}`)
    console.log(`Template: ${templateName}`)
  } catch (error) {
    console.error(`Failed to create config file: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

async function configEdit(args: string[]): Promise<void> {
  const options = parseEditOptions(args)
  const targetPath = options.project
    ? getConfigPath("project")
    : getConfigPath("user")
  
  // Create config if it doesn't exist
  if (!existsSync(targetPath)) {
    console.log(`Config file not found, creating: ${targetPath}`)
    const dir = dirname(targetPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(targetPath, stringify(DEFAULT_CONFIG), "utf-8")
  }
  
  // Open in editor
  const editor = process.env.EDITOR || process.env.VISUAL || "vi"
  
  try {
    execSync(`${editor} "${targetPath}"`, { stdio: "inherit" })
    console.log(`Config file edited: ${targetPath}`)
    console.log(`Run 'deepreef config validate' to check your changes.`)
  } catch (error) {
    console.error(`Failed to open editor: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

async function configDoctor(): Promise<void> {
  const cwd = process.cwd()
  
  console.log("Checking configuration...\n")
  
  // Check if config files exist
  const userPath = getConfigPath("user")
  const projectPath = getConfigPath("project")
  
  console.log("1. Config files:")
  if (existsSync(userPath)) {
    console.log(`   ✓ User config exists: ${userPath}`)
  } else {
    console.log(`   - User config not found (optional): ${userPath}`)
  }
  
  if (existsSync(projectPath)) {
    console.log(`   ✓ Project config exists: ${projectPath}`)
  } else {
    console.log(`   - Project config not found (optional): ${projectPath}`)
  }
  
  // Load and validate config
  console.log("\n2. Config validation:")
  try {
    const manager = await ConfigManager.create({ cwd })
    const config = manager.get()
    
    console.log(`   ✓ Config loaded successfully`)
    
    // Check providers
    console.log("\n3. Providers:")
    const providers = Object.keys(config.providers)
    if (providers.length === 0) {
      console.log("   - No custom providers configured")
    } else {
      for (const provider of providers) {
        const providerConfig = config.providers[provider]
        if (providerConfig.apiKeyEnv) {
          const envValue = process.env[providerConfig.apiKeyEnv]
          if (envValue) {
            console.log(`   ✓ ${provider}: API key from env ${providerConfig.apiKeyEnv}`)
          } else {
            console.log(`   ⚠ ${provider}: API key env ${providerConfig.apiKeyEnv} not set`)
          }
        } else if (providerConfig.apiKey) {
          console.log(`   ⚠ ${provider}: API key in config (consider using api_key_env)`)
        } else {
          console.log(`   - ${provider}: No API key configured`)
        }
      }
    }
    
    // Check agent configs
    console.log("\n4. Agent configs:")
    console.log(`   Supervisor: provider=${config.agents.supervisor.provider}`)
    console.log(`   Worker: provider=${config.agents.worker.provider}`)
    
    // Check tool policies
    console.log("\n5. Tool policies:")
    console.log(`   Supervisor loop deny: ${config.tools.supervisor.loop.deny.join(", ") || "none"}`)
    console.log(`   Worker loop deny: ${config.tools.worker.loop.deny.join(", ") || "none"}`)
    
    // Check warnings
    const warnings = manager.getWarnings()
    if (warnings.length > 0) {
      console.log("\n6. Warnings:")
      for (const warning of warnings) {
        console.log(`   ⚠ [${warning.path}] ${warning.message}`)
      }
    } else {
      console.log("\n6. No warnings")
    }
    
    console.log("\n✓ Configuration check complete")
    
  } catch (error) {
    console.error(`   ✗ Config validation failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

function parsePrintOptions(args: string[]): ConfigCommandOptions {
  const options: ConfigCommandOptions = {}
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--json") options.json = true
    if (arg === "--toml") options.toml = true
    if (arg === "--redact") options.redact = true
  }
  
  // Default to TOML if neither specified
  if (!options.json && !options.toml) {
    options.toml = true
  }
  
  return options
}

function parseInitOptions(args: string[]): ConfigCommandOptions {
  const options: ConfigCommandOptions = {}
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--project") options.project = true
    if (arg === "--template" && i + 1 < args.length) {
      options.template = args[++i]
    }
  }
  
  return options
}

function parseEditOptions(args: string[]): ConfigCommandOptions {
  const options: ConfigCommandOptions = {}
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--project") options.project = true
  }
  
  return options
}

function redactSecrets(config: DeepReefConfig): DeepReefConfig {
  const redacted = { ...config }
  
  // Redact provider API keys
  const providers = { ...redacted.providers }
  for (const [name, provider] of Object.entries(providers)) {
    if (provider && typeof provider === 'object' && 'apiKey' in provider) {
      providers[name] = { ...provider, apiKey: "***" } as any
    }
  }
  redacted.providers = providers as any
  
  return redacted
}