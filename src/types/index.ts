export type EnvironmentType = 'LIVE' | 'DEMO' | 'VST';
export type MarketType = 'SWAP' | 'SPOT';
export type OrderSide = 'BUY' | 'SELL';
export type PositionSide = 'LONG' | 'SHORT' | 'BOTH';
export type OrderType = 'MARKET' | 'LIMIT';
export type MarginType = 'ISOLATED' | 'CROSSED';
export type OrderStatus = 'PENDING' | 'EXECUTING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type InstrumentCategory = 'All' | 'Favorites' | 'Commodities' | 'Forex' | 'Crypto' | 'Indices';

export interface InstrumentContract {
  symbol: string; // Internal BingX symbol (e.g. NCCOGOLD2USD-USDT)
  displaySymbol: string; // UI Display Symbol (e.g. XAU-USDT)
  displayName: string; // e.g. GOLD(XAU)-USDT
  asset: string; // e.g. GOLD
  category: 'Commodities' | 'Forex' | 'Crypto' | 'Indices';
  maxLeverage: number;
  pricePrecision: number;
  quantityPrecision: number;
  tradeMinQuantity: number;
  tradeMinUSDT: number;
  lastPrice: number;
  priceChangePercent: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  isFavorite?: boolean;
}

export interface BingXAccountConfig {
  id: string; // Unique ID (e.g., "ACC-1234")
  accountName: string; // Human label (e.g. "Main Scalp Account")
  apiKey: string;
  secretKey: string;
  environment: EnvironmentType;
  isDefault?: boolean;
  enabled?: boolean;
  createdAt: number;
}

export interface BingXServerTime {
  serverTime: number;
  localTime: number;
  offsetMs: number; // serverTime - (localTime + rtt/2)
  rttMs: number;
}

export interface BingXAccountBalance {
  asset: string;
  balance: number;
  equity: number;
  availableMargin: number;
  usedMargin: number;
  unrealizedProfit: number;
  accountId: string;
  accountName: string;
  environment: EnvironmentType;
  marginLevel?: number;
}

export interface BingXTicker {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  bidPrice?: number;
  askPrice?: number;
  spread?: number;
  updatedAt?: number;
}

export interface ScheduledOrderRequest {
  symbol: string;
  marketType: MarketType;
  side: OrderSide;
  positionSide: PositionSide;
  type: OrderType;
  price?: number;
  quantity: number; // Order amount / quantity
  leverage: number; // e.g. 10, 50, 100
  marginType?: MarginType;
  stopLoss?: number;
  takeProfit?: number;
  targetTime: number; // Target execution timestamp in UTC milliseconds
  accountIds: string[] | 'ALL'; // Selected account IDs or ALL
}

export interface AccountExecutionResult {
  accountId: string;
  accountName: string;
  success: boolean;
  orderId?: string;
  latencyMs?: number;
  error?: string;
  rawResponse?: any;
}

export interface ScheduledOrder extends ScheduledOrderRequest {
  id: string;
  targetTimeFormatted: string;
  status: OrderStatus;
  actualTime?: number;
  precisionDriftMs?: number;
  executionResults?: AccountExecutionResult[];
  errorMessage?: string;
  createdAt: number;
}

export interface ExecutionLog {
  id: string;
  orderId?: string;
  timestamp: number;
  level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';
  message: string;
  details?: any;
}

export interface SystemStatus {
  status: 'ok' | 'degraded' | 'error';
  timeIST: string;
  timeUTC: string;
  timestamp: number;
  serverOffsetMs: number;
  rttMs: number;
  activeTimersCount: number;
  accountsCount: number;
  ordersCount: number;
}
