import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'

const TERMINAL_SCROLLBACK = 10000

function isPrintableCharacter(char) {
  const code = char.codePointAt(0)
  return typeof code === 'number' && code >= 32 && code !== 127
}

function sanitizeInputChunk(chunk) {
  return Array.from(chunk ?? '')
    .filter((char) => isPrintableCharacter(char))
    .join('')
}

function createEmptyInputState() {
  return {
    active: false,
    prompt: '',
    buffer: '',
    onSubmit: null,
  }
}

function hasRenderableCells(xterm) {
  const cell = xterm?._core?._renderService?.dimensions?.css?.cell
  return Boolean(cell?.width && cell?.height)
}

const Terminal = forwardRef(function Terminal({ onResize, isVisible = true }, ref) {
  const containerRef = useRef(null)
  const xtermRef = useRef(null)
  const fitAddonRef = useRef(null)
  const inputStateRef = useRef(createEmptyInputState())
  const fitRafRef = useRef(null)
  const fitTimeoutRef = useRef(null)
  const lastDimensionsRef = useRef({ cols: 0, rows: 0 })

  const emitResize = () => {
    const xterm = xtermRef.current
    if (!xterm) {
      return
    }

    const nextDimensions = { cols: xterm.cols, rows: xterm.rows }
    const previous = lastDimensionsRef.current

    if (previous.cols === nextDimensions.cols && previous.rows === nextDimensions.rows) {
      return
    }

    lastDimensionsRef.current = nextDimensions
    onResize?.(nextDimensions)
  }

  const isContainerVisible = () => {
    const container = containerRef.current
    if (!container || !isVisible) {
      return false
    }

    const rect = container.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0 && container.offsetParent !== null
  }

  const fitTerminal = () => {
    const xterm = xtermRef.current
    const fitAddon = fitAddonRef.current

    if (!xterm || !fitAddon || !isContainerVisible()) {
      return false
    }

    try {
      if (!hasRenderableCells(xterm)) {
        return false
      }

      fitAddon.fit()
      emitResize()
      return true
    } catch {
      return false
    }
  }

  const scheduleFit = () => {
    if (typeof window === 'undefined' || !isVisible) {
      return
    }

    if (fitRafRef.current !== null) {
      cancelAnimationFrame(fitRafRef.current)
    }

    fitRafRef.current = requestAnimationFrame(() => {
      fitRafRef.current = null
      fitTerminal()
    })
  }

  const reprintActivePrompt = () => {
    const xterm = xtermRef.current
    const state = inputStateRef.current

    if (!xterm || !state.active) {
      return
    }

    xterm.write(`${state.prompt}${state.buffer}`)
  }

  useImperativeHandle(ref, () => ({
    write: (data) => {
      xtermRef.current?.write(data)
    },
    writeln: (data) => {
      xtermRef.current?.writeln(data)
    },
    clear: () => {
      const xterm = xtermRef.current
      if (!xterm) {
        return
      }

      xterm.write('\x1b[H\x1b[2J')
      reprintActivePrompt()
    },
    focus: () => {
      xtermRef.current?.focus()
    },
    resize: () => {
      fitTerminal()
    },
    fit: () => {
      fitTerminal()
    },
    requestInput: ({ prompt = '', onSubmit } = {}) => {
      const xterm = xtermRef.current
      if (!xterm) {
        return false
      }

      const state = inputStateRef.current
      if (state.active) {
        xterm.write('\r\n')
      }

      inputStateRef.current = {
        active: true,
        prompt: String(prompt ?? ''),
        buffer: '',
        onSubmit: typeof onSubmit === 'function' ? onSubmit : null,
      }

      xterm.write(inputStateRef.current.prompt)
      xterm.focus()
      return true
    },
    cancelInput: ({ reason = '', newline = true } = {}) => {
      const xterm = xtermRef.current
      const state = inputStateRef.current
      if (!xterm || !state.active) {
        return false
      }

      if (reason) {
        xterm.write(reason)
      }
      if (newline) {
        xterm.write('\r\n')
      }

      inputStateRef.current = createEmptyInputState()
      return true
    },
  }))

  useEffect(() => {
    if (!containerRef.current) {
      return undefined
    }

    const xterm = new XTerm({
      theme: {
        background: '#111317',
        foreground: '#c7ced6',
        cursor: '#d4d4d4',
        selectionBackground: '#264f78',
        black: '#111317',
        red: '#f48771',
        green: '#4ec9b0',
        yellow: '#d7ba7d',
        blue: '#1997ff',
        magenta: '#c586c0',
        cyan: '#4fc1ff',
        white: '#c7ced6',
        brightBlack: '#6b7280',
        brightRed: '#ff9d8a',
        brightGreen: '#76d4c0',
        brightYellow: '#e5c07b',
        brightBlue: '#56b6ff',
        brightMagenta: '#d7a8d7',
        brightCyan: '#72d6ff',
        brightWhite: '#f3f4f6',
      },
      fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: TERMINAL_SCROLLBACK,
      allowTransparency: false,
      convertEol: true,
      smoothScrollDuration: 120,
      rightClickSelectsWord: true,
    })

    const fitAddon = new FitAddon()
    xterm.loadAddon(fitAddon)
    xterm.open(containerRef.current)

    const originalFit = fitAddon.fit.bind(fitAddon)
    fitAddon.fit = () => {
      if (!isContainerVisible() || !hasRenderableCells(xterm)) {
        return
      }

      originalFit()
    }

    xtermRef.current = xterm
    fitAddonRef.current = fitAddon
    lastDimensionsRef.current = { cols: xterm.cols, rows: xterm.rows }

    xterm.writeln('\x1b[90mWasmForge local runtime ready.\x1b[0m')
    xterm.writeln('')
    fitTimeoutRef.current = setTimeout(() => {
      fitTimeoutRef.current = null
      scheduleFit()
    }, 80)

    const dataListener = xterm.onData((data) => {
      const state = inputStateRef.current
      if (!state.active) {
        return
      }

      if (data === '\r') {
        const submittedValue = state.buffer
        const submit = state.onSubmit
        xterm.write('\r\n')
        let accepted = true

        try {
          accepted = submit ? submit(submittedValue) !== false : true
        } catch (error) {
          accepted = false
          xterm.writeln(`[WasmForge] ${error?.message || error}`)
        }

        if (accepted) {
          inputStateRef.current = createEmptyInputState()
        } else {
          xterm.write(`${state.prompt}${state.buffer}`)
        }
        return
      }

      if (data === '\u007f') {
        if (state.buffer.length === 0) {
          return
        }

        state.buffer = state.buffer.slice(0, -1)
        xterm.write('\b \b')
        return
      }

      const printableChunk = sanitizeInputChunk(data)
      if (!printableChunk) {
        return
      }

      state.buffer += printableChunk
      xterm.write(printableChunk)
    })

    const handleResize = () => scheduleFit()
    const resizeObserver =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            scheduleFit()
          })
        : null

    resizeObserver?.observe(containerRef.current)

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      resizeObserver?.disconnect()
      if (fitRafRef.current !== null) {
        cancelAnimationFrame(fitRafRef.current)
        fitRafRef.current = null
      }
      if (fitTimeoutRef.current !== null) {
        clearTimeout(fitTimeoutRef.current)
        fitTimeoutRef.current = null
      }
      const viewport = xterm?._core?.viewport
      const viewportFrame = viewport?._refreshAnimationFrame
      if (typeof viewportFrame === 'number') {
        window.cancelAnimationFrame(viewportFrame)
      }
      if (viewport) {
        viewport._refreshAnimationFrame = null
        viewport._innerRefresh = () => {}
        viewport.syncScrollArea = () => {}
      }
      dataListener.dispose()
      xterm.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
      inputStateRef.current = createEmptyInputState()
      lastDimensionsRef.current = { cols: 0, rows: 0 }
    }
  }, [onResize])

  useEffect(() => {
    if (!isVisible) {
      return undefined
    }

    const timeoutId = setTimeout(() => {
      scheduleFit()
    }, 0)

    return () => {
      clearTimeout(timeoutId)
    }
  }, [isVisible])

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: '#111317',
        padding: '8px 12px',
        boxSizing: 'border-box',
        borderRadius: 0,
      }}
      ref={containerRef}
    />
  )
})

export default Terminal
