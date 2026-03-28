import { useEffect, useMemo, useRef, useState } from 'react'

function formatWorkspaceCount(count) {
  if (count === 1) {
    return '1 workspace'
  }

  return `${count} workspaces`
}

export default function WorkspaceSwitcher({
  workspaces,
  activeWorkspace,
  onSelectWorkspace,
  onCreateWorkspace,
  disabled = false,
  fullWidth = false,
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [feedback, setFeedback] = useState('')
  const containerRef = useRef(null)
  const sortedWorkspaces = useMemo(
    () => [...workspaces].sort((left, right) => left.localeCompare(right)),
    [workspaces],
  )

  useEffect(() => {
    if (disabled && isOpen) {
      setIsOpen(false)
    }
  }, [disabled, isOpen])

  useEffect(() => {
    if (!isOpen) {
      return undefined
    }

    const handlePointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) {
        setIsOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [isOpen])

  const handleCreate = async () => {
    if (!draftName.trim() || isCreating) {
      return
    }

    setIsCreating(true)
    setFeedback('')

    try {
      await onCreateWorkspace?.(draftName)
      setDraftName('')
      setFeedback('')
      setIsOpen(false)
    } catch (error) {
      setFeedback(error?.message || String(error))
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        minWidth: fullWidth ? 0 : '248px',
        width: fullWidth ? '100%' : 'auto',
      }}
    >
      <button
        type="button"
        onClick={() => {
          if (!disabled) {
            setIsOpen((prev) => !prev)
            setFeedback('')
          }
        }}
        disabled={disabled}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '10px 14px',
          borderRadius: '12px',
          border: '1px solid rgba(95, 112, 140, 0.2)',
          background: disabled
            ? '#151c25'
            : '#0f161f',
          color: disabled ? '#7a8596' : '#f5f7fb',
          cursor: disabled ? 'not-allowed' : 'pointer',
          boxShadow: isOpen
            ? '0 0 0 1px rgba(120, 190, 255, 0.1), 0 10px 24px rgba(2, 6, 23, 0.22)'
            : 'none',
          transition: 'box-shadow 140ms ease, border-color 140ms ease',
          textAlign: 'left',
        }}
      >
        <div
          style={{
            width: '34px',
            height: '34px',
            borderRadius: '12px',
            display: 'grid',
            placeItems: 'center',
            background: '#131c27',
            border: '1px solid rgba(95, 112, 140, 0.22)',
            color: '#b9c7d8',
            fontSize: '14px',
            fontWeight: 800,
            letterSpacing: '0.08em',
            flexShrink: 0,
          }}
        >
          WS
        </div>

        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              color: '#8ea2bf',
              fontSize: '10px',
              fontWeight: 800,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
            }}
          >
            Active Workspace
          </div>
          <div
            style={{
              color: '#f5f7fb',
              fontSize: '14px',
              fontWeight: 700,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              marginTop: '4px',
            }}
          >
            {activeWorkspace}
          </div>
        </div>

        <div
          style={{
            color: '#8ea2bf',
            fontSize: '11px',
            fontWeight: 700,
            padding: '5px 8px',
            borderRadius: '8px',
            background: '#131c27',
            border: '1px solid rgba(97, 117, 149, 0.18)',
            flexShrink: 0,
          }}
        >
          {formatWorkspaceCount(sortedWorkspaces.length)}
        </div>
      </button>

      {isOpen ? (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 10px)',
            left: 0,
            width: '100%',
            borderRadius: '14px',
            border: '1px solid rgba(95, 112, 140, 0.2)',
            background: '#0f161f',
            boxShadow: '0 18px 40px rgba(2, 6, 23, 0.32)',
            overflow: 'hidden',
            zIndex: 30,
          }}
        >
          <div
            style={{
              padding: '14px 16px 10px',
              borderBottom: '1px solid rgba(95, 112, 140, 0.18)',
            }}
          >
            <div
              style={{
                color: '#f5f7fb',
                fontSize: '13px',
                fontWeight: 800,
              }}
            >
              Workspaces
            </div>
            <div
              style={{
                color: '#8ea2bf',
                fontSize: '12px',
                marginTop: '4px',
                lineHeight: 1.45,
              }}
            >
              Each workspace keeps its own files and database state.
            </div>
          </div>

          <div
            style={{
              maxHeight: '248px',
              overflowY: 'auto',
              padding: '8px',
              display: 'grid',
              gap: '6px',
            }}
          >
            {sortedWorkspaces.map((workspaceName) => {
              const isActive = workspaceName === activeWorkspace

              return (
                <button
                  key={workspaceName}
                  type="button"
                  onClick={() => {
                    if (!isActive) {
                      onSelectWorkspace?.(workspaceName)
                    }
                    setIsOpen(false)
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    width: '100%',
                    padding: '11px 12px',
                    borderRadius: '10px',
                    border: isActive
                      ? '1px solid rgba(118, 132, 153, 0.28)'
                      : '1px solid transparent',
                    background: isActive
                      ? 'rgba(95, 112, 140, 0.14)'
                      : 'transparent',
                    color: '#f5f7fb',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <div
                    style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '999px',
                      background: isActive ? '#8ea2bf' : '#4b5d77',
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontSize: '13px',
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {workspaceName}
                    </div>
                    <div
                      style={{
                        color: isActive ? '#b7c3d1' : '#8ea2bf',
                        fontSize: '11px',
                        marginTop: '2px',
                      }}
                    >
                      {isActive ? 'Current workspace' : 'Open this workspace'}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          <div
            style={{
              padding: '12px',
              borderTop: '1px solid rgba(95, 112, 140, 0.18)',
              background: '#101720',
            }}
          >
            <div
              style={{
                color: '#8ea2bf',
                fontSize: '10px',
                fontWeight: 800,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                marginBottom: '8px',
              }}
            >
              New Workspace
            </div>
            <div
              style={{
                display: 'flex',
                gap: '8px',
              }}
            >
              <input
                value={draftName}
                onChange={(event) => {
                  setDraftName(event.target.value)
                  if (feedback) {
                    setFeedback('')
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void handleCreate()
                  }
                }}
                placeholder="sql-practice"
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: '11px 12px',
                  borderRadius: '10px',
                  border: '1px solid rgba(95, 112, 140, 0.24)',
                  background: '#0b1118',
                  color: '#f5f7fb',
                  fontSize: '13px',
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={() => {
                  void handleCreate()
                }}
                disabled={isCreating || !draftName.trim()}
                style={{
                  padding: '0 14px',
                  borderRadius: '10px',
                  border: '1px solid rgba(84, 116, 151, 0.36)',
                  background: isCreating || !draftName.trim()
                    ? '#18202a'
                    : '#214967',
                  color: '#f5f7fb',
                  fontSize: '12px',
                  fontWeight: 800,
                  cursor: isCreating || !draftName.trim() ? 'not-allowed' : 'pointer',
                  letterSpacing: '0.04em',
                }}
              >
                Create
              </button>
            </div>
            <div
              style={{
                color: feedback ? '#ff8b8b' : '#8ea2bf',
                fontSize: '11px',
                minHeight: '16px',
                marginTop: '8px',
              }}
            >
              {feedback || 'Use a short name. Slashes are not allowed.'}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
