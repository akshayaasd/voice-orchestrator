import Redis from 'ioredis';

/**
 * 2-Phase Slot Lock Manager — Redis Implementation
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements the double-booking prevention pattern from the architecture spec:
 *
 * Phase 1 (Soft Lock):
 *   SET slot:{tenantId}:{slotId}  "LOCKED"  EX {ttlSeconds}  NX
 *   • NX = "Only set if Not eXists" — atomic, race-condition-safe
 *   • If key already exists → another caller locked it → offer alternative slot
 *   • Default TTL = 120s (enough for caller confirmation dialogue)
 *
 * Phase 2 (Hard Commit):
 *   • After caller confirms → write to PostgreSQL (done in the adapter)
 *   • Then DEL slot:{tenantId}:{slotId} to release the Redis lock
 *
 * Key format: slot:{tenantId}:{slotId}
 */
export class SlotLockManager {
  private redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, {
      retryStrategy: (times) => Math.min(times * 100, 3000),
      lazyConnect: true,
    });

    this.redis.on('connect',    () => console.log('[Redis] Connected to Redis.'));
    this.redis.on('error',      (err) => console.error('[Redis] Error:', err));
    this.redis.on('reconnecting', () => console.warn('[Redis] Reconnecting...'));
  }

  async connect(): Promise<void> {
    await this.redis.connect();
  }

  /**
   * Phase 1 — Attempt to acquire a soft lock on a calendar slot.
   *
   * @returns true if lock acquired, false if slot already locked by another caller
   */
  async acquireLock(
    tenantId:       string,
    slotId:         string,
    ttlSeconds:     number = 120,
  ): Promise<boolean> {
    const key = this.buildKey(tenantId, slotId);
    // SET key value EX seconds NX — returns "OK" or null
    const result = await this.redis.set(key, 'LOCKED', 'EX', ttlSeconds, 'NX');
    const acquired = result === 'OK';

    if (acquired) {
      console.log(`[SlotLock] ✅ Acquired lock: ${key} (TTL: ${ttlSeconds}s)`);
    } else {
      console.warn(`[SlotLock] ❌ Lock already held: ${key} — suggest alternate slot`);
    }

    return acquired;
  }

  /**
   * Phase 2 (partial) — Release a soft lock after successful PostgreSQL commit
   * or when the caller hangs up / times out.
   */
  async releaseLock(tenantId: string, slotId: string): Promise<void> {
    const key = this.buildKey(tenantId, slotId);
    const deleted = await this.redis.del(key);
    console.log(`[SlotLock] Released lock: ${key} (deleted=${deleted})`);
  }

  /**
   * Check if a slot is currently locked by ANY caller.
   * Use this for UI availability checks (not for booking decisions — use acquireLock for that).
   */
  async isLocked(tenantId: string, slotId: string): Promise<boolean> {
    const key = this.buildKey(tenantId, slotId);
    const val = await this.redis.get(key);
    return val !== null;
  }

  /**
   * Store ephemeral call session state (VAD buffer, active holds, etc.)
   * Separate key namespace from slot locks.
   */
  async setCallState(callSid: string, state: Record<string, unknown>, ttlSeconds: number = 3600): Promise<void> {
    const key = `call:${callSid}:state`;
    await this.redis.set(key, JSON.stringify(state), 'EX', ttlSeconds);
  }

  async getCallState(callSid: string): Promise<Record<string, unknown> | null> {
    const key = `call:${callSid}:state`;
    const raw = await this.redis.get(key);
    return raw ? JSON.parse(raw) : null;
  }

  async deleteCallState(callSid: string): Promise<void> {
    await this.redis.del(`call:${callSid}:state`);
  }

  async disconnect(): Promise<void> {
    await this.redis.quit();
    console.log('[Redis] Disconnected.');
  }

  private buildKey(tenantId: string, slotId: string): string {
    return `slot:${tenantId}:${slotId}`;
  }
}
