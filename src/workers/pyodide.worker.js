let pyodide = null
let heartbeatInterval = null
let stdoutBuffer = ''
let stderrBuffer = ''
let flushInterval = null
let workspaceHandle = null
let workspaceMount = null
let stdinBuffer = null
let stdinSignalView = null
let stdinBytesView = null
let baseUrl = '/'
let activeWorkspaceName = 'python-experiments'
let initializationPromise = null
const textDecoder = new TextDecoder()
const STDIN_SIGNAL_INDEX = 0
const STDIN_LENGTH_INDEX = 1
const STDIN_HEADER_INTS = 2
const STDIN_HEADER_BYTES = Int32Array.BYTES_PER_ELEMENT * STDIN_HEADER_INTS
const PACKAGE_IMPORT_PATTERNS = [
  { packageName: 'pandas', pattern: /^\s*(?:from\s+pandas\b|import\s+pandas\b)/m },
  { packageName: 'numpy', pattern: /^\s*(?:from\s+numpy\b|import\s+numpy\b)/m },
  {
    packageName: 'matplotlib',
    pattern: /^\s*(?:from\s+matplotlib(?:\.[\w.]+)?\b|import\s+matplotlib(?:\.[\w.]+)?\b|from\s+pylab\b|import\s+pylab\b)/m,
  },
]

function normalizeErrorMessage(err) {
  const message = err?.message || String(err)
  return message.replace(/\n?PythonError\s*$/u, '')
}

function collectRequestedPackages(source = '') {
  const packages = new Set()

  for (const { packageName, pattern } of PACKAGE_IMPORT_PATTERNS) {
    if (pattern.test(source)) {
      packages.add(packageName)
    }
  }

  return packages
}

function flushBufferedOutput() {
  if (stdoutBuffer.length > 0) {
    self.postMessage({ type: 'stdout', data: stdoutBuffer })
    stdoutBuffer = ''
  }

  if (stderrBuffer.length > 0) {
    self.postMessage({ type: 'stderr', data: stderrBuffer })
    stderrBuffer = ''
  }
}

function startFlushInterval() {
  flushInterval = setInterval(() => {
    flushBufferedOutput()
  }, 50)
}

function stopFlushInterval() {
  if (flushInterval) {
    clearInterval(flushInterval)
    flushInterval = null
  }

  flushBufferedOutput()
}

function startHeartbeat() {
  heartbeatInterval = setInterval(() => {
    self.postMessage({ type: 'heartbeat' })
  }, 1000)
}

function sendHeartbeat() {
  self.postMessage({ type: 'heartbeat' })
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval)
    heartbeatInterval = null
  }
}

function getPyodideAssetUrls() {
  const baseHref = new URL(baseUrl, self.location.origin)
  return {
    indexURL: new URL('pyodide/', baseHref).toString(),
    scriptURL: new URL('pyodide/pyodide.js', baseHref).toString(),
    lockFileURL: new URL('pyodide/pyodide-lock.json', baseHref).toString(),
  }
}

function normalizeWorkspaceName(name) {
  const normalized = String(name ?? '').trim()
  if (!normalized) {
    return 'python-experiments'
  }

  if (normalized.includes('/') || normalized.includes('\\')) {
    throw new Error('Workspace names cannot contain slashes')
  }

  return normalized
}

function initWorker({
  stdinBuffer: incomingStdinBuffer,
  baseUrl: incomingBaseUrl,
  workspaceName,
} = {}) {
  if (typeof incomingBaseUrl === 'string' && incomingBaseUrl.length > 0) {
    baseUrl = incomingBaseUrl
  }

  activeWorkspaceName = normalizeWorkspaceName(workspaceName)

  const hasSharedArrayBuffer =
    typeof SharedArrayBuffer === 'function' &&
    incomingStdinBuffer instanceof SharedArrayBuffer

  stdinBuffer = hasSharedArrayBuffer ? incomingStdinBuffer : null
  stdinSignalView = stdinBuffer
    ? new Int32Array(stdinBuffer, 0, STDIN_HEADER_INTS)
    : null
  stdinBytesView = stdinBuffer
    ? new Uint8Array(stdinBuffer, STDIN_HEADER_BYTES)
    : null

  if (stdinSignalView) {
    Atomics.store(stdinSignalView, STDIN_SIGNAL_INDEX, 0)
    Atomics.store(stdinSignalView, STDIN_LENGTH_INDEX, 0)
  }

  if (!initializationPromise) {
    initializationPromise = initPyodide()
  }
}

function stdinHandler(prompt = '') {
  if (!stdinSignalView || !stdinBytesView) {
    throw new Error(
      '[WasmForge] Interactive stdin requires SharedArrayBuffer. Verify window.crossOriginIsolated === true on this origin.'
    )
  }

  flushBufferedOutput()
  Atomics.store(stdinSignalView, STDIN_LENGTH_INDEX, 0)
  Atomics.store(stdinSignalView, STDIN_SIGNAL_INDEX, 0)
  self.postMessage({ type: 'stdin_request', prompt: String(prompt ?? '') })
  Atomics.wait(stdinSignalView, STDIN_SIGNAL_INDEX, 0)

  const byteLength = Atomics.load(stdinSignalView, STDIN_LENGTH_INDEX)
  const valueBytes = new Uint8Array(byteLength)
  valueBytes.set(stdinBytesView.subarray(0, byteLength))
  const value = textDecoder.decode(valueBytes)

  Atomics.store(stdinSignalView, STDIN_LENGTH_INDEX, 0)
  Atomics.store(stdinSignalView, STDIN_SIGNAL_INDEX, 0)

  return value
}

async function mountWorkspace() {
  if (workspaceMount) {
    return
  }

  self.postMessage({
    type: 'load_progress',
    msg: `Opening workspace "${activeWorkspaceName}"...`,
  })

  const rootHandle = await navigator.storage.getDirectory()
  const workspacesRoot = await rootHandle.getDirectoryHandle('wasmforge-workspaces', {
    create: true,
  })
  const workspaceDirectory = await workspacesRoot.getDirectoryHandle(activeWorkspaceName, {
    create: true,
  })
  workspaceHandle = await workspaceDirectory.getDirectoryHandle('files', { create: true })
  workspaceMount = await pyodide.mountNativeFS('/workspace', workspaceHandle)

  pyodide.runPython(`
import os
import sys

os.chdir("/workspace")
if "/workspace" not in sys.path:
    sys.path.insert(0, "/workspace")
  `)
}

async function syncWorkspaceFromOpfs() {
  if (!workspaceHandle) {
    return
  }

  const opfsFiles = new Map()
  for await (const [name, handle] of workspaceHandle.entries()) {
    if (handle.kind !== 'file') {
      continue
    }

    const file = await handle.getFile()
    opfsFiles.set(name, new Uint8Array(await file.arrayBuffer()))
  }

  const mountedFiles = pyodide.FS.readdir('/workspace').filter((name) => !['.', '..'].includes(name))
  for (const name of mountedFiles) {
    if (!opfsFiles.has(name)) {
      try {
        pyodide.FS.unlink(`/workspace/${name}`)
      } catch {
        // Ignore non-file entries for now.
      }
    }
  }

  for (const [name, content] of opfsFiles) {
    pyodide.FS.writeFile(`/workspace/${name}`, content)
  }
}

async function persistWorkspaceToOpfs() {
  if (workspaceMount) {
    await workspaceMount.syncfs()
  }
}

async function ensureLocalPackages(code, filename = 'main.py') {
  const requiredPackages = collectRequestedPackages(code)

  const workspaceFiles = pyodide.FS
    .readdir('/workspace')
    .filter((name) => name.endsWith('.py') && name !== filename)

  for (const workspaceFilename of workspaceFiles) {
    try {
      const source = pyodide.FS.readFile(`/workspace/${workspaceFilename}`, { encoding: 'utf8' })
      for (const packageName of collectRequestedPackages(source)) {
        requiredPackages.add(packageName)
      }
    } catch {
      // Ignore unreadable files and continue with the files we can scan.
    }
  }

  const packagesToLoad = [...requiredPackages]
  if (packagesToLoad.length > 0) {
    self.postMessage({ type: 'load_progress', msg: 'Loading required Python packages...' })
    await pyodide.loadPackage(packagesToLoad)
  }

  return {
    usesMatplotlib: requiredPackages.has('matplotlib'),
  }
}

async function resetWorkspaceImportState() {
  await pyodide.runPythonAsync(`
import importlib
import os
import sys

workspace_root = os.path.abspath("/workspace")
workspace_prefix = workspace_root + os.sep

importlib.invalidate_caches()

for module_name, module in list(sys.modules.items()):
    module_file = getattr(module, "__file__", None)
    if not module_file:
        continue

    try:
        module_path = os.path.abspath(module_file)
    except Exception:
        continue

    if module_path == workspace_root or module_path.startswith(workspace_prefix):
        sys.modules.pop(module_name, None)

for cache_key in list(sys.path_importer_cache.keys()):
    if not isinstance(cache_key, str):
        continue

    try:
        cache_path = os.path.abspath(cache_key)
    except Exception:
        continue

    if cache_path == workspace_root or cache_path.startswith(workspace_prefix):
        sys.path_importer_cache.pop(cache_key, None)
  `)
}

async function configureMatplotlibBackend() {
  await pyodide.runPythonAsync(`
try:
    import matplotlib
    matplotlib.use("Agg")
except Exception as exc:
    postStderr(f"[WasmForge] Failed to prepare Matplotlib: {exc}\\n")
  `)
}

async function resetMatplotlibState() {
  await pyodide.runPythonAsync(`
try:
    import sys
    if any(name.startswith("matplotlib") for name in sys.modules):
        import matplotlib.pyplot as plt
        plt.close("all")
except Exception:
    pass
  `)
}

async function collectMatplotlibFigures() {
  const serialized = await pyodide.runPythonAsync(`
import base64
import io
import json
import sys

results = []

try:
    if any(name.startswith("matplotlib") for name in sys.modules):
        import matplotlib.pyplot as plt

        for figure_number in plt.get_fignums():
            figure = plt.figure(figure_number)
            buffer = io.BytesIO()
            figure.savefig(buffer, format="png", bbox_inches="tight")
            buffer.seek(0)
            results.append({
                "id": f"Figure {figure_number}",
                "format": "png",
                "data": base64.b64encode(buffer.read()).decode("ascii"),
            })

        plt.close("all")
except Exception as exc:
    postStderr(f"[WasmForge] Failed to capture Matplotlib output: {exc}\\n")
    try:
        import matplotlib.pyplot as plt
        plt.close("all")
    except Exception:
        pass

json.dumps(results)
  `)

  if (!serialized) {
    return []
  }

  try {
    const parsed = JSON.parse(serialized)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function initPyodide() {
  try {
    const { indexURL, scriptURL, lockFileURL } = getPyodideAssetUrls()

    self.postMessage({ type: 'load_progress', msg: 'Loading Python environment...' })

    importScripts(scriptURL)

    self.postMessage({ type: 'load_progress', msg: 'Starting Python...' })

    pyodide = await loadPyodide({
      indexURL,
      lockFileURL,
    })

    // Expose JS callbacks before overriding Python streams.
    pyodide.globals.set('postStdout', (s) => { stdoutBuffer += s })
    pyodide.globals.set('postStderr', (s) => { stderrBuffer += s })
    pyodide.globals.set('_wasmforgeStdin', stdinHandler)

    // Override sys.stdout and sys.stderr to capture Python output
    // and route it to our buffering system instead of the console.
    pyodide.runPython(`
import builtins
import sys

class _WasmForgeStdout:
    def write(self, s):
        if s:
            postStdout(s)
    def flush(self):
        pass

class _WasmForgeStderr:
    def write(self, s):
        if s:
            postStderr(s)
    def flush(self):
        pass

def _wasmforge_input(prompt=""):
    return _wasmforgeStdin(prompt)

sys.stdout = _WasmForgeStdout()
sys.stderr = _WasmForgeStderr()
builtins.input = _wasmforge_input
    `)

    self.postMessage({ type: 'load_progress', msg: 'Loading standard Python packages...' })
    await pyodide.loadPackage(['numpy', 'pandas'])

    self.postMessage({ type: 'ready' })

  } catch (err) {
    self.postMessage({ type: 'stderr', data: `[WasmForge] Failed to load Pyodide: ${err.message}\n` })
    self.postMessage({ type: 'done', error: err.message })
    initializationPromise = null
    pyodide = null
  }
}

async function runPython(code, filename = 'main.py') {
  if (initializationPromise) {
    await initializationPromise
  }

  if (!pyodide) {
    self.postMessage({ type: 'stderr', data: '[WasmForge] Python is still loading. Please wait.\n' })
    self.postMessage({ type: 'done', error: 'Runtime not ready' })
    return
  }

  stopHeartbeat()
  stopFlushInterval()
  sendHeartbeat()
  startHeartbeat()
  startFlushInterval()

  let error = null
  const startedAt = performance.now()
  let usesMatplotlib = false

  try {
    await mountWorkspace()
    await syncWorkspaceFromOpfs()

    const workspacePath = `/workspace/${filename}`
    pyodide.FS.writeFile(workspacePath, code, { encoding: 'utf8' })

    const packageState = await ensureLocalPackages(code, filename)
    usesMatplotlib = packageState.usesMatplotlib

    await resetWorkspaceImportState()

    if (usesMatplotlib) {
      await configureMatplotlibBackend()
      await resetMatplotlibState()
    }

    await pyodide.runPythonAsync(`
import os
import runpy

os.chdir("/workspace")
runpy.run_path(${JSON.stringify(workspacePath)}, run_name="__main__")
    `)
  } catch (err) {
    const errorMsg = normalizeErrorMessage(err).trim()
    if (errorMsg) {
      self.postMessage({ type: 'stderr', data: `\n${errorMsg}\n` })
    }
    error = errorMsg || 'Python execution failed'
  } finally {
    if (usesMatplotlib) {
      try {
        const figures = await collectMatplotlibFigures()
        if (figures.length > 0) {
          self.postMessage({ type: 'figures', figures })
        }
      } catch (figureErr) {
        const figureMessage = `[WasmForge] Failed to render Matplotlib output: ${figureErr.message || figureErr}\n`
        self.postMessage({ type: 'stderr', data: `\n${figureMessage}` })
        error ||= figureMessage.trim()
      }
    }

    try {
      await persistWorkspaceToOpfs()
    } catch (syncErr) {
      const syncMessage = `[WasmForge] Failed to sync workspace: ${syncErr.message || syncErr}\n`
      self.postMessage({ type: 'stderr', data: `\n${syncMessage}` })
      error ||= syncMessage.trim()
    }

    stopHeartbeat()
    stopFlushInterval()
    self.postMessage({
      type: 'done',
      error,
      durationMs: performance.now() - startedAt,
    })
  }
}

self.onmessage = async (event) => {
  const {
    type,
    code,
    filename,
    stdinBuffer: incomingStdinBuffer,
    baseUrl: incomingBaseUrl,
    workspaceName,
  } = event.data

  switch (type) {
    case 'init':
      initWorker({
        stdinBuffer: incomingStdinBuffer,
        baseUrl: incomingBaseUrl,
        workspaceName,
      })
      break

    case 'run':
      await runPython(code, filename)
      break

    case 'kill':
      stopHeartbeat()
      stopFlushInterval()
      self.postMessage({ type: 'done', error: 'Execution killed by user' })
      break

    default:
      console.warn('[WasmForge Worker] Unknown message type:', type)
  }
}
