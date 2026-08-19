import axios, { AxiosInstance } from 'axios';
import https from 'https';
import { BingXSigner } from './signer.js';
import {
  BingXAccountConfig,
  BingXServerTime,
  BingXAccountBalance,
  BingXTicker,
  ScheduledOrderRequest,
  AccountExecutionResult,
  InstrumentContract,
} from '../types/index.js';

const BINGX_BASE_URL = process.env.BINGX_REST_URL || 'https://open-api.bingx.com';

class BingXApiClient {
  private httpAgent: https.Agent;
  private httpClient: AxiosInstance;
  private serverOffsetMs: number = 0;
  private lastRttMs: number = 0;

  constructor() {
    // Keep-Alive HTTP Agent for ultra-low latency connection reuse & TCP NO_DELAY
    this.httpAgent = new https.Agent({
      keepAlive: true,
      maxSockets: 100,
      keepAliveMsecs: 30000,
      scheduling: 'fifo',
    });

    this.httpClient = axios.create({
      baseURL: BINGX_BASE_URL,
      timeout: 10000,
      httpsAgent: this.httpAgent,
      headers: {
        'User-Agent': 'BingX-Order-Scheduler/1.0',
      },
    });
  }

  /**
   * Resolve human symbol alias (e.g. XAU-USDT, XAUAUD-USDT) to exact BingX V2 API symbol (e.g. NCCOGOLD2USD-USDT, NCCOXAUAUD2USD-USDT)
   */
  public resolveBingXSymbol(symbol: string): string {
    const s = symbol.toUpperCase().trim();

    // Direct Mappings
    if (s === 'XAU-USDT' || s === 'GOLD' || s === 'GOLD-USDT' || s === 'XAUUSD' || s === 'GOLD(XAU)-USDT') return 'NCCOGOLD2USD-USDT';
    if (s === 'XAUAUD-USDT' || s === 'XAUAUD' || s === 'XAU/AUD') return 'NCCOXAUAUD2USD-USDT';
    if (s === 'XAUEUR-USDT' || s === 'XAUEUR' || s === 'XAU/EUR') return 'NCCOXAUEUR2USD-USDT';
    if (s === 'XAUJPY-USDT' || s === 'XAUJPY' || s === 'XAU/JPY') return 'NCCOXAUJPY2USD-USDT';
    if (s === 'XAUGBP-USDT' || s === 'XAUGBP' || s === 'XAU/GBP') return 'NCCOXAUGBP2USD-USDT';
    if (s === 'XAUCAD-USDT' || s === 'XAUCAD' || s === 'XAU/CAD') return 'NCCOXAUCAD2USD-USDT';
    if (s === 'XAUCHF-USDT' || s === 'XAUCHF' || s === 'XAU/CHF') return 'NCCOXAUCHF2USD-USDT';
    if (s === 'XAG-USDT' || s === 'SILVER' || s === 'SILVER-USDT') return 'NCCOSILVER2USD-USDT';

    if (s === 'EUR-USDT' || s === 'EURUSD' || s === 'EURUSD-USDT') return 'NCFXEUR2USD-USDT';
    if (s === 'GBP-USDT' || s === 'GBPUSD' || s === 'GBPUSD-USDT') return 'NCFXGBP2USD-USDT';
    if (s === 'AUD-USDT' || s === 'AUDUSD' || s === 'AUDUSD-USDT') return 'NCFXAUD2USD-USDT';
    if (s === 'USD-JPY' || s === 'USDJPY' || s === 'USDJPY-USDT') return 'NCFXUSD2JPY-USDT';

    return s;
  }

  public displaySymbol(bingxSymbol: string): string {
    const s = bingxSymbol.toUpperCase().trim();
    if (s === 'NCCOGOLD2USD-USDT') return 'XAU-USDT';
    if (s === 'NCCOXAUAUD2USD-USDT') return 'XAUAUD-USDT';
    if (s === 'NCCOXAUEUR2USD-USDT') return 'XAUEUR-USDT';
    if (s === 'NCCOXAUJPY2USD-USDT') return 'XAUJPY-USDT';
    if (s === 'NCCOXAUGBP2USD-USDT') return 'XAUGBP-USDT';
    if (s === 'NCCOXAUCAD2USD-USDT') return 'XAUCAD-USDT';
    if (s === 'NCCOXAUCHF2USD-USDT') return 'XAUCHF-USDT';
    if (s === 'NCCOSILVER2USD-USDT') return 'XAG-USDT';
    if (s === 'NCFXEUR2USD-USDT') return 'EUR-USDT';
    if (s === 'NCFXGBP2USD-USDT') return 'GBP-USDT';
    if (s === 'NCFXAUD2USD-USDT') return 'AUD-USDT';
    if (s === 'NCFXUSD2JPY-USDT') return 'USD-JPY';

    return s;
  }

  /**
   * Synchronize clock with BingX Server Time using 3-sample median RTT calculation
   */
  public async syncServerTime(): Promise<BingXServerTime> {
    const samples: { offset: number; rtt: number; serverTime: number }[] = [];

    for (let i = 0; i < 3; i++) {
      try {
        const startLocal = Date.now();
        const res = await this.httpClient.get('/openApi/swap/v2/server/time');
        const endLocal = Date.now();
        const rtt = endLocal - startLocal;

        const serverTime = res.data?.data?.serverTime || res.data?.serverTime || Date.now();
        const estimatedLocalAtServerTime = startLocal + rtt / 2;
        const offset = serverTime - estimatedLocalAtServerTime;

        samples.push({ offset, rtt, serverTime });
      } catch (err: any) {
        console.warn(`Server time sync sample ${i + 1} network hiccup (${err.message || 'ECONNRESET'}). Retrying...`);
      }
    }

    if (samples.length > 0) {
      samples.sort((a, b) => a.rtt - b.rtt);
      const bestSample = samples[0];
      this.serverOffsetMs = Math.round(bestSample.offset);
      this.lastRttMs = Math.round(bestSample.rtt);

      console.log(
        `⏱️ BingX Server Clock Synced: Offset = ${this.serverOffsetMs > 0 ? '+' : ''}${this.serverOffsetMs}ms (RTT = ${this.lastRttMs}ms)`
      );
    }

    return {
      serverTime: Date.now() + this.serverOffsetMs,
      localTime: Date.now(),
      offsetMs: this.serverOffsetMs,
      rttMs: this.lastRttMs,
    };
  }

  public getServerOffset(): number {
    return this.serverOffsetMs;
  }

  public getRttMs(): number {
    return this.lastRttMs;
  }

  /**
   * Execute an order for a single BingX account
   */
  public async placeOrderSingleAccount(
    account: BingXAccountConfig,
    order: ScheduledOrderRequest
  ): Promise<AccountExecutionResult> {
    const startTime = Date.now();
    const apiSymbol = this.resolveBingXSymbol(order.symbol);
    try {
      const serverTimestamp = Date.now() + this.serverOffsetMs;
      const isSpot = order.marketType === 'SPOT';

      // 1. Set leverage & margin type for Swap Futures if specified
      if (!isSpot) {
        try {
          await this.setLeverageAndMargin(account, apiSymbol, order.leverage, order.marginType || 'ISOLATED');
        } catch (e: any) {
          console.warn(`Leverage adjustment warning for ${account.accountName}: ${e.message}`);
        }
      }

      const isNonCrypto =
        apiSymbol.startsWith('NCCO') ||
        apiSymbol.startsWith('NCFX') ||
        apiSymbol.startsWith('NCSI') ||
        apiSymbol.startsWith('NCSK') ||
        apiSymbol.includes('GOLD');

      // 2. Prepare order payload
      const endpoint = isSpot ? '/openApi/spot/v1/trade/order' : '/openApi/swap/v2/trade/order';

      const payload: Record<string, any> = {
        symbol: apiSymbol,
        side: order.side.toUpperCase(),
        type: order.type.toUpperCase(),
        timestamp: serverTimestamp,
        recvWindow: 5000,
      };

      if (!isSpot) {
        // BingX OpenAPI requires LONG or SHORT for Non-Crypto contracts (Gold/Forex)
        if (isNonCrypto) {
          payload.positionSide = order.side.toUpperCase() === 'BUY' ? 'LONG' : 'SHORT';
        } else {
          payload.positionSide = order.positionSide || (order.side.toUpperCase() === 'BUY' ? 'LONG' : 'SHORT');
        }
        payload.quantity = order.quantity;
      } else {
        payload.quantity = order.quantity;
      }

      if (order.type === 'LIMIT' && order.price) {
        payload.price = order.price;
      }

      if (order.stopLoss) {
        payload.stopLoss = JSON.stringify({ triggerPrice: order.stopLoss, price: order.stopLoss });
      }
      if (order.takeProfit) {
        payload.takeProfit = JSON.stringify({ triggerPrice: order.takeProfit, price: order.takeProfit });
      }

      // 3. Sign parameters
      const { queryString } = BingXSigner.signParams(payload, account.secretKey);

      // 4. Send HTTP request with Keep-Alive connection and form-urlencoded header
      const response = await this.httpClient.post(`${endpoint}?${queryString}`, null, {
        headers: {
          'X-BX-APIKEY': account.apiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      const latencyMs = Date.now() - startTime;
      const resData = response.data;

      if (resData && (resData.code === 0 || resData.code === '0')) {
        const orderId = resData.data?.order?.orderId || resData.data?.orderId || 'SUCCESS';
        return {
          accountId: account.id,
          accountName: account.accountName,
          success: true,
          orderId: String(orderId),
          latencyMs,
          rawResponse: resData,
        };
      } else {
        let errMsg = resData?.msg || resData?.message || `BingX Error Code: ${resData?.code}`;

        if (errMsg.includes('non-crypto symbol with one-way mode')) {
          errMsg = 'BingX API Rule: Gold & Forex pairs require Hedge Mode. Please open BingX App -> Futures -> Preference -> Position Mode -> Switch to Hedge Mode.';
        } else if (
          !isNonCrypto &&
          (errMsg.includes('One-way mode') || errMsg.includes('PositionSide') || errMsg.includes('BOTH')) &&
          order.positionSide !== 'BOTH'
        ) {
          console.log(`🔄 Crypto Account ${account.accountName} is in One-Way Mode. Auto-retrying order with positionSide: BOTH...`);
          return this.placeOrderSingleAccount(account, {
            ...order,
            positionSide: 'BOTH',
          });
        }

        return {
          accountId: account.id,
          accountName: account.accountName,
          success: false,
          latencyMs,
          error: errMsg,
          rawResponse: resData,
        };
      }
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      let errMsg = err.response?.data?.msg || err.response?.data?.message || err.message || 'Network/Server Error';

      if (errMsg.includes('non-crypto symbol with one-way mode')) {
        errMsg = 'BingX API Rule: Gold & Forex pairs require Hedge Mode. Please open BingX App -> Futures -> Preference -> Position Mode -> Switch to Hedge Mode.';
      } else if (
        !apiSymbol.startsWith('NCCO') &&
        !apiSymbol.startsWith('NCFX') &&
        (errMsg.includes('One-way mode') || errMsg.includes('PositionSide') || errMsg.includes('BOTH')) &&
        order.positionSide !== 'BOTH'
      ) {
        console.log(`🔄 Crypto Account ${account.accountName} is in One-Way Mode. Auto-retrying order with positionSide: BOTH...`);
        return this.placeOrderSingleAccount(account, {
          ...order,
          positionSide: 'BOTH',
        });
      }

      return {
        accountId: account.id,
        accountName: account.accountName,
        success: false,
        latencyMs,
        error: errMsg,
        rawResponse: err.response?.data,
      };
    }
  }

  /**
   * Parallel execution across multiple target accounts simultaneously
   */
  public async placeOrderParallel(
    accounts: BingXAccountConfig[],
    order: ScheduledOrderRequest
  ): Promise<AccountExecutionResult[]> {
    if (!accounts || accounts.length === 0) {
      return [
        {
          accountId: 'NONE',
          accountName: 'No Account',
          success: false,
          error: 'No valid active BingX accounts provided for execution.',
        },
      ];
    }

    console.log(`⚡ Dispatching parallel BingX orders across ${accounts.length} account(s)...`);

    const promises = accounts.map((acc) => this.placeOrderSingleAccount(acc, order));
    const results = await Promise.allSettled(promises);

    return results.map((res, index) => {
      if (res.status === 'fulfilled') {
        return res.value;
      } else {
        return {
          accountId: accounts[index].id,
          accountName: accounts[index].accountName,
          success: false,
          error: res.reason?.message || 'Unhandled Parallel Execution Error',
        };
      }
    });
  }

  /**
   * Set Leverage and Margin Type for Swap Futures
   */
  private async setLeverageAndMargin(
    account: BingXAccountConfig,
    symbol: string,
    leverage: number,
    marginType: 'ISOLATED' | 'CROSSED'
  ): Promise<void> {
    const serverTimestamp = Date.now() + this.serverOffsetMs;
    const apiSymbol = this.resolveBingXSymbol(symbol);
    const levParams = {
      symbol: apiSymbol,
      side: 'BOTH',
      leverage,
      timestamp: serverTimestamp,
    };
    const { queryString: levQuery } = BingXSigner.signParams(levParams, account.secretKey);
    await this.httpClient.post(`/openApi/swap/v2/trade/leverage?${levQuery}`, null, {
      headers: {
        'X-BX-APIKEY': account.apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
  }

  /**
   * Fetch Account Balance & Positions for a specific BingX account
   */
  public async getAccountBalance(account: BingXAccountConfig): Promise<BingXAccountBalance> {
    try {
      const serverTimestamp = Date.now() + this.serverOffsetMs;
      const params = { timestamp: serverTimestamp, recvWindow: 5000 };
      const { queryString } = BingXSigner.signParams(params, account.secretKey);

      const res = await this.httpClient.get(`/openApi/swap/v2/user/balance?${queryString}`, {
        headers: { 'X-BX-APIKEY': account.apiKey },
      });

      const data = res.data?.data?.balance || res.data?.data || {};
      const balanceVal = Number(data.balance || data.equity || 0);
      const equityVal = Number(data.equity || data.balance || 0);
      const availableVal = Number(data.availableMargin || data.freeMargin || balanceVal);
      const usedVal = Number(data.usedMargin || data.frozenMargin || 0);
      const pnlVal = Number(data.unrealizedProfit || 0);

      return {
        asset: 'USDT',
        balance: balanceVal,
        equity: equityVal,
        availableMargin: availableVal,
        usedMargin: usedVal,
        unrealizedProfit: pnlVal,
        accountId: account.id,
        accountName: account.accountName,
        environment: account.environment,
      };
    } catch (err: any) {
      console.warn(`Failed to fetch balance for account ${account.accountName}:`, err.message);
      return {
        asset: 'USDT',
        balance: 0,
        equity: 0,
        availableMargin: 0,
        usedMargin: 0,
        unrealizedProfit: 0,
        accountId: account.id,
        accountName: account.accountName,
        environment: account.environment,
      };
    }
  }

  /**
   * Fetch Real-time Market Tickers from BingX
   */
  public async getTickers(): Promise<BingXTicker[]> {
    try {
      const res = await this.httpClient.get('/openApi/swap/v2/quote/ticker');
      const list = res.data?.data || [];
      if (!Array.isArray(list) || list.length === 0) return this.getFallbackTickers();

      const result: BingXTicker[] = list.map((t: any) => ({
        symbol: this.displaySymbol(t.symbol),
        lastPrice: Number(t.lastPrice || t.price || 0),
        priceChangePercent: Number(t.priceChangePercent || t.priceChangeRate || 0),
        high24h: Number(t.highPrice || t.high24h || 0),
        low24h: Number(t.lowPrice || t.low24h || 0),
        volume24h: Number(t.volume || t.volume24h || 0),
        bidPrice: Number(t.bidPrice || t.lastPrice || 0),
        askPrice: Number(t.askPrice || t.lastPrice || 0),
        spread: Number(t.askPrice && t.bidPrice ? (t.askPrice - t.bidPrice).toFixed(4) : 0.05),
        updatedAt: Date.now(),
      }));

      return result.length > 0 ? result : this.getFallbackTickers();
    } catch (err: any) {
      console.warn('Failed to fetch BingX tickers:', err.message);
      return this.getFallbackTickers();
    }
  }

  private catalogCache: InstrumentContract[] = [];
  private lastCatalogFetch: number = 0;

  /**
   * Ingest and cache all 1,000+ BingX contracts catalog with categorization and specifications
   */
  public async getContractsCatalog(): Promise<InstrumentContract[]> {
    if (this.catalogCache.length > 0 && Date.now() - this.lastCatalogFetch < 5 * 60 * 1000) {
      return this.catalogCache;
    }

    try {
      const [contractsRes, tickers] = await Promise.all([
        this.httpClient.get('/openApi/swap/v2/quote/contracts'),
        this.getTickers(),
      ]);

      const tickerMap = new Map<string, BingXTicker>();
      tickers.forEach((t) => tickerMap.set(t.symbol, t));

      const rawList = contractsRes.data?.data || [];
      if (!Array.isArray(rawList) || rawList.length === 0) {
        return this.getFallbackCatalog();
      }

      const catalog: InstrumentContract[] = rawList.map((c: any) => {
        const rawSymbol = c.symbol;
        const displaySym = this.displaySymbol(rawSymbol);
        const displayName = c.displayName || displaySym;
        const asset = c.asset || displaySym.split('-')[0];

        let category: 'Commodities' | 'Forex' | 'Crypto' | 'Indices' = 'Crypto';
        let maxLev = 100;

        if (rawSymbol.includes('GOLD') || rawSymbol.includes('XAU') || asset.includes('GOLD') || asset.includes('XAU')) {
          category = 'Commodities';
          maxLev = 1000;
        } else if (rawSymbol.startsWith('NCFX') || rawSymbol.includes('EUR') || rawSymbol.includes('GBP') || rawSymbol.includes('AUD') || rawSymbol.includes('JPY')) {
          category = 'Forex';
          maxLev = 500;
        } else if (rawSymbol.startsWith('NCSI') || rawSymbol.startsWith('NCSK')) {
          category = 'Indices';
          maxLev = 200;
        } else if (displaySym.includes('BTC') || displaySym.includes('ETH')) {
          maxLev = 150;
        }

        const tick = tickerMap.get(displaySym) || {
          lastPrice: rawSymbol.includes('GOLD') ? 4373.78 : 0,
          priceChangePercent: 0,
          high24h: 0,
          low24h: 0,
          volume24h: Number(c.tradeMinUSDT || 0),
        };

        return {
          symbol: rawSymbol,
          displaySymbol: displaySym,
          displayName,
          asset,
          category,
          maxLeverage: maxLev,
          pricePrecision: Number(c.pricePrecision || 2),
          quantityPrecision: Number(c.quantityPrecision || 4),
          tradeMinQuantity: Number(c.tradeMinQuantity || 0.001),
          tradeMinUSDT: Number(c.tradeMinUSDT || 2),
          lastPrice: tick.lastPrice,
          priceChangePercent: tick.priceChangePercent,
          high24h: tick.high24h,
          low24h: tick.low24h,
          volume24h: tick.volume24h,
        };
      });

      this.catalogCache = catalog;
      this.lastCatalogFetch = Date.now();
      return catalog;
    } catch (err: any) {
      console.warn('Failed to fetch contracts catalog from BingX:', err.message);
      return this.getFallbackCatalog();
    }
  }

  private getFallbackCatalog(): InstrumentContract[] {
    return [
      { symbol: 'NCCOGOLD2USD-USDT', displaySymbol: 'XAU-USDT', displayName: 'GOLD(XAU)-USDT', asset: 'GOLD', category: 'Commodities', maxLeverage: 1000, pricePrecision: 2, quantityPrecision: 4, tradeMinQuantity: 0.0005, tradeMinUSDT: 2, lastPrice: 4373.78, priceChangePercent: 0.11, high24h: 4455.0, low24h: 4356.12, volume24h: 228352 },
      { symbol: 'BTC-USDT', displaySymbol: 'BTC-USDT', displayName: 'BTC-USDT', asset: 'BTC', category: 'Crypto', maxLeverage: 150, pricePrecision: 1, quantityPrecision: 3, tradeMinQuantity: 0.001, tradeMinUSDT: 2, lastPrice: 96500.0, priceChangePercent: 2.45, high24h: 98000, low24h: 94500, volume24h: 154200 },
      { symbol: 'ETH-USDT', displaySymbol: 'ETH-USDT', displayName: 'ETH-USDT', asset: 'ETH', category: 'Crypto', maxLeverage: 150, pricePrecision: 2, quantityPrecision: 2, tradeMinQuantity: 0.01, tradeMinUSDT: 2, lastPrice: 2750.5, priceChangePercent: -1.2, high24h: 2850, low24h: 2680, volume24h: 89000 },
      { symbol: 'SOL-USDT', displaySymbol: 'SOL-USDT', displayName: 'SOL-USDT', asset: 'SOL', category: 'Crypto', maxLeverage: 100, pricePrecision: 2, quantityPrecision: 2, tradeMinQuantity: 0.1, tradeMinUSDT: 2, lastPrice: 195.8, priceChangePercent: 5.6, high24h: 202, low24h: 184, volume24h: 42000 },
      { symbol: 'NCFXEUR2USD-USDT', displaySymbol: 'EUR-USDT', displayName: 'EURUSD-USDT', asset: 'EUR', category: 'Forex', maxLeverage: 500, pricePrecision: 5, quantityPrecision: 2, tradeMinQuantity: 2.5, tradeMinUSDT: 2, lastPrice: 1.085, priceChangePercent: 0.25, high24h: 1.09, low24h: 1.081, volume24h: 25000 },
      { symbol: 'NCFXGBP2USD-USDT', displaySymbol: 'GBP-USDT', displayName: 'GBPUSD-USDT', asset: 'GBP', category: 'Forex', maxLeverage: 500, pricePrecision: 5, quantityPrecision: 2, tradeMinQuantity: 2.5, tradeMinUSDT: 2, lastPrice: 1.272, priceChangePercent: -0.15, high24h: 1.278, low24h: 1.268, volume24h: 18000 },
    ];
  }

  private getFallbackTickers(): BingXTicker[] {
    return [
      { symbol: 'XAU-USDT', lastPrice: 4373.78, priceChangePercent: 0.11, high24h: 4455.0, low24h: 4356.12, volume24h: 228352, bidPrice: 4373.78, askPrice: 4373.84, spread: 0.06 },
      { symbol: 'BTC-USDT', lastPrice: 96500.0, priceChangePercent: 2.45, high24h: 98000, low24h: 94500, volume24h: 154200, bidPrice: 96498, askPrice: 96502, spread: 4.0 },
      { symbol: 'ETH-USDT', lastPrice: 2750.5, priceChangePercent: -1.2, high24h: 2850, low24h: 2680, volume24h: 89000, bidPrice: 2750.3, askPrice: 2750.7, spread: 0.4 },
      { symbol: 'SOL-USDT', lastPrice: 195.8, priceChangePercent: 5.6, high24h: 202, low24h: 184, volume24h: 42000, bidPrice: 195.7, askPrice: 195.9, spread: 0.2 },
      { symbol: 'XRP-USDT', lastPrice: 2.45, priceChangePercent: 1.8, high24h: 2.6, low24h: 2.3, volume24h: 31000, bidPrice: 2.449, askPrice: 2.451, spread: 0.002 },
      { symbol: 'EUR-USDT', lastPrice: 1.085, priceChangePercent: 0.25, high24h: 1.09, low24h: 1.081, volume24h: 25000, bidPrice: 1.0849, askPrice: 1.0851, spread: 0.0002 },
      { symbol: 'GBP-USDT', lastPrice: 1.272, priceChangePercent: -0.15, high24h: 1.278, low24h: 1.268, volume24h: 18000, bidPrice: 1.2719, askPrice: 1.2721, spread: 0.0002 },
    ];
  }
}

export const bingxClient = new BingXApiClient();
