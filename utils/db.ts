
import { openDB, DBSchema, deleteDB } from 'idb';
import { Product, Transaction, ShiftRecord, StoreProfile, StockLog, Customer } from '../types';

interface DukaDB extends DBSchema {
  products: {
    key: string;
    value: Product;
  };
  transactions: {
    key: string;
    value: Transaction;
    indexes: { 'by-date': string };
  };
  shift: {
    key: string;
    value: ShiftRecord;
  };
  profile: {
    key: string;
    value: StoreProfile;
  };
  stock_logs: {
    key: string;
    value: StockLog;
    indexes: { 'by-product': string; 'by-date': string };
  };
  customers: {
    key: string;
    value: Customer;
  }
}

const DB_NAME = 'duka-manager-db';
const DB_VERSION = 4; // Incrementing to version 4 to force update

export const initDB = async () => {
  return openDB<DukaDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, newVersion, transaction) {
      if (!db.objectStoreNames.contains('products')) {
        db.createObjectStore('products', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('transactions')) {
        const txStore = db.createObjectStore('transactions', { keyPath: 'id' });
        txStore.createIndex('by-date', 'date');
      }
      if (!db.objectStoreNames.contains('shift')) {
        db.createObjectStore('shift', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('profile')) {
        db.createObjectStore('profile', { autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('stock_logs')) {
        const logStore = db.createObjectStore('stock_logs', { keyPath: 'id' });
        logStore.createIndex('by-product', 'productId');
        logStore.createIndex('by-date', 'date');
      }
      if (!db.objectStoreNames.contains('customers')) {
        db.createObjectStore('customers', { keyPath: 'id' });
      }
    },
  });
};

// --- DATA ACCESS METHODS ---

// PRODUCTS
export const getAllProducts = async () => {
  const db = await initDB();
  return db.getAll('products');
};

export const saveProduct = async (product: Product) => {
  const db = await initDB();
  return db.put('products', product);
};

export const deleteProduct = async (id: string) => {
  const db = await initDB();
  return db.delete('products', id);
};

export const saveAllProducts = async (products: Product[]) => {
    const db = await initDB();
    const tx = db.transaction('products', 'readwrite');
    await Promise.all(products.map(p => tx.store.put(p)));
    await tx.done;
};

// TRANSACTIONS
export const getAllTransactions = async () => {
  const db = await initDB();
  return db.getAllFromIndex('transactions', 'by-date');
};

export const saveTransaction = async (transaction: Transaction) => {
  const db = await initDB();
  return db.put('transactions', transaction);
};

export const deleteTransaction = async (id: string) => {
  const db = await initDB();
  return db.delete('transactions', id);
};

export const updateTransaction = async (transaction: Transaction) => {
    const db = await initDB();
    return db.put('transactions', transaction);
}

// SHIFT
export const getCurrentShift = async (): Promise<ShiftRecord | null> => {
  const db = await initDB();
  const shifts = await db.getAll('shift');
  const openShift = shifts.find(s => s.isOpen);
  return openShift || null;
};

export const getLastClosedShift = async (): Promise<ShiftRecord | null> => {
  const db = await initDB();
  const shifts = await db.getAll('shift');
  const closedShifts = shifts.filter(s => !s.isOpen).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return closedShifts.length > 0 ? closedShifts[0] : null;
};

export const saveShift = async (shift: ShiftRecord) => {
  const db = await initDB();
  return db.put('shift', shift);
};

// PROFILE
export const getProfile = async (): Promise<StoreProfile | undefined> => {
  const db = await initDB();
  const profiles = await db.getAll('profile');
  return profiles[0];
};

export const saveProfile = async (profile: StoreProfile) => {
  const db = await initDB();
  await db.clear('profile');
  return db.add('profile', profile);
};

// STOCK LOGS
export const saveStockLog = async (log: StockLog) => {
  const db = await initDB();
  return db.put('stock_logs', log);
};

export const getStockLogs = async (productId?: string) => {
  const db = await initDB();
  if (productId) {
    return db.getAllFromIndex('stock_logs', 'by-product', productId);
  }
  return db.getAll('stock_logs');
};

// CUSTOMERS
export const getAllCustomers = async () => {
  const db = await initDB();
  return db.getAll('customers');
};

export const saveCustomer = async (customer: Customer) => {
  const db = await initDB();
  return db.put('customers', customer);
};

export const deleteCustomer = async (id: string) => {
  const db = await initDB();
  return db.delete('customers', id);
};

// RESET
export const resetDatabase = async () => {
    await deleteDB(DB_NAME);
    window.location.reload();
};

// RESTORE
export const restoreDatabase = async (data: { 
    products: Product[], 
    transactions: Transaction[], 
    profile: StoreProfile,
    currentShift?: ShiftRecord,
    stockLogs?: StockLog[],
    customers?: Customer[]
}) => {
    const db = await initDB();
    
    // Transaction to write all data
    const tx = db.transaction(['products', 'transactions', 'shift', 'profile', 'stock_logs', 'customers'], 'readwrite');
    
    // Clear existing stores
    await Promise.all([
        tx.objectStore('products').clear(),
        tx.objectStore('transactions').clear(),
        tx.objectStore('shift').clear(),
        tx.objectStore('profile').clear(),
        tx.objectStore('stock_logs').clear(),
        tx.objectStore('customers').clear()
    ]);

    // Import Products
    if (data.products && Array.isArray(data.products)) {
        for (const p of data.products) {
            await tx.objectStore('products').put(p);
        }
    }

    // Import Transactions
    if (data.transactions && Array.isArray(data.transactions)) {
        for (const t of data.transactions) {
            await tx.objectStore('transactions').put(t);
        }
    }

    // Import Shift
    if (data.currentShift) {
        await tx.objectStore('shift').put(data.currentShift);
    }

    // Import Profile
    if (data.profile) {
        await tx.objectStore('profile').add(data.profile);
    }

    // Import Stock Logs
    if (data.stockLogs && Array.isArray(data.stockLogs)) {
        for (const l of data.stockLogs) {
            await tx.objectStore('stock_logs').put(l);
        }
    }

    // Import Customers
    if (data.customers && Array.isArray(data.customers)) {
        for (const c of data.customers) {
            await tx.objectStore('customers').put(c);
        }
    }

    await tx.done;
    return true;
};
