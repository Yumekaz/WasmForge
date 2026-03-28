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

    const cellDimensions = xterm?._core?._renderService?.dimensions?.css?.cell
    if (!cellDimensions?.width || !cellDimensions?.height) {
      return false
    }

    try {
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
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        selectionBackground: '#264f78',
        black: '#0d1117',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#b1bac4',
        brightBlack: '#6e7681',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd',
        brightWhite: '#f0f6fc',
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

    xtermRef.current = xterm
    fitAddonRef.current = fitAddon
    lastDimensionsRef.current = { cols: xterm.cols, rows: xterm.rows }

    xterm.writeln('\x1b[1;34m========================================\x1b[0m')
    xterm.writeln('\x1b[1;34m|  \x1b[1;37mWasmForge\x1b[0m\x1b[1;34m - Browser IDE           |\x1b[0m')
    xterm.writeln('\x1b[1;34m========================================\x1b[0m')
    xterm.writeln('\x1b[90mPreparing local execution environments...\x1b[0m')
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

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      if (fitRafRef.current !== null) {
        cancelAnimationFrame(fitRafRef.current)
        fitRafRef.current = null
      }
      if (fitTimeoutRef.current !== null) {
        clearTimeout(fitTimeoutRef.current)
        fitTimeoutRef.current = null
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
        background: 'linear-gradient(180deg, #0d1117 0%, #090d13 100%)',
        padding: '8px',
        boxSizing: 'border-box',
        borderRadius: '0 0 12px 12px',
      }}
      ref={containerRef}
    />
  )
})

export default Terminal
