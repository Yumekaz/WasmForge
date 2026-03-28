import { useEffect, useState } from 'react'
import { getSqlEngineLabel } from '../utils/sqlRuntime.js'
import SchemaInspector from './SchemaInspector.jsx'

function formatCellValue(value) {
  if (value === null || value === undefined) {
    return 'NULL'
  }

  if (typeof value === 'object') {
    return JSON.stringify(value)
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }

  return String(value)
}

function compareValues(left, right) {
  if (left === right) {
    return 0
  }

  if (left === null || left === undefined) {
    return 1
  }

  if (right === null || right === undefined) {
    return -1
  }

  if (typeof left === 'number' && typeof right === 'number') {
    return left - right
  }

  return formatCellValue(left).localeCompare(formatCellValue(right), undefined, {
    numeric: true,
    sensitivity: 'base',
  })
}

function sortRows(rows, sortConfig) {
  if (!sortConfig) {
    return rows
  }

  const { columnIndex, direction } = sortConfig
  const directionMultiplier = direction === 'desc' ? -1 : 1

  return [...rows].sort((left, right) => {
    const result = compareValues(left[columnIndex], right[columnIndex])
    return result * directionMultiplier
  })
}

function ResultTable({ resultSet, sortConfig, onSort }) {
  const sortedRows = sortRows(resultSet.rows, sortConfig)

  return (
    <div
      style={{
        border: '1px solid #2a323b',
        borderRadius: '10px',
        overflow: 'hidden',
        background: '#0d141c',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          padding: '12px 14px',
          borderBottom: '1px solid #21262d',
          background: '#101720',
        }}
      >
        <div>
          <div style={{ color: '#f0f6fc', fontWeight: 700, fontSize: '13px' }}>
            {resultSet.title}
          </div>
          <div style={{ color: '#8b949e', fontSize: '12px', marginTop: '2px' }}>
            {resultSet.rowCount} row{resultSet.rowCount === 1 ? '' : 's'}
            {typeof resultSet.affectedRows === 'number'
              ? ` • ${resultSet.affectedRows} affected`
              : ''}
          </div>
        </div>
        <span
          style={{
            color: resultSet.kind === 'summary' ? '#c8a35a' : '#9db9da',
            background: resultSet.kind === 'summary' ? 'rgba(79, 63, 31, 0.4)' : 'rgba(40, 57, 79, 0.42)',
            border: `1px solid ${resultSet.kind === 'summary' ? 'rgba(138, 110, 63, 0.34)' : 'rgba(109, 133, 163, 0.34)'}`,
            borderRadius: '8px',
            padding: '3px 8px',
            fontSize: '11px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          {resultSet.kind}
        </span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '12px',
            color: '#c9d1d9',
          }}
        >
          <thead>
            <tr>
              {resultSet.columns.map((column, columnIndex) => {
                const isActive = sortConfig?.columnIndex === columnIndex
                const direction = isActive ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↕'

                return (
                  <th
                    key={`${resultSet.id}-${columnIndex}`}
                    onClick={() => onSort(resultSet.id, columnIndex)}
                    style={{
                      position: 'sticky',
                      top: 0,
                      background: '#101720',
                      color: isActive ? '#f0f6fc' : '#8b949e',
                      textAlign: 'left',
                      padding: '10px 12px',
                      borderBottom: '1px solid #21262d',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      fontWeight: 700,
                    }}
                  >
                    <span>{column}</span>
                    <span style={{ marginLeft: '8px', color: isActive ? '#9db9da' : '#6e7681' }}>
                      {direction}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>

          <tbody>
            {sortedRows.map((row, rowIndex) => (
              <tr
                key={`${resultSet.id}-row-${rowIndex}`}
                style={{
                  background: rowIndex % 2 === 0 ? '#0d141c' : '#101821',
                }}
              >
                {resultSet.columns.map((_, columnIndex) => (
                  <td
                    key={`${resultSet.id}-${rowIndex}-${columnIndex}`}
                    style={{
                      padding: '10px 12px',
                      borderBottom: '1px solid #161b22',
                      verticalAlign: 'top',
                      fontFamily:
                        '"Cascadia Code", "Fira Code", "JetBrains Mono", Consolas, monospace',
                      color: '#c9d1d9',
                      minWidth: '120px',
                    }}
                  >
                    {formatCellValue(row[columnIndex])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function SqlResultsPanel({
  activeFile,
  engine,
  result,
  isReady,
  isRunning,
  status,
  schema = null,
}) {
  const [sortState, setSortState] = useState({})
  const engineLabel = result?.engineLabel || getSqlEngineLabel(engine)
  const hasSchema = Boolean(schema?.tables?.length)

  useEffect(() => {
    setSortState({})
  }, [result?.executedAt, result?.filename])

  const handleSort = (resultId, columnIndex) => {
    setSortState((prev) => {
      const current = prev[resultId]
      const nextDirection =
        current?.columnIndex === columnIndex && current.direction === 'asc'
          ? 'desc'
          : 'asc'

      return {
        ...prev,
        [resultId]: {
          columnIndex,
          direction: nextDirection,
        },
      }
    })
  }

  const placeholderMessage = engine === 'sqlite'
    ? `Run ${activeFile || 'a .sql file'} to query a persistent SQLite database stored in the browser.`
    : `Run ${activeFile || 'a .pg file'} to query a persistent PostgreSQL database stored in the browser.`
  const errorTitle = result?.errorMeta?.kind === 'database_state'
    ? 'Database error'
    : result?.errorMeta?.kind === 'runtime'
      ? 'Engine error'
      : result?.errorMeta?.kind === 'persistence'
        ? 'Storage error'
        : result?.errorMeta?.kind === 'busy'
          ? 'Engine busy'
    : result?.errorMeta?.kind === 'killed'
      ? 'Execution stopped'
      : 'Query failed'
  const hasSuccessfulResult = Boolean(result && !result.error)

  return (
    <div
      style={{
        height: '100%',
        overflowY: 'auto',
        background: '#0d141c',
        padding: '16px',
        color: '#c9d1d9',
      }}
    >
      <div
        style={{
          border: '1px solid #2a323b',
          borderRadius: '14px',
          padding: '16px',
          background: '#0f161f',
          marginBottom: '16px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div style={{ color: '#f0f6fc', fontSize: '16px', fontWeight: 800 }}>
              Query Results
            </div>
            <div style={{ color: '#8b949e', fontSize: '12px', marginTop: '4px' }}>
              {status}
            </div>
          </div>

          <span
            style={{
              color: engine === 'sqlite' ? '#9db9da' : '#9ec7a2',
              background: engine === 'sqlite' ? 'rgba(40, 57, 79, 0.42)' : 'rgba(38, 59, 43, 0.44)',
              border: `1px solid ${engine === 'sqlite' ? 'rgba(109, 133, 163, 0.34)' : 'rgba(90, 125, 97, 0.34)'}`,
              borderRadius: '10px',
              padding: '4px 10px',
              fontSize: '11px',
              fontWeight: 800,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            {engineLabel}
          </span>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '10px',
            marginTop: '16px',
          }}
        >
          <InfoTile label="Engine" value={engineLabel} tone={engine === 'sqlite' ? '#9db9da' : '#9ec7a2'} />
          <InfoTile label="File" value={activeFile || 'No SQL file selected'} tone="#c8a35a" />
          <InfoTile
            label="Persistence"
            value="Browser storage (OPFS)"
            tone="#cfa07a"
          />
          <InfoTile
            label="Database"
            value={result?.databaseLabel || 'Created on first run'}
            tone="#aab2c4"
          />
        </div>
      </div>

      {hasSchema ? (
        <SchemaInspector schema={schema} />
      ) : null}

      {!isReady ? (
        <StateCard title="Preparing engine" body={status} tone="#9db9da" />
      ) : null}

      {isRunning ? (
        <StateCard title="Running query" body={`${engineLabel} is executing your SQL.`} tone="#cfa07a" />
      ) : null}

      {result?.recoveryMessage ? (
        <StateCard title="Database recovered" body={result.recoveryMessage} tone="#c8a35a" />
      ) : null}

      {result?.error ? (
        <StateCard title={errorTitle} body={result.error} tone="#ff7b72" />
      ) : null}

      {!result && !isRunning ? (
        <StateCard title="Ready for query" body={placeholderMessage} tone="#8b949e" />
      ) : null}

      {hasSuccessfulResult && result?.durationMs ? (
        <div style={{ color: '#8b949e', fontSize: '12px', marginBottom: '12px' }}>
          Last run finished in {result.durationMs.toFixed(1)}ms.
        </div>
      ) : null}

      {hasSuccessfulResult && engine === 'sqlite' ? (
        <div style={{ color: '#8b949e', fontSize: '12px', marginBottom: '12px' }}>
          {result.restoredFromOpfs
            ? `Restored ${result.databaseLabel} from OPFS before executing this query.`
            : `Created or updated ${result.databaseLabel} and persisted it back to OPFS after execution.`}
        </div>
      ) : null}

      {hasSuccessfulResult && engine === 'pglite' ? (
        <div style={{ color: '#8b949e', fontSize: '12px', marginBottom: '12px' }}>
          {result.recoveryMessage
            ? `PostgreSQL storage was reset and rebuilt for ${result.databaseLabel} before this query completed.`
            : result.restoredFromOpfs
              ? `Restored ${result.databaseLabel} from native OPFS-backed PostgreSQL storage.`
              : `Created or refreshed ${result.databaseLabel} in native OPFS-backed PostgreSQL storage.`}
        </div>
      ) : null}

      <div style={{ display: 'grid', gap: '14px' }}>
        {result?.resultSets?.map((resultSet) => (
          <ResultTable
            key={resultSet.id}
            resultSet={resultSet}
            sortConfig={sortState[resultSet.id]}
            onSort={handleSort}
          />
        ))}
      </div>
    </div>
  )
}

function InfoTile({ label, value, tone }) {
  return (
    <div
      style={{
        border: '1px solid #21262d',
        borderRadius: '10px',
        padding: '12px',
        background: '#0c1219',
      }}
    >
      <div
        style={{
          color: tone,
          fontSize: '11px',
          fontWeight: 800,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginBottom: '6px',
        }}
      >
        {label}
      </div>
      <div style={{ color: '#f0f6fc', fontSize: '13px', fontWeight: 600 }}>
        {value}
      </div>
    </div>
  )
}

function StateCard({ title, body, tone }) {
  return (
    <div
      style={{
        border: `1px solid ${tone}30`,
        borderLeft: `3px solid ${tone}`,
        borderRadius: '10px',
        padding: '14px 16px',
        background: '#0f161f',
        marginBottom: '14px',
      }}
    >
      <div style={{ color: '#f0f6fc', fontSize: '13px', fontWeight: 700 }}>
        {title}
      </div>
      <div style={{ color: '#8b949e', fontSize: '12px', marginTop: '5px', lineHeight: 1.5 }}>
        {body}
      </div>
    </div>
  )
}
