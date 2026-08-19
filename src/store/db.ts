import fs from 'fs';
import path from 'path';
import { BingXAccountConfig, ScheduledOrder, ExecutionLog } from '../types/index.js';

interface DatabaseSchema {
  accounts: BingXAccountConfig[];
  orders: ScheduledOrder[];
  logs: ExecutionLog[];
  passcode: string;
}

const DB_FILE = path.resolve(process.cwd(), 'data.json');

class LocalJSONDatabase {
  private schema: DatabaseSchema = {
    accounts: [],
    orders: [],
    logs: [],
    passcode: '1234',
  };

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const data = JSON.parse(raw);
        this.schema = {
          accounts: data.accounts || [],
          orders: data.orders || [],
          logs: data.logs || [],
          passcode: data.passcode || '1234',
        };
      } else {
        this.save();
      }
    } catch (err) {
      console.error('Failed to load database file data.json, starting with clean schema:', err);
    }
  }

  private save(): void {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(this.schema, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to save database file data.json:', err);
    }
  }

  // --- Passcode ---
  public getPasscode(): string {
    return process.env.ADMIN_PASSCODE || this.schema.passcode || '1234';
  }

  public setPasscode(newPasscode: string): void {
    this.schema.passcode = newPasscode;
    this.save();
  }

  // --- Accounts ---
  public getAccounts(): BingXAccountConfig[] {
    return this.schema.accounts;
  }

  public getAccount(id: string): BingXAccountConfig | undefined {
    return this.schema.accounts.find((a) => a.id === id);
  }

  public saveAccount(account: BingXAccountConfig): BingXAccountConfig {
    const idx = this.schema.accounts.findIndex((a) => a.id === account.id);
    if (idx >= 0) {
      this.schema.accounts[idx] = account;
    } else {
      this.schema.accounts.push(account);
    }
    this.save();
    return account;
  }

  public deleteAccount(id: string): boolean {
    const initialLen = this.schema.accounts.length;
    this.schema.accounts = this.schema.accounts.filter((a) => a.id !== id);
    if (this.schema.accounts.length < initialLen) {
      this.save();
      return true;
    }
    return false;
  }

  // --- Orders ---
  public getOrders(): ScheduledOrder[] {
    return this.schema.orders;
  }

  public getOrder(id: string): ScheduledOrder | undefined {
    return this.schema.orders.find((o) => o.id === id);
  }

  public addOrder(order: ScheduledOrder): ScheduledOrder {
    this.schema.orders.unshift(order);
    // Keep max 200 orders
    if (this.schema.orders.length > 200) {
      this.schema.orders = this.schema.orders.slice(0, 200);
    }
    this.save();
    return order;
  }

  public updateOrder(id: string, updates: Partial<ScheduledOrder>): ScheduledOrder | undefined {
    const order = this.schema.orders.find((o) => o.id === id);
    if (order) {
      Object.assign(order, updates);
      this.save();
      return order;
    }
    return undefined;
  }

  public deleteOrder(id: string): boolean {
    const initialLen = this.schema.orders.length;
    this.schema.orders = this.schema.orders.filter((o) => o.id !== id);
    if (this.schema.orders.length < initialLen) {
      this.save();
      return true;
    }
    return false;
  }

  // --- Logs ---
  public getLogs(limit: number = 100): ExecutionLog[] {
    return this.schema.logs.slice(0, limit);
  }

  public addLog(log: ExecutionLog): void {
    this.schema.logs.unshift(log);
    // Keep max 500 logs
    if (this.schema.logs.length > 500) {
      this.schema.logs = this.schema.logs.slice(0, 500);
    }
    this.save();
  }

  public clearLogs(): void {
    this.schema.logs = [];
    this.save();
  }
}

export const db = new LocalJSONDatabase();
