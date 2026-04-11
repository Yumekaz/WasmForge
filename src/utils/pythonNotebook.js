export const PYTHON_NOTEBOOK_EXTENSION = "wfnb";
export const PYTHON_NOTEBOOK_LANGUAGE = "python";
export const PYTHON_NOTEBOOK_KIND = "python-notebook";
export const PYTHON_NOTEBOOK_VERSION = 1;

const NOTEBOOK_STARTER_CELLS = [
  `import matplotlib.pyplot as plt
import pandas as pd

scores = pd.DataFrame(
    [
        {"name": "Ada", "score": 42},
        {"name": "Linus", "score": 36},
        {"name": "Grace", "score": 39},
    ]
)`,
  `display(scores)`,
  `scores.plot(x="name", y="score", kind="bar", legend=False, title="Notebook starter")
plt.tight_layout()
plt.show()`,
];

function normalizeCellSource(source = "") {
  return String(source ?? "").replace(/\r\n/gu, "\n");
}

export function createNotebookCellId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `cell-${crypto.randomUUID()}`;
  }

  return `cell-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createNotebookCell(source = "") {
  return {
    id: createNotebookCellId(),
    kind: "code",
    source: normalizeCellSource(source),
  };
}

function normalizeNotebookDocument(document) {
  const rawCells = Array.isArray(document?.cells) ? document.cells : [];
  const normalizedCells = rawCells
    .map((cell) => {
      if (!cell || typeof cell !== "object") {
        return null;
      }

      return {
        id: String(cell.id || createNotebookCellId()).trim() || createNotebookCellId(),
        kind: "code",
        source: normalizeCellSource(cell.source),
      };
    })
    .filter(Boolean);

  return {
    version: PYTHON_NOTEBOOK_VERSION,
    kernel: PYTHON_NOTEBOOK_LANGUAGE,
    cells: normalizedCells.length > 0 ? normalizedCells : [createNotebookCell("")],
  };
}

export function createDefaultPythonNotebookDocument() {
  return normalizeNotebookDocument({
    version: PYTHON_NOTEBOOK_VERSION,
    kernel: PYTHON_NOTEBOOK_LANGUAGE,
    cells: NOTEBOOK_STARTER_CELLS.map((source) => createNotebookCell(source)),
  });
}

export function serializePythonNotebookDocument(document) {
  return `${JSON.stringify(normalizeNotebookDocument(document), null, 2)}\n`;
}

export function parsePythonNotebookDocument(content) {
  const raw = String(content ?? "");
  if (!raw.trim()) {
    return {
      document: createDefaultPythonNotebookDocument(),
      error: "",
    };
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Notebook data must be a JSON object.");
    }

    return {
      document: normalizeNotebookDocument(parsed),
      error: "",
    };
  } catch (error) {
    return {
      document: null,
      error: error?.message || "Notebook data is invalid.",
    };
  }
}

export function isPythonNotebookFile(filename = "") {
  return filename.toLowerCase().endsWith(`.${PYTHON_NOTEBOOK_EXTENSION}`);
}
