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
        minWidth: '248px',
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
          borderRadius: '16px',
          border: '1px solid rgba(95, 112, 140, 0.35)',
          background: disabled
            ? 'linear-gradient(180deg, rgba(27, 35, 48, 0.72), rgba(17, 22, 31, 0.72))'
            : 'linear-gradient(180deg, rgba(30, 40, 56, 0.98), rgba(16, 22, 31, 0.98))',
          color: disabled ? '#7a8596' : '#f5f7fb',
          cursor: disabled ? 'not-allowed' : 'pointer',
          boxShadow: isOpen
            ? '0 0 0 1px rgba(120, 190, 255, 0.18), 0 16px 36px rgba(2, 6, 23, 0.38)'
            : '0 12px 28px rgba(2, 6, 23, 0.24)',
          transition: 'transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease',
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
            background: 'linear-gradient(135deg, rgba(91, 169, 255, 0.28), rgba(61, 225, 179, 0.18))',
            border: '1px solid rgba(105, 179, 255, 0.32)',
            color: '#9ed0ff',
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
              color: '#7ee7d8',
              fontSize: '10px',
              fontWeight: 800,
              letterSpacing: '0.18em',
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
            borderRadius: '999px',
            background: 'rgba(97, 117, 149, 0.14)',
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
            borderRadius: '20px',
            border: '1px solid rgba(95, 112, 140, 0.28)',
            background:
              'linear-gradient(180deg, rgba(17, 22, 31, 0.98), rgba(11, 16, 24, 0.98))',
            boxShadow: '0 24px 64px rgba(2, 6, 23, 0.52)',
            backdropFilter: 'blur(20px)',
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
                    borderRadius: '14px',
                    border: isActive
                      ? '1px solid rgba(126, 231, 216, 0.36)'
                      : '1px solid transparent',
                    background: isActive
                      ? 'linear-gradient(135deg, rgba(46, 95, 124, 0.34), rgba(30, 49, 61, 0.44))'
                      : 'rgba(255, 255, 255, 0.02)',
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
                      background: isActive ? '#7ee7d8' : '#4b5d77',
                      boxShadow: isActive ? '0 0 16px rgba(126, 231, 216, 0.42)' : 'none',
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
                        color: isActive ? '#baf7ec' : '#8ea2bf',
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
              background: 'rgba(255, 255, 255, 0.02)',
            }}
          >
            <div
              style={{
                color: '#7ee7d8',
                fontSize: '10px',
                fontWeight: 800,
                letterSpacing: '0.18em',
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
                  borderRadius: '12px',
                  border: '1px solid rgba(95, 112, 140, 0.3)',
                  background: 'rgba(9, 14, 22, 0.88)',
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
                  borderRadius: '12px',
                  border: '1px solid rgba(93, 167, 255, 0.4)',
                  background: isCreating || !draftName.trim()
                    ? 'rgba(34, 53, 79, 0.62)'
                    : 'linear-gradient(135deg, #0e5fd7, #2990ff)',
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
