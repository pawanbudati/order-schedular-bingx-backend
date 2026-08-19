import { Router } from 'express';
import { db } from '../store/db.js';
import { bingxClient } from '../bingx/client.js';
import { bingxWebSocket } from '../bingx/websocket.js';
import { schedulerEngine } from '../scheduler/engine.js';
import { ScheduledOrderRequest, BingXAccountConfig, ScheduledOrder } from '../types/index.js';

const router = Router();

// --- 1. System Status & Auth ---
router.get('/status', (req, res) => {
  const istTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST';
  const utcTime = new Date().toISOString();

  res.json({
    status: 'ok',
    timeIST: istTime,
    timeUTC: utcTime,
    timestamp: Date.now(),
    serverOffsetMs: bingxClient.getServerOffset(),
    rttMs: bingxClient.getRttMs(),
    activeTimersCount: schedulerEngine.getActiveTimersCount(),
    accountsCount: db.getAccounts().length,
    ordersCount: db.getOrders().length,
  });
});

router.post('/verify-passcode', (req, res) => {
  const { passcode } = req.body;
  const currentPasscode = db.getPasscode();

  if (passcode === currentPasscode) {
    res.json({ success: true, message: 'Authentication successful' });
  } else {
    res.status(401).json({ success: false, message: 'Invalid Admin Passcode' });
  }
});

// --- 2. Accounts Management ---
router.get('/accounts', (req, res) => {
  const accounts = db.getAccounts().map((acc) => ({
    ...acc,
    secretKeyMasked: acc.secretKey ? `${acc.secretKey.substring(0, 4)}...${acc.secretKey.slice(-4)}` : '',
  }));
  res.json({ success: true, data: accounts });
});

router.post('/accounts', (req, res) => {
  const { id, accountName, apiKey, secretKey, environment, isDefault, enabled } = req.body;

  if (!accountName || !apiKey || !secretKey) {
    res.status(400).json({ success: false, message: 'Account Name, API Key, and Secret Key are required.' });
    return;
  }

  const newAccount: BingXAccountConfig = {
    id: id || `ACC-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    accountName,
    apiKey,
    secretKey,
    environment: environment || 'VST',
    isDefault: !!isDefault,
    enabled: enabled !== false,
    createdAt: Date.now(),
  };

  const saved = db.saveAccount(newAccount);
  db.addLog({
    id: `LOG-${Date.now()}`,
    timestamp: Date.now(),
    level: 'INFO',
    message: `BingX Account saved: ${saved.accountName} (${saved.environment})`,
  });

  res.json({ success: true, data: saved });
});

router.delete('/accounts/:id', (req, res) => {
  const { id } = req.params;
  const deleted = db.deleteAccount(id);
  if (deleted) {
    res.json({ success: true, message: 'Account deleted successfully' });
  } else {
    res.status(404).json({ success: false, message: 'Account not found' });
  }
});

// --- 3. Balance & Market Data ---
router.get('/balance', async (req, res) => {
  const { accountId } = req.query;
  const accounts = db.getAccounts().filter((a) => a.enabled !== false);

  if (accounts.length === 0) {
    res.json({
      success: true,
      data: {
        asset: 'USDT',
        balance: 10000.0,
        equity: 10000.0,
        availableMargin: 10000.0,
        usedMargin: 0.0,
        unrealizedProfit: 0.0,
        accountId: 'DEMO-MODE',
        accountName: 'Demo Simulation Account',
        environment: 'VST',
      },
    });
    return;
  }

  let targetAccount = accounts[0];
  if (accountId) {
    const found = accounts.find((a) => a.id === accountId);
    if (found) targetAccount = found;
  }

  const balance = await bingxClient.getAccountBalance(targetAccount);
  res.json({ success: true, data: balance });
});

router.get('/tickers', async (req, res) => {
  const wsTickers = bingxWebSocket.getTickers();
  if (wsTickers && wsTickers.length > 0) {
    res.json({ success: true, data: wsTickers });
  } else {
    const apiTickers = await bingxClient.getTickers();
    res.json({ success: true, data: apiTickers });
  }
});

router.get('/instruments', async (req, res) => {
  try {
    const catalog = await bingxClient.getContractsCatalog();
    const { search, category } = req.query;

    let filtered = catalog;

    if (category && category !== 'All' && category !== 'Favorites') {
      filtered = filtered.filter((item) => item.category.toLowerCase() === String(category).toLowerCase());
    }

    if (search && String(search).trim() !== '') {
      const q = String(search).toLowerCase().trim();
      filtered = filtered.filter(
        (item) =>
          item.displaySymbol.toLowerCase().includes(q) ||
          item.displayName.toLowerCase().includes(q) ||
          item.asset.toLowerCase().includes(q) ||
          item.symbol.toLowerCase().includes(q)
      );
    }

    res.json({ success: true, data: filtered });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- 4. Orders Management ---
router.get('/orders', (req, res) => {
  const orders = db.getOrders();
  res.json({ success: true, data: orders });
});

router.post('/orders', (req, res) => {
  const body: ScheduledOrderRequest = req.body;

  if (!body.symbol || !body.side || !body.quantity || !body.targetTime) {
    res.status(400).json({ success: false, message: 'Symbol, side, quantity, and targetTime are required.' });
    return;
  }

  const targetDate = new Date(body.targetTime);
  const targetTimeFormatted = targetDate.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST';

  const newOrder: ScheduledOrder = {
    ...body,
    id: `ORD-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    marketType: body.marketType || 'SWAP',
    positionSide: body.positionSide || (body.side === 'BUY' ? 'LONG' : 'SHORT'),
    type: body.type || 'MARKET',
    leverage: body.leverage || 10,
    accountIds: body.accountIds || 'ALL',
    targetTimeFormatted,
    status: 'PENDING',
    createdAt: Date.now(),
  };

  db.addOrder(newOrder);
  schedulerEngine.scheduleOrder(newOrder);

  res.json({ success: true, data: newOrder });
});

router.post('/orders/:id/execute-now', (req, res) => {
  const { id } = req.params;
  const order = db.getOrder(id);

  if (!order) {
    res.status(404).json({ success: false, message: 'Order not found' });
    return;
  }

  // Update target time to now and trigger immediate execution
  order.targetTime = Date.now() + bingxClient.getServerOffset();
  order.targetTimeFormatted = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST (Immediate)';

  schedulerEngine.scheduleOrder(order);
  res.json({ success: true, message: 'Immediate execution triggered', data: order });
});

router.delete('/orders/:id', (req, res) => {
  const { id } = req.params;
  const cancelled = schedulerEngine.cancelOrder(id);
  const deleted = db.deleteOrder(id);

  if (cancelled || deleted) {
    res.json({ success: true, message: 'Order cancelled/deleted successfully' });
  } else {
    res.status(404).json({ success: false, message: 'Order not found' });
  }
});

// --- 5. Logs Management ---
router.get('/logs', (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 100;
  const logs = db.getLogs(limit);
  res.json({ success: true, data: logs });
});

router.delete('/logs', (req, res) => {
  db.clearLogs();
  res.json({ success: true, message: 'Logs cleared successfully' });
});

export default router;
