import { spawn } from 'node:child_process'

const proc = spawn('bun', ['run', 'packages/cli/src/index.ts'], {
  env: { ...process.env, HOME: '/tmp', DEEPSEEK_BASE_URL: 'http://127.0.0.1:1/', DEEPSEEK_API_KEY: 'test', TRACE_HANDLES: '1' },
  stdio: ['pipe', 'pipe', 'pipe']
})
proc.stdin.write('hi\n')
proc.stdin.end()

proc.stdout.on('data', d => console.log('STDOUT:', d.toString().trim()))
proc.stderr.on('data', d => console.log('STDERR:', d.toString().trim()))

proc.on('exit', (code) => {
  console.log('EXIT_CODE:', code)
})

setTimeout(() => {
  console.log('5s timeout - killing')
  proc.kill('SIGKILL')
}, 5000)
