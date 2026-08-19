import WebSocket from 'ws';
import zlib from 'zlib';
import { BingXTicker } from '../types/index.js';
import { bingxClient } from './client.js';

const BINGX_WS_URL = process.env.BINGX_WS_URL || 'wss://open-api-swap.bingx.com/swap-market';

class BingXWebSocketStream {
  private ws: WebSocket | null = null;
  private isConnected: boolean = false;
  private tickerStore: Map<string, BingXTicker> = new Map();
  private subscribers: Array<(tickers: BingXTicker[]) => void> = [];
  private pingInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.initDefaultTickers();
  }

  private initDefaultTickers() {
    const defaults: BingXTicker[] = [
      { symbol: 'XAU-USDT', lastPrice: 4373.78, priceChangePercent: 0.11, high24h: 4455.0, low24h: 4356.12, volume24h: 228352, bidPrice: 4373.78, askPrice: 4373.84, spread: 0.06 },
      { symbol: 'BTC-USDT', lastPrice: 96500.0, priceChangePercent: 2.45, high24h: 98000, low24h: 94500, volume24h: 154200, bidPrice: 96498, askPrice: 96502, spread: 4.0 },
      { symbol: 'ETH-USDT', lastPrice: 2750.5, priceChangePercent: -1.2, high24h: 2850, low24h: 2680, volume24h: 89000, bidPrice: 2750.3, askPrice: 2750.7, spread: 0.4 },
      { symbol: 'SOL-USDT', lastPrice: 195.8, priceChangePercent: 5.6, high24h: 202, low24h: 184, volume24h: 42000, bidPrice: 195.7, askPrice: 195.9, spread: 0.2 },
      { symbol: 'XRP-USDT', lastPrice: 2.45, priceChangePercent: 1.8, high24h: 2.6, low24h: 2.3, volume24h: 31000, bidPrice: 2.449, askPrice: 2.451, spread: 0.002 },
      { symbol: 'EUR-USDT', lastPrice: 1.085, priceChangePercent: 0.25, high24h: 1.09, low24h: 1.081, volume24h: 25000, bidPrice: 1.0849, askPrice: 1.0851, spread: 0.0002 },
      { symbol: 'GBP-USDT', lastPrice: 1.272, priceChangePercent: -0.15, high24h: 1.278, low24h: 1.268, volume24h: 18000, bidPrice: 1.2719, askPrice: 1.2721, spread: 0.0002 },
    ];
    defaults.forEach((t) => this.tickerStore.set(t.symbol, t));
  }

  public connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      console.log(`🔌 Connecting to BingX Market WebSocket: ${BINGX_WS_URL}`);
      this.ws = new WebSocket(BINGX_WS_URL);

      this.ws.on('open', () => {
        this.isConnected = true;
        console.log('✅ BingX Market WebSocket Connected!');

        // Subscribe to tickers using exact BingX contract symbols
        const symbols = ['NCCOGOLD2USD-USDT', 'NCCOXAUAUD2USD-USDT', 'NCCOXAUEUR2USD-USDT', 'NCCOXAUJPY2USD-USDT', 'XAUT-USDT', 'BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'XRP-USDT', 'NCFXEUR2USD-USDT', 'NCFXGBP2USD-USDT'];
        symbols.forEach((symbol) => {
          const subMsg = JSON.stringify({
            id: `sub-${symbol}-${Date.now()}`,
            reqType: 'sub',
            dataType: `${symbol}@ticker`,
          });
          this.ws?.send(subMsg);
        });

        // Ping interval every 20 seconds
        this.pingInterval = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ ping: Date.now() }));
          }
        }, 20000);
      });

      this.ws.on('message', (data: Buffer) => {
        try {
          let text = '';
          if (data[0] === 0x1f && data[1] === 0x8b) {
            text = zlib.gunzipSync(data).toString('utf-8');
          } else {
            text = data.toString('utf-8');
          }

          if (text === 'Ping' || text.includes('Ping')) {
            this.ws?.send('Pong');
            return;
          }

          const parsed = JSON.parse(text);
          if (parsed.ping) {
            this.ws?.send(JSON.stringify({ pong: parsed.ping }));
            return;
          }

          if (parsed.dataType && parsed.data) {
            const rawSymbol = parsed.dataType.split('@')[0].toUpperCase();
            const displaySym = bingxClient.displaySymbol(rawSymbol);
            const raw = parsed.data;

            const existing: BingXTicker = this.tickerStore.get(displaySym) || {
              symbol: displaySym,
              lastPrice: 0,
              priceChangePercent: 0,
              high24h: 0,
              low24h: 0,
              volume24h: 0,
              bidPrice: 0,
              askPrice: 0,
              spread: 0.05,
            };

            const updated: BingXTicker = {
              symbol: displaySym,
              lastPrice: Number(raw.c || raw.lastPrice || existing.lastPrice),
              priceChangePercent: Number(raw.P || raw.priceChangePercent || existing.priceChangePercent),
              high24h: Number(raw.h || raw.highPrice || existing.high24h),
              low24h: Number(raw.l || raw.lowPrice || existing.low24h),
              volume24h: Number(raw.v || raw.volume || existing.volume24h),
              bidPrice: Number(raw.b || raw.bidPrice || existing.bidPrice || raw.c),
              askPrice: Number(raw.a || raw.askPrice || existing.askPrice || raw.c),
              spread: Number(
                raw.a && raw.b
                  ? (Number(raw.a) - Number(raw.b)).toFixed(4)
                  : existing.spread || 0.05
              ),
              updatedAt: Date.now(),
            };

            this.tickerStore.set(displaySym, updated);
            this.notifySubscribers();
          }
        } catch (err) {
          // Non-fatal parse error
        }
      });

      this.ws.on('close', () => {
        this.isConnected = false;
        if (this.pingInterval) clearInterval(this.pingInterval);
        console.warn('⚠️ BingX Market WebSocket connection closed. Reconnecting in 5 seconds...');
        setTimeout(() => this.connect(), 5000);
      });

      this.ws.on('error', (err) => {
        console.error('WebSocket Error:', err.message);
      });
    } catch (err: any) {
      console.error('Failed to initialize WebSocket:', err.message);
    }
  }

  public getTickers(): BingXTicker[] {
    return Array.from(this.tickerStore.values());
  }

  public subscribe(callback: (tickers: BingXTicker[]) => void): () => void {
    this.subscribers.push(callback);
    return () => {
      this.subscribers = this.subscribers.filter((s) => s !== callback);
    };
  }

  private notifySubscribers() {
    const current = this.getTickers();
    this.subscribers.forEach((cb) => cb(current));
  }
}

export const bingxWebSocket = new BingXWebSocketStream();
