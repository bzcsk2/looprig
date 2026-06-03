const originalSetTimeout = globalThis.setTimeout
const originalSetInterval = globalThis.setInterval
const timers = new Map()

globalThis.setTimeout = (fn, ms, ...args) => {
  const stack = new Error().stack?.split('\n').slice(2, 5).join('\n') || ''
  const id = originalSetTimeout((...a) => {
    timers.delete(id)
    fn(...a)
  }, ms, ...args)
  timers.set(id, { type: 'timeout', ms, stack })
  return id
}

globalThis.setInterval = (fn, ms, ...args) => {
  const stack = new Error().stack?.split('\n').slice(2, 5).join('\n') || ''
  const id = originalSetInterval(fn, ms, ...args)
  timers.set(id, { type: 'interval', ms, stack })
  return id
}

globalThis.clearTimeout = (id) => { timers.delete(id); return originalSetTimeout.__proto__(id) }
globalThis.clearInterval = (id) => { timers.delete(id); return originalSetInterval.__proto__(id) }

// Monkey-patch Worker to track workers
const { Worker } = await import('node:worker_threads')
const originalWorker = Worker
const workers = []
globalThis.Worker = class extends originalWorker {
  constructor(...args) {
    super(...args)
    workers.push(this)
    console.error('[TRACE] Worker created')
  }
}

// Run the CLI
const { spawn } = await import('node:child_process')
const proc = spawn('bun', ['run', 'packages/cli/src/index.ts'], {
  env: { ...process.env, HOME: '/tmp', DEEPSEEK_BASE_URL: 'http://127.0.0.1:1/', DEEPSEEK_API_KEY: 'test' },
  stdio: ['pipe', 'pipe', 'pipe']
})
proc.stdin.write('hi\n')
proc.stdin.end()

proc.on('exit', (code) => {
  console.log('EXIT_CODE:', code)
  console.log('Active timers:', Array.from(timers.entries()))
  console.log('Active workers:', workers.length)
})

setTimeout(() => {
  console.log('3s timeout - killing')
  proc.kill('SIGKILL')
}, 3000)
