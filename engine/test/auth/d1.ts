// D1 test double on node:sqlite: real SQL, D1's prepare/bind/first/all/run/batch/exec surface, meta.changes filled in.
import { DatabaseSync } from "node:sqlite";

class Stmt {
  constructor(private db: DatabaseSync, private sql: string, private args: unknown[] = []) {}
  bind(...args: unknown[]): Stmt { return new Stmt(this.db, this.sql, args); }
  private params(): never[] { return this.args.map((a) => (a === undefined ? null : typeof a === "boolean" ? Number(a) : a)) as never[]; }
  async first<T>(): Promise<T | null> { return (this.db.prepare(this.sql).get(...this.params()) as T | undefined) ?? null; }
  async all<T>(): Promise<{ results: T[]; success: true; meta: { changes: number; last_row_id: number } }> {
    const results = this.db.prepare(this.sql).all(...this.params()) as T[];
    const m = this.db.prepare("SELECT changes() AS c, last_insert_rowid() AS r").get() as { c: number; r: number };
    return { results, success: true, meta: { changes: Number(m.c), last_row_id: Number(m.r) } };
  }
  async run() { const r = await this.all(); return { success: true as const, results: r.results, meta: r.meta }; }
}
export class TestD1 {
  readonly raw = new DatabaseSync(":memory:");
  prepare(sql: string): Stmt { return new Stmt(this.raw, sql); }
  async batch(stmts: Stmt[]): Promise<unknown[]> { const out = []; for (const s of stmts) out.push(await s.all()); return out; }
  exec(sql: string): void { this.raw.exec(sql); }
}
