import { useMemo, useState } from "react";

function formatTimestamp(value) {
  if (!value) {
    return "Not saved yet";
  }

  try {
    return new Date(value).toLocaleString();
  } catch {
    return "Unknown time";
  }
}

function statusTone(status) {
  switch (status) {
    case "conflict":
      return {
        color: "var(--ide-shell-danger)",
        surface: "color-mix(in srgb, var(--ide-shell-danger) 10%, var(--ide-shell-panel))",
      };
    case "changed_only_locally":
      return {
        color: "var(--ide-shell-success)",
        surface: "color-mix(in srgb, var(--ide-shell-success) 10%, var(--ide-shell-panel))",
      };
    case "changed_only_on_disk":
      return {
        color: "var(--ide-shell-warning)",
        surface: "color-mix(in srgb, var(--ide-shell-warning) 12%, var(--ide-shell-panel))",
      };
    default:
      return {
        color: "var(--ide-shell-muted)",
        surface: "var(--ide-shell-panel)",
      };
  }
}

function statusLabel(status) {
  switch (status) {
    case "changed_only_locally":
      return "Local only";
    case "changed_only_on_disk":
      return "Disk only";
    case "conflict":
      return "Conflict";
    default:
      return "Unchanged";
  }
}

function surfaceStyle() {
  return {
    border: "1px solid var(--ide-shell-border)",
    borderRadius: "6px",
    background: "var(--ide-shell-panel)",
  };
}

function actionButtonStyle({ tone = "default", disabled = false } = {}) {
  const colors = {
    default: {
      border: "color-mix(in srgb, var(--ide-shell-border-strong) 46%, transparent)",
      background: "var(--ide-shell-panel)",
      color: "var(--ide-shell-text)",
    },
    accent: {
      border: "color-mix(in srgb, var(--ide-shell-accent) 32%, transparent)",
      background: "color-mix(in srgb, var(--ide-shell-accent) 14%, var(--ide-shell-panel))",
      color: "var(--ide-shell-accent)",
    },
    success: {
      border: "color-mix(in srgb, var(--ide-shell-success) 34%, transparent)",
      background: "color-mix(in srgb, var(--ide-shell-success) 14%, var(--ide-shell-panel))",
      color: "var(--ide-shell-success)",
    },
    warning: {
      border: "color-mix(in srgb, var(--ide-shell-warning) 34%, transparent)",
      background: "color-mix(in srgb, var(--ide-shell-warning) 12%, var(--ide-shell-panel))",
      color: "var(--ide-shell-warning)",
    },
    danger: {
      border: "color-mix(in srgb, var(--ide-shell-danger) 34%, transparent)",
      background: "color-mix(in srgb, var(--ide-shell-danger) 12%, var(--ide-shell-panel))",
      color: "var(--ide-shell-danger)",
    },
  };

  const palette = colors[tone] || colors.default;
  return {
    border: `1px solid ${palette.border}`,
    background: palette.background,
    color: palette.color,
    borderRadius: "4px",
    padding: "7px 10px",
    fontSize: "12px",
    fontWeight: 700,
    letterSpacing: "0.03em",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.56 : 1,
  };
}

function SnapshotCard({ snapshot, onRestore, disabled = false }) {
  return (
    <div
      style={{
        ...surfaceStyle(),
        padding: "12px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "14px",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ color: "var(--ide-shell-text)", fontSize: "13px", fontWeight: 700 }}>
          {snapshot.label}
        </div>
        <div style={{ marginTop: "4px", color: "var(--ide-shell-muted)", fontSize: "11px", lineHeight: 1.5 }}>
          {snapshot.fileCount} file{snapshot.fileCount === 1 ? "" : "s"} • {snapshot.reason} • {formatTimestamp(snapshot.createdAt)}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onRestore?.(snapshot.id)}
        disabled={disabled}
        style={actionButtonStyle({ tone: "default", disabled })}
      >
        Restore
      </button>
    </div>
  );
}

export default function AirlockSyncPanel({
  linkedFolderName = "",
  linked = false,
  syncEnabled = false,
  statusText = "",
  lastSyncedAt = 0,
  lastSyncedSnapshot = null,
  snapshots = [],
  reconciliation = null,
  busy = false,
  onLinkFolder,
  onUnlinkFolder,
  onToggleSync,
  onSaveSnapshot,
  onRestoreSnapshot,
  onResolveEntry,
  onCompleteReattach,
}) {
  const [comparePath, setComparePath] = useState("");
  const compareEntry = useMemo(
    () => reconciliation?.entries?.find((entry) => entry.path === comparePath) || null,
    [comparePath, reconciliation?.entries],
  );
  const hasReconciliation = Array.isArray(reconciliation?.entries) && reconciliation.entries.length > 0;

  return (
    <div
      style={{
        height: "100%",
        overflow: "auto",
        background: "var(--ide-shell-output-bg)",
        padding: "18px",
      }}
    >
      <div style={{ display: "grid", gap: "16px", minHeight: "100%" }}>
        <div
          style={{
            ...surfaceStyle(),
            padding: "16px",
            display: "grid",
            gap: "12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "var(--ide-shell-muted)", fontSize: "10px", fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase" }}>
                Airlock Sync
              </div>
              <div style={{ marginTop: "10px", color: "var(--ide-shell-text)", fontSize: "20px", fontWeight: 800 }}>
                {linkedFolderName || "No linked folder"}
              </div>
              <div style={{ marginTop: "6px", color: syncEnabled ? "var(--ide-shell-success)" : "var(--ide-shell-warning)", fontSize: "12px", fontWeight: 700 }}>
                {linked ? (syncEnabled ? "Sync ON" : "Detached local shadow") : "No folder linked"}
              </div>
              <div style={{ marginTop: "8px", color: "var(--ide-shell-muted)", fontSize: "12px", lineHeight: 1.6 }}>
                {statusText || (linked
                  ? "The linked project can be synced back after reconciliation."
                  : "Link a real project folder to mirror it inside WasmForge.")}
              </div>
            </div>

            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" }}>
              {!linked ? (
                <button type="button" onClick={() => onLinkFolder?.()} disabled={busy} style={actionButtonStyle({ tone: "accent", disabled: busy })}>
                  Link Folder
                </button>
              ) : (
                <>
                  <button type="button" onClick={() => onToggleSync?.()} disabled={busy} style={actionButtonStyle({ tone: syncEnabled ? "warning" : "accent", disabled: busy })}>
                    {syncEnabled ? "Turn Sync Off" : "Turn Sync On"}
                  </button>
                  <button type="button" onClick={() => onUnlinkFolder?.()} disabled={busy} style={actionButtonStyle({ tone: "danger", disabled: busy })}>
                    Unlink
                  </button>
                </>
              )}
              <button type="button" onClick={() => onSaveSnapshot?.()} disabled={busy} style={actionButtonStyle({ tone: "default", disabled: busy })}>
                Save Snapshot
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <div style={{ ...surfaceStyle(), padding: "12px", background: "var(--ide-shell-elevated)" }}>
              <div style={{ color: "var(--ide-shell-muted)", fontSize: "10px", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase" }}>
                Last Synced
              </div>
              <div style={{ marginTop: "8px", color: "var(--ide-shell-text)", fontSize: "14px", fontWeight: 700 }}>
                {lastSyncedSnapshot ? formatTimestamp(lastSyncedAt || lastSyncedSnapshot.createdAt) : "No baseline yet"}
              </div>
              <div style={{ marginTop: "6px", color: "var(--ide-shell-muted)", fontSize: "11px" }}>
                {lastSyncedSnapshot ? `${lastSyncedSnapshot.fileCount} tracked files` : "Link and sync once to create a baseline."}
              </div>
            </div>

            <div style={{ ...surfaceStyle(), padding: "12px", background: "var(--ide-shell-elevated)" }}>
              <div style={{ color: "var(--ide-shell-muted)", fontSize: "10px", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase" }}>
                Snapshots
              </div>
              <div style={{ marginTop: "8px", color: "var(--ide-shell-text)", fontSize: "14px", fontWeight: 700 }}>
                {snapshots.length}
              </div>
              <div style={{ marginTop: "6px", color: "var(--ide-shell-muted)", fontSize: "11px" }}>
                Local rollback points for the detached shadow workspace.
              </div>
            </div>

            <div style={{ ...surfaceStyle(), padding: "12px", background: "var(--ide-shell-elevated)" }}>
              <div style={{ color: "var(--ide-shell-muted)", fontSize: "10px", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase" }}>
                Conflict Center
              </div>
              <div style={{ marginTop: "8px", color: "var(--ide-shell-text)", fontSize: "14px", fontWeight: 700 }}>
                {reconciliation?.summary?.conflict || 0} unresolved
              </div>
              <div style={{ marginTop: "6px", color: "var(--ide-shell-muted)", fontSize: "11px" }}>
                Three-way compare between last sync, local shadow, and disk.
              </div>
            </div>
          </div>
        </div>

        {hasReconciliation ? (
          <div style={{ display: "grid", gap: "12px", gridTemplateColumns: compareEntry ? "1.2fr 1fr" : "1fr" }}>
            <div style={{ ...surfaceStyle(), padding: "16px", display: "grid", gap: "10px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                <div>
                  <div style={{ color: "var(--ide-shell-text)", fontSize: "15px", fontWeight: 800 }}>
                    Conflict Center
                  </div>
                  <div style={{ marginTop: "4px", color: "var(--ide-shell-muted)", fontSize: "12px" }}>
                    Resolve the changed files before reattaching sync.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onCompleteReattach?.()}
                  disabled={busy || (reconciliation?.unresolvedCount || 0) > 0}
                  style={actionButtonStyle({ tone: "accent", disabled: busy || (reconciliation?.unresolvedCount || 0) > 0 })}
                >
                  Complete Reattach
                </button>
              </div>

              <div style={{ display: "grid", gap: "8px" }}>
                {reconciliation.entries.map((entry) => {
                  const tone = statusTone(entry.status);
                  return (
                    <div
                      key={entry.path}
                      style={{
                        border: "1px solid var(--ide-shell-border)",
                        borderRadius: "6px",
                        padding: "12px",
                        background: tone.surface,
                        display: "grid",
                        gap: "8px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ color: "var(--ide-shell-text)", fontSize: "13px", fontWeight: 700, fontFamily: '"Cascadia Code", Consolas, monospace' }}>
                            {entry.path}
                          </div>
                          <div style={{ marginTop: "4px", color: tone.color, fontSize: "11px", fontWeight: 700 }}>
                            {statusLabel(entry.status)}
                          </div>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                          {entry.status !== "unchanged" ? (
                            <>
                              <button
                                type="button"
                                onClick={() => onResolveEntry?.(entry.path, "local")}
                                disabled={busy}
                                style={actionButtonStyle({
                                  tone: entry.resolution === "local" ? "success" : "default",
                                  disabled: busy,
                                })}
                              >
                                Keep Local
                              </button>
                              <button
                                type="button"
                                onClick={() => onResolveEntry?.(entry.path, "disk")}
                                disabled={busy}
                                style={actionButtonStyle({
                                  tone: entry.resolution === "disk" ? "warning" : "default",
                                  disabled: busy,
                                })}
                              >
                                Keep Disk
                              </button>
                            </>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => setComparePath(comparePath === entry.path ? "" : entry.path)}
                            style={actionButtonStyle({ tone: comparePath === entry.path ? "accent" : "default" })}
                          >
                            Compare
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {compareEntry ? (
              <div style={{ ...surfaceStyle(), padding: "16px", display: "grid", gap: "10px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                  <div>
                    <div style={{ color: "var(--ide-shell-text)", fontSize: "15px", fontWeight: 800 }}>
                      Compare Versions
                    </div>
                    <div style={{ marginTop: "4px", color: "var(--ide-shell-muted)", fontSize: "11px", fontFamily: '"Cascadia Code", Consolas, monospace' }}>
                      {compareEntry.path}
                    </div>
                  </div>
                  <button type="button" onClick={() => setComparePath("")} style={actionButtonStyle({ tone: "default" })}>
                    Close
                  </button>
                </div>

                {[
                  { label: "Last Synced", value: compareEntry.lastSyncedContent },
                  { label: "Local Shadow", value: compareEntry.localContent },
                  { label: "Disk", value: compareEntry.diskContent },
                ].map((section) => (
                  <div key={section.label} style={{ display: "grid", gap: "6px" }}>
                    <div style={{ color: "var(--ide-shell-muted)", fontSize: "10px", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase" }}>
                      {section.label}
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        minHeight: "120px",
                        maxHeight: "180px",
                        overflow: "auto",
                        padding: "10px",
                        borderRadius: "4px",
                        border: "1px solid var(--ide-shell-border)",
                        background: "var(--ide-shell-editor-bg)",
                        color: "var(--ide-shell-text-soft)",
                        fontSize: "11px",
                        lineHeight: 1.6,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        fontFamily: '"Cascadia Code", Consolas, monospace',
                      }}
                    >
                      {typeof section.value === "string" ? section.value : "(missing)"}
                    </pre>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div style={{ ...surfaceStyle(), padding: "16px", display: "grid", gap: "10px" }}>
          <div>
            <div style={{ color: "var(--ide-shell-text)", fontSize: "15px", fontWeight: 800 }}>
              Local Snapshots
            </div>
            <div style={{ marginTop: "4px", color: "var(--ide-shell-muted)", fontSize: "12px" }}>
              Lightweight rollback points stored for the shadow workspace.
            </div>
          </div>

          {snapshots.length > 0 ? (
            <div style={{ display: "grid", gap: "8px" }}>
              {snapshots.map((snapshot) => (
                <SnapshotCard
                  key={snapshot.id}
                  snapshot={snapshot}
                  disabled={busy}
                  onRestore={onRestoreSnapshot}
                />
              ))}
            </div>
          ) : (
            <div
              style={{
                ...surfaceStyle(),
                padding: "16px",
                color: "var(--ide-shell-muted)",
                fontSize: "12px",
                lineHeight: 1.6,
              }}
            >
              No snapshots yet. WasmForge will create one automatically when you detach sync, and you can save one manually at any time.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
