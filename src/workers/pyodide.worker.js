let pyodide = null
let heartbeatInterval = null
let stdoutBuffer = ''
let stderrBuffer = ''
let flushInterval = null
let workspaceHandle = null
let workspaceMount = null
let localFolderHandle = null
let localFolderMount = null
let localFolderName = ''
let stdinBuffer = null
let stdinSignalView = null
let stdinBytesView = null
let baseUrl = '/'
let activeWorkspaceName = 'python-experiments'
let initializationPromise = null
let activeExecutionMode = 'script'
let notebookStdoutBuffer = ''
let notebookStderrBuffer = ''
let parallelJobCounter = 0
const textDecoder = new TextDecoder()
const STDIN_SIGNAL_INDEX = 0
const STDIN_LENGTH_INDEX = 1
const STDIN_HEADER_INTS = 2
const STDIN_HEADER_BYTES = Int32Array.BYTES_PER_ELEMENT * STDIN_HEADER_INTS
const MAX_PARALLEL_WORKERS = 4
const PARALLEL_TASK_TIMEOUT_MS = 90_000
const LOCAL_FOLDER_MOUNT_PATH = '/local'
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

function resetNotebookBuffers() {
  notebookStdoutBuffer = ''
  notebookStderrBuffer = ''
}

function bufferStdout(data = '') {
  const output = String(data)
  stdoutBuffer += output
  if (activeExecutionMode === 'notebook') {
    notebookStdoutBuffer += output
  }
}

function bufferStderr(data = '') {
  const output = String(data)
  stderrBuffer += output
  if (activeExecutionMode === 'notebook') {
    notebookStderrBuffer += output
  }
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

function updateLocalFolderPythonState(connected, name = localFolderName) {
  if (!pyodide) {
    return
  }

  pyodide.globals.set('_wasmforgeLocalFolderConnected', Boolean(connected))
  pyodide.globals.set('_wasmforgeLocalFolderName', String(name || ''))
  pyodide.runPython(`
import builtins

builtins._wasmforge_local_folder_connected = bool(_wasmforgeLocalFolderConnected)
builtins._wasmforge_local_folder_name = str(_wasmforgeLocalFolderName)
  `)
}

function ensureLocalFolderMountPoint() {
  try {
    pyodide.FS.mkdirTree(LOCAL_FOLDER_MOUNT_PATH)
  } catch {
    // Directory already exists or the runtime will report the mount failure below.
  }
}

async function unmountLocalFolder() {
  if (!pyodide) {
    localFolderMount = null
    return
  }

  if (localFolderMount) {
    try {
      pyodide.FS.unmount(LOCAL_FOLDER_MOUNT_PATH)
    } catch {
      // Treat stale or already-unmounted folders as disconnected.
    }
  }

  localFolderMount = null
  updateLocalFolderPythonState(false)
}

async function setLocalFolderHandle(handle) {
  const nextHandle = handle || null
  if (nextHandle === localFolderHandle) {
    return
  }

  await unmountLocalFolder()
  localFolderHandle = nextHandle
  localFolderName = nextHandle?.name || ''
  updateLocalFolderPythonState(false)
}

async function mountLocalFolder() {
  if (!localFolderHandle) {
    updateLocalFolderPythonState(false)
    return false
  }

  if (localFolderMount) {
    updateLocalFolderPythonState(true)
    return true
  }

  try {
    ensureLocalFolderMountPoint()
    localFolderMount = await pyodide.mountNativeFS(LOCAL_FOLDER_MOUNT_PATH, localFolderHandle)
    updateLocalFolderPythonState(true)
    return true
  } catch (err) {
    localFolderMount = null
    updateLocalFolderPythonState(false)
    throw new Error(
      `[Local folder] Could not mount "${localFolderName || 'selected folder'}": ${err?.message || err}`
    )
  }
}

async function persistLocalFolderToDisk() {
  if (localFolderMount) {
    await localFolderMount.syncfs()
  }
}

function initWorker({
  stdinBuffer: incomingStdinBuffer,
  baseUrl: incomingBaseUrl,
  workspaceName,
  localFolderHandle: incomingLocalFolderHandle,
} = {}) {
  if (typeof incomingBaseUrl === 'string' && incomingBaseUrl.length > 0) {
    baseUrl = incomingBaseUrl
  }

  activeWorkspaceName = normalizeWorkspaceName(workspaceName)
  localFolderHandle = incomingLocalFolderHandle || null
  localFolderName = localFolderHandle?.name || ''

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

async function patchMatplotlibShow() {
  await pyodide.runPythonAsync(`
try:
    import builtins
    import matplotlib.pyplot as plt
    from matplotlib.figure import Figure

    if not hasattr(builtins, "_wasmforge_original_pyplot_show"):
        builtins._wasmforge_original_pyplot_show = getattr(plt, "show", None)
    if not hasattr(builtins, "_wasmforge_original_figure_show"):
        builtins._wasmforge_original_figure_show = getattr(Figure, "show", None)

    def _wasmforge_capture_only_show(*args, **kwargs):
        return None

    plt.show = _wasmforge_capture_only_show
    Figure.show = _wasmforge_capture_only_show
except Exception as exc:
    postStderr(f"[WasmForge] Failed to patch Matplotlib show(): {exc}\\n")
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

async function resetStructuredOutputs() {
  await pyodide.runPythonAsync(`
try:
    import builtins
    builtins._wasmforge_reset_displays()
except Exception:
    pass
  `)
}

async function collectTabularOutputs() {
  const serialized = await pyodide.runPythonAsync(`
result = "[]"
try:
    import builtins
    result = builtins._wasmforge_collect_displays()
except Exception:
    result = "[]"
result
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

async function resetNotebookPythonSession(notebookKey, filename = 'notebook.wfnb') {
  await mountWorkspace()
  await syncWorkspaceFromOpfs()
  await resetWorkspaceImportState()
  await resetStructuredOutputs()
  await resetMatplotlibState()
  await pyodide.runPythonAsync(`
import builtins

builtins._wasmforge_reset_notebook_session(
    ${JSON.stringify(notebookKey)},
    ${JSON.stringify(`/workspace/${filename}`)},
)
  `)
}

function getParallelWorkerLimit(requestedWorkers, inputCount) {
  const requested = Number.parseInt(requestedWorkers, 10)
  const hardwareLimit = Number.isFinite(navigator?.hardwareConcurrency)
    ? navigator.hardwareConcurrency
    : MAX_PARALLEL_WORKERS

  return Math.max(
    1,
    Math.min(
      Number.isFinite(requested) && requested > 0 ? requested : 2,
      Math.max(1, hardwareLimit),
      MAX_PARALLEL_WORKERS,
      Math.max(1, inputCount),
    ),
  )
}

function getParallelWorkerUrl() {
  const baseHref = new URL(baseUrl, self.location.origin)
  return new URL('workers/pyodide.parallel.worker.js', baseHref).toString()
}

function chunkInputs(inputs, workerCount) {
  const chunkSize = Math.ceil(inputs.length / workerCount)
  const chunks = []

  for (let index = 0; index < workerCount; index += 1) {
    const start = index * chunkSize
    const end = Math.min(start + chunkSize, inputs.length)
    if (start < end) {
      chunks.push({
        index,
        inputs: inputs.slice(start, end),
      })
    }
  }

  return chunks
}

function runParallelChunk({
  taskSource,
  functionName,
  inputs,
  workerIndex,
  indexURL,
  lockFileURL,
}) {
  const workerUrl = getParallelWorkerUrl()
  const worker = new Worker(workerUrl, { type: 'classic' })
  const jobId = `parallel-${Date.now()}-${parallelJobCounter += 1}`

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      worker.terminate()
      reject(new Error(`Parallel worker ${workerIndex + 1} timed out after ${PARALLEL_TASK_TIMEOUT_MS / 1000}s`))
    }, PARALLEL_TASK_TIMEOUT_MS)

    worker.onmessage = (event) => {
      const { type, jobId: responseJobId, resultsJson, error } = event.data || {}
      if (responseJobId !== jobId) {
        return
      }

      clearTimeout(timeoutId)
      worker.terminate()

      if (type === 'result') {
        resolve({
          workerIndex,
          results: JSON.parse(resultsJson),
        })
        return
      }

      reject(new Error(error || `Parallel worker ${workerIndex + 1} failed`))
    }

    worker.onerror = (errorEvent) => {
      clearTimeout(timeoutId)
      worker.terminate()
      reject(new Error(errorEvent.message || `Parallel worker ${workerIndex + 1} crashed`))
    }

    worker.postMessage({
      type: 'run',
      jobId,
      indexURL,
      lockFileURL,
      taskSource,
      functionName,
      inputsJson: JSON.stringify(inputs),
    })
  })
}

async function runParallelMapFromPython(taskSource, functionName, inputsJson, requestedWorkers = 2) {
  let inputs
  try {
    inputs = JSON.parse(String(inputsJson || '[]'))
  } catch (err) {
    throw new Error(`parallel_map inputs must be JSON-serializable: ${err.message || err}`)
  }

  if (!Array.isArray(inputs)) {
    throw new Error('parallel_map inputs must serialize to a list')
  }

  if (inputs.length === 0) {
    return JSON.stringify({
      results: [],
      workers: 0,
      durationMs: 0,
    })
  }

  const { indexURL, lockFileURL } = getPyodideAssetUrls()
  const workerCount = getParallelWorkerLimit(requestedWorkers, inputs.length)
  const chunks = chunkInputs(inputs, workerCount)
  const startedAt = performance.now()

  bufferStdout(`[Parallel] ${chunks.length} local Python workers used for ${inputs.length} tasks.\n`)
  flushBufferedOutput()

  try {
    const chunkResults = await Promise.all(
      chunks.map((chunk) =>
        runParallelChunk({
          taskSource: String(taskSource ?? ''),
          functionName: String(functionName ?? ''),
          inputs: chunk.inputs,
          workerIndex: chunk.index,
          indexURL,
          lockFileURL,
        }),
      ),
    )

    const orderedResults = chunkResults
      .sort((left, right) => left.workerIndex - right.workerIndex)
      .flatMap((chunk) => chunk.results)
    const durationMs = performance.now() - startedAt

    bufferStdout(`[Parallel] Completed ${inputs.length} tasks in ${durationMs.toFixed(1)}ms.\n`)

    return JSON.stringify({
      results: orderedResults,
      workers: chunks.length,
      durationMs,
    })
  } catch (err) {
    throw new Error(`parallel_map failed: ${err.message || err}`)
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
    pyodide.globals.set('postStdout', bufferStdout)
    pyodide.globals.set('postStderr', bufferStderr)
    pyodide.globals.set('_wasmforgeStdin', stdinHandler)
    pyodide.globals.set('_wasmforgeParallelMap', runParallelMapFromPython)

    // Override sys.stdout and sys.stderr to capture Python output
    // and route it to our buffering system instead of the console.
    pyodide.runPython(`
import builtins
import math
import sys
import types

builtins._wasmforge_display_payloads = []
builtins._wasmforge_notebook_sessions = {}
builtins._wasmforge_local_folder_connected = False
builtins._wasmforge_local_folder_name = ""

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

def _wasmforge_safe_value(value):
    if value is None or isinstance(value, (bool, int, str)):
        return value

    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return str(value)
        return value

    item = getattr(value, "item", None)
    if callable(item):
        try:
            return _wasmforge_safe_value(item())
        except Exception:
            pass

    isoformat = getattr(value, "isoformat", None)
    if callable(isoformat):
        try:
            return isoformat()
        except Exception:
            pass

    try:
        import pandas as _pd
        is_missing = _pd.isna(value)
        if isinstance(is_missing, bool) and is_missing:
            return None
    except Exception:
        pass

    return str(value)

def _wasmforge_capture_table(obj):
    try:
        import pandas as pd
    except Exception:
        return False

    if isinstance(obj, pd.Series):
        frame = obj.to_frame()
        kind = "series"
        title = obj.name or f"Series {len(builtins._wasmforge_display_payloads) + 1}"
    elif isinstance(obj, pd.DataFrame):
        frame = obj
        kind = "dataframe"
        title = frame.attrs.get("title") or f"DataFrame {len(builtins._wasmforge_display_payloads) + 1}"
    else:
        return False

    row_limit = 100
    column_limit = 12
    preview = frame.iloc[:row_limit, :column_limit]

    rows = [
        [_wasmforge_safe_value(value) for value in row]
        for row in preview.itertuples(index=False, name=None)
    ]
    index = [_wasmforge_safe_value(value) for value in preview.index.tolist()]
    columns = [str(column) for column in preview.columns.tolist()]

    builtins._wasmforge_display_payloads.append({
        "id": f"Display {len(builtins._wasmforge_display_payloads) + 1}",
        "kind": kind,
        "title": str(title),
        "columns": columns,
        "rows": rows,
        "index": index,
        "rowCount": int(frame.shape[0]),
        "columnCount": int(frame.shape[1]),
        "truncatedRows": max(0, int(frame.shape[0]) - int(preview.shape[0])),
        "truncatedColumns": max(0, int(frame.shape[1]) - int(preview.shape[1])),
    })
    return True

def _wasmforge_display(*objects):
    if not objects:
        return None

    for obj in objects:
        if _wasmforge_capture_table(obj):
            continue

        text = str(obj)
        if text:
            postStdout(text)
            if not text.endswith("\\n"):
                postStdout("\\n")

    return objects[0] if len(objects) == 1 else objects

def _wasmforge_reset_displays():
    builtins._wasmforge_display_payloads.clear()

def _wasmforge_collect_displays():
    import json

    payload = json.dumps(builtins._wasmforge_display_payloads)
    builtins._wasmforge_display_payloads.clear()
    return payload

def _wasmforge_create_notebook_namespace(filename=""):
    namespace = {
        "__name__": "__main__",
        "__package__": None,
        "__builtins__": builtins.__dict__,
    }
    if filename:
        namespace["__file__"] = filename
    return namespace

def _wasmforge_reset_notebook_session(session_key, filename=""):
    namespace = _wasmforge_create_notebook_namespace(filename)
    builtins._wasmforge_notebook_sessions[session_key] = namespace
    return namespace

def _wasmforge_get_notebook_session(session_key, filename=""):
    namespace = builtins._wasmforge_notebook_sessions.get(session_key)
    if namespace is None:
        namespace = _wasmforge_reset_notebook_session(session_key, filename)
    if filename:
        namespace["__file__"] = filename
    namespace["__name__"] = "__main__"
    namespace["__package__"] = None
    return namespace

def _wasmforge_run_notebook_cell(source, session_key, filename="", cell_label="Cell"):
    namespace = _wasmforge_get_notebook_session(session_key, filename)
    compiled = compile(source, f"{filename or '<notebook>'}::{cell_label}", "exec")
    exec(compiled, namespace, namespace)

sys.stdout = _WasmForgeStdout()
sys.stderr = _WasmForgeStderr()
builtins.input = _wasmforge_input
builtins.display = _wasmforge_display
builtins._wasmforge_reset_displays = _wasmforge_reset_displays
builtins._wasmforge_collect_displays = _wasmforge_collect_displays
builtins._wasmforge_reset_notebook_session = _wasmforge_reset_notebook_session
builtins._wasmforge_run_notebook_cell = _wasmforge_run_notebook_cell

wasmforge_fs = types.ModuleType("wasmforge_fs")

def _wasmforge_fs_normalize_path(path, allow_root=False):
    import posixpath

    raw = str(path if path is not None else "")
    if chr(92) in raw:
        raise ValueError("Local folder paths must use '/' separators")

    stripped = raw.strip()
    if not stripped:
        if allow_root:
            return "."
        raise ValueError("Local folder path cannot be empty")

    if stripped.startswith("/") or stripped.startswith("~"):
        raise ValueError("Local folder paths must be relative")

    normalized = posixpath.normpath(stripped)
    if normalized == ".":
        if allow_root:
            return "."
        raise ValueError("Local folder path must name a file")

    if normalized == ".." or normalized.startswith("../"):
        raise ValueError("Local folder path cannot escape the selected folder")

    return normalized

def _wasmforge_fs_full_path(path, allow_root=False):
    if not builtins._wasmforge_local_folder_connected:
        raise RuntimeError("No local folder connected. Click Connect Folder first.")

    safe_path = _wasmforge_fs_normalize_path(path, allow_root=allow_root)
    if safe_path == ".":
        return safe_path, "/local"

    return safe_path, "/local/" + safe_path

def _wasmforge_fs_is_connected():
    return bool(builtins._wasmforge_local_folder_connected)

def _wasmforge_fs_local_root():
    return str(builtins._wasmforge_local_folder_name or "")

def _wasmforge_fs_read_text(path, encoding="utf-8"):
    safe_path, full_path = _wasmforge_fs_full_path(path)
    with open(full_path, "r", encoding=encoding) as file:
        return file.read()

def _wasmforge_fs_write_text(path, text, encoding="utf-8"):
    import os

    safe_path, full_path = _wasmforge_fs_full_path(path)
    parent = os.path.dirname(full_path)
    if parent and parent != "/local":
        os.makedirs(parent, exist_ok=True)

    with open(full_path, "w", encoding=encoding) as file:
        file.write(str(text))

    postStdout(f"[Local folder] Wrote {safe_path}\\n")
    return safe_path

def _wasmforge_fs_list_files(path="."):
    import os

    safe_path, full_path = _wasmforge_fs_full_path(path, allow_root=True)
    names = sorted(os.listdir(full_path))
    return names

def _wasmforge_fs_help():
    return (
        "Use read_text(path), write_text(path, text), list_files(path='.'), "
        "is_connected(), and local_root(). Paths are relative to the folder you granted."
    )

wasmforge_fs.is_connected = _wasmforge_fs_is_connected
wasmforge_fs.local_root = _wasmforge_fs_local_root
wasmforge_fs.read_text = _wasmforge_fs_read_text
wasmforge_fs.write_text = _wasmforge_fs_write_text
wasmforge_fs.list_files = _wasmforge_fs_list_files
wasmforge_fs.help = _wasmforge_fs_help
sys.modules["wasmforge_fs"] = wasmforge_fs

wasmforge_parallel = types.ModuleType("wasmforge_parallel")

async def _wasmforge_parallel_map(task_source, function_name, inputs, workers=2):
    import json

    try:
        inputs_json = json.dumps(list(inputs))
    except TypeError as exc:
        raise TypeError("parallel_map inputs must be JSON-serializable") from exc

    payload_json = await _wasmforgeParallelMap(
        str(task_source),
        str(function_name),
        inputs_json,
        int(workers),
    )
    payload = json.loads(str(payload_json))
    return payload.get("results", [])

def _wasmforge_parallel_help():
    return (
        "Use: results = await parallel_map(task_source, function_name, inputs, workers=2). "
        "Inputs and return values must be JSON-serializable."
    )

wasmforge_parallel.parallel_map = _wasmforge_parallel_map
wasmforge_parallel.help = _wasmforge_parallel_help
sys.modules["wasmforge_parallel"] = wasmforge_parallel
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
  activeExecutionMode = 'script'
  resetNotebookBuffers()
  sendHeartbeat()
  startHeartbeat()
  startFlushInterval()

  let error = null
  const startedAt = performance.now()
  let usesMatplotlib = false

  try {
    await mountWorkspace()
    await syncWorkspaceFromOpfs()
    await mountLocalFolder()

    const workspacePath = `/workspace/${filename}`
    pyodide.FS.writeFile(workspacePath, code, { encoding: 'utf8' })

    const packageState = await ensureLocalPackages(code, filename)
    usesMatplotlib = packageState.usesMatplotlib

    await resetWorkspaceImportState()
    await resetStructuredOutputs()

    if (usesMatplotlib) {
      await configureMatplotlibBackend()
      await patchMatplotlibShow()
      await resetMatplotlibState()
    }

    await pyodide.runPythonAsync(`
import builtins
import os
from pyodide.code import eval_code_async

os.chdir("/workspace")
_wasmforge_script_namespace = {
    "__name__": "__main__",
    "__package__": None,
    "__file__": ${JSON.stringify(workspacePath)},
    "__builtins__": builtins.__dict__,
}
await eval_code_async(
    ${JSON.stringify(code)},
    globals=_wasmforge_script_namespace,
    locals=_wasmforge_script_namespace,
    filename=${JSON.stringify(workspacePath)},
)
    `)
  } catch (err) {
    const errorMsg = normalizeErrorMessage(err).trim()
    if (errorMsg) {
      self.postMessage({ type: 'stderr', data: `\n${errorMsg}\n` })
    }
    error = errorMsg || 'Python execution failed'
  } finally {
    try {
      const tables = await collectTabularOutputs()
      if (tables.length > 0) {
        self.postMessage({ type: 'tables', tables })
      }
    } catch (tableErr) {
      const tableMessage = `[WasmForge] Failed to capture pandas output: ${tableErr.message || tableErr}\n`
      self.postMessage({ type: 'stderr', data: `\n${tableMessage}` })
      error ||= tableMessage.trim()
    }

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

    try {
      await persistLocalFolderToDisk()
    } catch (syncErr) {
      const syncMessage = `[WasmForge] Failed to sync local folder: ${syncErr.message || syncErr}\n`
      self.postMessage({ type: 'stderr', data: `\n${syncMessage}` })
      error ||= syncMessage.trim()
    }

    stopHeartbeat()
    stopFlushInterval()
    activeExecutionMode = 'script'
    self.postMessage({
      type: 'done',
      error,
      durationMs: performance.now() - startedAt,
    })
  }
}

async function runNotebookCell({
  notebookKey,
  code,
  filename = 'notebook.wfnb',
  cellId = 'cell',
} = {}) {
  if (initializationPromise) {
    await initializationPromise
  }

  if (!pyodide) {
    self.postMessage({ type: 'stderr', data: '[WasmForge] Python is still loading. Please wait.\n' })
    self.postMessage({
      type: 'notebook_cell_done',
      cellId,
      error: 'Runtime not ready',
      stdout: '',
      stderr: '[WasmForge] Python is still loading. Please wait.\n',
      figures: [],
      tables: [],
      durationMs: null,
    })
    return
  }

  stopHeartbeat()
  stopFlushInterval()
  activeExecutionMode = 'notebook'
  resetNotebookBuffers()
  sendHeartbeat()
  startHeartbeat()
  startFlushInterval()

  let error = null
  const startedAt = performance.now()
  let usesMatplotlib = false

  try {
    await mountWorkspace()
    await syncWorkspaceFromOpfs()
    await mountLocalFolder()

    const packageState = await ensureLocalPackages(code, filename)
    usesMatplotlib = packageState.usesMatplotlib

    await resetWorkspaceImportState()
    await resetStructuredOutputs()
    await resetMatplotlibState()

    if (usesMatplotlib) {
      await configureMatplotlibBackend()
      await patchMatplotlibShow()
    }

    await pyodide.runPythonAsync(`
import builtins

builtins._wasmforge_run_notebook_cell(
    ${JSON.stringify(code)},
    ${JSON.stringify(notebookKey)},
    ${JSON.stringify(`/workspace/${filename}`)},
    ${JSON.stringify(cellId)},
)
    `)
  } catch (err) {
    const errorMsg = normalizeErrorMessage(err).trim()
    if (errorMsg) {
      stderrBuffer += `\n${errorMsg}\n`
      notebookStderrBuffer += `\n${errorMsg}\n`
    }
    error = errorMsg || 'Python notebook execution failed'
  } finally {
    let tables = []
    let figures = []

    try {
      tables = await collectTabularOutputs()
    } catch (tableErr) {
      const tableMessage = `[WasmForge] Failed to capture pandas output: ${tableErr.message || tableErr}\n`
      stderrBuffer += `\n${tableMessage}`
      notebookStderrBuffer += `\n${tableMessage}`
      error ||= tableMessage.trim()
    }

    try {
      figures = await collectMatplotlibFigures()
    } catch (figureErr) {
      const figureMessage = `[WasmForge] Failed to render Matplotlib output: ${figureErr.message || figureErr}\n`
      stderrBuffer += `\n${figureMessage}`
      notebookStderrBuffer += `\n${figureMessage}`
      error ||= figureMessage.trim()
    }

    try {
      await persistWorkspaceToOpfs()
    } catch (syncErr) {
      const syncMessage = `[WasmForge] Failed to sync workspace: ${syncErr.message || syncErr}\n`
      stderrBuffer += `\n${syncMessage}`
      notebookStderrBuffer += `\n${syncMessage}`
      error ||= syncMessage.trim()
    }

    try {
      await persistLocalFolderToDisk()
    } catch (syncErr) {
      const syncMessage = `[WasmForge] Failed to sync local folder: ${syncErr.message || syncErr}\n`
      stderrBuffer += `\n${syncMessage}`
      notebookStderrBuffer += `\n${syncMessage}`
      error ||= syncMessage.trim()
    }

    stopHeartbeat()
    stopFlushInterval()
    activeExecutionMode = 'script'

    self.postMessage({
      type: 'notebook_cell_done',
      cellId,
      error,
      stdout: notebookStdoutBuffer,
      stderr: notebookStderrBuffer,
      tables,
      figures,
      durationMs: performance.now() - startedAt,
    })

    resetNotebookBuffers()
  }
}

self.onmessage = async (event) => {
  const {
    type,
    code,
    filename,
    notebookKey,
    cellId,
    stdinBuffer: incomingStdinBuffer,
    baseUrl: incomingBaseUrl,
    workspaceName,
    localFolderHandle: incomingLocalFolderHandle,
  } = event.data

  switch (type) {
    case 'init':
      initWorker({
        stdinBuffer: incomingStdinBuffer,
        baseUrl: incomingBaseUrl,
        workspaceName,
        localFolderHandle: incomingLocalFolderHandle,
      })
      break

    case 'set_local_folder':
      await setLocalFolderHandle(incomingLocalFolderHandle)
      break

    case 'run':
      await setLocalFolderHandle(incomingLocalFolderHandle)
      await runPython(code, filename)
      break

    case 'run_notebook_cell':
      await setLocalFolderHandle(incomingLocalFolderHandle)
      await runNotebookCell({
        notebookKey,
        code,
        filename,
        cellId,
      })
      break

    case 'reset_notebook_session':
      try {
        await setLocalFolderHandle(incomingLocalFolderHandle)

        if (initializationPromise) {
          await initializationPromise
        }

        if (!pyodide) {
          throw new Error('Runtime not ready')
        }

        stopHeartbeat()
        stopFlushInterval()
        activeExecutionMode = 'script'
        resetNotebookBuffers()
        sendHeartbeat()
        startHeartbeat()
        startFlushInterval()
        await resetNotebookPythonSession(notebookKey, filename)
        stopHeartbeat()
        stopFlushInterval()
        self.postMessage({ type: 'notebook_session_reset', error: '' })
      } catch (err) {
        const error = normalizeErrorMessage(err).trim() || 'Failed to reset notebook session'
        stderrBuffer += `\n${error}\n`
        stopHeartbeat()
        stopFlushInterval()
        self.postMessage({ type: 'notebook_session_reset', error })
      }
      break

    case 'kill':
      stopHeartbeat()
      stopFlushInterval()
      activeExecutionMode = 'script'
      resetNotebookBuffers()
      self.postMessage({ type: 'done', error: 'Execution killed by user' })
      break

    default:
      console.warn('[WasmForge Worker] Unknown message type:', type)
  }
}
