import { bingxClient } from '../bingx/client.js';
import { db } from '../store/db.js';
import { ScheduledOrder, BingXAccountConfig } from '../types/index.js';

class HighPrecisionBingXSchedulerEngine {
  private activeTimers: Map<string, NodeJS.Timeout> = new Map();
  private isInitialized: boolean = false;

  public async init(): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;

    console.log('🚀 Initializing High-Precision BingX Order Scheduler Engine...');

    // 1. Sync server clock
    const clockSync = await bingxClient.syncServerTime();
    console.log(
      `⏱️ BingX Exchange Clock Synced: Offset = ${clockSync.offsetMs > 0 ? '+' : ''}${clockSync.offsetMs} ms (RTT = ${clockSync.rttMs} ms)`
    );

    // 2. Periodically re-sync clock every 60 seconds
    setInterval(async () => {
      await bingxClient.syncServerTime();
    }, 60 * 1000);

    // 3. Reload pending orders from store
    const pendingOrders = db.getOrders().filter((o) => o.status === 'PENDING');
    console.log(`📋 Loaded ${pendingOrders.length} pending scheduled orders from persistent database.`);

    for (const order of pendingOrders) {
      this.scheduleOrder(order);
    }
  }

  /**
   * Schedule an order for precise execution at targetTime (UTC Milliseconds)
   */
  public scheduleOrder(order: ScheduledOrder): void {
    // Clear existing timer if re-scheduling
    this.cancelTimer(order.id);

    const nowLocal = Date.now();
    const offset = bingxClient.getServerOffset();

    // Calculate expected local machine timestamp when BingX server timestamp equals order.targetTime
    const localTargetMs = order.targetTime - offset;
    const delayMs = localTargetMs - nowLocal;

    if (delayMs <= 0) {
      console.warn(`Order ${order.id} target time is in the past (${delayMs} ms overdue). Executing immediately.`);
      this.executeOrderNow(order);
      return;
    }

    console.log(
      `⏰ Order ${order.id} (${order.symbol} ${order.side} ${order.quantity} qty @ ${order.marketType}) scheduled in ${delayMs} ms at target ${order.targetTimeFormatted}`
    );

    db.addLog({
      id: `LOG-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      orderId: order.id,
      timestamp: Date.now(),
      level: 'INFO',
      message: `Order scheduled for ${order.targetTimeFormatted} (Delay: ${delayMs}ms, ServerOffset: ${offset > 0 ? '+' : ''}${offset}ms)`,
    });

    // 2-Stage High Precision Timer:
    // Stage 1: If delay is > 50ms, sleep with setTimeout until 50ms before target.
    // Stage 2: Spin-lock with high-resolution process.hrtime.bigint() for final 50ms.
    if (delayMs > 50) {
      const macroTimer = setTimeout(() => {
        this.spinAndExecute(order);
      }, delayMs - 50);

      this.activeTimers.set(order.id, macroTimer);
    } else {
      this.spinAndExecute(order);
    }
  }

  /**
   * Stage 2 Spin-Lock for microsecond/millisecond alignment
   */
  private spinAndExecute(order: ScheduledOrder): void {
    const offset = bingxClient.getServerOffset();
    const targetServerMs = order.targetTime;

    const spinStart = process.hrtime.bigint();

    while (true) {
      const currentServerMs = Date.now() + offset;
      if (currentServerMs >= targetServerMs) {
        break;
      }
      // Brief yield if > 5ms remaining to prevent high CPU lockup during longer spins
      const remainingMs = targetServerMs - currentServerMs;
      if (remainingMs > 5) {
        const start = Date.now();
        while (Date.now() - start < 1) {}
      }
    }

    const spinEnd = process.hrtime.bigint();
    const spinDurationUs = Number(spinEnd - spinStart) / 1000;

    // Trigger order placement immediately
    this.executeOrderNow(order, spinDurationUs);
  }

  /**
   * Dispatches parallel order execution to BingX REST API and records metrics
   */
  private async executeOrderNow(order: ScheduledOrder, spinDurationUs: number = 0): Promise<void> {
    this.activeTimers.delete(order.id);

    // Update status to EXECUTING
    db.updateOrder(order.id, { status: 'EXECUTING' });

    const triggerLocalTime = Date.now();
    const triggerServerTime = triggerLocalTime + bingxClient.getServerOffset();
    const driftMs = triggerServerTime - order.targetTime;

    console.log(
      `⚡ EXECUTING ORDER ${order.id} on BingX! (Target: ${order.targetTime}, TriggerServerTime: ${triggerServerTime}, Drift: ${driftMs > 0 ? '+' : ''}${driftMs}ms)`
    );

    db.addLog({
      id: `LOG-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      orderId: order.id,
      timestamp: triggerLocalTime,
      level: 'INFO',
      message: `Triggering BingX API parallel execution (Drift: ${driftMs > 0 ? '+' : ''}${driftMs}ms, Spin: ${spinDurationUs.toFixed(1)}µs)`,
    });

    // Determine target accounts
    const allAccounts = db.getAccounts().filter((a) => a.enabled !== false);
    let targetAccounts: BingXAccountConfig[] = [];

    if (order.accountIds === 'ALL') {
      targetAccounts = allAccounts;
    } else if (Array.isArray(order.accountIds)) {
      targetAccounts = allAccounts.filter((a) => order.accountIds.includes(a.id));
    }

    if (targetAccounts.length === 0) {
      const completionTime = Date.now();
      const errMsg = 'No active/enabled BingX accounts selected for order execution.';
      db.updateOrder(order.id, {
        status: 'FAILED',
        actualTime: completionTime,
        precisionDriftMs: driftMs,
        errorMessage: errMsg,
      });
      db.addLog({
        id: `LOG-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        orderId: order.id,
        timestamp: completionTime,
        level: 'ERROR',
        message: `Execution Failed: ${errMsg}`,
      });
      return;
    }

    try {
      // Parallel execution across target accounts
      const results = await bingxClient.placeOrderParallel(targetAccounts, order);
      const completionTime = Date.now();

      const hasSuccess = results.some((r) => r.success);
      const allSuccess = results.every((r) => r.success);
      const finalStatus = allSuccess ? 'COMPLETED' : hasSuccess ? 'COMPLETED' : 'FAILED';

      const errorMessages = results
        .filter((r) => !r.success)
        .map((r) => `${r.accountName}: ${r.error}`)
        .join('; ');

      db.updateOrder(order.id, {
        status: finalStatus,
        actualTime: completionTime,
        precisionDriftMs: driftMs,
        executionResults: results,
        errorMessage: errorMessages || undefined,
      });

      if (hasSuccess) {
        db.addLog({
          id: `LOG-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          orderId: order.id,
          timestamp: completionTime,
          level: 'SUCCESS',
          message: `Order filled on ${results.filter((r) => r.success).length}/${targetAccounts.length} BingX accounts! (Drift: ${driftMs > 0 ? '+' : ''}${driftMs}ms)`,
          details: results,
        });
        console.log(`✅ Order ${order.id} SUCCESS on BingX.`);
      } else {
        db.addLog({
          id: `LOG-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          orderId: order.id,
          timestamp: completionTime,
          level: 'ERROR',
          message: `BingX Order Execution Failed: ${errorMessages}`,
          details: results,
        });
        console.error(`❌ Order ${order.id} FAILED: ${errorMessages}`);
      }
    } catch (err: any) {
      const errTime = Date.now();
      db.updateOrder(order.id, {
        status: 'FAILED',
        actualTime: errTime,
        precisionDriftMs: driftMs,
        errorMessage: err.message,
      });

      db.addLog({
        id: `LOG-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        orderId: order.id,
        timestamp: errTime,
        level: 'ERROR',
        message: `Exception during order execution: ${err.message}`,
      });
    }
  }

  /**
   * Cancel a pending scheduled order
   */
  public cancelOrder(orderId: string): boolean {
    this.cancelTimer(orderId);
    const updated = db.updateOrder(orderId, { status: 'CANCELLED' });

    if (updated) {
      db.addLog({
        id: `LOG-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        orderId,
        timestamp: Date.now(),
        level: 'WARN',
        message: `Scheduled Order ${orderId} was cancelled by user.`,
      });
      return true;
    }
    return false;
  }

  public getActiveTimersCount(): number {
    return this.activeTimers.size;
  }

  private cancelTimer(orderId: string): void {
    const existing = this.activeTimers.get(orderId);
    if (existing) {
      clearTimeout(existing);
      this.activeTimers.delete(orderId);
    }
  }
}

export const schedulerEngine = new HighPrecisionBingXSchedulerEngine();
