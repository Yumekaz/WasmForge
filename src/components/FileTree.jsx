import { useEffect, useMemo, useRef, useState } from 'react'

function FileTree({
  files,
  activeFile,
  onFileSelect,
  onNewFile,
  onCreateFile,
  onRenameFile,
  onDeleteFile,
  disabled = false,
}) {
  const [isCreating, setIsCreating] = useState(false)
  const [createName, setCreateName] = useState('')
  const [editingName, setEditingName] = useState(null)
  const [editingValue, setEditingValue] = useState('')
  const [contextMenu, setContextMenu] = useState(null)
  const createInputRef = useRef(null)
  const editInputRef = useRef(null)
  const menuRef = useRef(null)

  const canCreateInline = Boolean(onCreateFile || onNewFile)
  const canRename = Boolean(onRenameFile)
  const canDelete = Boolean(onDeleteFile)

  useEffect(() => {
    if (isCreating) {
      createInputRef.current?.focus()
      createInputRef.current?.select?.()
    }
  }, [isCreating])

  useEffect(() => {
    if (editingName) {
      editInputRef.current?.focus()
      editInputRef.current?.select?.()
    }
  }, [editingName])

  useEffect(() => {
    if (!contextMenu) {
      return undefined
    }

    const closeMenu = () => setContextMenu(null)
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        closeMenu()
      }
    }

    const handlePointerDown = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        closeMenu()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('scroll', closeMenu, true)
    window.addEventListener('resize', closeMenu)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('scroll', closeMenu, true)
      window.removeEventListener('resize', closeMenu)
    }
  }, [contextMenu])

  useEffect(() => {
    if (editingName && !files.some((file) => file.name === editingName)) {
      setEditingName(null)
      setEditingValue('')
    }
  }, [editingName, files])

  const orderedFiles = useMemo(() => {
    return [...files].sort((left, right) => left.name.localeCompare(right.name))
  }, [files])

  const startCreate = () => {
    if (disabled || !canCreateInline) {
      return
    }

    setContextMenu(null)
    setEditingName(null)
    setCreateName('')
    setIsCreating(true)
  }

  const cancelCreate = () => {
    setIsCreating(false)
    setCreateName('')
  }

  const submitCreate = async () => {
    if (disabled) {
      return
    }

    const normalized = normalizeFileName(createName)
    if (!normalized) {
      cancelCreate()
      return
    }

    if (files.some((file) => file.name === normalized)) {
      return
    }

    try {
      if (onCreateFile) {
        await onCreateFile(normalized)
      } else if (onNewFile) {
        onNewFile()
      }
      cancelCreate()
    } catch {
      // Parent owns the side effects; keep the row open on failure.
    }
  }

  const beginRename = (filename) => {
    if (disabled || !canRename) {
      return
    }

    setContextMenu(null)
    setIsCreating(false)
    setCreateName('')
    setEditingName(filename)
    setEditingValue(filename)
  }

  const cancelRename = () => {
    setEditingName(null)
    setEditingValue('')
  }

  const submitRename = async () => {
    if (!editingName || disabled || !canRename) {
      return
    }

    const normalized = normalizeFileName(editingValue)
    if (!normalized || normalized === editingName) {
      cancelRename()
      return
    }

    if (files.some((file) => file.name === normalized && file.name !== editingName)) {
      return
    }

    try {
      await onRenameFile(editingName, normalized)
      cancelRename()
    } catch {
      // Parent owns the side effects; keep the row open on failure.
    }
  }

  const handleDelete = async (filename) => {
    if (disabled || !canDelete) {
      return
    }

    setContextMenu(null)

    try {
      await onDeleteFile(filename)
    } catch {
      // Parent owns the side effects.
    }
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: '#0d141c',
        borderRight: '1px solid #2a323b',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '10px 12px',
          borderBottom: '1px solid #30363d',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          background: '#101720',
        }}
      >
        <div>
          <div
            style={{
              fontSize: '11px',
              fontWeight: 700,
              color: '#8b949e',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            Files
          </div>
          <div style={{ color: '#6e7681', fontSize: '11px', marginTop: '3px' }}>
            {orderedFiles.length} file{orderedFiles.length === 1 ? '' : 's'}
          </div>
        </div>

        <button
          onClick={disabled ? undefined : startCreate}
          title={
            disabled
              ? 'Finish or stop the active session before creating files'
              : 'Create file'
          }
          disabled={disabled || !canCreateInline}
          style={iconButtonStyle(disabled || !canCreateInline)}
        >
          +
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0 10px' }}>
        {isCreating ? (
          <InlineRow
            isActive
            tone="#9db9da"
            leftSlot={<FileGlyph filename={createName || 'new.file'} />}
          >
            <input
              ref={createInputRef}
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void submitCreate()
                }
                if (event.key === 'Escape') {
                  cancelCreate()
                }
              }}
              onBlur={() => {
                if (createName.trim()) {
                  void submitCreate()
                } else {
                  cancelCreate()
                }
              }}
              placeholder="new-file.py"
              spellCheck={false}
              disabled={disabled}
              style={inlineInputStyle}
            />
          </InlineRow>
        ) : null}

        {orderedFiles.length === 0 && !isCreating ? (
          <div
            style={{
              padding: '20px 14px',
              color: '#6e7681',
              fontSize: '12px',
              textAlign: 'center',
              lineHeight: 1.5,
            }}
          >
            No files in this workspace.
            <br />
            Create one to begin.
          </div>
        ) : null}

        {orderedFiles.map((file) => (
          <FileItem
            key={file.name}
            file={file}
            isActive={file.name === activeFile}
            disabled={disabled}
            canRename={canRename}
            canDelete={canDelete}
            isEditing={editingName === file.name}
            editingValue={editingName === file.name ? editingValue : ''}
            onEditValueChange={setEditingValue}
            onRenameStart={() => beginRename(file.name)}
            onRenameCancel={cancelRename}
            onRenameSubmit={() => void submitRename()}
            onDelete={() => void handleDelete(file.name)}
            onSelect={() => onFileSelect(file.name)}
            onContextRequest={(event) => {
              if (disabled) {
                return
              }

              event.preventDefault()
              setIsCreating(false)
              setEditingName(null)
              setEditingValue('')
              setContextMenu({
                file: file.name,
                x: event.clientX,
                y: event.clientY,
              })
            }}
            editInputRef={editingName === file.name ? editInputRef : null}
          />
        ))}
      </div>

      {contextMenu ? (
        <div
          ref={menuRef}
          style={getContextMenuStyle(contextMenu)}
        >
          <MenuItem
            label="Open"
            hint="Enter"
            onClick={() => {
              onFileSelect(contextMenu.file)
              setContextMenu(null)
            }}
          />
          <MenuItem
            label="Rename"
            hint="Double-click"
            disabled={!canRename}
            onClick={() => {
              beginRename(contextMenu.file)
              setContextMenu(null)
            }}
          />
          <MenuItem
            label="Delete"
            hint="Del"
            danger
            disabled={!canDelete}
            onClick={() => void handleDelete(contextMenu.file)}
          />
        </div>
      ) : null}
    </div>
  )
}

function FileItem({
  file,
  isActive,
  disabled = false,
  canRename = false,
  canDelete = false,
  isEditing = false,
  editingValue = '',
  onEditValueChange,
  onRenameStart,
  onRenameCancel,
  onRenameSubmit,
  onDelete,
  onSelect,
  onContextRequest,
  editInputRef,
}) {
  const meta = getFileMeta(file.name)

  return (
    <div
      data-file-row
      onClick={disabled ? undefined : onSelect}
      onDoubleClick={disabled ? undefined : onRenameStart}
      onContextMenu={onContextRequest}
      style={{
        margin: '0 8px 4px',
        padding: '8px 10px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        fontSize: '13px',
        color: disabled ? '#6e7681' : isActive ? '#f0f6fc' : '#c9d1d9',
        background: isActive
          ? 'rgba(95, 112, 140, 0.14)'
          : 'transparent',
        border: `1px solid ${isActive ? 'rgba(118, 132, 153, 0.24)' : 'transparent'}`,
        borderRadius: '12px',
        transition: 'background 0.12s ease, border-color 0.12s ease',
        opacity: disabled ? 0.72 : 1,
      }}
      onMouseEnter={(event) => {
        if (!isActive && !disabled) {
          event.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)'
          event.currentTarget.style.borderColor = 'rgba(139, 148, 158, 0.1)'
        }
      }}
      onMouseLeave={(event) => {
        if (!isActive) {
          event.currentTarget.style.background = 'transparent'
          event.currentTarget.style.borderColor = 'transparent'
        }
      }}
    >
      <FileGlyph filename={file.name} />

      <div style={{ flex: 1, minWidth: 0 }}>
        {isEditing ? (
          <input
            ref={editInputRef}
            value={editingValue}
            onChange={(event) => onEditValueChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                void onRenameSubmit()
              }
              if (event.key === 'Escape') {
                onRenameCancel()
              }
            }}
            onBlur={() => void onRenameSubmit()}
            spellCheck={false}
            disabled={disabled}
            style={inlineInputStyle}
          />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            <div
              style={{
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontWeight: isActive ? 700 : 500,
              }}
              title={file.name}
            >
              {file.name}
            </div>
          </div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          opacity: canRename || canDelete ? 1 : 0.35,
        }}
      >
        <ActionButton
          label="Rename"
          shortcut="R"
          disabled={disabled || !canRename || isEditing}
          onClick={onRenameStart}
        />
        <ActionButton
          label="Delete"
          shortcut="X"
          danger
          disabled={disabled || !canDelete}
          onClick={onDelete}
        />
      </div>
    </div>
  )
}

function FileGlyph({ filename }) {
  const meta = getFileMeta(filename)

  return (
    <div
      aria-hidden="true"
      style={{
        width: '28px',
        height: '28px',
        position: 'relative',
        flexShrink: 0,
        borderRadius: '8px',
        background: '#11161d',
        border: `1px solid ${meta.border}`,
        display: 'grid',
        placeItems: 'center',
        color: meta.color,
        fontSize: meta.glyphFontSize,
        fontWeight: 800,
        letterSpacing: '0.04em',
      }}
    >
      <span style={{ position: 'relative', zIndex: 1 }}>{meta.glyph}</span>
    </div>
  )
}

function ActionButton({ label, shortcut, onClick, disabled = false, danger = false }) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={label}
      style={{
        height: '24px',
        minWidth: '24px',
        padding: '0 8px',
        borderRadius: '8px',
        border: `1px solid ${danger ? 'rgba(248, 81, 73, 0.35)' : 'rgba(139, 148, 158, 0.2)'}`,
        background: danger ? 'rgba(248, 81, 73, 0.06)' : '#11161d',
        color: disabled ? '#6e7681' : danger ? '#ff7b72' : '#c9d1d9',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: '11px',
        fontWeight: 700,
        letterSpacing: '0.02em',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
      }}
    >
      <span>{label}</span>
      <span style={{ opacity: 0.72 }}>{shortcut}</span>
    </button>
  )
}

function MenuItem({ label, hint, onClick, danger = false, disabled = false }) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        padding: '9px 10px',
        border: 'none',
        borderRadius: '8px',
        background: 'transparent',
        color: disabled ? '#6e7681' : danger ? '#ff7b72' : '#c9d1d9',
        cursor: disabled ? 'not-allowed' : 'pointer',
        textAlign: 'left',
        fontSize: '12px',
        fontWeight: 600,
      }}
      onMouseEnter={(event) => {
        if (!disabled) {
          event.currentTarget.style.background = danger ? 'rgba(248, 81, 73, 0.08)' : 'rgba(255, 255, 255, 0.04)'
        }
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = 'transparent'
      }}
    >
      <span>{label}</span>
      <span style={{ color: '#8b949e', fontSize: '10px', fontWeight: 700 }}>{hint}</span>
    </button>
  )
}

function InlineRow({ children, leftSlot, tone = '#9db9da', isActive = false }) {
  return (
    <div
      style={{
        margin: '0 8px 4px',
        padding: '8px 10px',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        borderRadius: '12px',
        border: `1px solid ${isActive ? tone : 'rgba(95, 112, 140, 0.2)'}`,
        background: 'rgba(95, 112, 140, 0.08)',
      }}
    >
      {leftSlot}
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  )
}

function iconButtonStyle(disabled = false) {
  return {
    width: '28px',
    height: '28px',
    borderRadius: '8px',
    border: '1px solid rgba(139, 148, 158, 0.18)',
    background: '#11161d',
    color: disabled ? '#6e7681' : '#c9d1d9',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: '18px',
    lineHeight: 1,
    display: 'grid',
    placeItems: 'center',
  }
}

const inlineInputStyle = {
  width: '100%',
  border: '1px solid rgba(95, 112, 140, 0.26)',
  borderRadius: '8px',
  background: '#0b1118',
  color: '#f0f6fc',
  fontSize: '13px',
  padding: '7px 9px',
  outline: 'none',
  boxSizing: 'border-box',
}

function normalizeFileName(value) {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) {
    return ''
  }

  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return ''
  }

  return trimmed.replace(/^\/?workspace\//u, '')
}

function getFileMeta(filename) {
  const ext = filename.split('.').pop()?.toLowerCase() || ''

  switch (ext) {
    case 'py':
      return {
        badge: 'PY',
        glyph: 'Py',
        color: '#9db9da',
        surface: '#0d2538',
        surfaceDark: '#091a29',
        border: '#536986',
        badgeBackground: 'rgba(88, 166, 255, 0.12)',
        badgeBorder: 'rgba(88, 166, 255, 0.35)',
        glyphFontSize: '11px',
      }
    case 'sql':
      return {
        badge: 'SQL',
        glyph: 'DB',
        color: '#9ec7a2',
        surface: '#0f2e1f',
        surfaceDark: '#0b2318',
        border: '#527258',
        badgeBackground: 'rgba(86, 211, 100, 0.12)',
        badgeBorder: 'rgba(86, 211, 100, 0.35)',
        glyphFontSize: '10px',
      }
    case 'js':
      return {
        badge: 'JS',
        glyph: 'JS',
        color: '#d0ba83',
        surface: '#362708',
        surfaceDark: '#291d06',
        border: '#7a6540',
        badgeBackground: 'rgba(210, 153, 34, 0.12)',
        badgeBorder: 'rgba(210, 153, 34, 0.35)',
        glyphFontSize: '10px',
      }
    case 'ts':
      return {
        badge: 'TS',
        glyph: 'TS',
        color: '#aebdd8',
        surface: '#27143f',
        surfaceDark: '#1d1031',
        border: '#5f6f87',
        badgeBackground: 'rgba(188, 140, 255, 0.12)',
        badgeBorder: 'rgba(188, 140, 255, 0.35)',
        glyphFontSize: '10px',
      }
    case 'pg':
      return {
        badge: 'PG',
        glyph: 'PG',
        color: '#cfa07a',
        surface: '#3a1e08',
        surfaceDark: '#281406',
        border: '#8e6a4f',
        badgeBackground: 'rgba(240, 136, 62, 0.12)',
        badgeBorder: 'rgba(240, 136, 62, 0.35)',
        glyphFontSize: '10px',
      }
    default:
      return {
        badge: 'FILE',
        glyph: '⋯',
        color: '#8b949e',
        surface: '#1a1f29',
        surfaceDark: '#11151b',
        border: '#30363d',
        badgeBackground: 'rgba(139, 148, 158, 0.12)',
        badgeBorder: 'rgba(139, 148, 158, 0.28)',
        glyphFontSize: '11px',
      }
  }
}

function getContextMenuStyle(contextMenu) {
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1024
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 768
  const left = Math.max(8, Math.min(contextMenu.x, viewportWidth - 200))
  const top = Math.max(8, Math.min(contextMenu.y, viewportHeight - 150))

  return {
    position: 'fixed',
    left: `${left}px`,
    top: `${top}px`,
    minWidth: '180px',
    padding: '6px',
    border: '1px solid #2a323b',
    borderRadius: '10px',
    background: '#0f161f',
    boxShadow: '0 14px 30px rgba(1, 4, 9, 0.28)',
    zIndex: 50,
  }
}

export default FileTree
