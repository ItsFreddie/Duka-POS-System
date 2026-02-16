
export interface Product {
  id: string;
  name: string;
  category: string;
  buyPrice: number;
  sellPrice: number;
  stock: number;
  image: string; // Base64 string
  measurementUnit?: string; // 'pcs', 'L', 'kg', 'm' etc.
  expiryDate?: string; // ISO Date string YYYY-MM-DD
}

export interface CartItem extends Product {
  quantity: number;
}

export interface SaleItem {
  productId: string;
  name: string;
  quantity: number;
  price: number;
  cost: number;
}

export interface Expense {
  id: string;
  amount: number;
  reason: string;
  date: string;
  source?: 'Cash' | 'M-Pesa';
}

export interface StockLog {
  id: string;
  productId: string;
  productName: string;
  quantityChanged: number;
  newStockLevel: number;
  reason: string;
  date: string;
  expiryDate?: string;
}

export interface Customer {
  id: string;
  name: string;
  phone?: string;
  totalDebt: number;
  lastTransactionDate?: string;
}

export interface Transaction {
  id: string;
  date: string;
  items: SaleItem[];
  total: number;
  paymentMethod: 'Cash' | 'M-Pesa' | 'Debt' | 'Split';
  amountPaid: number;
  splitDetails?: {
    cash: number;
    mpesa: number;
  };
  mpesaCode?: string;
  customerName?: string;
  customerPhone?: string;
  customerId?: string; // Link to Customer Account
  status: 'Completed' | 'Pending Debt' | 'Refunded';
  isRefunded?: boolean;
}

export interface ShiftRecord {
  id: string;
  date: string;
  openedAt: string;
  closedAt?: string;
  openingCash: number;
  openingMpesa: number;
  closingCashCalculated: number;
  closingMpesaCalculated: number;
  expenses: Expense[];
  cashRefunds: number;
  mpesaRefunds: number;
  actualClosingCash?: number;
  actualClosingMpesa?: number;
  notes?: string;
  isOpen: boolean;
}

export interface StoreProfile {
  name: string;
  location: string;
  logoUrl: string; // Base64 string
  currency: string;
  dailySalesTarget?: number;
  adminPin: string; // New field for security
}

export enum AppView {
  DASHBOARD = 'DASHBOARD',
  POS = 'POS',
  INVENTORY = 'INVENTORY',
  FINANCE = 'FINANCE',
  SETTINGS = 'SETTINGS',
}
