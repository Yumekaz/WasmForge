const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()
const WRITE_DEBOUNCE_MS = 300
const WORKSPACES_ROOT_DIRECTORY = 'wasmforge-workspaces'
const WORKSPACE_FILES_DIRECTORY = 'files'
const WORKSPACE_SQLITE_DIRECTORY = 'sqlite'
const stagedWrites = new Map()
let operationQueue = Promise.resolve()

function normalizeWorkspaceName(workspaceName) {
  const normalized = String(workspaceName ?? '').trim()

  if (!normalized) {
    throw new Error('Workspace name is required')
  }

  if (normalized.includes('/') || normalized.includes('\\')) {
    throw new Error('Workspace names cannot contain slashes')
  }

  return normalized
}

function normalizeFilename(filename) {
  const normalized = String(filename || '').replace(/^\/?workspace\//u, '').trim()
  if (!normalized) {
    throw new Error('Filename is required')
  }
  if (normalized.includes('/') || normalized.includes('\\')) {
    throw new Error('Nested paths are not supported in the workspace explorer yet')
  }
  return normalized
}

function getStagedWriteKey(workspaceName, filename) {
  return `${normalizeWorkspaceName(workspaceName)}::${normalizeFilename(filename)}`
}

function parseStagedWriteKey(stagedWriteKey) {
  const separatorIndex = stagedWriteKey.indexOf('::')
  if (separatorIndex === -1) {
    return {
      workspaceName: '',
      filename: stagedWriteKey,
    }
  }

  return {
    workspaceName: stagedWriteKey.slice(0, separatorIndex),
    filename: stagedWriteKey.slice(separatorIndex + 2),
  }
}

async function getWorkspacesRootDirectory({ create = true } = {}) {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(WORKSPACES_ROOT_DIRECTORY, { create })
}

async function getWorkspaceDirectory(workspaceName, { create = true } = {}) {
  const workspacesRoot = await getWorkspacesRootDirectory({ create })
  return workspacesRoot.getDirectoryHandle(normalizeWorkspaceName(workspaceName), { create })
}

async function ensureWorkspace(workspaceName) {
  const normalizedWorkspaceName = normalizeWorkspaceName(workspaceName)
  const workspaceDirectory = await getWorkspaceDirectory(normalizedWorkspaceName, {
    create: true,
  })

  await workspaceDirectory.getDirectoryHandle(WORKSPACE_FILES_DIRECTORY, { create: true })
  await workspaceDirectory.getDirectoryHandle(WORKSPACE_SQLITE_DIRECTORY, { create: true })

  return normalizedWorkspaceName
}

async function getScopedDirectory(scope = 'workspace', workspaceName) {
  const workspaceDirectory = await getWorkspaceDirectory(workspaceName, { create: true })

  switch (scope) {
    case 'workspace':
      return workspaceDirectory.getDirectoryHandle(WORKSPACE_FILES_DIRECTORY, { create: true })

    case 'sqlite':
      return workspaceDirectory.getDirectoryHandle(WORKSPACE_SQLITE_DIRECTORY, { create: true })

    default:
      throw new Error(`Unsupported OPFS scope: ${scope}`)
  }
}

async function getScopedFileHandle(filename, {
  scope = 'workspace',
  workspaceName,
  create = false,
} = {}) {
  const directory = await getScopedDirectory(scope, workspaceName)
  return directory.getFileHandle(normalizeFilename(filename), { create })
}

function getScheduledWrite(workspaceName, filename) {
  return stagedWrites.get(getStagedWriteKey(workspaceName, filename))
}

function queueOperation(operation) {
  const nextOperation = operationQueue
    .catch(() => undefined)
    .then(operation)

  operationQueue = nextOperation.catch(() => undefined)
  return nextOperation
}

function clearScheduledWrite(workspaceName, filename) {
  const key = getStagedWriteKey(workspaceName, filename)
  const pending = stagedWrites.get(key)
  if (!pending) {
    return false
  }

  clearTimeout(pending.timer)
  stagedWrites.delete(key)
  return true
}

function takeScheduledWrite(workspaceName, filename) {
  const key = getStagedWriteKey(workspaceName, filename)
  const pending = stagedWrites.get(key)
  if (!pending) {
    return null
  }

  clearTimeout(pending.timer)
  stagedWrites.delete(key)
  return pending
}

async function writeFile(filename, content, scope = 'workspace', workspaceName) {
  const normalizedFilename = normalizeFilename(filename)
  const fileHandle = await getScopedFileHandle(normalizedFilename, {
    scope,
    workspaceName,
    create: true,
  })
  const access = await fileHandle.createSyncAccessHandle()

  try {
    const encoded = textEncoder.encode(content)
    access.truncate(0)
    access.write(encoded, { at: 0 })
    access.flush()
  } finally {
    access.close()
  }

  return { ok: true }
}

async function writeBinaryFile(filename, content, scope = 'sqlite', workspaceName) {
  const normalizedFilename = normalizeFilename(filename)
  const fileHandle = await getScopedFileHandle(normalizedFilename, {
    scope,
    workspaceName,
    create: true,
  })
  const access = await fileHandle.createSyncAccessHandle()

  try {
    const bytes = content instanceof Uint8Array
      ? content
      : new Uint8Array(content ?? new ArrayBuffer(0))
    access.truncate(0)
    access.write(bytes, { at: 0 })
    access.flush()
  } finally {
    access.close()
  }

  return { ok: true, size: content?.byteLength ?? 0 }
}

async function readFile(filename, scope = 'workspace', workspaceName) {
  const normalizedFilename = normalizeFilename(filename)
  const stagedWrite = scope === 'workspace'
    ? getScheduledWrite(workspaceName, normalizedFilename)
    : null
  if (stagedWrite && scope === 'workspace') {
    return stagedWrite.content
  }

  const fileHandle = await getScopedFileHandle(normalizedFilename, { scope, workspaceName })
  const access = await fileHandle.createSyncAccessHandle()

  try {
    const size = access.getSize()
    const buffer = new Uint8Array(size)
    access.read(buffer, { at: 0 })
    return textDecoder.decode(buffer)
  } finally {
    access.close()
  }
}

async function readBinaryFile(filename, scope = 'sqlite', workspaceName) {
  const normalizedFilename = normalizeFilename(filename)
  const fileHandle = await getScopedFileHandle(normalizedFilename, { scope, workspaceName })
  const access = await fileHandle.createSyncAccessHandle()

  try {
    const size = access.getSize()
    const buffer = new Uint8Array(size)
    access.read(buffer, { at: 0 })
    return buffer.buffer
  } finally {
    access.close()
  }
}

async function listFiles(workspaceName) {
  const workspace = await getScopedDirectory('workspace', workspaceName)
  const filenames = new Set()

  for (const [stagedWriteKey] of stagedWrites) {
    const parsed = parseStagedWriteKey(stagedWriteKey)
    if (parsed.workspaceName === normalizeWorkspaceName(workspaceName)) {
      filenames.add(parsed.filename)
    }
  }

  for await (const [name, handle] of workspace.entries()) {
    if (handle.kind === 'file') {
      filenames.add(name)
    }
  }

  return Array.from(filenames).sort((left, right) => left.localeCompare(right))
}

async function listWorkspaces() {
  const workspacesRoot = await getWorkspacesRootDirectory({ create: true })
  const names = []

  for await (const [name, handle] of workspacesRoot.entries()) {
    if (handle.kind === 'directory') {
      names.push(name)
    }
  }

  return names.sort((left, right) => left.localeCompare(right))
}

async function fileExists(filename, scope = 'workspace', workspaceName) {
  try {
    await getScopedFileHandle(filename, { scope, workspaceName })
    return true
  } catch (error) {
    if (error?.name === 'NotFoundError') {
      return false
    }

    throw error
  }
}

async function deleteFile(filename, scope = 'workspace', workspaceName) {
  const normalizedFilename = normalizeFilename(filename)
  const directory = await getScopedDirectory(scope, workspaceName)
  if (scope === 'workspace') {
    clearScheduledWrite(workspaceName, normalizedFilename)
  }

  try {
    await directory.removeEntry(normalizedFilename)
    return { ok: true, deleted: true }
  } catch (error) {
    if (error?.name === 'NotFoundError') {
      return { ok: true, deleted: false }
    }

    throw error
  }
}

async function renameFile(filename, nextFilename, workspaceName) {
  const normalizedFilename = normalizeFilename(filename)
  const normalizedNextFilename = normalizeFilename(nextFilename)

  if (normalizedFilename === normalizedNextFilename) {
    return { ok: true, filename: normalizedNextFilename }
  }

  const pendingWrite = takeScheduledWrite(workspaceName, normalizedFilename)
  const content = pendingWrite
    ? pendingWrite.content
    : await readFile(normalizedFilename, 'workspace', workspaceName)
  await writeFile(normalizedNextFilename, content, 'workspace', workspaceName)
  await deleteFile(normalizedFilename, 'workspace', workspaceName)

  return {
    ok: true,
    filename: normalizedNextFilename,
  }
}

async function flushStagedWrite(filename, workspaceName) {
  const normalizedWorkspaceName = normalizeWorkspaceName(workspaceName)
  const normalizedFilename = normalizeFilename(filename)
  const pending = getScheduledWrite(normalizedWorkspaceName, normalizedFilename)
  if (!pending) {
    return { ok: true, flushed: false }
  }

  clearTimeout(pending.timer)
  stagedWrites.delete(getStagedWriteKey(normalizedWorkspaceName, normalizedFilename))
  await writeFile(normalizedFilename, pending.content, 'workspace', normalizedWorkspaceName)
  postWriteFlushed(normalizedWorkspaceName, normalizedFilename)
  return { ok: true, flushed: true }
}

async function flushAllStagedWrites() {
  const stagedEntries = Array.from(stagedWrites.entries())
  for (const [stagedWriteKey, pending] of stagedEntries) {
    clearTimeout(pending.timer)
    stagedWrites.delete(stagedWriteKey)

    const { workspaceName, filename } = parseStagedWriteKey(stagedWriteKey)
    await writeFile(filename, pending.content, 'workspace', workspaceName)
    postWriteFlushed(workspaceName, filename)
  }

  return { ok: true, count: stagedEntries.length }
}

function postWriteError(workspaceName, filename, error) {
  self.postMessage({
    type: 'write_error',
    workspaceName,
    filename,
    error: error?.message || String(error),
  })
}

function postWriteFlushed(workspaceName, filename) {
  self.postMessage({
    type: 'write_flushed',
    workspaceName,
    filename,
  })
}

function scheduleWrite(filename, content, workspaceName) {
  const normalizedWorkspaceName = normalizeWorkspaceName(workspaceName)
  const normalizedFilename = normalizeFilename(filename)
  clearScheduledWrite(normalizedWorkspaceName, normalizedFilename)

  const stagedWriteKey = getStagedWriteKey(normalizedWorkspaceName, normalizedFilename)
  const timer = setTimeout(async () => {
    try {
      await queueOperation(async () => {
        const pending = stagedWrites.get(stagedWriteKey)
        if (!pending || pending.timer !== timer) {
          return
        }

        stagedWrites.delete(stagedWriteKey)
        await writeFile(normalizedFilename, pending.content, 'workspace', normalizedWorkspaceName)
        postWriteFlushed(normalizedWorkspaceName, normalizedFilename)
      })
    } catch (error) {
      postWriteError(normalizedWorkspaceName, normalizedFilename, error)
    }
  }, WRITE_DEBOUNCE_MS)

  stagedWrites.set(stagedWriteKey, {
    workspaceName: normalizedWorkspaceName,
    filename: normalizedFilename,
    content: content ?? '',
    timer,
  })

  return { ok: true, queued: true }
}

self.onmessage = async (event) => {
  const {
    id,
    type,
    filename,
    nextFilename,
    content,
    scope,
    workspaceName,
  } = event.data

  try {
    const result = await queueOperation(async () => {
      switch (type) {
        case 'create_workspace':
          return {
            ok: true,
            name: await ensureWorkspace(workspaceName),
          }

        case 'list_workspaces':
          return listWorkspaces()

        case 'write':
          return writeFile(filename, content ?? '', scope ?? 'workspace', workspaceName)

        case 'schedule_write':
          return scheduleWrite(filename, content ?? '', workspaceName)

        case 'read':
          return readFile(filename, scope ?? 'workspace', workspaceName)

        case 'delete':
          return deleteFile(filename, scope ?? 'workspace', workspaceName)

        case 'rename':
          return renameFile(filename, nextFilename, workspaceName)

        case 'write_binary':
          return writeBinaryFile(
            filename,
            content ?? new ArrayBuffer(0),
            scope ?? 'sqlite',
            workspaceName,
          )

        case 'read_binary':
          return readBinaryFile(filename, scope ?? 'sqlite', workspaceName)

        case 'exists':
          return fileExists(filename, scope ?? 'workspace', workspaceName)

        case 'list':
          return listFiles(workspaceName)

        case 'flush':
          return flushStagedWrite(filename, workspaceName)

        case 'flush_all':
          return flushAllStagedWrites()

        default:
          throw new Error(`Unknown I/O worker message type: ${type}`)
      }
    })

    self.postMessage({ id, result })
  } catch (error) {
    self.postMessage({ id, error: error?.message || String(error) })
  }
}
