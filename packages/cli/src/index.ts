import { stdin as input, stdout as output, stderr as errorOutput } from "node:process"
import { configCommand } from "./commands/config.js"
import { evalCommand } from "./commands/eval.js"
import { harnessCommand } from "./commands/harness.js"

function printHelp(): void {
  output.write(`covalo - Terminal-native AI loop agent runtime

Usage:
  covalo                        Start interactive TUI session
  covalo config <subcommand>    Configuration management
  covalo eval <subcommand>      Eval environment management
  covalo harness <subcommand>   Harness evolution management
  covalo --help, -h             Show this help
  covalo --version, -v          Show version

Config Subcommands:
  covalo config path              Show config file paths
  covalo config print [options]   Print effective config
  covalo config validate          Validate config files
  covalo config init [options]    Initialize config file
  covalo config edit [options]    Open config in editor
  covalo config doctor            Check config health

Eval Subcommands:
  covalo eval doctor [--json]    Check eval environment health
  covalo eval prepare <env>      Prepare an eval environment

Harness Subcommands:
  covalo harness doctor           Check harness health
  covalo harness mine --from-eval  Mine weaknesses from eval
  covalo harness propose --weakness  Propose harness patches
  covalo harness validate --patch  Validate a patch
  covalo harness promote --patch  Promote a patch
  covalo harness history          Show evolution history
  covalo harness rollback <id>    Rollback a patch

Examples:
  covalo config init --template local-first
  covalo config print --redact
  covalo config validate
  covalo config doctor
  covalo eval doctor
  covalo eval prepare sandbox.benchmark
  covalo harness doctor
  covalo harness history
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
    output.write("covalo v0.1.1\n")
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
  
  // Handle harness subcommand
  if (args[0] === "harness") {
    const subcommand = args[1] || "help"
    const subArgs = args.slice(2)
    await harnessCommand(subcommand, subArgs)
    return
  }
  
  // Default: start TUI
  await import("./tui.js")
}

main().catch((error) => {
  errorOutput.write(`Error: ${error.message}\n`)
  process.exit(1)
})