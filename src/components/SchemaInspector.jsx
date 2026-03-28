import { useEffect, useMemo, useState } from 'react'

function normalizeSchema(schema) {
  const tables = Array.isArray(schema?.tables) ? schema.tables : []

  return tables
    .map((table) => ({
      name: String(table?.name || 'unnamed_table'),
      type: String(table?.type || 'table'),
      columns: Array.isArray(table?.columns)
        ? table.columns.map((column) => ({
            name: String(column?.name || 'unnamed_column'),
            type: String(column?.type || 'unknown'),
          }))
        : [],
    }))
    .filter((table) => table.name.length > 0)
}

function Chevron({ open }) {
  return (
    <span
      style={{
        display: 'inline-block',
        transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
        transition: 'transform 160ms ease',
        color: '#8b949e',
        width: '14px',
        textAlign: 'center',
        fontSize: '11px',
      }}
    >
      ▶
    </span>
  )
}

function Pill({ children, tone = 'default' }) {
  const tones = {
    default: {
      color: '#c9d1d9',
      background: '#101720',
      border: '#2a323b',
    },
    accent: {
      color: '#9db9da',
      background: 'rgba(40, 57, 79, 0.42)',
      border: 'rgba(109, 133, 163, 0.34)',
    },
    warm: {
      color: '#c8a35a',
      background: 'rgba(79, 63, 31, 0.4)',
      border: 'rgba(138, 110, 63, 0.34)',
    },
    green: {
      color: '#9ec7a2',
      background: 'rgba(38, 59, 43, 0.44)',
      border: 'rgba(90, 125, 97, 0.34)',
    },
  }

  const style = tones[tone] || tones.default

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '2px 8px',
        borderRadius: '8px',
        color: style.color,
        background: style.background,
        border: `1px solid ${style.border}`,
        fontSize: '11px',
        fontWeight: 700,
        letterSpacing: '0.03em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  )
}

function TreeRow({
  label,
  meta,
  open,
  onToggle,
  tone = 'default',
  indent = 0,
  icon,
  children,
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '10px 12px',
          marginLeft: `${indent * 16}px`,
          border: '1px solid transparent',
          borderRadius: '10px',
          background: open ? 'rgba(95, 112, 140, 0.12)' : 'transparent',
          color: '#c9d1d9',
          cursor: 'pointer',
          textAlign: 'left',
          transition: 'background 160ms ease, border-color 160ms ease',
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.background = open ? 'rgba(95, 112, 140, 0.16)' : 'rgba(17, 22, 29, 0.9)'
          event.currentTarget.style.borderColor = '#21262d'
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.background = open ? 'rgba(95, 112, 140, 0.12)' : 'transparent'
          event.currentTarget.style.borderColor = 'transparent'
        }}
      >
        <Chevron open={open} />
        <span
          style={{
            minWidth: '28px',
            height: '28px',
            display: 'inline-grid',
            placeItems: 'center',
            borderRadius: '8px',
            background: '#11161d',
            border: '1px solid #2a323b',
            color:
              tone === 'accent'
                ? '#9db9da'
                : tone === 'warm'
                  ? '#c8a35a'
                  : tone === 'green'
                    ? '#9ec7a2'
                    : '#8b949e',
            fontSize: '12px',
            fontWeight: 800,
          }}
        >
          {icon}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{
              display: 'block',
              color: '#f0f6fc',
              fontSize: '13px',
              fontWeight: 700,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </span>
          <span
            style={{
              display: 'block',
              color: '#8b949e',
              fontSize: '11px',
              marginTop: '2px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {meta}
          </span>
        </span>
      </button>

      {open ? <div style={{ marginTop: '4px' }}>{children}</div> : null}
    </div>
  )
}

function ColumnRow({ column, indent = 0 }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        marginLeft: `${indent * 16 + 22}px`,
        padding: '8px 12px',
        borderLeft: '1px solid #21262d',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            color: '#c9d1d9',
            fontSize: '13px',
            fontWeight: 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {column.name}
        </div>
        <div style={{ color: '#8b949e', fontSize: '11px', marginTop: '2px' }}>
          Column
        </div>
      </div>

      <Pill tone="default">{column.type}</Pill>
    </div>
  )
}

export default function SchemaInspector({ schema }) {
  const tables = useMemo(() => normalizeSchema(schema), [schema])
  const [expandedTables, setExpandedTables] = useState(() => new Set())

  useEffect(() => {
    if (tables.length === 0) {
      setExpandedTables(new Set())
      return
    }

    setExpandedTables((current) => {
      const next = new Set(current)

      if (next.size === 0) {
        next.add(tables[0].name)
        return next
      }

      for (const table of tables) {
        if (next.has(table.name)) {
          return next
        }
      }

      next.add(tables[0].name)
      return next
    })
  }, [tables])

  const tableCount = tables.length
  const columnCount = tables.reduce((sum, table) => sum + table.columns.length, 0)

  if (tableCount === 0) {
    return (
      <div
        style={{
          border: '1px solid #2a323b',
          borderRadius: '14px',
          background: '#0f161f',
          marginBottom: '16px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '16px',
            borderBottom: '1px solid #21262d',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div style={{ color: '#f0f6fc', fontSize: '15px', fontWeight: 800 }}>
              Schema Inspector
            </div>
            <div style={{ color: '#8b949e', fontSize: '12px', marginTop: '4px' }}>
              Waiting for SQL execution to expose a schema.
            </div>
          </div>
          <Pill tone="accent">Inactive</Pill>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        border: '1px solid #2a323b',
        borderRadius: '14px',
        background: '#0f161f',
        marginBottom: '16px',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '16px',
          borderBottom: '1px solid #21262d',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div style={{ color: '#f0f6fc', fontSize: '15px', fontWeight: 800 }}>
            Schema Inspector
          </div>
          <div style={{ color: '#8b949e', fontSize: '12px', marginTop: '4px' }}>
            Auto-discovered from the latest SQL execution.
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <Pill tone="accent">{tableCount} tables</Pill>
          <Pill tone="warm">{columnCount} columns</Pill>
        </div>
      </div>

      <div style={{ padding: '12px' }}>
        <div
          style={{
            display: 'grid',
            gap: '10px',
          }}
        >
          {tables.map((table) => {
            const open = expandedTables.has(table.name)
            const columnSummary = `${table.columns.length} column${table.columns.length === 1 ? '' : 's'}`

            return (
              <TreeRow
                key={table.name}
                label={table.name}
                meta={columnSummary}
                open={open}
                tone="accent"
                icon={table.type === 'view' ? 'V' : 'T'}
                onToggle={() => {
                  setExpandedTables((current) => {
                    const next = new Set(current)
                    if (next.has(table.name)) {
                      next.delete(table.name)
                    } else {
                      next.add(table.name)
                    }
                    return next
                  })
                }}
              >
                <div
                  style={{
                    marginLeft: '14px',
                    paddingLeft: '12px',
                    borderLeft: '1px solid #21262d',
                    display: 'grid',
                    gap: '6px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '12px',
                      padding: '2px 12px 6px 0',
                    }}
                  >
                    <span style={{ color: '#8b949e', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      Columns
                    </span>
                    <Pill tone={table.type === 'view' ? 'warm' : 'green'}>{table.type}</Pill>
                  </div>

                  {table.columns.length > 0 ? (
                    table.columns.map((column) => (
                      <ColumnRow key={`${table.name}-${column.name}`} column={column} indent={1} />
                    ))
                  ) : (
                    <div
                      style={{
                        marginLeft: '22px',
                        padding: '10px 12px',
                        color: '#8b949e',
                        fontSize: '12px',
                        borderLeft: '1px dashed #30363d',
                      }}
                    >
                      No columns detected for this object.
                    </div>
                  )}
                </div>
              </TreeRow>
            )
          })}
        </div>
      </div>
    </div>
  )
}
