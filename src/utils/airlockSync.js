const SNAPSHOT_VERSION = 1;

function normalizePath(value) {
  const normalized = String(value ?? "")
    .replace(/\\/gu, "/")
    .trim()
    .replace(/^\/+|\/+$/gu, "");

  if (!normalized) {
    return "";
  }

  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) {
    throw new Error("Airlock paths must stay inside the linked workspace.");
  }

  return parts.join("/");
}

export function createTextHash(value = "") {
  const text = String(value ?? "");
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function normalizeSnapshotEntries(entries) {
  if (!entries) {
    return {};
  }

  const asEntries = Array.isArray(entries)
    ? entries.map((entry) => [entry?.path ?? entry?.name, entry?.content])
    : Object.entries(entries);

  return Object.fromEntries(
    asEntries
      .map(([path, content]) => [normalizePath(path), typeof content === "string" ? content : String(content ?? "")])
      .filter(([path]) => Boolean(path))
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function createSnapshotRecord({
  id,
  label = "Snapshot",
  reason = "manual",
  source = "local",
  linkedFolderName = "",
  files = {},
  createdAt = Date.now(),
} = {}) {
  const normalizedFiles = normalizeSnapshotEntries(files);
  const fileEntries = Object.entries(normalizedFiles);
  const contentHash = createTextHash(
    fileEntries.map(([path, content]) => `${path}\n${content}`).join("\n---\n"),
  );

  return {
    version: SNAPSHOT_VERSION,
    id: String(id || `${createdAt}-${contentHash}`).trim(),
    label: String(label || "Snapshot").trim() || "Snapshot",
    reason: String(reason || "manual").trim() || "manual",
    source: String(source || "local").trim() || "local",
    linkedFolderName: String(linkedFolderName || "").trim(),
    createdAt: Number.isFinite(createdAt) ? Number(createdAt) : Date.now(),
    fileCount: fileEntries.length,
    contentHash,
    files: normalizedFiles,
  };
}

export function serializeSnapshotRecord(snapshot) {
  return JSON.stringify(createSnapshotRecord(snapshot));
}

export function deserializeSnapshotRecord(rawValue) {
  if (!rawValue) {
    return null;
  }

  try {
    return createSnapshotRecord(JSON.parse(rawValue));
  } catch {
    return null;
  }
}

export function serializeSnapshotCollection(collection = []) {
  const snapshots = Array.isArray(collection)
    ? collection.map((snapshot) => createSnapshotRecord(snapshot))
    : [];

  return JSON.stringify({
    version: SNAPSHOT_VERSION,
    snapshots,
  });
}

export function deserializeSnapshotCollection(rawValue) {
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue);
    const snapshots = Array.isArray(parsed?.snapshots) ? parsed.snapshots : [];
    return snapshots
      .map((snapshot) => createSnapshotRecord(snapshot))
      .sort((left, right) => right.createdAt - left.createdAt);
  } catch {
    return [];
  }
}

function buildComparedEntry(path, lastSyncedContent, localContent, diskContent) {
  const lastHash = lastSyncedContent === null ? "" : createTextHash(lastSyncedContent);
  const localHash = localContent === null ? "" : createTextHash(localContent);
  const diskHash = diskContent === null ? "" : createTextHash(diskContent);

  const localChanged = localHash !== lastHash;
  const diskChanged = diskHash !== lastHash;
  const localMatchesDisk = localHash === diskHash;

  let status = "unchanged";
  if (localChanged && diskChanged && !localMatchesDisk) {
    status = "conflict";
  } else if (localChanged && !diskChanged) {
    status = "changed_only_locally";
  } else if (!localChanged && diskChanged) {
    status = "changed_only_on_disk";
  }

  return {
    path,
    status,
    lastSyncedContent,
    localContent,
    diskContent,
    lastHash,
    localHash,
    diskHash,
    resolution:
      status === "changed_only_locally"
        ? "local"
        : status === "changed_only_on_disk"
          ? "disk"
          : null,
  };
}

export function createReconciliationResult({
  lastSynced = {},
  currentLocal = {},
  currentDisk = {},
} = {}) {
  const syncedEntries = normalizeSnapshotEntries(lastSynced);
  const localEntries = normalizeSnapshotEntries(currentLocal);
  const diskEntries = normalizeSnapshotEntries(currentDisk);
  const allPaths = Array.from(
    new Set([
      ...Object.keys(syncedEntries),
      ...Object.keys(localEntries),
      ...Object.keys(diskEntries),
    ]),
  ).sort((left, right) => left.localeCompare(right));

  const entries = allPaths.map((path) =>
    buildComparedEntry(
      path,
      Object.prototype.hasOwnProperty.call(syncedEntries, path) ? syncedEntries[path] : null,
      Object.prototype.hasOwnProperty.call(localEntries, path) ? localEntries[path] : null,
      Object.prototype.hasOwnProperty.call(diskEntries, path) ? diskEntries[path] : null,
    ),
  );

  const summary = {
    unchanged: entries.filter((entry) => entry.status === "unchanged").length,
    changedOnlyLocally: entries.filter((entry) => entry.status === "changed_only_locally").length,
    changedOnlyOnDisk: entries.filter((entry) => entry.status === "changed_only_on_disk").length,
    conflict: entries.filter((entry) => entry.status === "conflict").length,
  };

  return {
    entries,
    summary,
    hasChanges: entries.some((entry) => entry.status !== "unchanged"),
    unresolvedCount: entries.filter((entry) => entry.status === "conflict" && !entry.resolution).length,
  };
}

export function applyReconciliationResolution(entries = [], path, resolution) {
  const normalizedPath = normalizePath(path);
  const normalizedResolution = resolution === "disk" ? "disk" : "local";

  return entries.map((entry) => (
    entry.path === normalizedPath
      ? { ...entry, resolution: normalizedResolution }
      : entry
  ));
}

function getResolvedContent(entry) {
  switch (entry.status) {
    case "changed_only_locally":
      return entry.localContent;
    case "changed_only_on_disk":
      return entry.diskContent;
    case "conflict":
      return entry.resolution === "disk" ? entry.diskContent : entry.localContent;
    case "unchanged":
    default:
      if (entry.localContent !== null && entry.localContent !== undefined) {
        return entry.localContent;
      }
      if (entry.diskContent !== null && entry.diskContent !== undefined) {
        return entry.diskContent;
      }
      return entry.lastSyncedContent;
  }
}

export function buildResolvedFileMap(entries = []) {
  return Object.fromEntries(
    entries
      .map((entry) => [normalizePath(entry.path), getResolvedContent(entry)])
      .filter(([path, content]) => Boolean(path) && typeof content === "string")
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function hasPendingConflicts(entries = []) {
  return entries.some((entry) => entry.status === "conflict" && !entry.resolution);
}
