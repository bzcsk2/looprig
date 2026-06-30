import { stdin as input, stdout as output, stderr as errorOutput } from "node:process"
import { configCommand } from "./commands/config.js"
import { evalCommand } from "./commands/eval.js"

function printHelp(): void {
  output.write(`deepreef - Terminal-native AI loop agent runtime

Usage:
  deepreef                        Start interactive TUI session
  deepreef config <subcommand>    Configuration management
  deepreef eval <subcommand>      Eval environment management
  deepreef --help, -h             Show this help
  deepreef --version, -v          Show version

Config Subcommands:
  deepreef config path              Show config file paths
  deepreef config print [options]   Print effective config
  deepreef config validate          Validate config files
  deepreef config init [options]    Initialize config file
  deepreef config edit [options]    Open config in editor
  deepreef config doctor            Check config health

Eval Subcommands:
  deepreef eval doctor [--json]    Check eval environment health
  deepreef eval prepare <env>      Prepare an eval environment

Examples:
  deepreef config init --template local-first
  deepreef config print --redact
  deepreef config validate
  deepreef config doctor
  deepreef eval doctor
  deepreef eval prepare sandbox.benchmark
`)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  
  // Handle --help or -h
  if (args.includes("--help") || args.includes("-h")) {
    printHelp()
    return
  }
  
  // Handle --version or -v
  if (args.includes("--version") || args.includes("-v")) {
    // Version will be injected by build
    output.write("deepreef v0.1.1\n")
    return
  }
  
  // Handle config subcommand
  if (args[0] === "config") {
    const subcommand = args[1] || "help"
    const subArgs = args.slice(2)
    await configCommand(subcommand, subArgs)
    return
  }
  
  // Handle eval subcommand
  if (args[0] === "eval") {
    const subcommand = args[1] || "help"
    const subArgs = args.slice(2)
    await evalCommand(subcommand, subArgs)
    return
  }
  
  // Default: start TUI
  await import("./tui.js")
}

main().catch((error) => {
  errorOutput.write(`Error: ${error.message}\n`)
  process.exit(1)
})