import { Suspense, useEffect, useMemo } from "react";

function formatDuration(durationMs) {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) {
    return "";
  }

  if (durationMs < 1000) {
    return `${durationMs.toFixed(1)}ms`;
  }

  return `${(durationMs / 1000).toFixed(2)}s`;
}

function formatTimestamp(executedAt) {
  if (!executedAt) {
    return "";
  }

  const date = new Date(executedAt);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatCellValue(value) {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return String(value);
}

function NotebookChip({ tone = "default", children }) {
  const palette = {
    default: {
      color: "var(--ide-shell-text-soft)",
      background: "var(--ide-shell-panel)",
      border: "var(--ide-shell-border)",
    },
    accent: {
      color: "var(--ide-shell-accent)",
      background: "color-mix(in srgb, var(--ide-shell-accent-soft) 80%, transparent)",
      border: "color-mix(in srgb, var(--ide-shell-accent) 24%, transparent)",
    },
    success: {
      color: "var(--ide-shell-success)",
      background: "color-mix(in srgb, var(--ide-shell-success) 14%, transparent)",
      border: "color-mix(in srgb, var(--ide-shell-success) 24%, transparent)",
    },
    warning: {
      color: "var(--ide-shell-warning)",
      background: "color-mix(in srgb, var(--ide-shell-warning) 14%, transparent)",
      border: "color-mix(in srgb, var(--ide-shell-warning) 24%, transparent)",
    },
    danger: {
      color: "var(--ide-shell-danger)",
      background: "color-mix(in srgb, var(--ide-shell-danger) 14%, transparent)",
      border: "color-mix(in srgb, var(--ide-shell-danger) 24%, transparent)",
    },
  };

  const style = palette[tone] || palette.default;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        padding: "3px 8px",
        borderRadius: "999px",
        border: `1px solid ${style.border}`,
        background: style.background,
        color: style.color,
        fontSize: "11px",
        fontWeight: 700,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function NotebookActionButton({ children, onClick, disabled = false, tone = "default", title = "" }) {
  const toneStyles = {
    default: {
      color: "var(--ide-shell-text)",
      border: "var(--ide-shell-border)",
      background: "var(--ide-shell-panel)",
    },
    accent: {
      color: "var(--ide-shell-accent-contrast)",
      border: "color-mix(in srgb, var(--ide-shell-accent) 18%, transparent)",
      background: "var(--ide-shell-accent)",
    },
    danger: {
      color: "var(--ide-shell-danger)",
      border: "color-mix(in srgb, var(--ide-shell-danger) 18%, transparent)",
      background: "var(--ide-shell-panel)",
    },
  };
  const style = toneStyles[tone] || toneStyles.default;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        border: `1px solid ${style.border}`,
        background: style.background,
        color: style.color,
        height: "30px",
        padding: "0 12px",
        borderRadius: "8px",
        fontSize: "12px",
        fontWeight: 700,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {children}
    </button>
  );
}

function NotebookInlineOutput({ cellLabel, result, filename }) {
  const tables = Array.isArray(result?.tables) ? result.tables : [];
  const figures = Array.isArray(result?.figures) ? result.figures : [];
  const stdout = String(result?.stdout ?? "");
  const stderr = String(result?.stderr ?? "");
  const durationLabel = formatDuration(result?.durationMs);
  const executedAtLabel = formatTimestamp(result?.executedAt);

  if (!result) {
    return null;
  }

  return (
    <div
      role="region"
      aria-label={`${cellLabel} output`}
      style={{
        marginTop: "14px",
        borderTop: "1px solid var(--ide-shell-border)",
        paddingTop: "14px",
        display: "grid",
        gap: "12px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
        <div style={{ color: "var(--ide-shell-text)", fontSize: "13px", fontWeight: 700 }}>
          {cellLabel} output
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          {durationLabel ? <NotebookChip tone="accent">{durationLabel}</NotebookChip> : null}
          {figures.length > 0 ? <NotebookChip tone="success">{figures.length} figure{figures.length === 1 ? "" : "s"}</NotebookChip> : null}
          {tables.length > 0 ? <NotebookChip tone="success">{tables.length} table{tables.length === 1 ? "" : "s"}</NotebookChip> : null}
          {result?.error ? <NotebookChip tone="danger">Error</NotebookChip> : <NotebookChip tone="success">Local runtime</NotebookChip>}
        </div>
      </div>

      {executedAtLabel ? (
        <div style={{ color: "var(--ide-shell-muted)", fontSize: "12px" }}>
          Executed on this device at {executedAtLabel}
        </div>
      ) : null}

      {stdout ? (
        <OutputBlock label="stdout" tone="default">
          {stdout}
        </OutputBlock>
      ) : null}

      {stderr ? (
        <OutputBlock label="stderr" tone={result?.error ? "danger" : "warning"}>
          {stderr}
        </OutputBlock>
      ) : null}

      {result?.error && !stderr ? (
        <OutputBlock label="error" tone="danger">
          {result.error}
        </OutputBlock>
      ) : null}

      {tables.map((table) => (
        <div
          key={table.id}
          style={{
            border: "1px solid var(--ide-shell-border)",
            borderRadius: "12px",
            background: "var(--ide-shell-panel-strong)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "12px 14px",
              borderBottom: "1px solid var(--ide-shell-border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "10px",
              flexWrap: "wrap",
            }}
          >
            <div>
              <div role="heading" aria-level={4} style={{ color: "var(--ide-shell-text)", fontSize: "13px", fontWeight: 800 }}>
                DataFrame Preview
              </div>
              <div style={{ color: "var(--ide-shell-muted)", fontSize: "12px", marginTop: "4px" }}>
                {table.title}
              </div>
            </div>
            <NotebookChip tone="success">
              {table.rowCount}x{table.columnCount}
            </NotebookChip>
          </div>

          <div style={{ padding: "14px" }}>
            <div
              style={{
                overflowX: "auto",
                borderRadius: "10px",
                border: "1px solid var(--ide-shell-border)",
                background: "var(--ide-shell-output-bg)",
              }}
            >
              <table
                aria-label={`DataFrame ${table.title}`}
                style={{ width: "100%", minWidth: "420px", borderCollapse: "collapse" }}
              >
                <thead>
                  <tr style={{ background: "var(--ide-shell-panel)" }}>
                    {Array.isArray(table.index) && table.index.length === table.rows.length ? (
                      <th style={tableHeaderStyle}>Index</th>
                    ) : null}
                    {table.columns.map((column) => (
                      <th key={column} style={tableHeaderStyle}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, rowIndex) => (
                    <tr key={`${table.id}-row-${rowIndex}`}>
                      {Array.isArray(table.index) && table.index.length === table.rows.length ? (
                        <td style={tableCellStyle(true)}>{formatCellValue(table.index[rowIndex])}</td>
                      ) : null}
                      {row.map((cell, cellIndex) => (
                        <td key={`${table.id}-${rowIndex}-${cellIndex}`} style={tableCellStyle(false)}>
                          {formatCellValue(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: "10px", color: "var(--ide-shell-muted)", fontSize: "12px" }}>
              Source: {filename}
            </div>
          </div>
        </div>
      ))}

      {figures.map((figure) => (
        <div
          key={figure.id}
          style={{
            border: "1px solid var(--ide-shell-border)",
            borderRadius: "12px",
            background: "var(--ide-shell-panel-strong)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "12px 14px",
              borderBottom: "1px solid var(--ide-shell-border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "10px",
            }}
          >
            <div>
              <div role="heading" aria-level={4} style={{ color: "var(--ide-shell-text)", fontSize: "13px", fontWeight: 800 }}>
                Figure Preview
              </div>
              <div style={{ color: "var(--ide-shell-muted)", fontSize: "12px", marginTop: "4px" }}>
                {figure.id}
              </div>
            </div>
            <NotebookChip tone="success">{figure.format}</NotebookChip>
          </div>

          <div style={{ padding: "14px" }}>
            <div
              style={{
                border: "1px solid var(--ide-shell-border)",
                borderRadius: "10px",
                background: "var(--ide-shell-output-bg)",
                padding: "12px",
              }}
            >
              <img
                src={figure.dataUrl}
                alt={`${figure.id} (${figure.format})`}
                style={{
                  display: "block",
                  width: "100%",
                  maxHeight: "420px",
                  objectFit: "contain",
                  background: "var(--ide-shell-output-bg)",
                }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function OutputBlock({ label, tone = "default", children }) {
  const toneMap = {
    default: {
      border: "var(--ide-shell-border)",
      background: "var(--ide-shell-output-bg)",
      color: "var(--ide-shell-text)",
    },
    warning: {
      border: "color-mix(in srgb, var(--ide-shell-warning) 26%, transparent)",
      background: "color-mix(in srgb, var(--ide-shell-warning) 10%, transparent)",
      color: "var(--ide-shell-text)",
    },
    danger: {
      border: "color-mix(in srgb, var(--ide-shell-danger) 26%, transparent)",
      background: "color-mix(in srgb, var(--ide-shell-danger) 10%, transparent)",
      color: "var(--ide-shell-text)",
    },
  };
  const style = toneMap[tone] || toneMap.default;

  return (
    <div
      style={{
        border: `1px solid ${style.border}`,
        borderRadius: "12px",
        overflow: "hidden",
        background: style.background,
      }}
    >
      <div
        style={{
          padding: "10px 12px",
          borderBottom: `1px solid ${style.border}`,
          color: "var(--ide-shell-muted)",
          fontSize: "11px",
          fontWeight: 800,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <pre
        style={{
          margin: 0,
          padding: "12px",
          color: style.color,
          fontSize: "12px",
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontFamily: '"Cascadia Code", Consolas, monospace',
        }}
      >
        {children}
      </pre>
    </div>
  );
}

function NotebookCell({
  filename,
  index,
  cell,
  selected,
  result,
  isRunning,
  sessionBusy,
  runtimeReady,
  canDelete,
  themeMode,
  EditorComponent,
  onSelect,
  onChange,
  onAddCellAfter,
  onDelete,
  onRun,
}) {
  const cellLabel = `Cell ${index + 1}`;
  const actionsDisabled = sessionBusy || !runtimeReady;
  const preview = useMemo(() => {
    const trimmed = String(cell.source ?? "").trim();
    if (!trimmed) {
      return "# Empty cell";
    }

    return trimmed.split("\n").slice(0, 4).join("\n");
  }, [cell.source]);

  return (
    <section
      role="region"
      aria-label={cellLabel}
      style={{
        border: `1px solid ${selected ? "color-mix(in srgb, var(--ide-shell-accent) 22%, transparent)" : "var(--ide-shell-border)"}`,
        borderRadius: "14px",
        background: "var(--ide-shell-panel-strong)",
        boxShadow: selected ? "inset 2px 0 0 var(--ide-shell-accent)" : "none",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "12px 14px",
          borderBottom: "1px solid var(--ide-shell-border)",
          background: selected ? "color-mix(in srgb, var(--ide-shell-accent-soft) 45%, transparent)" : "var(--ide-shell-panel)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={onSelect}
          style={{
            border: "none",
            background: "transparent",
            padding: 0,
            margin: 0,
            color: "inherit",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <div style={{ color: "var(--ide-shell-text)", fontSize: "14px", fontWeight: 800 }}>
            {cellLabel}
          </div>
          <div style={{ color: "var(--ide-shell-muted)", fontSize: "12px", marginTop: "4px" }}>
            {selected ? "Shared Python state persists until you restart the session." : preview}
          </div>
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          {isRunning ? <NotebookChip tone="warning">Running</NotebookChip> : null}
          <NotebookActionButton onClick={onRun} disabled={actionsDisabled} tone="accent">
            Run cell
          </NotebookActionButton>
          <NotebookActionButton onClick={onAddCellAfter} disabled={actionsDisabled}>
            Add code cell
          </NotebookActionButton>
          <NotebookActionButton onClick={onDelete} disabled={!canDelete || actionsDisabled} tone="danger">
            Delete
          </NotebookActionButton>
        </div>
      </div>

      <div style={{ padding: "14px" }}>
        {selected ? (
          <div role="group" aria-label={`${cellLabel} editor`} style={{ height: "260px", border: "1px solid var(--ide-shell-border)", borderRadius: "12px", overflow: "hidden" }}>
            <Suspense
              fallback={(
                <div
                  style={{
                    height: "100%",
                    display: "grid",
                    placeItems: "center",
                    color: "var(--ide-shell-muted)",
                    fontSize: "12px",
                    background: "var(--ide-shell-editor-bg)",
                  }}
                >
                  Loading cell editor...
                </div>
              )}
            >
              <EditorComponent
                code={cell.source}
                filename={`${filename}:${cell.id}.py`}
                modelPath={`${filename}::${cell.id}.py`}
                onChange={onChange}
                language="python"
                readOnly={actionsDisabled}
                persistDrafts={false}
                themeMode={themeMode}
              />
            </Suspense>
          </div>
        ) : (
          <button
            type="button"
            onClick={onSelect}
            style={{
              width: "100%",
              border: "1px solid var(--ide-shell-border)",
              background: "var(--ide-shell-output-bg)",
              color: "var(--ide-shell-text-soft)",
              borderRadius: "12px",
              padding: "14px 16px",
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            <pre
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontFamily: '"Cascadia Code", Consolas, monospace',
                fontSize: "12px",
                lineHeight: 1.7,
              }}
            >
              {preview}
            </pre>
          </button>
        )}

        <NotebookInlineOutput cellLabel={cellLabel} result={result} filename={filename} />
      </div>
    </section>
  );
}

const tableHeaderStyle = {
  padding: "10px 12px",
  borderBottom: "1px solid var(--ide-shell-border)",
  borderRight: "1px solid var(--ide-shell-border)",
  color: "var(--ide-shell-muted)",
  fontSize: "11px",
  fontWeight: 800,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  textAlign: "left",
};

function tableCellStyle(indexCell = false) {
  return {
    padding: "10px 12px",
    borderBottom: "1px solid var(--ide-shell-border)",
    borderRight: "1px solid var(--ide-shell-border)",
    color: indexCell ? "var(--ide-shell-muted-strong)" : "var(--ide-shell-text)",
    fontSize: "12px",
    whiteSpace: "nowrap",
  };
}

export default function PythonNotebook({
  filename,
  document,
  parseError = "",
  selectedCellId,
  cellResults = {},
  runningCellId = "",
  runAllInProgress = false,
  sessionBusy = false,
  runtimeReady = true,
  themeMode = "night",
  EditorComponent,
  onSelectCell,
  onCellChange,
  onAddCellAfter,
  onDeleteCell,
  onRunCell,
  onRunAll,
  onResetSession,
  onRepair,
}) {
  const cells = Array.isArray(document?.cells) ? document.cells : [];

  useEffect(() => {
    if (!parseError && cells.length > 0 && !selectedCellId) {
      onSelectCell?.(cells[0].id);
    }
  }, [cells, onSelectCell, parseError, selectedCellId]);

  if (parseError) {
    return (
      <div
        style={{
          height: "100%",
          overflowY: "auto",
          background: "var(--ide-shell-editor-bg)",
          padding: "18px",
          display: "grid",
          alignItems: "start",
        }}
      >
        <div
          style={{
            border: "1px solid color-mix(in srgb, var(--ide-shell-danger) 24%, transparent)",
            borderRadius: "16px",
            background: "var(--ide-shell-panel-strong)",
            padding: "20px",
            maxWidth: "740px",
          }}
        >
          <div role="heading" aria-level={2} style={{ color: "var(--ide-shell-text)", fontSize: "20px", fontWeight: 800 }}>
            Python Notebook
          </div>
          <div style={{ marginTop: "8px", color: "var(--ide-shell-muted)", fontSize: "13px", lineHeight: 1.7 }}>
            This notebook file is invalid JSON right now, so WasmForge cannot restore the cells safely.
          </div>
          <div style={{ marginTop: "16px" }}>
            <OutputBlock label="parse error" tone="danger">
              {parseError}
            </OutputBlock>
          </div>
          <div style={{ marginTop: "16px", display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <NotebookActionButton onClick={onRepair} tone="accent">
              Repair notebook
            </NotebookActionButton>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100%",
        overflowY: "auto",
        background: "var(--ide-shell-editor-bg)",
        padding: "18px",
      }}
    >
      <div
        style={{
          border: "1px solid var(--ide-shell-border)",
          borderRadius: "16px",
          background: "var(--ide-shell-panel-strong)",
          padding: "18px",
          display: "grid",
          gap: "16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}>
          <div>
            <div role="heading" aria-level={2} style={{ color: "var(--ide-shell-text)", fontSize: "20px", fontWeight: 800 }}>
              Python Notebook
            </div>
            <div style={{ marginTop: "8px", color: "var(--ide-shell-muted)", fontSize: "13px", lineHeight: 1.7, maxWidth: "620px" }}>
              Run cells against one shared Python session, keep inline tables and figures close to the code, and restart the session whenever you want a clean slate.
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <NotebookChip tone="accent">{cells.length} cell{cells.length === 1 ? "" : "s"}</NotebookChip>
            {!runtimeReady ? <NotebookChip tone="warning">Preparing Python</NotebookChip> : null}
            {runAllInProgress ? <NotebookChip tone="warning">Run all in progress</NotebookChip> : null}
            <NotebookActionButton onClick={onRunAll} disabled={sessionBusy || !runtimeReady} tone="accent">
              Run all cells
            </NotebookActionButton>
            <NotebookActionButton onClick={onResetSession} disabled={sessionBusy || !runtimeReady}>
              Restart Python session
            </NotebookActionButton>
          </div>
        </div>

        <div style={{ display: "grid", gap: "16px" }}>
          {cells.map((cell, index) => (
            <NotebookCell
              key={cell.id}
              filename={filename}
              index={index}
              cell={cell}
              selected={selectedCellId === cell.id || (!selectedCellId && index === 0)}
              result={cellResults[cell.id]}
              isRunning={runningCellId === cell.id}
              sessionBusy={sessionBusy}
              runtimeReady={runtimeReady}
              canDelete={cells.length > 1}
              themeMode={themeMode}
              EditorComponent={EditorComponent}
              onSelect={() => onSelectCell?.(cell.id)}
              onChange={(nextSource) => onCellChange?.(cell.id, nextSource)}
              onAddCellAfter={() => onAddCellAfter?.(cell.id)}
              onDelete={() => onDeleteCell?.(cell.id)}
              onRun={() => onRunCell?.(cell.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
