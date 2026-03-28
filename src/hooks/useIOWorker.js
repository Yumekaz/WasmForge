import { useCallback, useEffect, useRef, useState } from 'react'

export function useIOWorker({ workspaceName = 'python-experiments', onError, onWriteFlushed } = {}) {
  const workerRef = useRef(null)
  const nextRequestIdRef = useRef(0)
  const pendingRequestsRef = useRef(new Map())
  const scheduledWritesRef = useRef([])
  const createWorkerRef = useRef(null)
  const onErrorRef = useRef(onError)
  const onWriteFlushedRef = useRef(onWriteFlushed)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  useEffect(() => {
    onWriteFlushedRef.current = onWriteFlushed
  }, [onWriteFlushed])

  const rejectAllPending = useCallback((error) => {
    for (const { reject } of pendingRequestsRef.current.values()) {
      reject(error)
    }
    pendingRequestsRef.current.clear()
  }, [])

  const flushScheduledWrites = useCallback(() => {
    if (!workerRef.current || scheduledWritesRef.current.length === 0) {
      return
    }

    const queuedWrites = scheduledWritesRef.current.splice(0)
    for (const payload of queuedWrites) {
      workerRef.current.postMessage(payload)
    }
  }, [])

  const attachWorker = useCallback((worker) => {
    worker.onmessage = (event) => {
      const { id, result, error, type, filename, workspaceName: eventWorkspaceName } = event.data

      if (type === 'write_error') {
        const writeError = new Error(
          filename
            ? `Failed to save ${filename}: ${error}`
            : (error || 'Workspace write failed')
        )
        writeError.details = {
          workspaceName: eventWorkspaceName,
          filename,
        }
        onErrorRef.current?.(writeError)
        return
      }

      if (type === 'write_flushed') {
        onWriteFlushedRef.current?.(filename, eventWorkspaceName)
        return
      }

      const pending = pendingRequestsRef.current.get(id)
      if (!pending) {
        return
      }

      pendingRequestsRef.current.delete(id)

      if (error) {
        pending.reject(new Error(error))
        return
      }

      pending.resolve(result)
    }

    worker.onerror = (event) => {
      const error = new Error(event.message || 'Workspace I/O worker crashed')
      setIsReady(false)
      rejectAllPending(error)
      onErrorRef.current?.(error)
      workerRef.current = null
      createWorkerRef.current?.()
    }
  }, [rejectAllPending])

  const createWorker = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate()
      workerRef.current = null
    }

    const worker = new Worker(
      new URL('../workers/io.worker.js', import.meta.url),
      { type: 'classic' }
    )

    attachWorker(worker)
    workerRef.current = worker
    setIsReady(true)
    flushScheduledWrites()
  }, [attachWorker, flushScheduledWrites])

  createWorkerRef.current = createWorker

  useEffect(() => {
    createWorker()

    return () => {
      setIsReady(false)
      rejectAllPending(new Error('Workspace I/O worker stopped'))
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [createWorker, rejectAllPending])

  const callWorker = useCallback((payload) => {
    if (!workerRef.current) {
      return Promise.reject(new Error('Workspace I/O worker is not ready'))
    }

    const id = nextRequestIdRef.current++
    return new Promise((resolve, reject) => {
      pendingRequestsRef.current.set(id, { resolve, reject })
      workerRef.current.postMessage({ ...payload, id })
    })
  }, [])

  const withWorkspace = useCallback((payload) => ({
    ...payload,
    workspaceName: payload.workspaceName ?? workspaceName,
  }), [workspaceName])

  const scheduleWrite = useCallback((filename, content) => {
    const payload = withWorkspace({
      type: 'schedule_write',
      filename,
      content,
    })

    if (!workerRef.current) {
      scheduledWritesRef.current.push(payload)
      createWorkerRef.current?.()
      return
    }

    workerRef.current.postMessage(payload)
  }, [withWorkspace])

  const listFiles = useCallback(
    (workspaceOverride) => callWorker(withWorkspace({ type: 'list', workspaceName: workspaceOverride })),
    [callWorker, withWorkspace],
  )
  const readFile = useCallback(
    (filename, scope = 'workspace', workspaceOverride) =>
      callWorker(withWorkspace({ type: 'read', filename, scope, workspaceName: workspaceOverride })),
    [callWorker, withWorkspace],
  )
  const writeFile = useCallback(
    (filename, content, scope = 'workspace', workspaceOverride) =>
      callWorker(withWorkspace({ type: 'write', filename, content, scope, workspaceName: workspaceOverride })),
    [callWorker, withWorkspace],
  )
  const deleteFile = useCallback(
    (filename, scope = 'workspace', workspaceOverride) =>
      callWorker(withWorkspace({ type: 'delete', filename, scope, workspaceName: workspaceOverride })),
    [callWorker, withWorkspace],
  )
  const renameFile = useCallback(
    (filename, nextFilename, workspaceOverride) =>
      callWorker(withWorkspace({ type: 'rename', filename, nextFilename, workspaceName: workspaceOverride })),
    [callWorker, withWorkspace],
  )
  const fileExists = useCallback(
    (filename, scope = 'workspace') => callWorker(withWorkspace({ type: 'exists', filename, scope })),
    [callWorker, withWorkspace],
  )
  const readBinaryFile = useCallback(
    (filename, scope = 'sqlite') =>
      callWorker(withWorkspace({ type: 'read_binary', filename, scope })),
    [callWorker, withWorkspace],
  )
  const writeBinaryFile = useCallback(
    (filename, content, scope = 'sqlite') =>
      callWorker(withWorkspace({ type: 'write_binary', filename, content, scope })),
    [callWorker, withWorkspace],
  )
  const flushWrite = useCallback(
    (filename) => callWorker(withWorkspace({ type: 'flush', filename })),
    [callWorker, withWorkspace],
  )
  const flushAllWrites = useCallback(() => callWorker({ type: 'flush_all' }), [callWorker])
  const listWorkspaces = useCallback(
    () => callWorker({ type: 'list_workspaces' }),
    [callWorker],
  )
  const createWorkspace = useCallback(
    (name) => callWorker({ type: 'create_workspace', workspaceName: name }),
    [callWorker],
  )

  return {
    isReady,
    listFiles,
    readFile,
    writeFile,
    deleteFile,
    renameFile,
    fileExists,
    readBinaryFile,
    writeBinaryFile,
    scheduleWrite,
    flushWrite,
    flushAllWrites,
    listWorkspaces,
    createWorkspace,
  }
}
