/**
 * KSCW SQL Workspace — natural-language → SQL via Anthropic API.
 *
 * POST /admin/sql/ask  body { prompt, write_mode? }  → { sql, model, ... }
 *
 * Superuser-only (accountability.admin === true). Loads the live public
 * schema from information_schema, sends it as a cached system block so
 * subsequent calls hit the prompt cache (90% discount). Returns just the
 * SQL string — the frontend drops it into the editor for the user to
 * review and run; nothing is executed automatically.
 */

import { writeErrorLog } from './error-log.js'

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''
const DEFAULT_MODEL = process.env.SQL_AI_MODEL || 'claude-sonnet-4-6'
const MAX_TOKENS = 1024
const PROMPT_MAX_LEN = 2000
const SQL_PREVIEW_MAX = 1500

const SYSTEM_INSTRUCTIONS = `You are a PostgreSQL 15.8 SQL expert assisting a club administrator querying the KSC Wiedikon volleyball/basketball platform database. The user describes what they want in natural language; you respond with exactly one PostgreSQL SQL statement that answers it.

Rules:
- Output ONLY the SQL — no prose, no explanation, no markdown fences. Just the raw query.
- Target PostgreSQL 15.8 specifically. Use PG-native syntax (ILIKE, ::cast, JSONB operators ->/->>/@>, COALESCE, FILTER, etc.).
- Default to read-only SELECT/CTE queries. Do not write INSERT/UPDATE/DELETE/DDL unless the user explicitly asks for a write and clearly understands they need to flip "Write mode" in the UI.
- Always include a sensible LIMIT (default 100) unless the user explicitly asks for all rows or an aggregate.
- IMPORTANT: members.role and members.position are stored as PostgreSQL \`json\` (not \`jsonb\`). The \`@>\` containment operator and most JSONB functions are only defined on \`jsonb\` — you MUST cast first. Patterns that work:
  - \`role::jsonb @> '["admin"]'::jsonb\`
  - \`'admin' IN (SELECT json_array_elements_text(role))\`
  Never write \`role @> '["admin"]'\` without the \`::jsonb\` cast — it fails with "operator does not exist: json @> unknown".
- Always inspect the schema's printed data_type before assuming json vs jsonb; cast accordingly.
- members.kscw_membership_active is the canonical "is this person an active club member" flag; filter on it for most member queries.
- Licence flags are seven BOOLEAN columns on members: \`scorer_vb\`, \`referee_vb\` (volleyball) and \`otr1_bb\`, \`otr2_bb\`, \`otn1_bb\`, \`otn2_bb\`, \`referee_bb\` (basketball). Query them directly (\`WHERE scorer_vb\`), not the legacy \`licences\` JSON column (which is being dropped). Count holders with \`COUNT(*) FILTER (WHERE scorer_vb)\`.
- OTN caveat: \`otn1_bb\` / \`otn2_bb\` are the precise Basketplan-sourced levels 1 and 2, and a member can hold BOTH (an upgraded official keeps the lower one) — so for "who has an OTN licence" write \`WHERE otn1_bb OR otn2_bb\`, and use one alone only when the user explicitly asks about a specific level. There is no coarse level-less OTN column: \`otn_bb\` was dropped by migration 303, so a query naming it will error.
- "Schreiber" = scorer_vb licence. "TR" = team-responsible.
- Use \`members\`, \`teams\`, \`member_teams\`, \`teams_coaches\`, \`teams_responsibles\`, \`games\`, \`trainings\`, \`events\`, \`participations\`, \`absences\` for the obvious entities.
- Dates: \`date\` columns are bare YYYY-MM-DD; \`*_at\` / \`date_created\` / \`date_updated\` are timestamptz. Format display dates with \`to_char(d, 'DD.MM.YYYY')\` for Swiss output.
- If the request is ambiguous, pick the most useful reasonable interpretation rather than asking — the user will iterate.
- If the request is impossible against this schema, output a SELECT that returns one row explaining the issue: \`SELECT 'cannot answer: <reason>' AS note;\`.`

/** Serialize information_schema into a compact `table(col type, col type, ...)`
 *  representation — small enough to fit in the cached system block without
 *  burning tokens, structured enough that the model can reason about joins. */
async function loadSchemaText(database) {
  const result = await database.raw(`
    SELECT c.table_name, c.column_name, c.data_type, c.is_nullable, c.ordinal_position
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name, c.ordinal_position
  `)
  const byTable = new Map()
  for (const r of result.rows) {
    let entry = byTable.get(r.table_name)
    if (!entry) { entry = []; byTable.set(r.table_name, entry) }
    const nullMark = r.is_nullable === 'YES' ? '?' : ''
    entry.push(`${r.column_name} ${r.data_type}${nullMark}`)
  }
  const lines = []
  for (const [tname, cols] of byTable) {
    lines.push(`${tname}(${cols.join(', ')})`)
  }
  return lines.join('\n')
}

/** Strip any markdown fences and leading/trailing whitespace. */
function extractSql(modelText) {
  if (!modelText) return ''
  let s = modelText.trim()
  // ```sql ... ``` or ``` ... ```
  const fence = s.match(/^```(?:sql|postgresql)?\s*\n?([\s\S]*?)\n?```$/i)
  if (fence) s = fence[1]
  return s.trim()
}

export function registerSqlAi(router, { database, logger }) {
  const log = logger.child({ extension: 'kscw-sql-ai' })

  function requireSuperuser(req) {
    if (!req.accountability?.user) {
      const err = new Error('Authentication required')
      err.status = 401
      throw err
    }
    if (req.accountability.admin !== true) {
      log.warn({ msg: 'Superuser access denied (sql-ai)', userId: req.accountability.user })
      const err = new Error('Superuser access required')
      err.status = 403
      throw err
    }
  }

  router.post('/admin/sql/ask', async (req, res) => {
    const started = Date.now()
    let userId = null
    let promptText = ''
    try {
      requireSuperuser(req)
      userId = req.accountability.user

      if (!ANTHROPIC_API_KEY) {
        const err = new Error('ANTHROPIC_API_KEY not configured on backend')
        err.status = 503
        err.code = 'no_api_key'
        throw err
      }

      promptText = String(req.body?.prompt ?? '').trim()
      if (!promptText) return res.status(400).json({ error: 'prompt required' })
      if (promptText.length > PROMPT_MAX_LEN) {
        return res.status(400).json({ error: `prompt too long (max ${PROMPT_MAX_LEN} chars)` })
      }

      const schemaText = await loadSchemaText(database)
      const model = DEFAULT_MODEL

      const anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: MAX_TOKENS,
          system: [
            { type: 'text', text: SYSTEM_INSTRUCTIONS },
            // Cache the schema dump — stable across calls, big-ish block,
            // makes repeat /ask calls fast + cheap (90% discount on cache hits)
            {
              type: 'text',
              text: `# Database schema (PostgreSQL 15.8, public)\n${schemaText}`,
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [{ role: 'user', content: promptText }],
        }),
      })

      const data = await anthropicResp.json()
      if (!anthropicResp.ok || data.error) {
        const errMsg = data?.error?.message || `Anthropic API ${anthropicResp.status}`
        const err = new Error(errMsg)
        err.status = anthropicResp.status >= 400 && anthropicResp.status < 500 ? 400 : 502
        err.code = 'anthropic_error'
        throw err
      }

      const sql = extractSql(data.content?.[0]?.text || '')
      if (!sql) {
        const err = new Error('Model returned no SQL')
        err.status = 502
        err.code = 'empty_response'
        throw err
      }

      const durationMs = Date.now() - started
      const usage = data.usage || {}
      writeErrorLog({
        level: 'info',
        source: 'backend',
        project: 'wiedisync',
        event: 'sql_workspace_ai',
        endpoint: '/admin/sql/ask',
        userId,
        action: 'nl2sql',
        status: 200,
        durationMs,
        model,
        promptLen: promptText.length,
        sqlPreview: sql.slice(0, SQL_PREVIEW_MAX),
        tokensIn: usage.input_tokens ?? null,
        tokensCached: usage.cache_read_input_tokens ?? null,
        tokensCacheWrite: usage.cache_creation_input_tokens ?? null,
        tokensOut: usage.output_tokens ?? null,
      })

      res.json({
        sql,
        model,
        duration_ms: durationMs,
        tokens_in: usage.input_tokens ?? null,
        tokens_cached: usage.cache_read_input_tokens ?? null,
        tokens_out: usage.output_tokens ?? null,
      })
    } catch (err) {
      const durationMs = Date.now() - started
      writeErrorLog({
        level: 'error',
        source: 'backend',
        project: 'wiedisync',
        event: 'sql_workspace_ai',
        endpoint: '/admin/sql/ask',
        userId,
        action: 'nl2sql',
        status: err.status || 500,
        durationMs,
        error: err.message?.slice(0, 1000) ?? null,
        code: err.code ?? null,
        promptPreview: promptText.slice(0, 500),
      })
      res.status(err.status || 500).json({
        error: err.status ? err.message : 'Internal error',
        code: err.code ?? null,
      })
    }
  })
}
