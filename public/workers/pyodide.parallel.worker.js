let pyodide = null
let initializationPromise = null

function normalizeErrorMessage(error) {
  const message = error?.message || String(error)
  return message.replace(/\n?PythonError\s*$/u, '')
}

async function ensurePyodide({ indexURL, lockFileURL }) {
  if (pyodide) {
    return pyodide
  }

  if (!initializationPromise) {
    initializationPromise = (async () => {
      importScripts(new URL('pyodide.js', indexURL).toString())

      pyodide = await loadPyodide({
        indexURL,
        lockFileURL,
      })

      pyodide.runPython(`
import sys

class _WasmForgeParallelSink:
    def write(self, value):
        pass
    def flush(self):
        pass

sys.stdout = _WasmForgeParallelSink()
sys.stderr = _WasmForgeParallelSink()
      `)

      return pyodide
    })()
  }

  return initializationPromise
}

async function runChunk({
  jobId,
  indexURL,
  lockFileURL,
  taskSource,
  functionName,
  inputsJson,
}) {
  const runtime = await ensurePyodide({ indexURL, lockFileURL })
  const source = `
import json

${taskSource}

_wasmforge_parallel_inputs = json.loads(${JSON.stringify(inputsJson)})
_wasmforge_parallel_function = globals().get(${JSON.stringify(functionName)})

if not callable(_wasmforge_parallel_function):
    raise TypeError("parallel_map function_name must point to a callable")

_wasmforge_parallel_results = [
    _wasmforge_parallel_function(item)
    for item in _wasmforge_parallel_inputs
]

json.dumps(_wasmforge_parallel_results)
`

  const resultsJson = await runtime.runPythonAsync(source)
  self.postMessage({
    type: 'result',
    jobId,
    resultsJson: String(resultsJson ?? '[]'),
  })
}

self.onmessage = (event) => {
  const payload = event.data || {}

  if (payload.type !== 'run') {
    return
  }

  runChunk(payload).catch((error) => {
    self.postMessage({
      type: 'error',
      jobId: payload.jobId,
      error: normalizeErrorMessage(error).trim() || 'Parallel Python worker failed',
    })
  })
}
