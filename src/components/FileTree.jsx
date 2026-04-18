import { useEffect, useMemo, useRef, useState } from "react";

function FileTree({
  files,
  activeFile,
  activeWorkspace,
  mode = "explorer",
  searchQuery = "",
  onSearchQueryChange,
  workspaces = [],
  onSelectWorkspace,
  onCreateWorkspace,
  onFileSelect,
  onCreateFile,
  onCreateNotebook,
  onRenameFile,
  onDeleteFile,
  workspaceLocked = false,
  storageLabel = "Stored locally",
  footerLabel = "Saved locally",
  allowNestedPaths = false,
  disabled = false,
}) {
  const [isCreating, setIsCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [editingName, setEditingName] = useState(null);
  const [editingValue, setEditingValue] = useState("");
  const [contextMenu, setContextMenu] = useState(null);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [workspaceDraftName, setWorkspaceDraftName] = useState("");
  const [workspaceFeedback, setWorkspaceFeedback] = useState("");
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState(() => new Set());
  const [showPersistentRowActions, setShowPersistentRowActions] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(pointer: coarse)").matches
      : false,
  );
  const createInputRef = useRef(null);
  const editInputRef = useRef(null);
  const searchInputRef = useRef(null);
  const menuRef = useRef(null);
  const workspaceMenuRef = useRef(null);
  const workspaceButtonRef = useRef(null);

  const orderedFiles = useMemo(
    () => [...files].sort(compareFileEntries),
    [files],
  );
  const fileCount = useMemo(
    () => orderedFiles.filter((file) => (file.kind || "file") === "file").length,
    [orderedFiles],
  );
  const folderCount = useMemo(
    () => orderedFiles.filter((file) => file.kind === "directory").length,
    [orderedFiles],
  );
  const sortedWorkspaces = useMemo(
    () => [...workspaces].sort((left, right) => left.localeCompare(right)),
    [workspaces],
  );
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const visibleFiles = useMemo(() => {
    const normalizedEntries = orderedFiles.map(normalizeFileEntryForTree);
    if (mode !== "search" || !normalizedSearchQuery) {
      return allowNestedPaths
        ? buildFileTreeRows(normalizedEntries, expandedFolders)
        : normalizedEntries;
    }
    return normalizedEntries
      .filter((file) => file.name.toLowerCase().includes(normalizedSearchQuery))
      .map((file) => ({
        ...file,
        depth: allowNestedPaths ? Math.max(0, file.name.split("/").length - 1) : 0,
        displayName: getBasename(file.name),
      }));
  }, [allowNestedPaths, expandedFolders, mode, normalizedSearchQuery, orderedFiles]);

  useEffect(() => {
    if (!allowNestedPaths) {
      setExpandedFolders(new Set());
      return;
    }

    setExpandedFolders((previous) => {
      let changed = false;
      const next = new Set(previous);
      for (const file of files) {
        if (file.kind === "directory" && !next.has(file.name)) {
          next.add(file.name);
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [allowNestedPaths, files]);

  useEffect(() => {
    if (isCreating) {
      createInputRef.current?.focus();
      createInputRef.current?.select?.();
    }
  }, [isCreating]);

  useEffect(() => {
    if (editingName) {
      editInputRef.current?.focus();
      editInputRef.current?.select?.();
    }
  }, [editingName]);

  useEffect(() => {
    if (mode === "search") {
      searchInputRef.current?.focus();
      searchInputRef.current?.select?.();
    }
  }, [mode]);

  useEffect(() => {
    if (!contextMenu && !workspaceMenuOpen) {
      return undefined;
    }

    const closeMenus = (event) => {
      if (workspaceMenuOpen) {
        if (workspaceMenuRef.current?.contains(event.target)) {
          return;
        }
        if (workspaceButtonRef.current?.contains(event.target)) {
          return;
        }
      }

      if (contextMenu && menuRef.current?.contains(event.target)) {
        return;
      }

      setContextMenu(null);
      setWorkspaceMenuOpen(false);
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setContextMenu(null);
        setWorkspaceMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", closeMenus);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", closeMenus);
    window.addEventListener("scroll", closeMenus, true);

    return () => {
      window.removeEventListener("pointerdown", closeMenus);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", closeMenus);
      window.removeEventListener("scroll", closeMenus, true);
    };
  }, [contextMenu, workspaceMenuOpen]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }

    const mediaQuery = window.matchMedia("(pointer: coarse)");
    const syncPointerMode = () => {
      setShowPersistentRowActions(mediaQuery.matches);
    };

    syncPointerMode();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncPointerMode);
      return () => mediaQuery.removeEventListener("change", syncPointerMode);
    }

    mediaQuery.addListener(syncPointerMode);
    return () => mediaQuery.removeListener(syncPointerMode);
  }, []);

  useEffect(() => {
    if (disabled || workspaceLocked) {
      setContextMenu(null);
      setWorkspaceMenuOpen(false);
    }
  }, [disabled, workspaceLocked]);

  useEffect(() => {
    if (editingName && !files.some((file) => file.name === editingName)) {
      setEditingName(null);
      setEditingValue("");
    }
  }, [editingName, files]);

  const openFileMenu = (filename, x, y) => {
    setWorkspaceMenuOpen(false);
    setContextMenu({ file: filename, x, y });
  };

  const handleCreateFile = async () => {
    const normalized = normalizeFileName(createName, { allowNestedPaths });
    if (!normalized) {
      setIsCreating(false);
      setCreateName("");
      return;
    }

    if (files.some((file) => file.name === normalized)) {
      return;
    }

    try {
      await onCreateFile?.(normalized);
      setIsCreating(false);
      setCreateName("");
    } catch {
      // Parent owns error messaging.
    }
  };

  const handleRenameSubmit = async () => {
    const normalized = normalizeFileName(editingValue, { allowNestedPaths });
    if (!editingName || !normalized || normalized === editingName) {
      setEditingName(null);
      setEditingValue("");
      return;
    }

    if (files.some((file) => file.name === normalized && file.name !== editingName)) {
      return;
    }

    try {
      await onRenameFile?.(editingName, normalized);
      setEditingName(null);
      setEditingValue("");
    } catch {
      // Parent owns error messaging.
    }
  };

  const handleWorkspaceCreate = async () => {
    const normalized = normalizeWorkspaceName(workspaceDraftName);
    if (!normalized || isCreatingWorkspace) {
      return;
    }

    setIsCreatingWorkspace(true);
    setWorkspaceFeedback("");

    try {
      await onCreateWorkspace?.(normalized);
      setWorkspaceDraftName("");
      setWorkspaceMenuOpen(false);
    } catch (error) {
      setWorkspaceFeedback(error?.message || String(error));
    } finally {
      setIsCreatingWorkspace(false);
    }
  };

  return (
    <div
      className="wf-file-tree"
      style={{
        width: "100%",
        height: "100%",
        background: "var(--ide-shell-elevated)",
        color: "var(--ide-shell-text)",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <style>
        {`
          .wf-file-tree * {
            box-sizing: border-box;
          }

          .wf-file-tree .wf-sidebar-card,
          .wf-file-tree .wf-file-row,
          .wf-file-tree .wf-create-file-btn,
          .wf-file-tree .wf-workspace-entry {
            transition: border-color 160ms ease, box-shadow 160ms ease, background 160ms ease, opacity 160ms ease;
          }

          .wf-file-tree ::-webkit-scrollbar {
            width: 8px;
          }

          .wf-file-tree ::-webkit-scrollbar-thumb {
            background: color-mix(in srgb, var(--ide-shell-border-strong) 72%, transparent);
            border-radius: 3px;
          }
        `}
      </style>

      <div
        style={{
          padding: "12px 12px 14px",
          borderBottom: "1px solid var(--ide-shell-border)",
          background: "var(--ide-shell-elevated)",
          flexShrink: 0,
          position: "relative",
          zIndex: 2,
        }}
      >
        <div
          style={{
            color: "var(--ide-shell-muted)",
            fontSize: "10px",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            fontWeight: 700,
          }}
        >
          {mode === "search" ? "Search" : "Explorer"}
        </div>

        <div
          className="wf-sidebar-card"
          style={{
            marginTop: "10px",
            padding: "10px 12px 12px",
            border: "1px solid var(--ide-shell-border)",
            borderRadius: "4px",
            background: "var(--ide-shell-panel)",
            display: "grid",
            gap: "10px",
          }}
        >
          <button
            ref={workspaceButtonRef}
            type="button"
            aria-label="Workspace switcher"
            title={workspaceLocked ? `${activeWorkspace} is linked through Airlock` : activeWorkspace}
            disabled={disabled || workspaceLocked}
            onClick={() => {
              if (disabled || workspaceLocked) {
                return;
              }
              setContextMenu(null);
              setWorkspaceFeedback("");
              setWorkspaceMenuOpen((prev) => !prev);
            }}
            style={workspaceCardButtonStyle(disabled || workspaceLocked)}
          >
            <div style={workspaceCardLabelStyle}>Workspace</div>
            <div
              style={{
                marginTop: "6px",
                color: "var(--ide-shell-text)",
                fontSize: "15px",
                fontWeight: 700,
                letterSpacing: "0.01em",
                lineHeight: 1.2,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {activeWorkspace}
            </div>
            <div style={workspaceCardMetaStyle}>
              <span>
                {fileCount} file{fileCount === 1 ? "" : "s"}
              </span>
              {folderCount > 0 ? (
                <>
                  <span style={workspaceCardDotStyle} />
                  <span>{folderCount} folder{folderCount === 1 ? "" : "s"}</span>
                </>
              ) : null}
              <span style={workspaceCardDotStyle} />
              <span>{storageLabel}</span>
            </div>
          </button>

          <button
            className="wf-create-file-btn"
            type="button"
            onClick={() => {
              if (disabled) {
                return;
              }
              setWorkspaceMenuOpen(false);
              setContextMenu(null);
              setEditingName(null);
              setCreateName("");
              setIsCreating(true);
            }}
            disabled={disabled}
            aria-label="Create file"
            title="Create file"
            style={createFileButtonStyle(disabled)}
          >
            <span
              style={{
                width: "18px",
                height: "18px",
                borderRadius: "4px",
                display: "grid",
                placeItems: "center",
                background: "var(--ide-shell-accent-soft)",
                fontSize: "13px",
                lineHeight: 1,
              }}
            >
              +
            </span>
            <span>Create File</span>
          </button>

          <button
            className="wf-create-file-btn"
            type="button"
            onClick={() => {
              if (disabled) {
                return;
              }
              setWorkspaceMenuOpen(false);
              setContextMenu(null);
              setEditingName(null);
              setCreateName("");
              void onCreateNotebook?.();
            }}
            disabled={disabled}
            aria-label="Create notebook"
            title="Create notebook"
            style={createFileButtonStyle(disabled)}
          >
            <span
              style={{
                width: "18px",
                height: "18px",
                borderRadius: "4px",
                display: "grid",
                placeItems: "center",
                background: "var(--ide-shell-accent-soft)",
                fontSize: "10px",
                fontWeight: 800,
                lineHeight: 1,
              }}
            >
              NB
            </span>
            <span>Create Notebook</span>
          </button>
        </div>

        <div
          style={{
            marginTop: "14px",
            color: "var(--ide-shell-muted)",
            fontSize: "10px",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "8px",
          }}
        >
          <span>{mode === "search" ? "Results" : "Files"}</span>
          <span style={{ color: "var(--ide-shell-muted-strong)", fontSize: "9px", letterSpacing: "0.1em" }}>
            {mode === "search"
              ? `${visibleFiles.length} match${visibleFiles.length === 1 ? "" : "es"}`
              : `${fileCount + folderCount} item${fileCount + folderCount === 1 ? "" : "s"}`}
          </span>
        </div>

        {mode === "search" ? (
          <div
            style={{
              marginTop: "10px",
              padding: "12px 12px 10px",
              border: "1px solid var(--ide-shell-border)",
              borderRadius: "4px",
              background: "var(--ide-shell-panel)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <SearchGlyph />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(event) => onSearchQueryChange?.(event.target.value)}
                placeholder="Search files in this workspace"
                spellCheck={false}
                style={searchInputStyle}
              />
            </div>
            <div
              style={{
                marginTop: "8px",
                color: "var(--ide-shell-muted)",
                fontSize: "11px",
                lineHeight: 1.5,
              }}
            >
              {normalizedSearchQuery
                ? `${visibleFiles.length} match${visibleFiles.length === 1 ? "" : "es"} in ${activeWorkspace}`
                : "Filter files by name or extension."}
            </div>
          </div>
        ) : null}

        {workspaceMenuOpen && !workspaceLocked ? (
          <div ref={workspaceMenuRef} style={workspaceMenuStyle}>
            <div style={menuSectionLabelStyle}>Workspaces</div>

            <div style={{ display: "grid", gap: "4px", maxHeight: "164px", overflowY: "auto", paddingRight: "2px" }}>
              {sortedWorkspaces.map((workspaceName) => {
                const isActive = workspaceName === activeWorkspace;
                return (
                  <button
                    className="wf-workspace-entry"
                    key={workspaceName}
                    type="button"
                    onClick={() => {
                      if (!isActive) {
                        onSelectWorkspace?.(workspaceName);
                      }
                      setWorkspaceMenuOpen(false);
                    }}
                    style={workspaceMenuItemStyle(isActive)}
                  >
                    <span
                      style={{
                        width: "8px",
                        height: "2px",
                        borderRadius: "1px",
                        background: isActive ? "var(--ide-shell-accent)" : "var(--ide-shell-muted-strong)",
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {workspaceName}
                    </span>
                  </button>
                );
              })}
            </div>

            <div
              style={{
                borderTop: "1px solid color-mix(in srgb, var(--ide-shell-border-strong) 26%, transparent)",
                marginTop: "10px",
                paddingTop: "10px",
              }}
            >
              <div style={menuSectionLabelStyle}>New Workspace</div>
              <div style={{ display: "flex", gap: "6px" }}>
                <input
                  value={workspaceDraftName}
                  onChange={(event) => {
                    setWorkspaceDraftName(event.target.value);
                    if (workspaceFeedback) {
                      setWorkspaceFeedback("");
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void handleWorkspaceCreate();
                    }
                  }}
                  placeholder="workspace-name"
                  style={workspaceInputStyle}
                />
                <button
                  type="button"
                  onClick={() => {
                    void handleWorkspaceCreate();
                  }}
                  disabled={isCreatingWorkspace || !normalizeWorkspaceName(workspaceDraftName)}
                  style={workspaceCreateButtonStyle(isCreatingWorkspace || !normalizeWorkspaceName(workspaceDraftName))}
                >
                  Add
                </button>
              </div>
              {workspaceFeedback ? (
                <div style={{ marginTop: "8px", color: "var(--ide-shell-danger)", fontSize: "11px", lineHeight: 1.4 }}>
                  {workspaceFeedback}
                </div>
              ) : (
                <div style={{ marginTop: "8px", color: "var(--ide-shell-muted)", fontSize: "11px", lineHeight: 1.4 }}>
                  Keep names short. No slashes.
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "10px 0 14px",
            background: "transparent",
          }}
        >
        {isCreating ? (
          <InlineRow meta={getFileMeta(createName || "new-file.txt")}>
            <input
              ref={createInputRef}
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void handleCreateFile();
                }
                if (event.key === "Escape") {
                  setIsCreating(false);
                  setCreateName("");
                }
              }}
              onBlur={() => {
                if (createName.trim()) {
                  void handleCreateFile();
                } else {
                  setIsCreating(false);
                  setCreateName("");
                }
              }}
              placeholder="new-file.txt"
              spellCheck={false}
              style={inlineInputStyle}
            />
          </InlineRow>
        ) : null}

        {orderedFiles.length === 0 && !isCreating ? (
          <div style={{ padding: "18px 12px", color: "var(--ide-shell-muted)", fontSize: "12px", lineHeight: 1.55 }}>
            Create a file to begin.
            <div style={{ marginTop: "6px", color: "var(--ide-shell-muted-strong)", fontSize: "11px" }}>
              {storageLabel === "Linked real folder"
                ? "Files save directly into the linked folder."
                : storageLabel === "Detached local shadow"
                  ? "Files save into the detached Airlock shadow workspace until you reattach."
                  : "Files and runtime data persist locally."}
            </div>
          </div>
        ) : null}

        {orderedFiles.length > 0 && visibleFiles.length === 0 ? (
          <div style={{ padding: "18px 12px", color: "var(--ide-shell-muted)", fontSize: "12px", lineHeight: 1.55 }}>
            No files match "{searchQuery}".
            <div style={{ marginTop: "6px", color: "var(--ide-shell-muted-strong)", fontSize: "11px" }}>
              Try `main`, `.ts`, `.sql`, or `.pg`.
            </div>
          </div>
        ) : null}

        {visibleFiles.map((file) => (
          <FileItem
            key={file.name}
            file={file}
            isActive={file.name === activeFile}
            disabled={disabled}
            isEditing={editingName === file.name}
            editingValue={editingName === file.name ? editingValue : ""}
            onEditValueChange={setEditingValue}
            onRenameStart={() => {
              if (disabled || file.kind === "directory" || file.supported === false) {
                return;
              }
              setContextMenu(null);
              setEditingName(file.name);
              setEditingValue(file.name);
            }}
            onRenameCancel={() => {
              setEditingName(null);
              setEditingValue("");
            }}
            onRenameSubmit={() => void handleRenameSubmit()}
            onDelete={() => void onDeleteFile?.(file.name)}
            onSelect={() => {
              if (!disabled) {
                onFileSelect(file.name);
              }
            }}
            onFolderToggle={() => {
              if (disabled || file.kind !== "directory") {
                return;
              }
              setExpandedFolders((previous) => {
                const next = new Set(previous);
                if (next.has(file.name)) {
                  next.delete(file.name);
                } else {
                  next.add(file.name);
                }
                return next;
              });
            }}
            onContextRequest={(event) => {
              if (disabled || file.kind === "directory" || file.supported === false) {
                return;
              }
              event.preventDefault();
              openFileMenu(file.name, event.clientX, event.clientY);
            }}
            onMenuOpen={(event) => {
              if (disabled || file.kind === "directory" || file.supported === false) {
                return;
              }
              event.stopPropagation();
              const bounds = event.currentTarget.getBoundingClientRect();
              openFileMenu(file.name, bounds.right - 12, bounds.bottom + 4);
            }}
            editInputRef={editingName === file.name ? editInputRef : null}
            showPersistentActions={showPersistentRowActions}
          />
        ))}
      </div>

      <div
        style={{
          flexShrink: 0,
          padding: "10px 12px 12px",
          borderTop: "1px solid var(--ide-shell-border)",
          background: "var(--ide-shell-elevated)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            color: "var(--ide-shell-muted)",
            fontSize: "11px",
            lineHeight: 1.5,
          }}
        >
          <span style={{ width: "8px", height: "2px", borderRadius: "1px", background: "var(--ide-shell-success)", flexShrink: 0 }} />
          {footerLabel}
        </div>
      </div>

      {contextMenu ? (
        <div ref={menuRef} style={getContextMenuStyle(contextMenu)}>
          <MenuItem
            label="Open"
            onClick={() => {
              onFileSelect(contextMenu.file);
              setContextMenu(null);
            }}
          />
          <MenuItem
            label="Rename"
            onClick={() => {
              setEditingName(contextMenu.file);
              setEditingValue(contextMenu.file);
              setContextMenu(null);
            }}
          />
          <MenuItem
            label="Delete"
            danger
            onClick={() => {
              void onDeleteFile?.(contextMenu.file);
              setContextMenu(null);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function FileItem({
  file,
  isActive,
  disabled,
  isEditing,
  editingValue,
  onEditValueChange,
  onRenameStart,
  onRenameCancel,
  onRenameSubmit,
  onSelect,
  onFolderToggle,
  onContextRequest,
  onMenuOpen,
  editInputRef,
  showPersistentActions = false,
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [hasActionFocus, setHasActionFocus] = useState(false);
  const isDirectory = file.kind === "directory";
  const isUnsupported = file.supported === false && !isDirectory;
  const meta = getFileMeta(file.name, file.kind, file.supported);
  const displayName = file.displayName || getBasename(file.name);

  return (
    <div
      className="wf-file-row"
      onClick={isDirectory ? onFolderToggle : onSelect}
      onDoubleClick={isDirectory ? onFolderToggle : onRenameStart}
      onContextMenu={onContextRequest}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        height: "34px",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: `0 9px 0 ${11 + (file.depth || 0) * 14}px`,
        margin: "0 8px",
        border: "1px solid",
        borderColor: isActive
          ? "color-mix(in srgb, var(--ide-shell-accent) 22%, transparent)"
          : isHovered
            ? "color-mix(in srgb, var(--ide-shell-border-strong) 24%, transparent)"
            : "transparent",
        background: isActive ? "var(--ide-shell-selection)" : isHovered ? "var(--ide-shell-hover)" : "transparent",
        color: isUnsupported
          ? "var(--ide-shell-muted)"
          : isActive
            ? "var(--ide-shell-text)"
            : "var(--ide-shell-text-soft)",
        cursor: disabled ? "default" : "pointer",
        borderRadius: "4px",
        boxShadow: isActive ? "inset 2px 0 0 var(--ide-shell-accent)" : "none",
        transition: "background 160ms ease, border-color 160ms ease, box-shadow 160ms ease",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: "10px",
          color: isDirectory ? "var(--ide-shell-muted)" : "transparent",
          fontSize: "10px",
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        {isDirectory ? (file.isExpanded ? "▾" : "▸") : "•"}
      </span>
      <FileGlyph meta={meta} />

      <div style={{ flex: 1, minWidth: 0 }}>
        {isEditing ? (
          <input
            ref={editInputRef}
            value={editingValue}
            onChange={(event) => onEditValueChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void onRenameSubmit();
              }
              if (event.key === "Escape") {
                onRenameCancel();
              }
            }}
            onBlur={() => void onRenameSubmit()}
            spellCheck={false}
            style={inlineInputStyle}
          />
        ) : (
          <div
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontFamily: '"Cascadia Code", Consolas, monospace',
              fontSize: "12px",
              fontWeight: isDirectory || isActive ? 700 : 600,
              lineHeight: 1,
              color: isUnsupported
                ? "var(--ide-shell-muted)"
                : isActive || isDirectory
                  ? "var(--ide-shell-text)"
                  : "var(--ide-shell-text-soft)",
            }}
            title={file.name}
          >
            {displayName}
          </div>
        )}
      </div>

      {!isDirectory && !isUnsupported ? (
        <button
          className="wf-file-row-action"
          type="button"
          onClick={onMenuOpen}
          onDoubleClick={(event) => event.stopPropagation()}
          onFocus={() => setHasActionFocus(true)}
          onBlur={() => setHasActionFocus(false)}
          style={fileActionButtonStyle(isHovered || isActive || showPersistentActions || hasActionFocus)}
          aria-label={`More actions for ${file.name}`}
          title="More actions"
        >
          ⋯
        </button>
      ) : (
        <span style={{ width: "22px", height: "22px", flexShrink: 0 }} />
      )}
    </div>
  );
}

function MenuItem({ label, onClick, danger = false }) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: "100%",
        border: "none",
        background: hovered ? "var(--ide-shell-hover)" : "transparent",
        color: danger ? "var(--ide-shell-danger)" : "var(--ide-shell-text)",
        textAlign: "left",
        padding: "9px 12px",
        fontSize: "12px",
        cursor: "pointer",
        transition: "background 120ms ease",
      }}
    >
      {label}
    </button>
  );
}

function InlineRow({ meta, children }) {
  return (
    <div
      style={{
        height: "32px",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "0 9px 0 11px",
        margin: "0 8px",
        background: "var(--ide-shell-selection)",
        borderRadius: "4px",
        boxShadow: "inset 2px 0 0 var(--ide-shell-accent)",
      }}
    >
      <FileGlyph meta={meta} />
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

function FileGlyph({ meta }) {
  return (
    <span
      style={{
        width: "20px",
        height: "20px",
        borderRadius: "3px",
        display: "grid",
        placeItems: "center",
        background: meta.surface,
        color: meta.accent,
        fontSize: meta.label.length > 2 ? "7px" : "9px",
        fontWeight: 700,
        letterSpacing: "0.03em",
        flexShrink: 0,
        boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--ide-shell-border-strong) 28%, transparent)",
      }}
      aria-hidden="true"
    >
      {meta.label}
    </span>
  );
}

function SearchGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="6.75" cy="6.75" r="3.75" stroke="var(--ide-shell-muted)" strokeWidth="1.2" />
      <path d="m9.75 9.75 3 3" stroke="var(--ide-shell-muted)" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function normalizeTreePath(value) {
  return String(value ?? "")
    .replace(/^\/?workspace\//u, "")
    .replace(/\\/gu, "/")
    .trim()
    .replace(/^\/+|\/+$/gu, "");
}

function normalizeFileName(value, options = {}) {
  const trimmed = normalizeTreePath(value);
  if (!trimmed) {
    return "";
  }
  if (!options.allowNestedPaths && trimmed.includes("/")) {
    return "";
  }
  if (trimmed.split("/").some((part) => !part || part === "." || part === "..")) {
    return "";
  }
  return trimmed;
}

function normalizeWorkspaceName(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed || trimmed.includes("/") || trimmed.includes("\\")) {
    return "";
  }
  return trimmed;
}

function getBasename(path) {
  return normalizeTreePath(path).split("/").filter(Boolean).pop() || path;
}

function normalizeFileEntryForTree(file) {
  const kind = file.kind || "file";
  return {
    ...file,
    kind,
    supported: file.supported ?? kind === "file",
    displayName: getBasename(file.name),
    depth: 0,
  };
}

function compareFileEntries(left, right) {
  const leftKind = left.kind || "file";
  const rightKind = right.kind || "file";
  const leftParent = normalizeTreePath(left.name).split("/").slice(0, -1).join("/");
  const rightParent = normalizeTreePath(right.name).split("/").slice(0, -1).join("/");

  if (leftParent !== rightParent) {
    return leftParent.localeCompare(rightParent);
  }
  if (leftKind !== rightKind) {
    return leftKind === "directory" ? -1 : 1;
  }
  return getBasename(left.name).localeCompare(getBasename(right.name));
}

function buildFileTreeRows(entries, expandedFolders) {
  const nodes = new Map();
  const rootChildren = [];

  const ensureDirectoryNode = (path) => {
    const normalizedPath = normalizeTreePath(path);
    if (!normalizedPath) {
      return null;
    }

    if (nodes.has(normalizedPath)) {
      return nodes.get(normalizedPath);
    }

    const parentPath = normalizedPath.split("/").slice(0, -1).join("/");
    const node = {
      entry: {
        name: normalizedPath,
        kind: "directory",
        supported: false,
      },
      children: [],
    };
    nodes.set(normalizedPath, node);

    const parent = parentPath ? ensureDirectoryNode(parentPath) : null;
    if (parent) {
      parent.children.push(node);
    } else {
      rootChildren.push(node);
    }

    return node;
  };

  for (const entry of entries) {
    const normalizedName = normalizeTreePath(entry.name);
    if (!normalizedName) {
      continue;
    }

    if (entry.kind === "directory") {
      const directoryNode = ensureDirectoryNode(normalizedName);
      directoryNode.entry = {
        ...directoryNode.entry,
        ...entry,
        name: normalizedName,
        kind: "directory",
        supported: false,
      };
      continue;
    }

    const parentPath = normalizedName.split("/").slice(0, -1).join("/");
    const parent = parentPath ? ensureDirectoryNode(parentPath) : null;
    const fileNode = {
      entry: {
        ...entry,
        name: normalizedName,
        kind: "file",
      },
      children: [],
    };

    if (parent) {
      parent.children.push(fileNode);
    } else {
      rootChildren.push(fileNode);
    }
  }

  const sortChildren = (children) => {
    children.sort((left, right) => compareFileEntries(left.entry, right.entry));
    children.forEach((child) => sortChildren(child.children));
  };
  sortChildren(rootChildren);

  const rows = [];
  const flatten = (children, depth) => {
    for (const node of children) {
      const isDirectory = node.entry.kind === "directory";
      const isExpanded = expandedFolders.has(node.entry.name);
      rows.push({
        ...node.entry,
        depth,
        displayName: getBasename(node.entry.name),
        hasChildren: node.children.length > 0,
        isExpanded,
      });

      if (isDirectory && isExpanded) {
        flatten(node.children, depth + 1);
      }
    }
  };

  flatten(rootChildren, 0);
  return rows;
}

function getFileMeta(filename, kind = "file", supported = true) {
  if (kind === "directory") {
    return { label: "DIR", accent: "var(--ide-file-ts-accent)", surface: "var(--ide-file-ts-surface)", kind };
  }

  if (supported === false) {
    return { label: "BIN", accent: "var(--ide-shell-muted)", surface: "var(--ide-shell-hover)", kind };
  }

  const basename = getBasename(filename);
  const extension = basename.split(".").pop()?.toLowerCase() || "";

  switch (extension) {
    case "c":
    case "h":
      return { label: "C", accent: "var(--ide-file-ts-accent)", surface: "var(--ide-file-ts-surface)" };
    case "cc":
    case "cpp":
    case "cxx":
    case "hh":
    case "hpp":
    case "hxx":
      return { label: "C++", accent: "var(--ide-file-js-accent)", surface: "var(--ide-file-js-surface)" };
    case "go":
      return { label: "GO", accent: "var(--ide-file-ts-accent)", surface: "var(--ide-file-ts-surface)" };
    case "java":
      return { label: "JV", accent: "var(--ide-file-pg-accent)", surface: "var(--ide-file-pg-surface)" };
    case "py":
      return { label: "PY", accent: "var(--ide-file-py-accent)", surface: "var(--ide-file-py-surface)" };
    case "js":
      return { label: "JS", accent: "var(--ide-file-js-accent)", surface: "var(--ide-file-js-surface)" };
    case "rs":
      return { label: "RS", accent: "var(--ide-file-pg-accent)", surface: "var(--ide-file-pg-surface)" };
    case "ts":
      return { label: "TS", accent: "var(--ide-file-ts-accent)", surface: "var(--ide-file-ts-surface)" };
    case "sql":
      return { label: "SQL", accent: "var(--ide-file-sql-accent)", surface: "var(--ide-file-sql-surface)" };
    case "pg":
      return { label: "PG", accent: "var(--ide-file-pg-accent)", surface: "var(--ide-file-pg-surface)" };
    case "wfnb":
      return { label: "NB", accent: "var(--ide-file-py-accent)", surface: "var(--ide-file-py-surface)" };
    case "zig":
      return { label: "ZG", accent: "var(--ide-file-sql-accent)", surface: "var(--ide-file-sql-surface)" };
    default:
      return { label: "TXT", accent: "var(--ide-file-txt-accent)", surface: "var(--ide-file-txt-surface)" };
  }
}

function getContextMenuStyle(contextMenu) {
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1024;
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 768;
  const left = Math.max(8, Math.min(contextMenu.x, viewportWidth - 176));
  const top = Math.max(8, Math.min(contextMenu.y, viewportHeight - 120));

  return {
    position: "fixed",
    left: `${left}px`,
    top: `${top}px`,
    minWidth: "160px",
    border: "1px solid var(--ide-shell-border)",
    background: "var(--ide-shell-elevated)",
    boxShadow: "0 16px 30px rgba(0, 0, 0, 0.34)",
    zIndex: 40,
    padding: "6px 0",
    borderRadius: "4px",
  };
}

const menuSectionLabelStyle = {
  color: "var(--ide-shell-text-soft)",
  fontSize: "10px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.14em",
  marginBottom: "8px",
};

const inlineInputStyle = {
  width: "100%",
  border: "1px solid color-mix(in srgb, var(--ide-shell-accent) 28%, transparent)",
  background: "var(--ide-shell-editor-bg)",
  color: "var(--ide-shell-text)",
  fontFamily: '"Cascadia Code", Consolas, monospace',
  fontSize: "12px",
  padding: "5px 8px",
  outline: "none",
  boxSizing: "border-box",
  borderRadius: "3px",
};

const searchInputStyle = {
  flex: 1,
  minWidth: 0,
  border: "none",
  background: "transparent",
  color: "var(--ide-shell-text)",
  fontSize: "12px",
  outline: "none",
  padding: 0,
};

const workspaceMenuStyle = {
  position: "absolute",
  top: "144px",
  left: "8px",
  right: "8px",
  border: "1px solid var(--ide-shell-border)",
  background: "var(--ide-shell-elevated)",
  boxShadow: "0 16px 30px rgba(0, 0, 0, 0.34)",
  padding: "12px",
  zIndex: 30,
  borderRadius: "4px",
};

function workspaceCardButtonStyle(disabled = false) {
  return {
    width: "100%",
    border: "none",
    background: "transparent",
    color: "var(--ide-shell-text)",
    padding: "0",
    textAlign: "left",
    cursor: disabled ? "default" : "pointer",
    display: "grid",
    gap: "8px",
    borderRadius: "4px",
    opacity: disabled ? 0.8 : 1,
  };
}

const workspaceCardLabelStyle = {
  color: "var(--ide-shell-muted)",
  fontSize: "10px",
  textTransform: "uppercase",
  letterSpacing: "0.16em",
  fontWeight: 700,
};

const workspaceCardMetaStyle = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  color: "var(--ide-shell-muted)",
  fontSize: "10px",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const workspaceCardDotStyle = {
  width: "6px",
  height: "2px",
  borderRadius: "1px",
  background: "var(--ide-shell-muted-strong)",
  flexShrink: 0,
};

function createFileButtonStyle(disabled = false) {
  return {
    width: "100%",
    height: "34px",
    border: disabled
      ? "1px solid var(--ide-shell-border)"
      : "1px solid color-mix(in srgb, var(--ide-shell-accent) 18%, transparent)",
    background: disabled ? "var(--ide-shell-panel)" : "var(--ide-shell-hover)",
    color: disabled ? "var(--ide-shell-muted)" : "var(--ide-shell-text)",
    cursor: disabled ? "default" : "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    borderRadius: "3px",
    fontSize: "12px",
    fontWeight: 700,
    letterSpacing: "0.04em",
  };
}

const workspaceInputStyle = {
  flex: 1,
  minWidth: 0,
  border: "1px solid var(--ide-shell-border)",
  background: "var(--ide-shell-editor-bg)",
  color: "var(--ide-shell-text)",
  fontSize: "12px",
  padding: "8px 10px",
  outline: "none",
  borderRadius: "4px",
};

function workspaceCreateButtonStyle(disabled = false) {
  return {
    border: "1px solid color-mix(in srgb, var(--ide-shell-accent) 18%, transparent)",
    background: disabled ? "var(--ide-shell-hover)" : "var(--ide-shell-accent)",
    color: "var(--ide-shell-accent-contrast)",
    padding: "0 12px",
    fontSize: "12px",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.7 : 1,
    borderRadius: "3px",
    fontWeight: 700,
  };
}

function workspaceToggleButtonStyle(disabled = false) {
  return {
    flex: 1,
    minWidth: 0,
    border: "none",
    background: "transparent",
    color: "var(--ide-shell-text)",
    padding: "2px 0 4px",
    textAlign: "left",
    display: "flex",
    alignItems: "flex-start",
    gap: "9px",
    cursor: disabled ? "default" : "pointer",
  };
}

function workspaceMenuItemStyle(active = false) {
  return {
    height: "30px",
    border: `1px solid ${active ? "color-mix(in srgb, var(--ide-shell-accent) 18%, transparent)" : "transparent"}`,
    background: active ? "var(--ide-shell-selection)" : "transparent",
    color: active ? "var(--ide-shell-text)" : "var(--ide-shell-text-soft)",
    textAlign: "left",
    padding: "0 10px",
    cursor: "pointer",
    fontSize: "12px",
    borderRadius: "3px",
    display: "flex",
    alignItems: "center",
    gap: "8px",
  };
}

function headerIconButtonStyle(disabled = false) {
  return {
    width: "24px",
    height: "24px",
    border: "1px solid color-mix(in srgb, var(--ide-shell-border-strong) 24%, transparent)",
    background: "color-mix(in srgb, var(--ide-shell-panel) 88%, transparent)",
    color: disabled ? "var(--ide-shell-muted-strong)" : "var(--ide-shell-text-soft)",
    cursor: disabled ? "default" : "pointer",
    fontSize: "16px",
    lineHeight: 1,
    padding: 0,
    borderRadius: "4px",
    flexShrink: 0,
  };
}

function fileActionButtonStyle(visible = false) {
  return {
    width: "22px",
    height: "22px",
    border: "1px solid color-mix(in srgb, var(--ide-shell-border-strong) 18%, transparent)",
    background: visible ? "var(--ide-shell-hover)" : "transparent",
    color: "var(--ide-shell-muted)",
    cursor: "pointer",
    opacity: visible ? 1 : 0.34,
    transition: "opacity 120ms ease, background 120ms ease",
    flexShrink: 0,
    borderRadius: "3px",
    outline: "none",
  };
}

export default FileTree;
