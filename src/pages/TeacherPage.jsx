import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TEST_ROOM_CODE, getSeededRoom, normalizeRoomCode } from '../utils/mockTest.js'

const TEACHER_ROOM_STORAGE_KEY = 'wasmforge:teacher:last-room-code'
const HEALTH_ENDPOINT = '/api/test/health'
const SUBMISSIONS_ENDPOINT = '/api/test/submissions'
const DEFAULT_HEALTH_MESSAGE = 'Backend ready.'
const DEFAULT_NOT_CONFIGURED_MESSAGE =
  'Backend not configured. Set DATABASE_URL and WASMFORGE_TEACHER_PIN before using the teacher dashboard.'

function readStoredTeacherRoom() {
  if (typeof window === 'undefined') {
    return TEST_ROOM_CODE
  }

  try {
    const stored = window.localStorage.getItem(TEACHER_ROOM_STORAGE_KEY)
    return normalizeRoomCode(stored || TEST_ROOM_CODE) || TEST_ROOM_CODE
  } catch {
    return TEST_ROOM_CODE
  }
}

function useCompactLayout(breakpoint = 980) {
  const [isCompact, setIsCompact] = useState(() => {
    if (typeof window === 'undefined') {
      return false
    }

    return window.innerWidth <= breakpoint
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined
    }

    const mediaQuery = window.matchMedia(`(max-width: ${breakpoint}px)`)
    const update = () => setIsCompact(mediaQuery.matches)

    update()

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', update)
      return () => mediaQuery.removeEventListener('change', update)
    }

    mediaQuery.addListener(update)
    return () => mediaQuery.removeListener(update)
  }, [breakpoint])

  return isCompact
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') {
    return value
  }

  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function normalizeObject(value) {
  const parsed = parseMaybeJson(value)
  return isPlainObject(parsed) ? parsed : {}
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  return ''
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const next = Number(value)
    if (Number.isFinite(next)) {
      return next
    }
  }

  return null
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) {
      return value
    }
  }

  return ''
}

function coerceBoolean(value) {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    if (/^(true|1|yes)$/iu.test(value.trim())) {
      return true
    }

    if (/^(false|0|no)$/iu.test(value.trim())) {
      return false
    }
  }

  if (typeof value === 'number') {
    return value !== 0
  }

  return Boolean(value)
}

function trimCodeFence(value) {
  return String(value ?? '').replace(/\s+$/u, '')
}

function deriveTimestamp(value) {
  if (value === null || value === undefined || value === '') {
    return null
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1e11) {
      return value
    }

    if (value > 1e9) {
      return value * 1000
    }
  }

  if (typeof value === 'string') {
    const numericValue = Number(value)
    if (Number.isFinite(numericValue)) {
      return deriveTimestamp(numericValue)
    }

    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return null
}

function extractMessage(payload, text = '') {
  const objectPayload = isPlainObject(payload) ? payload : {}
  const candidate = firstString(
    objectPayload.message,
    objectPayload.error,
    objectPayload.detail,
    objectPayload.reason,
    objectPayload.database?.error,
    objectPayload.status,
    objectPayload.code,
    text,
  )

  return candidate
}

function looksLikeBackendNotConfigured(message = '') {
  return /not configured|not_configured|missing env|database_url|teacher_pin|wasmforge_teacher_pin|backend unavailable/iu.test(
    String(message || '').replace(/_/gu, ' '),
  )
}

function getHealthStatus(response, payload, text = '') {
  const objectPayload = isPlainObject(payload) ? payload : {}
  const env = isPlainObject(objectPayload.env) ? objectPayload.env : {}
  const database = isPlainObject(objectPayload.database) ? objectPayload.database : {}
  const message = extractMessage(payload, text)
  const statusToken = firstString(objectPayload.status, objectPayload.error, objectPayload.code)
  const configuredFlags = [
    objectPayload.configured,
    objectPayload.backendConfigured,
    objectPayload.backend_configured,
    objectPayload.envConfigured,
    typeof env.databaseUrlConfigured === 'boolean' && typeof env.teacherPinConfigured === 'boolean'
      ? env.databaseUrlConfigured && env.teacherPinConfigured
      : null,
  ]
  const hasExplicitConfiguredFalse = configuredFlags.some((value) => value === false)
  const databaseReady = database.ready === true

  if (
    statusToken === 'backend_not_configured'
    || statusToken === 'not_configured'
    || hasExplicitConfiguredFalse
    || looksLikeBackendNotConfigured(message)
  ) {
    return {
      status: 'not_configured',
      message: message || DEFAULT_NOT_CONFIGURED_MESSAGE,
      payload: objectPayload,
    }
  }

  if (
    !response.ok
    || objectPayload.ok === false
    || objectPayload.healthy === false
    || (statusToken === 'database_unavailable' && databaseReady === false)
  ) {
    return {
      status: 'error',
      message: message || `Health check failed (${response.status}).`,
      payload: objectPayload,
    }
  }

  return {
    status: 'ok',
    message: message || DEFAULT_HEALTH_MESSAGE,
    payload: objectPayload,
  }
}

async function readResponsePayload(response) {
  const text = await response.text()
  return {
    text,
    payload: text ? parseMaybeJson(text) : null,
  }
}

function getQuestionScore(result) {
  const tests = Array.isArray(result?.tests) ? result.tests : []
  return tests.reduce(
    (total, test) => ({
      score: total.score + (test.passed ? Number(test.points || 0) : 0),
      maxScore: total.maxScore + Number(test.points || 0),
    }),
    { score: 0, maxScore: 0 },
  )
}

function normalizeTestResult(test, index) {
  const payload = normalizeObject(test)
  const expectedStdout = String(payload.expectedStdout ?? payload.expected_stdout ?? '')
  const stdout = String(payload.stdout ?? '')
  const error = firstString(payload.error)
  const passed =
    typeof payload.passed === 'boolean'
      ? payload.passed
      : !error && trimCodeFence(stdout) === trimCodeFence(expectedStdout)

  return {
    id: firstString(payload.id) || `case-${index + 1}`,
    name: firstString(payload.name) || `Case ${index + 1}`,
    stdin: String(payload.stdin ?? ''),
    expectedStdout,
    stdout,
    stderr: String(payload.stderr ?? ''),
    error,
    hidden: coerceBoolean(payload.hidden),
    points: firstFiniteNumber(payload.points) ?? 0,
    passed,
    durationMs: firstFiniteNumber(payload.durationMs, payload.duration_ms),
  }
}

function extractAnswerSource(answerValue) {
  const parsed = parseMaybeJson(answerValue)

  if (typeof parsed === 'string') {
    return parsed
  }

  if (!isPlainObject(parsed)) {
    return ''
  }

  const directSource = firstString(
    parsed.source,
    parsed.code,
    parsed.content,
    parsed.text,
    parsed.value,
    parsed.answer,
  )

  if (directSource) {
    return directSource
  }

  return ''
}

function normalizeAnswerMap(answers, room) {
  const objectAnswers = normalizeObject(answers)
  const filenameToId = new Map(
    Array.isArray(room?.questions)
      ? room.questions.map((question) => [question.filename, question.id])
      : [],
  )
  const answerMap = new Map()

  for (const [rawKey, rawValue] of Object.entries(objectAnswers)) {
    const parsed = parseMaybeJson(rawValue)
    const normalizedValue = isPlainObject(parsed) ? parsed : parsed
    const questionId = firstString(
      isPlainObject(normalizedValue) ? normalizedValue.questionId : '',
      isPlainObject(normalizedValue) ? normalizedValue.question_id : '',
      filenameToId.get(rawKey),
      isPlainObject(normalizedValue) ? filenameToId.get(normalizedValue.filename) : '',
      rawKey,
    )

    answerMap.set(questionId, {
      questionId,
      rawKey,
      filename: firstString(
        isPlainObject(normalizedValue) ? normalizedValue.filename : '',
        rawKey,
      ),
      source: extractAnswerSource(normalizedValue),
      rawValue: normalizedValue,
    })
  }

  return answerMap
}

function normalizeResultMap(results, room) {
  const objectResults = normalizeObject(results)
  const filenameToId = new Map(
    Array.isArray(room?.questions)
      ? room.questions.map((question) => [question.filename, question.id])
      : [],
  )
  const resultMap = new Map()

  for (const [rawKey, rawValue] of Object.entries(objectResults)) {
    const parsed = normalizeObject(rawValue)
    const questionId = firstString(
      parsed.questionId,
      parsed.question_id,
      filenameToId.get(rawKey),
      rawKey,
    )

    resultMap.set(questionId, {
      ...parsed,
      tests: Array.isArray(parsed.tests) ? parsed.tests.map(normalizeTestResult) : [],
    })
  }

  return resultMap
}

function buildQuestionEntries({ answers, results, room }) {
  const answerMap = normalizeAnswerMap(answers, room)
  const resultMap = normalizeResultMap(results, room)
  const orderedIds = []
  const seen = new Set()
  const roomQuestions = Array.isArray(room?.questions) ? room.questions : []

  const pushQuestionId = (questionId) => {
    const normalizedId = String(questionId || '').trim()
    if (!normalizedId || seen.has(normalizedId)) {
      return
    }

    seen.add(normalizedId)
    orderedIds.push(normalizedId)
  }

  roomQuestions.forEach((question) => pushQuestionId(question.id))
  resultMap.forEach((_, questionId) => pushQuestionId(questionId))
  answerMap.forEach((_, questionId) => pushQuestionId(questionId))

  return orderedIds.map((questionId, index) => {
    const meta =
      roomQuestions.find((question) => question.id === questionId)
      || roomQuestions.find((question) => question.filename === questionId)
      || null
    const answer = answerMap.get(questionId)
    const result = resultMap.get(questionId)
    const derivedScore = getQuestionScore(result)
    const fallbackMaxScore = Array.isArray(meta?.tests)
      ? meta.tests.reduce((total, test) => total + Number(test.points || 0), 0)
      : 0
    const score = firstFiniteNumber(result?.score, derivedScore.score) ?? 0
    const maxScore =
      firstFiniteNumber(result?.maxScore, derivedScore.maxScore, fallbackMaxScore) ?? fallbackMaxScore
    const code = firstText(answer?.source, extractAnswerSource(result?.answer))
    const tests = Array.isArray(result?.tests) ? result.tests : []
    const passedCount = tests.filter((test) => test.passed).length

    return {
      id: questionId,
      filename: firstString(meta?.filename, answer?.filename, answer?.rawKey, `question-${index + 1}.py`),
      title: firstString(meta?.title, `Question ${index + 1}`),
      prompt: firstString(meta?.prompt),
      code,
      score,
      maxScore,
      tests,
      passedCount,
      error: firstString(result?.error, tests.find((test) => test.error)?.error),
      durationMs: firstFiniteNumber(result?.durationMs, result?.duration_ms),
    }
  })
}

function normalizeSubmissionRecord(record, index, roomCode, room) {
  const rawRecord = normalizeObject(record)
  if (!Object.keys(rawRecord).length) {
    return null
  }

  const payload = normalizeObject(rawRecord.payload)
  const questions = buildQuestionEntries({
    answers: payload.answers ?? rawRecord.answers,
    results: payload.results ?? rawRecord.results,
    room,
  })
  const computedScore = questions.reduce((total, question) => total + question.score, 0)
  const computedMaxScore = questions.reduce((total, question) => total + question.maxScore, 0)
  const score = firstFiniteNumber(payload.score, rawRecord.score, computedScore) ?? computedScore
  const maxScore =
    firstFiniteNumber(payload.maxScore, payload.max_score, rawRecord.maxScore, rawRecord.max_score, computedMaxScore)
    ?? computedMaxScore
  const submittedAt = deriveTimestamp(
    payload.clientCreatedAt
      ?? payload.client_created_at
      ?? rawRecord.clientCreatedAt
      ?? rawRecord.client_created_at
      ?? rawRecord.submittedAt
      ?? rawRecord.submitted_at,
  )
  const receivedAt = deriveTimestamp(rawRecord.receivedAt ?? rawRecord.received_at ?? payload.receivedAt)
  const normalizedRoomCode = normalizeRoomCode(
    firstString(
      payload.roomCode,
      payload.room_code,
      rawRecord.roomCode,
      rawRecord.room_code,
      roomCode,
    ),
  )

  return {
    id: firstString(payload.id, rawRecord.id) || `submission-${index + 1}`,
    attemptId: firstString(payload.attemptId, payload.attempt_id, rawRecord.attemptId, rawRecord.attempt_id),
    roomCode: normalizedRoomCode || roomCode,
    studentId: firstString(payload.studentId, payload.student_id, rawRecord.studentId, rawRecord.student_id),
    studentName:
      firstString(payload.studentName, payload.student_name, rawRecord.studentName, rawRecord.student_name)
      || 'Unnamed student',
    score,
    maxScore,
    late: coerceBoolean(payload.late ?? rawRecord.late),
    submittedAt,
    receivedAt,
    testTitle: firstString(payload.testTitle, payload.test_title, room?.title),
    questions,
    rawRecord,
    rawPayload: payload,
  }
}

function normalizeSubmissionList(payload, roomCode, room) {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.submissions)
      ? payload.submissions
      : Array.isArray(payload?.items)
        ? payload.items
        : Array.isArray(payload?.data)
          ? payload.data
          : []

  return list
    .map((entry, index) => normalizeSubmissionRecord(entry, index, roomCode, room))
    .filter(Boolean)
    .sort((left, right) => {
      const leftTime = left.receivedAt ?? left.submittedAt ?? 0
      const rightTime = right.receivedAt ?? right.submittedAt ?? 0

      if (rightTime !== leftTime) {
        return rightTime - leftTime
      }

      if (right.score !== left.score) {
        return right.score - left.score
      }

      return left.studentName.localeCompare(right.studentName)
    })
}

function formatDateTime(timestamp) {
  if (!timestamp) {
    return 'Unavailable'
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp))
}

function formatScore(score, maxScore) {
  if (!Number.isFinite(score) || !Number.isFinite(maxScore)) {
    return '0 / 0'
  }

  return `${score} / ${maxScore}`
}

function formatPercent(score, maxScore) {
  if (!Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0) {
    return '0%'
  }

  return `${Math.round((score / maxScore) * 100)}%`
}

function formatDurationMs(durationMs) {
  if (!Number.isFinite(durationMs)) {
    return 'n/a'
  }

  if (durationMs >= 1000) {
    return `${(durationMs / 1000).toFixed(2)}s`
  }

  return `${Math.round(durationMs)}ms`
}

function getQuestionTone(question) {
  if (question.error) {
    return 'danger'
  }

  if (question.maxScore > 0 && question.score >= question.maxScore) {
    return 'success'
  }

  if (question.score > 0) {
    return 'warning'
  }

  return 'idle'
}

function serializeForExport(submissions) {
  return submissions.map((submission) => ({
    id: submission.id,
    attemptId: submission.attemptId,
    roomCode: submission.roomCode,
    studentId: submission.studentId,
    studentName: submission.studentName,
    score: submission.score,
    maxScore: submission.maxScore,
    late: submission.late,
    submittedAt: submission.submittedAt ? new Date(submission.submittedAt).toISOString() : null,
    receivedAt: submission.receivedAt ? new Date(submission.receivedAt).toISOString() : null,
    testTitle: submission.testTitle,
    questions: submission.questions.map((question) => ({
      id: question.id,
      title: question.title,
      filename: question.filename,
      prompt: question.prompt,
      score: question.score,
      maxScore: question.maxScore,
      durationMs: question.durationMs,
      error: question.error,
      code: question.code,
      tests: question.tests,
    })),
    rawRecord: submission.rawRecord,
    rawPayload: submission.rawPayload,
  }))
}

function makeButtonStyle({ tone = 'primary', disabled = false, fullWidth = false } = {}) {
  const palette =
    tone === 'ghost'
      ? {
          background: 'rgba(255, 255, 255, 0.02)',
          border: 'rgba(255, 255, 255, 0.12)',
          color: 'var(--wf-text)',
        }
      : tone === 'danger'
        ? {
            background: 'rgba(232, 114, 114, 0.14)',
            border: 'rgba(232, 114, 114, 0.28)',
            color: 'var(--wf-rose)',
          }
        : {
            background: 'linear-gradient(135deg, rgba(180, 138, 234, 0.96), rgba(114, 180, 232, 0.92))',
            border: 'rgba(180, 138, 234, 0.36)',
            color: '#0b0b0f',
          }

  return {
    height: 42,
    padding: '0 16px',
    width: fullWidth ? '100%' : 'auto',
    borderRadius: 14,
    border: `1px solid ${palette.border}`,
    background: disabled ? 'rgba(255, 255, 255, 0.05)' : palette.background,
    color: disabled ? 'var(--wf-muted)' : palette.color,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'var(--wf-body)',
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: '0.02em',
    opacity: disabled ? 0.64 : 1,
    transition: 'transform 160ms ease, opacity 160ms ease, border-color 160ms ease',
  }
}

function makeBadgeStyle(tone = 'idle') {
  const palette =
    tone === 'success'
      ? { color: 'var(--wf-mint)', border: 'rgba(125, 216, 176, 0.24)', background: 'rgba(125, 216, 176, 0.08)' }
      : tone === 'warning'
        ? { color: 'var(--wf-gold)', border: 'rgba(232, 200, 114, 0.24)', background: 'rgba(232, 200, 114, 0.08)' }
        : tone === 'danger'
          ? { color: 'var(--wf-rose)', border: 'rgba(232, 114, 114, 0.24)', background: 'rgba(232, 114, 114, 0.08)' }
          : tone === 'accent'
            ? { color: 'var(--wf-accent)', border: 'rgba(180, 138, 234, 0.24)', background: 'rgba(180, 138, 234, 0.09)' }
            : { color: 'var(--wf-text-soft)', border: 'rgba(255, 255, 255, 0.12)', background: 'rgba(255, 255, 255, 0.04)' }

  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    minHeight: 28,
    padding: '0 10px',
    borderRadius: 999,
    border: `1px solid ${palette.border}`,
    background: palette.background,
    color: palette.color,
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  }
}

function StateBanner({ tone = 'idle', title, message }) {
  const palette =
    tone === 'danger'
      ? { border: 'rgba(232, 114, 114, 0.28)', background: 'rgba(232, 114, 114, 0.08)', color: 'var(--wf-rose)' }
      : tone === 'warning'
        ? { border: 'rgba(232, 200, 114, 0.28)', background: 'rgba(232, 200, 114, 0.08)', color: 'var(--wf-gold)' }
        : tone === 'success'
          ? { border: 'rgba(125, 216, 176, 0.28)', background: 'rgba(125, 216, 176, 0.08)', color: 'var(--wf-mint)' }
          : { border: 'rgba(255, 255, 255, 0.12)', background: 'rgba(255, 255, 255, 0.04)', color: 'var(--wf-text-soft)' }

  return (
    <div
      aria-live="polite"
      style={{
        borderRadius: 20,
        border: `1px solid ${palette.border}`,
        background: palette.background,
        padding: '16px 18px',
        color: palette.color,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        {title}
      </div>
      <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.65, color: 'var(--wf-text-soft)' }}>
        {message}
      </div>
    </div>
  )
}

function MetricCard({ label, value, tone = 'idle' }) {
  return (
    <article
      style={{
        borderRadius: 20,
        border: '1px solid rgba(255, 255, 255, 0.08)',
        background: 'linear-gradient(180deg, rgba(17, 17, 20, 0.96), rgba(9, 9, 11, 0.96))',
        padding: 18,
        minWidth: 0,
      }}
    >
      <div style={{ ...makeBadgeStyle(tone), minHeight: 24, padding: '0 8px', fontSize: 10 }}>{label}</div>
      <div
        style={{
          marginTop: 16,
          color: 'var(--wf-text)',
          fontFamily: 'var(--wf-display)',
          fontSize: 30,
          lineHeight: 1.05,
        }}
      >
        {value}
      </div>
    </article>
  )
}

function KeyStat({ label, value }) {
  return (
    <div
      style={{
        display: 'grid',
        gap: 6,
        minWidth: 0,
        padding: '12px 14px',
        borderRadius: 16,
        border: '1px solid rgba(255, 255, 255, 0.08)',
        background: 'rgba(255, 255, 255, 0.03)',
      }}
    >
      <div style={{ color: 'var(--wf-muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ color: 'var(--wf-text)', fontSize: 14, fontWeight: 700, minWidth: 0, overflowWrap: 'anywhere' }}>
        {value}
      </div>
    </div>
  )
}

export default function TeacherPage() {
  const isCompact = useCompactLayout()
  const [roomCode, setRoomCode] = useState(() => readStoredTeacherRoom())
  const [adminPin, setAdminPin] = useState('')
  const [healthState, setHealthState] = useState({
    status: 'idle',
    message: 'Checking backend health...',
    payload: null,
  })
  const [fetchState, setFetchState] = useState({
    status: 'idle',
    message: 'Enter the room code and admin PIN to load submissions.',
  })
  const [submissions, setSubmissions] = useState([])
  const [selectedSubmissionId, setSelectedSubmissionId] = useState('')
  const [lastLoadedAt, setLastLoadedAt] = useState(null)
  const healthAbortRef = useRef(null)
  const fetchAbortRef = useRef(null)

  const seededRoom = useMemo(() => getSeededRoom(roomCode), [roomCode])
  const selectedSubmission = useMemo(
    () => submissions.find((submission) => submission.id === selectedSubmissionId) || submissions[0] || null,
    [selectedSubmissionId, submissions],
  )

  const summary = useMemo(() => {
    if (!submissions.length) {
      return {
        total: 0,
        lateCount: 0,
        averagePercent: '0%',
        bestScore: '0 / 0',
      }
    }

    const lateCount = submissions.filter((submission) => submission.late).length
    const averagePercent = Math.round(
      submissions.reduce((total, submission) => {
        if (!submission.maxScore) {
          return total
        }

        return total + (submission.score / submission.maxScore) * 100
      }, 0) / submissions.length,
    )
    const bestSubmission = [...submissions].sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }

      const leftTime = left.receivedAt ?? left.submittedAt ?? 0
      const rightTime = right.receivedAt ?? right.submittedAt ?? 0
      return leftTime - rightTime
    })[0]

    return {
      total: submissions.length,
      lateCount,
      averagePercent: `${averagePercent}%`,
      bestScore: formatScore(bestSubmission.score, bestSubmission.maxScore),
    }
  }, [submissions])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    try {
      window.localStorage.setItem(TEACHER_ROOM_STORAGE_KEY, normalizeRoomCode(roomCode) || TEST_ROOM_CODE)
    } catch {
      // Ignore storage failures and keep the page usable.
    }
  }, [roomCode])

  const runHealthCheck = useCallback(async ({ signal } = {}) => {
    const response = await fetch(HEALTH_ENDPOINT, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal,
    })
    const { payload, text } = await readResponsePayload(response)
    return getHealthStatus(response, payload, text)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    healthAbortRef.current?.abort()
    healthAbortRef.current = controller

    setHealthState({
      status: 'checking',
      message: 'Checking backend health...',
      payload: null,
    })

    runHealthCheck({ signal: controller.signal })
      .then((nextState) => {
        setHealthState(nextState)
      })
      .catch((error) => {
        if (error?.name === 'AbortError') {
          return
        }

        setHealthState({
          status: 'error',
          message: error?.message || 'Could not reach /api/test/health.',
          payload: null,
        })
      })

    return () => {
      controller.abort()
    }
  }, [runHealthCheck])

  useEffect(() => {
    return () => {
      healthAbortRef.current?.abort()
      fetchAbortRef.current?.abort()
    }
  }, [])

  const handleLoadSubmissions = useCallback(
    async (event) => {
      event?.preventDefault?.()

      const normalizedRoomCode = normalizeRoomCode(roomCode)
      const trimmedPin = adminPin.trim()

      if (!normalizedRoomCode) {
        setFetchState({
          status: 'error',
          message: 'Room code is required.',
        })
        return
      }

      if (!trimmedPin) {
        setFetchState({
          status: 'auth',
          message: 'Admin PIN is required.',
        })
        return
      }

      const controller = new AbortController()
      fetchAbortRef.current?.abort()
      fetchAbortRef.current = controller

      setFetchState({
        status: 'loading',
        message: `Loading submissions for ${normalizedRoomCode}...`,
      })

      try {
        const nextHealthState = await runHealthCheck({ signal: controller.signal })
        setHealthState(nextHealthState)

        if (nextHealthState.status === 'not_configured') {
          setFetchState({
            status: 'not_configured',
            message: nextHealthState.message,
          })
          startTransition(() => {
            setSubmissions([])
            setSelectedSubmissionId('')
          })
          return
        }

        if (nextHealthState.status === 'error') {
          setFetchState({
            status: 'error',
            message: nextHealthState.message,
          })
          return
        }

        const response = await fetch(
          `${SUBMISSIONS_ENDPOINT}?roomCode=${encodeURIComponent(normalizedRoomCode)}`,
          {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              'x-wasmforge-teacher-pin': trimmedPin,
            },
            signal: controller.signal,
          },
        )
        const { payload, text } = await readResponsePayload(response)
        const message = extractMessage(payload, text)

        if (response.status === 401 || response.status === 403) {
          setFetchState({
            status: 'auth',
            message: message || 'Teacher PIN rejected by /api/test/submissions.',
          })
          return
        }

        if (payload?.error === 'backend_not_configured' || looksLikeBackendNotConfigured(message)) {
          setFetchState({
            status: 'not_configured',
            message: message || DEFAULT_NOT_CONFIGURED_MESSAGE,
          })
          startTransition(() => {
            setSubmissions([])
            setSelectedSubmissionId('')
          })
          return
        }

        if (!response.ok) {
          setFetchState({
            status: 'error',
            message: message || `Request failed with status ${response.status}.`,
          })
          return
        }

        const room = getSeededRoom(normalizedRoomCode)
        const nextSubmissions = normalizeSubmissionList(payload, normalizedRoomCode, room)

        startTransition(() => {
          setSubmissions(nextSubmissions)
          setSelectedSubmissionId((currentId) => {
            if (nextSubmissions.some((submission) => submission.id === currentId)) {
              return currentId
            }

            return nextSubmissions[0]?.id || ''
          })
        })

        setLastLoadedAt(Date.now())
        setFetchState({
          status: 'success',
          message: nextSubmissions.length
            ? `Loaded ${nextSubmissions.length} submission${nextSubmissions.length === 1 ? '' : 's'} for ${normalizedRoomCode}.`
            : `No submissions returned for ${normalizedRoomCode}.`,
        })
      } catch (error) {
        if (error?.name === 'AbortError') {
          return
        }

        setFetchState({
          status: 'error',
          message: error?.message || 'Could not load teacher submissions.',
        })
      }
    },
    [adminPin, roomCode, runHealthCheck],
  )

  const handleExportJson = useCallback(() => {
    if (!submissions.length || typeof window === 'undefined') {
      return
    }

    const payload = {
      exportedAt: new Date().toISOString(),
      roomCode: normalizeRoomCode(roomCode) || TEST_ROOM_CODE,
      health: {
        status: healthState.status,
        message: healthState.message,
      },
      submissions: serializeForExport(submissions),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${payload.roomCode.toLowerCase()}-teacher-export.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  }, [healthState.message, healthState.status, roomCode, submissions])

  const healthTone =
    healthState.status === 'ok'
      ? 'success'
      : healthState.status === 'not_configured'
        ? 'warning'
        : healthState.status === 'error'
          ? 'danger'
          : 'accent'

  const fetchTone =
    fetchState.status === 'success'
      ? 'success'
      : fetchState.status === 'not_configured'
        ? 'warning'
        : fetchState.status === 'error' || fetchState.status === 'auth'
          ? 'danger'
          : 'accent'

  return (
    <div
      style={{
        minHeight: '100vh',
        background:
          'radial-gradient(circle at top left, rgba(180, 138, 234, 0.18), transparent 30%), radial-gradient(circle at top right, rgba(114, 180, 232, 0.12), transparent 28%), linear-gradient(180deg, #111114 0%, #09090b 58%, #050507 100%)',
        color: 'var(--wf-text)',
      }}
    >
      <div style={{ width: 'min(100%, 1320px)', margin: '0 auto', padding: isCompact ? '20px 16px 40px' : '32px 24px 48px' }}>
        <div
          style={{
            display: 'grid',
            gap: 24,
          }}
        >
          <header
            style={{
              display: 'grid',
              gap: 20,
              padding: isCompact ? 20 : 28,
              borderRadius: 28,
              border: '1px solid rgba(255, 255, 255, 0.08)',
              background: 'linear-gradient(180deg, rgba(17, 17, 20, 0.96), rgba(9, 9, 11, 0.98))',
              boxShadow: '0 30px 80px rgba(0, 0, 0, 0.28)',
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
              <div style={{ minWidth: 0, maxWidth: 760 }}>
                <div style={makeBadgeStyle('accent')}>Teacher Console</div>
                <h1
                  style={{
                    margin: '16px 0 0',
                    fontFamily: 'var(--wf-display)',
                    fontSize: isCompact ? 36 : 52,
                    lineHeight: 0.96,
                    letterSpacing: '-0.02em',
                  }}
                >
                  Mock test submissions without the student noise.
                </h1>
                <p
                  style={{
                    margin: '16px 0 0',
                    maxWidth: 760,
                    color: 'var(--wf-text-soft)',
                    fontSize: isCompact ? 15 : 16,
                    lineHeight: 1.72,
                  }}
                >
                  Load synced submissions for a room, inspect per-question grading, and export the full teacher view as JSON.
                  This page only trusts the backend after an explicit health check.
                </p>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                <div style={makeBadgeStyle(healthTone)}>
                  {healthState.status === 'checking'
                    ? 'Checking backend'
                    : healthState.status === 'ok'
                      ? 'Backend ready'
                      : healthState.status === 'not_configured'
                        ? 'Backend not configured'
                        : healthState.status === 'error'
                          ? 'Backend error'
                          : 'Backend unknown'}
                </div>
                {lastLoadedAt ? <div style={makeBadgeStyle('idle')}>Updated {formatDateTime(lastLoadedAt)}</div> : null}
              </div>
            </div>

            <form onSubmit={handleLoadSubmissions} style={{ display: 'grid', gap: 16 }}>
              <div
                style={{
                  display: 'grid',
                  gap: 14,
                  gridTemplateColumns: isCompact ? '1fr' : 'minmax(220px, 280px) minmax(220px, 260px) auto auto',
                  alignItems: 'end',
                }}
              >
                <label style={{ display: 'grid', gap: 8 }}>
                  <span style={{ color: 'var(--wf-muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    Room code
                  </span>
                  <input
                    data-testid="teacher-room-code"
                    value={roomCode}
                    onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
                    onBlur={() => setRoomCode((current) => normalizeRoomCode(current) || '')}
                    placeholder={TEST_ROOM_CODE}
                    autoCapitalize="characters"
                    spellCheck={false}
                    style={{
                      height: 46,
                      borderRadius: 14,
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      background: 'rgba(255, 255, 255, 0.04)',
                      color: 'var(--wf-text)',
                      padding: '0 14px',
                      fontFamily: 'var(--wf-mono)',
                      fontSize: 14,
                      outline: 'none',
                    }}
                  />
                </label>

                <label style={{ display: 'grid', gap: 8 }}>
                  <span style={{ color: 'var(--wf-muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    Admin PIN
                  </span>
                  <input
                    type="password"
                    data-testid="teacher-pin"
                    value={adminPin}
                    onChange={(event) => setAdminPin(event.target.value)}
                    placeholder="Teacher PIN"
                    autoComplete="current-password"
                    style={{
                      height: 46,
                      borderRadius: 14,
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      background: 'rgba(255, 255, 255, 0.04)',
                      color: 'var(--wf-text)',
                      padding: '0 14px',
                      fontFamily: 'var(--wf-mono)',
                      fontSize: 14,
                      outline: 'none',
                    }}
                  />
                </label>

                <button
                  type="submit"
                  data-testid="load-submissions"
                  disabled={fetchState.status === 'loading'}
                  style={makeButtonStyle({
                    disabled: fetchState.status === 'loading',
                    fullWidth: isCompact,
                  })}
                >
                  {fetchState.status === 'loading' ? 'Loading...' : 'Load submissions'}
                </button>

                <button
                  type="button"
                  disabled={!submissions.length}
                  onClick={handleExportJson}
                  style={makeButtonStyle({
                    tone: 'ghost',
                    disabled: !submissions.length,
                    fullWidth: isCompact,
                  })}
                >
                  Export JSON
                </button>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {seededRoom ? (
                  <>
                    <div style={makeBadgeStyle('accent')}>{seededRoom.title}</div>
                    <div style={makeBadgeStyle('idle')}>{seededRoom.questions.length} questions</div>
                    <div style={makeBadgeStyle('idle')}>{seededRoom.durationMinutes} min</div>
                  </>
                ) : (
                  <div style={makeBadgeStyle('warning')}>Room metadata not found locally</div>
                )}
              </div>
            </form>
          </header>

          <StateBanner
            tone={healthState.status === 'ok' ? 'success' : healthState.status === 'not_configured' ? 'warning' : healthState.status === 'error' ? 'danger' : 'idle'}
            title="Backend health"
            message={healthState.message}
          />

          <StateBanner
            tone={fetchTone === 'accent' ? 'idle' : fetchTone}
            title="Teacher fetch state"
            message={fetchState.message}
          />

          <section
            style={{
              display: 'grid',
              gap: 14,
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            }}
          >
            <MetricCard label="Submissions" value={summary.total} tone="accent" />
            <MetricCard label="Average" value={summary.averagePercent} tone="success" />
            <MetricCard label="Late" value={summary.lateCount} tone={summary.lateCount ? 'warning' : 'idle'} />
            <MetricCard label="Best score" value={summary.bestScore} tone="accent" />
          </section>

          <section
            style={{
              display: 'grid',
              gap: 18,
              alignItems: 'start',
              gridTemplateColumns: isCompact ? '1fr' : '320px minmax(0, 1fr)',
            }}
          >
            <aside
              style={{
                borderRadius: 24,
                border: '1px solid rgba(255, 255, 255, 0.08)',
                background: 'linear-gradient(180deg, rgba(17, 17, 20, 0.96), rgba(9, 9, 11, 0.98))',
                padding: 18,
                position: isCompact ? 'static' : 'sticky',
                top: 20,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ color: 'var(--wf-muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    Submission list
                  </div>
                  <div style={{ marginTop: 8, color: 'var(--wf-text)', fontSize: 18, fontWeight: 700 }}>
                    {normalizeRoomCode(roomCode) || TEST_ROOM_CODE}
                  </div>
                </div>
                <div style={makeBadgeStyle('idle')}>{submissions.length}</div>
              </div>

              <div data-testid="teacher-submissions-table" style={{ marginTop: 18, display: 'grid', gap: 10 }}>
                {submissions.length ? (
                  submissions.map((submission) => {
                    const isActive = submission.id === selectedSubmission?.id

                    return (
                      <button
                        key={submission.id}
                        type="button"
                        onClick={() => setSelectedSubmissionId(submission.id)}
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          display: 'grid',
                          gap: 10,
                          padding: 14,
                          borderRadius: 18,
                          border: isActive ? '1px solid rgba(180, 138, 234, 0.34)' : '1px solid rgba(255, 255, 255, 0.08)',
                          background: isActive ? 'rgba(180, 138, 234, 0.11)' : 'rgba(255, 255, 255, 0.03)',
                          color: 'inherit',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                          <div style={{ color: 'var(--wf-text)', fontSize: 15, fontWeight: 700, minWidth: 0, overflowWrap: 'anywhere' }}>
                            {submission.studentName}
                          </div>
                          {submission.late ? <div style={makeBadgeStyle('warning')}>Late</div> : null}
                        </div>

                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          <div style={makeBadgeStyle('accent')}>{formatScore(submission.score, submission.maxScore)}</div>
                          <div style={makeBadgeStyle('idle')}>{formatPercent(submission.score, submission.maxScore)}</div>
                        </div>

                        <div style={{ color: 'var(--wf-muted)', fontSize: 12, lineHeight: 1.6 }}>
                          Submitted {formatDateTime(submission.submittedAt || submission.receivedAt)}
                        </div>
                      </button>
                    )
                  })
                ) : (
                  <div
                    style={{
                      padding: 18,
                      borderRadius: 18,
                      border: '1px dashed rgba(255, 255, 255, 0.12)',
                      color: 'var(--wf-muted)',
                      fontSize: 14,
                      lineHeight: 1.7,
                    }}
                  >
                    No synced submissions yet. If students are working offline, the backend will stay empty until their queues flush.
                  </div>
                )}
              </div>
            </aside>

            <div style={{ display: 'grid', gap: 18 }}>
              {selectedSubmission ? (
                <>
                  <section
                    style={{
                      display: 'grid',
                      gap: 18,
                      padding: isCompact ? 18 : 24,
                      borderRadius: 24,
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      background: 'linear-gradient(180deg, rgba(17, 17, 20, 0.96), rgba(9, 9, 11, 0.98))',
                    }}
                  >
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={makeBadgeStyle('accent')}>Selected submission</div>
                        <h2 style={{ margin: '14px 0 0', fontSize: isCompact ? 28 : 34, lineHeight: 1.04, fontFamily: 'var(--wf-display)' }}>
                          {selectedSubmission.studentName}
                        </h2>
                        <div style={{ marginTop: 10, color: 'var(--wf-text-soft)', fontSize: 15, lineHeight: 1.7 }}>
                          {selectedSubmission.testTitle || 'Python mock test'} · {selectedSubmission.roomCode}
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                        <div style={makeBadgeStyle('accent')}>{formatScore(selectedSubmission.score, selectedSubmission.maxScore)}</div>
                        <div style={makeBadgeStyle(selectedSubmission.late ? 'warning' : 'success')}>
                          {selectedSubmission.late ? 'Late' : 'On time'}
                        </div>
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gap: 12,
                        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                      }}
                    >
                      <KeyStat label="Submitted" value={formatDateTime(selectedSubmission.submittedAt || selectedSubmission.receivedAt)} />
                      <KeyStat label="Received" value={formatDateTime(selectedSubmission.receivedAt || selectedSubmission.submittedAt)} />
                      <KeyStat label="Attempt ID" value={selectedSubmission.attemptId || 'Unavailable'} />
                      <KeyStat label="Student ID" value={selectedSubmission.studentId || 'Unavailable'} />
                    </div>
                  </section>

                  <section style={{ display: 'grid', gap: 16 }}>
                    {selectedSubmission.questions.length ? (
                      selectedSubmission.questions.map((question, index) => {
                        const tone = getQuestionTone(question)

                        return (
                          <article
                            key={question.id}
                            style={{
                              display: 'grid',
                              gap: 18,
                              padding: isCompact ? 18 : 22,
                              borderRadius: 24,
                              border: '1px solid rgba(255, 255, 255, 0.08)',
                              background: 'linear-gradient(180deg, rgba(17, 17, 20, 0.96), rgba(9, 9, 11, 0.98))',
                            }}
                          >
                            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 14 }}>
                              <div style={{ minWidth: 0 }}>
                                <div style={makeBadgeStyle(tone)}>
                                  Question {index + 1}
                                </div>
                                <div style={{ marginTop: 12, color: 'var(--wf-text)', fontSize: 22, fontWeight: 700, lineHeight: 1.2 }}>
                                  {question.title}
                                </div>
                                {question.prompt ? (
                                  <div style={{ marginTop: 10, color: 'var(--wf-text-soft)', fontSize: 14, lineHeight: 1.75 }}>
                                    {question.prompt}
                                  </div>
                                ) : null}
                              </div>

                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }}>
                                <div style={makeBadgeStyle('accent')}>{formatScore(question.score, question.maxScore)}</div>
                                <div style={makeBadgeStyle('idle')}>
                                  {question.tests.length
                                    ? `${question.passedCount}/${question.tests.length} passed`
                                    : 'No test data'}
                                </div>
                                <div style={makeBadgeStyle('idle')}>{question.filename}</div>
                                {question.durationMs ? <div style={makeBadgeStyle('idle')}>{formatDurationMs(question.durationMs)}</div> : null}
                              </div>
                            </div>

                            {question.error ? (
                              <StateBanner tone="danger" title="Question error" message={question.error} />
                            ) : null}

                            <div
                              style={{
                                display: 'grid',
                                gap: 12,
                                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                              }}
                            >
                              {question.tests.map((test) => (
                                <div
                                  key={test.id}
                                  style={{
                                    display: 'grid',
                                    gap: 10,
                                    padding: 14,
                                    borderRadius: 18,
                                    border: `1px solid ${
                                      test.passed
                                        ? 'rgba(125, 216, 176, 0.2)'
                                        : 'rgba(232, 114, 114, 0.2)'
                                    }`,
                                    background: test.passed ? 'rgba(125, 216, 176, 0.06)' : 'rgba(232, 114, 114, 0.06)',
                                  }}
                                >
                                  <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}>
                                    <div style={{ color: 'var(--wf-text)', fontSize: 14, fontWeight: 700 }}>{test.name}</div>
                                    <div style={makeBadgeStyle(test.passed ? 'success' : 'danger')}>
                                      {test.passed ? 'Pass' : 'Fail'}
                                    </div>
                                  </div>

                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                    <div style={makeBadgeStyle('idle')}>{test.points} pt</div>
                                    {test.durationMs ? <div style={makeBadgeStyle('idle')}>{formatDurationMs(test.durationMs)}</div> : null}
                                  </div>

                                  {!test.passed ? (
                                    <div style={{ display: 'grid', gap: 10 }}>
                                      <CodePanel label="stdin" value={test.stdin || '[empty]'} />
                                      <CodePanel label="expected" value={test.expectedStdout || '[empty]'} />
                                      <CodePanel label="actual" value={test.stdout || '[empty]'} />
                                      {test.stderr ? <CodePanel label="stderr" value={test.stderr} /> : null}
                                      {test.error ? <CodePanel label="error" value={test.error} /> : null}
                                    </div>
                                  ) : null}
                                </div>
                              ))}
                            </div>

                            <CodePanel label="Code preview" value={question.code || '# No code captured for this question'} large />
                          </article>
                        )
                      })
                    ) : (
                      <StateBanner
                        tone="warning"
                        title="No question detail"
                        message="The backend row loaded, but it did not include per-question answers or grading results yet."
                      />
                    )}
                  </section>
                </>
              ) : (
                <section
                  style={{
                    padding: isCompact ? 20 : 28,
                    borderRadius: 24,
                    border: '1px dashed rgba(255, 255, 255, 0.14)',
                    background: 'rgba(255, 255, 255, 0.03)',
                    color: 'var(--wf-text-soft)',
                    lineHeight: 1.8,
                  }}
                >
                  Load a room and select a submission to inspect the teacher view.
                </section>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function CodePanel({ label, value, large = false }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ color: 'var(--wf-muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
        {label}
      </div>
      <pre
        style={{
          margin: 0,
          maxHeight: large ? 320 : 180,
          overflow: 'auto',
          padding: '14px 16px',
          borderRadius: 16,
          border: '1px solid rgba(255, 255, 255, 0.08)',
          background: 'rgba(3, 5, 8, 0.9)',
          color: 'var(--wf-text-soft)',
          fontFamily: 'var(--wf-mono)',
          fontSize: 12,
          lineHeight: 1.7,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </pre>
    </div>
  )
}
