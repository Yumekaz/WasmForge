import { neon } from "@neondatabase/serverless";

import { getTestBackendConfig } from "./test-config.js";

let cachedDatabaseUrl = "";
let cachedSqlClient = null;
let schemaPromise = null;

export async function ensureTestSubmissionsSchema(config = getTestBackendConfig()) {
  const sql = getSqlClient(config);

  if (!schemaPromise) {
    schemaPromise = (async () => {
      await sql`
        create table if not exists test_submissions (
          id text primary key,
          room_code text not null,
          student_name text not null,
          attempt_id text not null,
          score numeric not null default 0,
          max_score numeric not null default 0,
          late boolean not null default false,
          payload jsonb not null,
          client_created_at timestamptz not null,
          received_at timestamptz not null default now()
        )
      `;

      await sql`
        create index if not exists test_submissions_room_received_idx
        on test_submissions (room_code, received_at desc)
      `;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }

  await schemaPromise;
}

export async function upsertTestSubmission(submission, config = getTestBackendConfig()) {
  const sql = getSqlClient(config);
  await ensureTestSubmissionsSchema(config);

  const rows = await sql`
    insert into test_submissions (
      id,
      room_code,
      student_name,
      attempt_id,
      score,
      max_score,
      late,
      payload,
      client_created_at
    )
    values (
      ${submission.id},
      ${submission.roomCode},
      ${submission.studentName},
      ${submission.attemptId},
      ${submission.score},
      ${submission.maxScore},
      ${submission.late},
      ${JSON.stringify(submission.payload)}::jsonb,
      ${submission.clientCreatedAtIso}::timestamptz
    )
    on conflict (id) do update
    set room_code = excluded.room_code,
        student_name = excluded.student_name,
        attempt_id = excluded.attempt_id,
        score = excluded.score,
        max_score = excluded.max_score,
        late = excluded.late,
        payload = excluded.payload,
        client_created_at = excluded.client_created_at
    returning
      id,
      room_code,
      student_name,
      attempt_id,
      score,
      max_score,
      late,
      payload,
      client_created_at,
      received_at,
      (xmax = 0) as inserted
  `;

  return mapSubmissionRow(rows[0]);
}

export async function listTestSubmissions(roomCode, config = getTestBackendConfig()) {
  const sql = getSqlClient(config);
  await ensureTestSubmissionsSchema(config);

  const rows = await sql`
    select
      id,
      room_code,
      student_name,
      attempt_id,
      score,
      max_score,
      late,
      payload,
      client_created_at,
      received_at
    from test_submissions
    where room_code = ${roomCode}
    order by received_at desc, client_created_at desc, id desc
  `;

  return rows.map((row) => mapSubmissionRow(row));
}

export async function checkTestDatabaseReadiness(config = getTestBackendConfig()) {
  if (!config.databaseUrlConfigured) {
    return {
      ready: false,
      error: "DATABASE_URL is not configured.",
      checkedAt: null,
    };
  }

  try {
    const sql = getSqlClient(config);
    await ensureTestSubmissionsSchema(config);
    const rows = await sql`select now() as checked_at`;

    return {
      ready: true,
      error: null,
      checkedAt: toIsoString(rows[0]?.checked_at),
    };
  } catch (error) {
    return {
      ready: false,
      error: normalizeDatabaseError(error),
      checkedAt: null,
    };
  }
}

function getSqlClient(config) {
  if (!config?.databaseUrlConfigured) {
    throw new Error("DATABASE_URL is required.");
  }

  if (!cachedSqlClient || cachedDatabaseUrl !== config.databaseUrl) {
    cachedDatabaseUrl = config.databaseUrl;
    cachedSqlClient = neon(config.databaseUrl);
    schemaPromise = null;
  }

  return cachedSqlClient;
}

function mapSubmissionRow(row) {
  const payload = parsePayload(row?.payload);

  return {
    id: String(row?.id ?? ""),
    roomCode: String(row?.room_code ?? ""),
    studentName: String(row?.student_name ?? ""),
    attemptId: String(row?.attempt_id ?? ""),
    score: Number(row?.score ?? 0),
    maxScore: Number(row?.max_score ?? 0),
    late: Boolean(row?.late),
    payload,
    clientCreatedAt: toIsoString(row?.client_created_at),
    receivedAt: toIsoString(row?.received_at),
    inserted: row?.inserted == null ? undefined : Boolean(row.inserted),
  };
}

function parsePayload(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    try {
      return JSON.parse(value);
    } catch {
      return { raw: value };
    }
  }

  return {};
}

function toIsoString(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function normalizeDatabaseError(error) {
  return String(error?.message || error || "Database request failed.");
}
