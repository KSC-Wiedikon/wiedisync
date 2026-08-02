// ⛔ PAID ALTERNATIVE — NOT USED. Live scoring ships on the club's free Directus
// (board → `live_scores` item; app polls + optional realtime). This Durable
// Object needs a PAID Workers plan and is retained ONLY as the scale
// escape-hatch (see ../README.md + ../../.planning/live-scoring-DESIGN.md). Do
// not deploy.
//
// LiveMatchRelay — one Durable Object per channel (one physical scoreboard).
//
// Responsibilities:
//   1. Hold the CURRENT match snapshot (persisted, so a DO restart keeps the score).
//   2. Fan out every board update to connected viewers over Server-Sent Events.
//   3. Archive completed matches (event === 'match-end') into SQLite history.
//
// Why SSE (not WebSocket): the traffic is strictly one-way — the board publishes,
// viewers only read. EventSource gives the client free auto-reconnect + Last-Event-ID
// resume, which is exactly right for spectators on flaky hall wifi/4G. The one place
// WebSocket would win on Cloudflare is Hibernation (cheaper idle billing for many
// long-lived connections); at club scale (a few matches/week, tens–low-hundreds of
// viewers) that saving is immaterial and not worth the extra client complexity.
// Full rationale in ../../.planning/live-scoring-DESIGN.md.

import { DurableObject } from 'cloudflare:workers'
import type { BoardState, Envelope, Env, HistoryRow, MatchEvent, PublishBody } from './types'

const KEEPALIVE_MS = 20_000 // comment ping — beats CF's ~100s idle-stream cutoff
const HISTORY_CAP = 100

interface Current {
  state: BoardState | null
  status: 'live' | 'idle' | 'final'
  event: MatchEvent
  seq: number
  ts: number
}

export class LiveMatchRelay extends DurableObject<Env> {
  private channel = 'kscw'
  private cur: Current = { state: null, status: 'idle', event: null, seq: 0, ts: 0 }
  private clients = new Map<number, WritableStreamDefaultWriter<Uint8Array>>()
  private clientSeq = 0
  private keepalive: ReturnType<typeof setInterval> | null = null
  private enc = new TextEncoder()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ended_at INTEGER NOT NULL,
          team_a TEXT NOT NULL,
          team_b TEXT NOT NULL,
          sets_a INTEGER NOT NULL,
          sets_b INTEGER NOT NULL,
          set_results TEXT NOT NULL,
          snapshot TEXT NOT NULL
        )
      `)
      // Persist-first, cache-second: rehydrate the last snapshot so an evicted/
      // restarted DO still answers /state and seeds new subscribers correctly.
      const saved = await ctx.storage.get<Current>('current')
      if (saved) this.cur = saved
    })
  }

  async fetch(request: Request): Promise<Response> {
    this.channel = request.headers.get('X-Relay-Channel') || this.channel
    const op = new URL(request.url).pathname.slice(1)

    switch (op) {
      case 'subscribe': return this.subscribe(request)
      case 'publish': return this.publish(request)
      case 'reset': return this.reset()
      case 'state': return this.jsonResponse(this.envelope())
      case 'history': return this.jsonResponse({ matches: this.listHistory() })
      default: return this.jsonResponse({ error: 'not found' }, 404)
    }
  }

  // --- SSE subscribe (public read) ---
  private subscribe(request: Request): Response {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
    const writer = writable.getWriter()
    const id = ++this.clientSeq
    this.clients.set(id, writer)

    // Seed the newcomer with the current snapshot immediately.
    void this.send(writer, 'snapshot', this.envelope()).catch(() => this.drop(id))
    this.ensureKeepalive()

    // Drop the client when the browser closes the stream (EventSource .close(),
    // tab close, or network drop — the runtime aborts the request signal).
    request.signal?.addEventListener('abort', () => this.drop(id))

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        // Defeat proxy buffering that would otherwise batch/delay SSE frames.
        'X-Accel-Buffering': 'no',
      },
    })
  }

  // --- publish (bearer-authed at the Worker) ---
  private async publish(request: Request): Promise<Response> {
    let body: PublishBody
    try {
      body = (await request.json()) as PublishBody
    } catch {
      return this.jsonResponse({ error: 'invalid JSON body' }, 400)
    }
    if (!body || typeof body !== 'object' || !body.state) {
      return this.jsonResponse({ error: 'missing state' }, 400)
    }

    const event: MatchEvent = body.event ?? null
    this.cur = {
      state: body.state,
      status: event === 'match-end' ? 'final' : 'live',
      event,
      seq: this.cur.seq + 1,
      ts: body.ts ?? Date.now(),
    }
    // Persist BEFORE broadcasting so a crash mid-fanout can't lose the score.
    await this.ctx.storage.put('current', this.cur)

    // Archive on match end (best-effort; never blocks the fan-out).
    if (event === 'match-end') {
      try { this.archive(body.state, this.cur.ts) } catch { /* history is non-critical */ }
    }

    this.broadcast('update')
    return this.jsonResponse({ ok: true, seq: this.cur.seq, viewers: this.clients.size })
  }

  // --- reset -> idle (bearer-authed) ---
  private async reset(): Promise<Response> {
    this.cur = { state: null, status: 'idle', event: null, seq: this.cur.seq + 1, ts: Date.now() }
    await this.ctx.storage.put('current', this.cur)
    this.broadcast('update')
    return this.jsonResponse({ ok: true })
  }

  // --- fan-out ---
  private broadcast(type: 'snapshot' | 'update'): void {
    const env = this.envelope()
    for (const [id, writer] of this.clients) {
      void this.send(writer, type, env).catch(() => this.drop(id))
    }
  }

  private async send(writer: WritableStreamDefaultWriter<Uint8Array>, type: string, data: Envelope): Promise<void> {
    const frame = `event: ${type}\nid: ${data.seq}\ndata: ${JSON.stringify(data)}\n\n`
    await writer.write(this.enc.encode(frame))
  }

  private drop(id: number): void {
    const writer = this.clients.get(id)
    if (!writer) return
    this.clients.delete(id)
    try { void writer.close() } catch { /* already gone */ }
    if (this.clients.size === 0 && this.keepalive) {
      clearInterval(this.keepalive)
      this.keepalive = null
    }
  }

  private ensureKeepalive(): void {
    if (this.keepalive) return
    // While any SSE stream is open the DO stays resident, so a plain interval is
    // safe here; it self-cancels when the last viewer leaves (see drop()).
    this.keepalive = setInterval(() => {
      if (this.clients.size === 0) {
        if (this.keepalive) { clearInterval(this.keepalive); this.keepalive = null }
        return
      }
      const ping = this.enc.encode(`: keepalive ${Date.now()}\n\n`)
      for (const [id, writer] of this.clients) {
        void writer.write(ping).catch(() => this.drop(id))
      }
    }, KEEPALIVE_MS)
  }

  // --- history ---
  private archive(state: BoardState, endedAt: number): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO history (ended_at, team_a, team_b, sets_a, sets_b, set_results, snapshot)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      endedAt,
      state.team_a_short || state.team_a_name || 'A',
      state.team_b_short || state.team_b_name || 'B',
      state.sets_won_a,
      state.sets_won_b,
      JSON.stringify(state.set_results ?? []),
      JSON.stringify(state),
    )
    // Cap the log — keep the newest HISTORY_CAP rows.
    this.ctx.storage.sql.exec(
      `DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT ?)`,
      HISTORY_CAP,
    )
  }

  private listHistory(): HistoryRow[] {
    const rows = this.ctx.storage.sql
      .exec(`SELECT ended_at, team_a, team_b, sets_a, sets_b, set_results, snapshot
             FROM history ORDER BY id DESC LIMIT ?`, HISTORY_CAP)
      .toArray() as Array<Record<string, unknown>>
    return rows.map((r) => ({
      ended_at: Number(r.ended_at),
      team_a: String(r.team_a),
      team_b: String(r.team_b),
      sets_a: Number(r.sets_a),
      sets_b: Number(r.sets_b),
      set_results: safeParse(r.set_results, []),
      snapshot: safeParse(r.snapshot, null),
    }))
  }

  private envelope(): Envelope {
    return {
      v: 1,
      channel: this.channel,
      status: this.cur.status,
      seq: this.cur.seq,
      event: this.cur.event,
      ts: this.cur.ts,
      match: this.cur.state,
    }
  }

  private jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
  }
}

function safeParse<T>(raw: unknown, fallback: T): T {
  try { return JSON.parse(String(raw)) as T } catch { return fallback }
}
