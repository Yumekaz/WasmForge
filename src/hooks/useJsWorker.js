import { useCallback, useEffect, useRef, useState } from 'react'

const DEFAULT_FILENAME = 'main.js'

function createIdleStatus() {
  return 'Preparing JavaScript environment...'
}

export function useJsWorker({
  onStdout,
  onStderr,
  onReady,
  onDone,
  onProgress,
} = {}) {
  const workerRef = useRef(null)
  const spawnWorkerRef = useRef(null)
  const respawnTimeoutRef = useRef(null)
  const crashCountRef = useRef(0)
  const onStdoutRef = useRef(onStdout)
  const onStderrRef = useRef(onStderr)
  const onReadyRef = useRef(onReady)
  const onDoneRef = useRef(onDone)
  const onProgressRef = useRef(onProgress)
  const [isReady, setIsReady] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [status, setStatus] = useState(createIdleStatus)

  useEffect(() => {
    onStdoutRef.current = onStdout
  }, [onStdout])

  useEffect(() => {
    onStderrRef.current = onStderr
  }, [onStderr])

  useEffect(() => {
    onReadyRef.current = onReady
  }, [onReady])

  useEffect(() => {
    onDoneRef.current = onDone
  }, [onDone])

  useEffect(() => {
    onProgressRef.current = onProgress
  }, [onProgress])

  const clearScheduledRespawn = useCallback(() => {
    if (respawnTimeoutRef.current) {
      clearTimeout(respawnTimeoutRef.current)
      respawnTimeoutRef.current = null
    }
  }, [])

  const scheduleRespawn = useCallback(() => {
    clearScheduledRespawn()

    const attempt = crashCountRef.current + 1
    crashCountRef.current = attempt
    const delayMs = Math.min((attempt - 1) * 1000, 5000)
    const statusMessage = attempt === 1
      ? 'Recovering JavaScript environment...'
      : `Recovering JavaScript environment (retry ${attempt})...`

    setStatus(statusMessage)
    onStderrRef.current?.(
      delayMs > 0
        ? `[WasmForge] Restarting JavaScript environment in ${Math.ceil(delayMs / 1000)}s...\n`
        : '[WasmForge] Restarting JavaScript environment...\n',
    )

    respawnTimeoutRef.current = setTimeout(() => {
      respawnTimeoutRef.current = null
      spawnWorkerRef.current?.()
    }, delayMs)
  }, [clearScheduledRespawn])

  const spawnWorker = useCallback(() => {
    clearScheduledRespawn()

    if (workerRef.current) {
      workerRef.current.terminate()
      workerRef.current = null
    }

    setIsReady(false)
    setIsRunning(false)
    setStatus(createIdleStatus())

    const worker = new Worker(
      new URL('../workers/js.worker.js', import.meta.url),
      { type: 'module' },
    )

    worker.onmessage = (event) => {
      const { type, data, error, status: nextStatus } = event.data || {}

      switch (type) {
        case 'ready':
          crashCountRef.current = 0
          setIsReady(true)
          setStatus('JavaScript ready')
          onReadyRef.current?.()
          break

        case 'stdout':
          onStdoutRef.current?.(data)
          break

        case 'stderr':
          onStderrRef.current?.(data)
          break

        case 'status':
          setStatus(nextStatus || '')
          onProgressRef.current?.(nextStatus || '')
          break

        case 'done':
          setIsRunning(false)
          setStatus(error ? 'Execution failed' : 'JavaScript ready')
          onDoneRef.current?.(error)
          break

        default:
          break
      }
    }

    worker.onerror = (err) => {
      const message = err?.message || 'JavaScript environment crashed'

      try {
        worker.terminate()
      } catch {
        // Ignore teardown races after a crash.
      }

      setIsReady(false)
      setIsRunning(false)
      setStatus('JavaScript unavailable')
      onStderrRef.current?.(`[WasmForge] ${message}\n`)
      onDoneRef.current?.(message)

      if (workerRef.current === worker) {
        workerRef.current = null
      }

      scheduleRespawn()
    }

    workerRef.current = worker
    worker.postMessage({ type: 'init' })
  }, [clearScheduledRespawn, scheduleRespawn])

  spawnWorkerRef.current = spawnWorker

  const runCode = useCallback((payload) => {
    if (!workerRef.current || !isReady) {
      onStderrRef.current?.('[WasmForge] The JavaScript environment is still loading. Please wait...\n')
      return
    }

    if (isRunning) {
      onStderrRef.current?.('[WasmForge] A JavaScript session is already running.\n')
      return
    }

    const execution = typeof payload === 'string'
      ? { code: payload, filename: DEFAULT_FILENAME }
      : payload

    setIsRunning(true)
    setStatus('Running...')
    onProgressRef.current?.('Running JavaScript...')

    workerRef.current.postMessage({
      type: 'run',
      code: execution.code,
      filename: execution.filename || DEFAULT_FILENAME,
    })
  }, [isReady, isRunning])

  const killWorker = useCallback(() => {
    clearScheduledRespawn()
    crashCountRef.current = 0

    if (workerRef.current) {
      workerRef.current.terminate()
      workerRef.current = null
    }

    setIsRunning(false)
    setIsReady(false)
    setStatus('JavaScript restarted')
    onStderrRef.current?.('\n[WasmForge] Execution killed by user.\n')
    onDoneRef.current?.('Killed by user')
    spawnWorkerRef.current?.()
  }, [clearScheduledRespawn])

  useEffect(() => {
    spawnWorker()

    return () => {
      clearScheduledRespawn()
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [clearScheduledRespawn, spawnWorker])

  return {
    runCode,
    killWorker,
    isReady,
    isRunning,
    status,
  }
}
