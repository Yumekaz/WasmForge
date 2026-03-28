export const LEGACY_DEFAULT_PYTHON = `import numpy as np

# WasmForge — Phase 1 smoke test
# No backend. Pure WebAssembly.

print("hello world from WasmForge")

a = np.array([[1, 2], [3, 4]])
b = np.array([[5, 6], [7, 8]])

print("\\nMatrix A:")
print(a)
print("\\nMatrix B:")
print(b)
print("\\nA @ B:")
print(a @ b)
print(f"\\ndet(A): {np.linalg.det(a):.6f}")
print(f"sum(B): {b.sum()}")
`

export const DEFAULT_PYTHON = `import numpy as np

# Browser-native Python starter
# Saved directly to browser storage.

print("hello world from WasmForge")

a = np.array([[1, 2], [3, 4]])
b = np.array([[5, 6], [7, 8]])

print("\\nMatrix A:")
print(a)
print("\\nMatrix B:")
print(b)
print("\\nA @ B:")
print(a @ b)
print(f"\\ndet(A): {np.linalg.det(a):.6f}")
print(f"sum(B): {b.sum()}")
`

function normalizeStarterContent(content) {
  return String(content ?? '').replace(/\r\n/g, '\n').trimEnd()
}

const LEGACY_STARTER_VARIANTS = new Set([
  normalizeStarterContent(LEGACY_DEFAULT_PYTHON),
  normalizeStarterContent(
    LEGACY_DEFAULT_PYTHON.replace(
      'print("hello world from WasmForge")',
      '#print("hello world from WasmForge")',
    ),
  ),
  normalizeStarterContent(
    LEGACY_DEFAULT_PYTHON.replace(
      'print("hello world from WasmForge")',
      '# print("hello world from WasmForge")',
    ),
  ),
])

export function migrateLegacyDefaultPython(content) {
  return LEGACY_STARTER_VARIANTS.has(normalizeStarterContent(content))
    ? DEFAULT_PYTHON
    : null
}
