
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
  category?: string;
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
  creditBalance: number; // Store credit / Prepayment
  lastTransactionDate?: string;
}

export interface Transaction {
  id: string;
  date: string;
  items: SaleItem[];
  subtotal?: number;
  discount?: number;
  total: number;
  paymentMethod: 'Cash' | 'M-Pesa' | 'Debt' | 'Split' | 'Credit';
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
  dueDate?: string;
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
  cashDeposits: number; // New: Track customer credit deposits
  mpesaDeposits: number; // New: Track customer credit deposits
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
