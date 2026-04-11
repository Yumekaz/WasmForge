import '../monacoSetup.js'
import { useCallback, useEffect, useRef } from 'react'
import MonacoEditor from '@monaco-editor/react'
import { DEFAULT_PYTHON } from '../constants/defaultPython.js'

const DEFAULT_RECOVERY_STORAGE_KEY = 'wasmforge:pending-workspace-writes'
const WASMFORGE_EDITOR_THEME = 'wasmforge-night'
const WASMFORGE_EDITOR_THEME_DAY = 'wasmforge-day'

function defineWasmForgeTheme(monaco) {
  monaco.editor.defineTheme(WASMFORGE_EDITOR_THEME, {
    base: 'vs-dark',
    inherit: true,
    semanticHighlighting: true,
    colors: {
      'editor.background': '#09090b',
      'editor.foreground': '#ececef',
      'editorLineNumber.foreground': '#56565f',
      'editorLineNumber.activeForeground': '#d4ccdf',
      'editorCursor.foreground': '#b48aea',
      'editor.selectionBackground': '#3b2767',
      'editor.inactiveSelectionBackground': '#2b1e47',
      'editor.lineHighlightBackground': '#111114',
      'editor.lineHighlightBorder': '#00000000',
      'editorIndentGuide.background1': '#18181c',
      'editorIndentGuide.activeBackground1': '#2a2a32',
      'editorWhitespace.foreground': '#18181c',
      'editorBracketHighlight.foreground1': '#ececef',
      'editorBracketHighlight.foreground2': '#72b4e8',
      'editorBracketHighlight.foreground3': '#b48aea',
      'editorBracketHighlight.foreground4': '#7dd8b0',
      'editorBracketMatch.background': '#241544',
      'editorBracketMatch.border': '#48367a',
      'editor.findMatchBackground': '#48367a',
      'editor.findMatchHighlightBackground': '#2b1e47',
      'editor.wordHighlightBackground': '#2b1e47',
      'editor.wordHighlightStrongBackground': '#36265e',
      'editorHoverWidget.background': '#111114',
      'editorHoverWidget.border': '#36265e',
      'editorWidget.background': '#111114',
      'editorWidget.border': '#36265e',
      'editorSuggestWidget.background': '#111114',
      'editorSuggestWidget.border': '#36265e',
      'editorSuggestWidget.selectedBackground': '#241544',
      'editorSuggestWidget.highlightForeground': '#b48aea',
      'editorGutter.background': '#09090b',
      'scrollbarSlider.background': '#3a3a4480',
      'scrollbarSlider.hoverBackground': '#56565f90',
      'scrollbarSlider.activeBackground': '#8b8b96a0',
      'minimap.background': '#09090b',
      'editorStickyScroll.background': '#111114',
      'editorStickyScrollHover.background': '#18181c',
      'editorOverviewRuler.border': '#00000000',
      'editorOverviewRuler.bracketMatchForeground': '#b48aea',
      'editorInfo.foreground': '#b48aea',
      'editorWarning.foreground': '#f6c177',
      'editorError.foreground': '#e87272',
    },
    rules: [
      { token: 'comment', foreground: '7A6E94', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'E87272' },
      { token: 'keyword.control', foreground: 'E87272' },
      { token: 'storage', foreground: 'E87272' },
      { token: 'storage.type', foreground: 'C8A0E8' },
      { token: 'string', foreground: '7DD8B0' },
      { token: 'string.escape', foreground: 'F6D3A4' },
      { token: 'number', foreground: '72B4E8' },
      { token: 'constant.numeric', foreground: '72B4E8' },
      { token: 'constant.language', foreground: 'A88DE8' },
      { token: 'regexp', foreground: 'E87272' },
      { token: 'operator', foreground: 'ECECEF' },
      { token: 'delimiter', foreground: '8B8B96' },
      { token: 'delimiter.bracket', foreground: 'ECECEF' },
      { token: 'entity.name.function', foreground: 'C8A0E8' },
      { token: 'support.function', foreground: 'C8A0E8' },
      { token: 'variable.parameter', foreground: 'D4CCDF' },
      { token: 'entity.name.type', foreground: 'C4C4CC' },
      { token: 'support.type', foreground: 'C4C4CC' },
      { token: 'type.identifier', foreground: 'C4C4CC' },
      { token: 'namespace', foreground: 'A88DE8' },
    ],
  })

  monaco.editor.defineTheme(WASMFORGE_EDITOR_THEME_DAY, {
    base: 'vs',
    inherit: true,
    semanticHighlighting: true,
    colors: {
      'editor.background': '#f3ede2',
      'editor.foreground': '#32283c',
      'editorLineNumber.foreground': '#a89db4',
      'editorLineNumber.activeForeground': '#726583',
      'editorCursor.foreground': '#7350a7',
      'editor.selectionBackground': '#e7dfee',
      'editor.inactiveSelectionBackground': '#eee7f2',
      'editor.lineHighlightBackground': '#e5ebf1',
      'editor.lineHighlightBorder': '#00000000',
      'editorIndentGuide.background1': '#ddd4e6',
      'editorIndentGuide.activeBackground1': '#c9bfd8',
      'editorWhitespace.foreground': '#ddd4e6',
      'editorBracketHighlight.foreground1': '#32283c',
      'editorBracketHighlight.foreground2': '#7350a7',
      'editorBracketHighlight.foreground3': '#8b6ab8',
      'editorBracketHighlight.foreground4': '#61856d',
      'editorBracketMatch.background': '#e6deee',
      'editorBracketMatch.border': '#b49dcb',
      'editor.findMatchBackground': '#d9cceb',
      'editor.findMatchHighlightBackground': '#ece5f0',
      'editor.wordHighlightBackground': '#ece4f1',
      'editor.wordHighlightStrongBackground': '#e4d9ee',
      'editorHoverWidget.background': '#efe8de',
      'editorHoverWidget.border': '#d2c8d8',
      'editorWidget.background': '#efe8de',
      'editorWidget.border': '#d2c8d8',
      'editorSuggestWidget.background': '#efe8de',
      'editorSuggestWidget.border': '#d2c8d8',
      'editorSuggestWidget.selectedBackground': '#e5ebf1',
      'editorSuggestWidget.highlightForeground': '#7350a7',
      'editorGutter.background': '#f3ede2',
      'scrollbarSlider.background': '#c4b8d280',
      'scrollbarSlider.hoverBackground': '#afa2c490',
      'scrollbarSlider.activeBackground': '#9788aea0',
      'minimap.background': '#f3ede2',
      'editorStickyScroll.background': '#eee6dc',
      'editorStickyScrollHover.background': '#e5ebf1',
      'editorOverviewRuler.border': '#00000000',
      'editorOverviewRuler.bracketMatchForeground': '#7350a7',
      'editorInfo.foreground': '#7350a7',
      'editorWarning.foreground': '#a7793e',
      'editorError.foreground': '#b5645d',
    },
    rules: [
      { token: 'comment', foreground: '8A8096', fontStyle: 'italic' },
      { token: 'keyword', foreground: '8050B0' },
      { token: 'keyword.control', foreground: '8050B0' },
      { token: 'storage', foreground: '8050B0' },
      { token: 'storage.type', foreground: '7350A7' },
      { token: 'string', foreground: '9D564F' },
      { token: 'string.escape', foreground: 'A7793E' },
      { token: 'number', foreground: '5D79A9' },
      { token: 'constant.numeric', foreground: '5D79A9' },
      { token: 'constant.language', foreground: '8B6AB8' },
      { token: 'regexp', foreground: '9D564F' },
      { token: 'operator', foreground: '32283C' },
      { token: 'delimiter', foreground: '8C8298' },
      { token: 'delimiter.bracket', foreground: '32283C' },
      { token: 'entity.name.function', foreground: '68459A' },
      { token: 'support.function', foreground: '68459A' },
      { token: 'variable.parameter', foreground: '5E546C' },
      { token: 'entity.name.type', foreground: '5E546C' },
      { token: 'support.type', foreground: '5E546C' },
      { token: 'type.identifier', foreground: '5E546C' },
      { token: 'namespace', foreground: '8B6AB8' },
    ],
  })
}

function persistDraft(filename, content, storageKey = DEFAULT_RECOVERY_STORAGE_KEY) {
  if (typeof window === 'undefined' || !filename) {
    return
  }

  try {
    const raw = window.localStorage.getItem(storageKey)
    const drafts = raw ? JSON.parse(raw) : {}
    const nextDrafts = drafts && typeof drafts === 'object' && !Array.isArray(drafts)
      ? drafts
      : {}

    nextDrafts[filename] = content
    window.localStorage.setItem(storageKey, JSON.stringify(nextDrafts))
  } catch {
    // Recovery storage is best-effort only.
  }
}

function Editor({
  code,
  filename,
  modelPath = filename,
  onChange,
  onMount,
  language = 'python',
  readOnly = false,
  draftStorageKey = DEFAULT_RECOVERY_STORAGE_KEY,
  persistDrafts = true,
  themeMode = 'night',
}) {
  const editorRef = useRef(null)
  const modelChangeDisposableRef = useRef(null)
  const filenameRef = useRef(filename)

  useEffect(() => {
    filenameRef.current = filename
  }, [filename])

  useEffect(() => {
    return () => {
      modelChangeDisposableRef.current?.dispose()
      modelChangeDisposableRef.current = null
    }
  }, [])

  const handleMount = useCallback((editor, monaco) => {
    editorRef.current = editor
    modelChangeDisposableRef.current?.dispose()
    if (persistDrafts) {
      modelChangeDisposableRef.current = editor.onDidChangeModelContent(() => {
        persistDraft(filenameRef.current, editor.getValue(), draftStorageKey)
      })
    } else {
      modelChangeDisposableRef.current = null
    }

    onMount?.(editor, monaco)
  }, [draftStorageKey, onMount, persistDrafts])

  const handleBeforeMount = useCallback((monaco) => {
    defineWasmForgeTheme(monaco)
  }, [])

  return (
    <MonacoEditor
      height="100%"
      language={language}
      value={code}
      onChange={(val) => {
        const nextValue = val ?? ''
        if (persistDrafts) {
          persistDraft(filenameRef.current, nextValue, draftStorageKey)
        }
        onChange?.(nextValue)
      }}
      beforeMount={handleBeforeMount}
      onMount={handleMount}
      theme={themeMode === 'day' ? WASMFORGE_EDITOR_THEME_DAY : WASMFORGE_EDITOR_THEME}
      path={modelPath}
      options={{
        fontSize: 14,
        lineHeight: 23,
        fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", Consolas, monospace',
        fontLigatures: true,
        readOnly,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        lineNumbers: 'on',
        lineNumbersMinChars: 3,
        renderLineHighlight: 'line',
        cursorBlinking: 'phase',
        cursorSmoothCaretAnimation: 'on',
        smoothScrolling: true,
        padding: { top: 20, bottom: 24 },
        automaticLayout: true,
        tabSize: 4,
        insertSpaces: true,
        wordWrap: 'on',
        roundedSelection: false,
        glyphMargin: false,
        overviewRulerBorder: false,
        hideCursorInOverviewRuler: true,
        renderWhitespace: 'selection',
        matchBrackets: 'always',
        bracketPairColorization: { enabled: true },
        guides: {
          indentation: false,
          highlightActiveIndentation: false,
          bracketPairs: true,
          highlightActiveBracketPair: true,
        },
        scrollbar: {
          verticalScrollbarSize: 10,
          horizontalScrollbarSize: 10,
          alwaysConsumeMouseWheel: false,
        },
        suggest: { showKeywords: true },
        quickSuggestions: true,
      }}
    />
  )
}

export { DEFAULT_PYTHON }
export default Editor
