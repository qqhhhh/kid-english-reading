import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const apiUrl = 'http://127.0.0.1:4175/api/health'
const viteEntry = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js')

let apiProcess = null
let webProcess = null
let shuttingDown = false

function startNode(args) {
  return spawn(process.execPath, args, {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  })
}

async function apiIsReady() {
  return endpointIsReady(apiUrl)
}

async function endpointIsReady(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000) })
    return response.ok
  } catch {
    return false
  }
}

async function waitForApi(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await apiIsReady()) return
    if (apiProcess?.exitCode !== null) {
      throw new Error(`开发 API 提前退出（退出码 ${apiProcess.exitCode}）`)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`等待 ${apiUrl} 超时`)
}

function stopChild(child) {
  if (child && child.exitCode === null && !child.killed) child.kill('SIGTERM')
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true
  process.exitCode = exitCode
  stopChild(webProcess)
  stopChild(apiProcess)
  setTimeout(() => process.exit(exitCode), 750).unref()
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => shutdown(0))
}

try {
  if (await apiIsReady()) {
    console.log(`[dev] 开发 API 已在运行：${apiUrl}`)
  } else {
    console.log('[dev] 正在启动开发 API（4175）…')
    apiProcess = startNode([path.join(rootDir, 'server', 'dev.js')])
    await waitForApi()
    console.log(`[dev] 开发 API 已就绪：${apiUrl}`)
  }

  if (await endpointIsReady('http://127.0.0.1:5173/')) {
    console.log('[dev] Vite 前端已在运行：http://127.0.0.1:5173')
    if (!apiProcess) process.exitCode = 0
  } else {
    webProcess = startNode([viteEntry, '--host', '127.0.0.1', '--port', '5173', '--strictPort'])
    webProcess.on('exit', (code) => shutdown(code ?? 0))
  }

  apiProcess?.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`[dev] 开发 API 已退出（退出码 ${code ?? 'unknown'}）`)
      shutdown(code || 1)
    }
  })
} catch (error) {
  console.error(`[dev] ${error instanceof Error ? error.message : String(error)}`)
  shutdown(1)
}
