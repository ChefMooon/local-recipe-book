import { EventEmitter } from "node:events";

export type ChangeEntity =
  | "meal"
  | "mealType"
  | "mealSubType"
  | "recipe"
  | "groceryList"
  | "prepList"
  | "preference"
  | "pantry"
  | "dataManagement";

export type ChangeAction = "create" | "update" | "delete" | "bulk";

export type ChangeEvent = {
  entity: ChangeEntity;
  id?: string;
  action: ChangeAction;
  revision: number;
};

const CHANGE_EVENT_NAME = "change";

/**
 * Module-level singleton bus shared by every domain service construction path
 * (including internal fallback constructions in PrepListService and
 * DataManagementService). A unit test asserts exactly one instance across all
 * construction paths — do not convert to per-factory injection only.
 */
class ChangeEventBusImpl {
  private readonly emitter = new EventEmitter();
  private currentRevision = 0;

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  /**
   * Reserve the next revision number. Call inside the same Prisma transaction
   * as the mutation so a committed mutation always owns its revision; emit()
   * must be called after commit with the reserved revision.
   */
  reserveRevision(): number {
    return this.currentRevision + 1;
  }

  /** Publish a committed change. Only call after the transaction commits. */
  emit(event: Omit<ChangeEvent, "revision"> & { revision: number }): void {
    if (!Number.isFinite(event.revision)) {
      throw new Error("Change events require a finite revision.");
    }
    if (event.revision > this.currentRevision) {
      this.currentRevision = event.revision;
    }
    this.emitter.emit(CHANGE_EVENT_NAME, event as ChangeEvent);
  }

  subscribe(listener: (event: ChangeEvent) => void): () => void {
    this.emitter.on(CHANGE_EVENT_NAME, listener);
    return () => {
      this.emitter.off(CHANGE_EVENT_NAME, listener);
    };
  }

  get revision(): number {
    return this.currentRevision;
  }

  /** Restore the watermark after restart or crash recovery sweep. */
  setRevision(value: number): void {
    if (Number.isFinite(value) && value > this.currentRevision) {
      this.currentRevision = value;
    }
  }
}

export type ChangeEventBus = ChangeEventBusImpl;

type RevisionTransaction = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

const globalForBus = globalThis as typeof globalThis & {
  __localRecipeBookChangeEventBus?: ChangeEventBusImpl;
};

export const changeEventBus: ChangeEventBus =
  globalForBus.__localRecipeBookChangeEventBus ?? new ChangeEventBusImpl();

globalForBus.__localRecipeBookChangeEventBus = changeEventBus;

/**
 * Emit one change event for a committed mutation, bumping the persisted
 * SyncState revision counter. Call only AFTER the mutation transaction commits.
 * Returns the emitted event's revision.
 */
export async function publishCommittedChange(
  entity: ChangeEntity,
  action: ChangeAction,
  id?: string
): Promise<number> {
  const { prisma } = await import("../lib/prisma");
  const revision = await reserveRevision(prisma);
  changeEventBus.emit({ entity, action, id, revision });
  return revision;
}

/** Reserve a revision inside the caller's mutation transaction. */
export async function reserveCommittedChange(
  tx: RevisionTransaction,
  entity: ChangeEntity,
  action: ChangeAction,
  id?: string
): Promise<Omit<ChangeEvent, "revision"> & { revision: number }> {
  const revision = await reserveRevision(tx);
  return { entity, action, id, revision };
}

/** Emit a change that has already been committed and assigned a revision. */
export function emitCommittedChange(event: ChangeEvent): void {
  changeEventBus.emit(event);
}

type RevisionStore = RevisionTransaction & {
  syncState?: {
    findUnique(args: { where: { key: string } }): Promise<{ value: string } | null>;
    upsert(args: {
      where: { key: string };
      update: { value: string };
      create: { key: string; value: string };
    }): Promise<{ value: string }>;
  };
};

const REVISION_KEY = "sync.revision";

async function reserveRevision(prisma: RevisionStore): Promise<number> {
  if (prisma.$queryRawUnsafe) {
    const rows = await prisma.$queryRawUnsafe<Array<{ value: string }>>(
      `INSERT INTO "SyncState" ("key", "value") VALUES ('${REVISION_KEY}', '1')
       ON CONFLICT ("key") DO UPDATE SET "value" = CAST("SyncState"."value" AS INTEGER) + 1
       RETURNING "value"`
    );
    const revision = Number.parseInt(rows[0]?.value ?? "0", 10);
    if (!Number.isFinite(revision) || revision < 1) {
      throw new Error("Sync revision counter is invalid.");
    }
    changeEventBus.setRevision(revision);
    return revision;
  }

  // Compatibility fallback for lightweight unit-test Prisma doubles.
  if (!prisma.syncState) {
    throw new Error("A transaction-capable Prisma client is required for sync revisions.");
  }
  const row = await prisma.syncState.findUnique({ where: { key: REVISION_KEY } });
  const previous = row ? Number.parseInt(row.value, 10) : 0;
  const next = (Number.isFinite(previous) ? previous : 0) + 1;
  await prisma.syncState.upsert({
    where: { key: REVISION_KEY },
    update: { value: `${next}` },
    create: { key: REVISION_KEY, value: `${next}` },
  });
  changeEventBus.setRevision(next);
  return next;
}

/** Read the persisted revision without mutating it (used by /api/sync/revision). */
export async function readPersistedRevision(): Promise<number> {
  const { prisma } = await import("../lib/prisma");
  try {
    const row = await prisma.syncState.findUnique({ where: { key: REVISION_KEY } });
    const parsed = row ? Number.parseInt(row.value, 10) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    // Table not yet created (bootstrap pending): report revision 0 so clients
    // sweep rather than treating the server as broken.
    return 0;
  }
}
