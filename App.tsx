
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  LayoutDashboard, 
  ShoppingCart, 
  Package, 
  BarChart3, 
  Settings, 
  Moon, 
  Sun,
  Menu,
  Store,
  Upload,
  LogOut,
  Wallet,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Download,
  Trash2,
  Database,
  Banknote,
  CreditCard,
  Calculator,
  X,
  Check,
  Lock,
  Unlock,
  ShieldCheck,
  Delete,
  Target,
  History,
  RotateCcw,
  Wifi,
  WifiOff
} from 'lucide-react';

import { Dashboard } from './components/Dashboard';
import { POS } from './components/POS';
import { Inventory } from './components/Inventory';
import { Finance } from './components/Finance';
import { AppView, Product, Transaction, ShiftRecord, StoreProfile, StockLog, Expense, Customer } from './types';
import * as db from './utils/db';

// Utility for safe ID generation
export const generateId = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 9);

// Initial Data
const INITIAL_PROFILE: StoreProfile = {
  name: "Kristie Gen. Shop",
  location: "Nairobi, CBD",
  logoUrl: "https://cdn-icons-png.flaticon.com/512/869/869636.png",
  currency: "KES",
  dailySalesTarget: 10000,
  adminPin: "1234" // Default PIN
};

const INITIAL_PRODUCTS: Product[] = [
  { id: '1', name: 'Blue Band 500g', category: 'Household', buyPrice: 280, sellPrice: 350, stock: 24, image: 'https://via.placeholder.com/400?text=BlueBand', measurementUnit: 'pcs', expiryDate: '2024-12-31' },
  { id: '2', name: 'Unga wa Jogoo 2kg', category: 'Household', buyPrice: 210, sellPrice: 240, stock: 50, image: 'https://via.placeholder.com/400?text=Unga', measurementUnit: 'pcs' },
  { id: '3', name: 'Salit Cooking Oil (Dispenser)', category: 'Household', buyPrice: 180, sellPrice: 250, stock: 20, image: 'https://via.placeholder.com/400?text=Oil', measurementUnit: 'L' },
  { id: '4', name: 'Milk 500ml', category: 'Drinks', buyPrice: 60, sellPrice: 75, stock: 30, image: 'https://via.placeholder.com/400?text=Milk', measurementUnit: 'pcs', expiryDate: '2023-11-20' },
];

// PIN Entry Modal Component
const PinEntryModal = ({ 
  isOpen, 
  onClose, 
  onSuccess, 
  correctPin 
}: { 
  isOpen: boolean, 
  onClose: () => void, 
  onSuccess: () => void, 
  correctPin: string 
}) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setPin('');
      setError(false);
    }
  }, [isOpen]);

  const handleNumClick = (num: string) => {
    if (pin.length < 4) {
      const newPin = pin + num;
      setPin(newPin);
      if (newPin.length === 4) {
        if (newPin === correctPin) {
          onSuccess();
        } else {
          setError(true);
          setTimeout(() => {
            setPin('');
            setError(false);
          }, 500);
        }
      }
    }
  };

  const handleClear = () => {
    setPin('');
    setError(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-[0_4px_12px_rgba(0,0,0,0.08)] w-full max-w-xs overflow-hidden border border-gray-200 dark:border-gray-800">
        <div className="p-6 bg-gray-50 dark:bg-black/30 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
           <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
             <Lock className="w-4 h-4 text-purple-500" /> Admin Access
           </h3>
           <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
             <X className="w-5 h-5" />
           </button>
        </div>
        <div className="p-6 flex flex-col items-center gap-6">
           <div className="flex gap-4">
             {[0, 1, 2, 3].map(i => (
               <div key={i} className={`w-4 h-4 rounded-full border-2 transition-all ${pin.length > i ? (error ? 'bg-red-500 border-red-500' : 'bg-purple-600 border-purple-600') : 'border-gray-300 dark:border-gray-600'}`}></div>
             ))}
           </div>
           {error && <p className="text-red-500 text-xs font-bold animate-pulse">Incorrect PIN</p>}
           
           <div className="grid grid-cols-3 gap-4 w-full">
             {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
               <button 
                 key={n} 
                 onClick={() => handleNumClick(n.toString())}
                 className="aspect-square rounded-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-xl font-bold text-gray-900 dark:text-white transition-colors"
               >
                 {n}
               </button>
             ))}
             <div className="aspect-square"></div>
             <button 
                 onClick={() => handleNumClick('0')}
                 className="aspect-square rounded-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-xl font-bold text-gray-900 dark:text-white transition-colors"
               >
                 0
             </button>
             <button 
               onClick={handleClear}
               className="aspect-square rounded-full flex items-center justify-center text-gray-500 hover:text-red-500 transition-colors"
             >
               <Trash2 className="w-6 h-6" />
             </button>
           </div>
        </div>
      </div>
    </div>
  );
};

const LoginView = ({ 
  profile, 
  onOpenShift, 
  isDarkMode, 
  setIsDarkMode,
  lastClosedShift
}: { 
  profile: StoreProfile, 
  onOpenShift: (cash: number, mpesa: number) => void,
  isDarkMode: boolean,
  setIsDarkMode: (v: boolean) => void,
  lastClosedShift: ShiftRecord | null
}) => {
  const [openingCash, setOpeningCash] = useState('');
  const [openingMpesa, setOpeningMpesa] = useState('');
  const [isBreakdownOpen, setIsBreakdownOpen] = useState(false);
  
  // Denomination State
  const [counts, setCounts] = useState<Record<number, string>>({});
  const notes = [1000, 500, 200, 100, 50];
  const coins = [20, 10, 5];

  // Live Clock
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const calculateBreakdownTotal = () => {
    let total = 0;
    Object.entries(counts).forEach(([denom, count]) => {
      total += Number(denom) * (Number(count) || 0);
    });
    return total;
  };

  const handleBreakdownSave = () => {
    const total = calculateBreakdownTotal();
    setOpeningCash(total.toString());
    setIsBreakdownOpen(false);
  };

  const handleCountChange = (denom: number, val: string) => {
    setCounts(prev => ({...prev, [denom]: val}));
  };

  const handleUsePrevious = () => {
    if (lastClosedShift) {
        // Use actual closing if available, otherwise calculated (though actual is preferred for carry over)
        const cash = lastClosedShift.actualClosingCash !== undefined ? lastClosedShift.actualClosingCash : lastClosedShift.closingCashCalculated;
        const mpesa = lastClosedShift.actualClosingMpesa !== undefined ? lastClosedShift.actualClosingMpesa : lastClosedShift.closingMpesaCalculated;
        
        setOpeningCash(cash.toString());
        setOpeningMpesa(mpesa.toString());
    }
  };

  const handleSubmit = () => {
    // Validate inputs are not empty
    if (openingCash.trim() === '' || openingMpesa.trim() === '') {
      alert("Please enter opening balances for both Cash and M-Pesa. Enter 0 if the balance is empty.");
      return;
    }

    const cash = Number(openingCash);
    const mpesa = Number(openingMpesa);
    
    if (isNaN(cash) || isNaN(mpesa)) {
      alert("Please enter valid numeric amounts");
      return;
    }
    
    onOpenShift(cash, mpesa);
  };

  const isValid = openingCash.trim() !== '' && openingMpesa.trim() !== '';

  return (
    <div className="flex flex-col h-screen bg-[#F0F2F5] dark:bg-gray-900 text-gray-900 dark:text-gray-100 overflow-hidden font-sans">
      
      {/* 1. Header Section */}
      <header className="flex-none pt-8 pb-4 px-6 text-center z-10">
        <div className="mb-2 flex justify-center">
            <div className="w-12 h-12 rounded-xl bg-white dark:bg-gray-800 shadow-[0_4px_12px_rgba(0,0,0,0.08)] border border-gray-200 dark:border-gray-700 p-2">
                 <img src={profile.logoUrl} alt="Logo" className="w-full h-full object-contain opacity-90" />
            </div>
        </div>
        <h1 className="text-xl font-black tracking-tight text-gray-900 dark:text-white leading-tight">{profile.name}</h1>
        <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mt-1">
          {currentTime.toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'short' })} • {currentTime.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </header>

      {/* 2. Main Content - Centered & Compact */}
      <main className="flex-1 flex flex-col justify-center px-6 max-w-md mx-auto w-full gap-6">
        
        {/* Use Previous Record Option - Enhanced Visibility */}
        {lastClosedShift && (
            <div className="mb-6 animate-fade-in">
              <div className="flex items-center justify-between mb-2">
                 <span className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Quick Start</span>
              </div>
              <button 
                  onClick={handleUsePrevious}
                  className="w-full p-4 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-2xl border border-blue-100 dark:border-blue-800 shadow-sm flex items-center justify-between group hover:shadow-md hover:border-blue-200 dark:hover:border-blue-700 transition-all relative overflow-hidden"
              >
                  <div className="flex flex-col items-start text-left">
                      <span className="text-sm font-black text-blue-700 dark:text-blue-300 flex items-center gap-2">
                          <RotateCcw className="w-4 h-4" /> Use Previous Closing Balance
                      </span>
                      <div className="flex items-center gap-3 mt-2 text-sm">
                          <div className="px-2 py-1 bg-white dark:bg-black/40 rounded-lg border border-blue-100 dark:border-blue-900/50">
                             <span className="text-xs text-gray-500 dark:text-gray-400 mr-1">Cash:</span>
                             <span className="font-bold text-gray-900 dark:text-white">{profile.currency} {(lastClosedShift.actualClosingCash ?? 0).toLocaleString()}</span>
                          </div>
                          <div className="px-2 py-1 bg-white dark:bg-black/40 rounded-lg border border-blue-100 dark:border-blue-900/50">
                             <span className="text-xs text-gray-500 dark:text-gray-400 mr-1">M-Pesa:</span>
                             <span className="font-bold text-gray-900 dark:text-white">{profile.currency} {(lastClosedShift.actualClosingMpesa ?? 0).toLocaleString()}</span>
                          </div>
                      </div>
                  </div>
                  <div className="h-8 w-8 bg-blue-600 text-white rounded-full flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                      <Check className="w-5 h-5" />
                  </div>
              </button>
            </div>
        )}

        {/* Opening Cash Input */}
        <div className="space-y-2">
           <label className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 flex justify-between items-center">
              <span>Opening Cash (KES)</span>
              {Object.keys(counts).length > 0 && (
                <span className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 px-2 py-0.5 rounded-full">
                  Verified via Breakdown
                </span>
              )}
           </label>
           <div className="relative group">
              <div className="absolute left-0 inset-y-0 pl-4 flex items-center pointer-events-none">
                <Banknote className="w-6 h-6 text-gray-400 group-focus-within:text-emerald-500 transition-colors" />
              </div>
              <input 
                 type="number"
                 inputMode="decimal"
                 placeholder="0"
                 value={openingCash}
                 onChange={(e) => setOpeningCash(e.target.value)}
                 className={`w-full h-16 pl-12 pr-14 text-3xl font-black bg-white dark:bg-gray-800 border-2 rounded-2xl outline-none transition-all shadow-[0_4px_12px_rgba(0,0,0,0.08)] text-gray-900 dark:text-white placeholder-gray-400 ${!openingCash ? 'border-amber-200 dark:border-amber-900/50' : 'border-gray-200 dark:border-gray-700 focus:border-emerald-500 dark:focus:border-emerald-500'}`}
              />
              <button 
                onClick={() => setIsBreakdownOpen(true)}
                className="absolute right-2 top-2 bottom-2 aspect-square bg-gray-100 dark:bg-gray-700 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-gray-500 dark:text-gray-300 hover:text-emerald-600 dark:hover:text-emerald-400 rounded-xl flex items-center justify-center transition-colors"
                title="Count Cash"
              >
                 <Calculator className="w-6 h-6" />
              </button>
           </div>
        </div>

        {/* Opening M-Pesa Input */}
        <div className="space-y-2">
           <label className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
              Opening M-Pesa Balance
           </label>
           <div className="relative group">
              <div className="absolute left-0 inset-y-0 pl-4 flex items-center pointer-events-none">
                <CreditCard className="w-6 h-6 text-gray-400 group-focus-within:text-green-500 transition-colors" />
              </div>
              <input 
                 type="number"
                 inputMode="decimal"
                 placeholder="0"
                 value={openingMpesa}
                 onChange={(e) => setOpeningMpesa(e.target.value)}
                 className={`w-full h-16 pl-12 pr-4 text-3xl font-black bg-white dark:bg-gray-800 border-2 rounded-2xl outline-none transition-all shadow-[0_4px_12px_rgba(0,0,0,0.08)] text-gray-900 dark:text-white placeholder-gray-400 ${!openingMpesa ? 'border-amber-200 dark:border-amber-900/50' : 'border-gray-200 dark:border-gray-700 focus:border-green-500 dark:focus:border-green-500'}`}
              />
           </div>
        </div>

      </main>

      {/* 3. Footer Action - Sticky */}
      <footer className="p-6 pb-8 bg-[#F0F2F5] dark:bg-gray-900 mt-auto">
         <button 
           onClick={handleSubmit}
           disabled={!isValid}
           className={`w-full h-16 rounded-2xl font-black text-lg tracking-wide uppercase shadow-[0_4px_12px_rgba(0,0,0,0.08)] transition-all flex items-center justify-center gap-3 ${
             !isValid
               ? 'bg-gray-300 dark:bg-gray-800 text-gray-500 dark:text-gray-500 cursor-not-allowed shadow-none' 
               : 'bg-gray-900 dark:bg-white text-white dark:text-black hover:shadow-2xl hover:-translate-y-1 active:scale-[0.98]'
           }`}
         >
           <span>Open Shop</span>
           <ChevronRight className="w-6 h-6" />
         </button>
         
         <div className="mt-6 flex justify-center gap-6">
            <button 
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 font-medium text-xs flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
            >
              {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              <span>{isDarkMode ? 'Light Mode' : 'Dark Mode'}</span>
            </button>
            <button 
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 font-medium text-xs flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
              onClick={() => alert("Contact Admin for support")}
            >
               <span>Support</span>
            </button>
         </div>
      </footer>

      {/* 4. Denomination Breakdown Modal */}
      {isBreakdownOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#F0F2F5] dark:bg-gray-900 sm:bg-black/50 sm:backdrop-blur-sm sm:items-center sm:justify-center">
          <div className="flex-1 flex flex-col bg-[#F0F2F5] dark:bg-gray-900 sm:bg-white sm:dark:bg-gray-900 sm:rounded-2xl sm:shadow-[0_4px_12px_rgba(0,0,0,0.08)] sm:max-w-md sm:w-full sm:max-h-[85vh] overflow-hidden sm:border border-gray-200 dark:border-gray-800">
            
            {/* Modal Header */}
            <div className="p-5 border-b border-gray-200 dark:border-gray-800 flex justify-between items-center bg-white dark:bg-gray-900 z-10 shadow-sm">
                <div>
                   <h2 className="text-lg font-black text-gray-900 dark:text-white">Cash Breakdown</h2>
                   <p className="text-xs text-gray-500 font-medium">Count notes and coins</p>
                </div>
                <button onClick={() => setIsBreakdownOpen(false)} className="p-2 bg-gray-100 dark:bg-gray-800 rounded-full text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
                  <X className="w-6 h-6" />
                </button>
            </div>

            {/* Scrollable Inputs */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
               <div className="space-y-3">
                  <h3 className="text-xs font-bold uppercase text-gray-400 tracking-wider">Notes</h3>
                  <div className="grid grid-cols-2 gap-3">
                      {notes.map(denom => (
                        <div key={denom} className="bg-white dark:bg-gray-800 p-3 rounded-xl border border-gray-200 dark:border-gray-700 focus-within:ring-2 focus-within:ring-emerald-500 focus-within:border-emerald-500 transition-all shadow-sm">
                           <div className="flex justify-between items-center mb-1">
                              <span className="text-sm font-bold text-gray-900 dark:text-white">{denom}/=</span>
                              <span className="text-xs text-gray-400 font-medium">Note</span>
                           </div>
                           <input 
                              type="number" 
                              placeholder="0"
                              className="w-full text-2xl font-black bg-transparent border-none p-0 focus:ring-0 text-emerald-600 dark:text-emerald-400 placeholder-gray-300 dark:placeholder-gray-700"
                              value={counts[denom] || ''}
                              onChange={(e) => handleCountChange(denom, e.target.value)}
                           />
                           {counts[denom] && (
                              <div className="text-[10px] text-right font-medium text-gray-400 mt-1">
                                 = {(Number(counts[denom]) * denom).toLocaleString()}
                              </div>
                           )}
                        </div>
                      ))}
                  </div>
               </div>

               <div className="space-y-3">
                  <h3 className="text-xs font-bold uppercase text-gray-400 tracking-wider">Coins</h3>
                  <div className="grid grid-cols-3 gap-3">
                      {coins.map(denom => (
                        <div key={denom} className="bg-white dark:bg-gray-800 p-3 rounded-xl border border-gray-200 dark:border-gray-700 focus-within:ring-2 focus-within:ring-emerald-500 focus-within:border-emerald-500 transition-all shadow-sm">
                           <div className="text-center mb-1">
                              <span className="text-sm font-bold text-gray-700 dark:text-gray-300">{denom}/=</span>
                           </div>
                           <input 
                              type="number" 
                              placeholder="0"
                              className="w-full text-xl font-black bg-transparent border-none p-0 focus:ring-0 text-center text-emerald-600 dark:text-emerald-400 placeholder-gray-300 dark:placeholder-gray-700"
                              value={counts[denom] || ''}
                              onChange={(e) => handleCountChange(denom, e.target.value)}
                           />
                        </div>
                      ))}
                  </div>
               </div>
            </div>

            {/* Modal Footer */}
            <div className="p-5 border-t border-gray-200 dark:border-gray-800 bg-[#F0F2F5] dark:bg-black/20">
               <div className="flex justify-between items-center mb-4 px-1">
                  <span className="font-medium text-gray-500 dark:text-gray-400">Total Calculated</span>
                  <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
                     {profile.currency} {calculateBreakdownTotal().toLocaleString()}
                  </span>
               </div>
               <button 
                 onClick={handleBreakdownSave}
                 className="w-full h-14 bg-emerald-600 text-white rounded-xl font-bold text-lg shadow-[0_4px_12px_rgba(0,0,0,0.08)] hover:bg-emerald-700 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
               >
                 <Check className="w-5 h-5" /> Confirm Total
               </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};

const App = () => {
  // State
  const [appMode, setAppMode] = useState<'POS' | 'ADMIN'>('POS'); // New state for architecture split
  const [view, setView] = useState<AppView>(AppView.DASHBOARD);
  const [isDarkMode, setIsDarkMode] = useState(true); 
  const [isSidebarOpen, setIsSidebarOpen] = useState(false); // Mobile toggle
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false); // Desktop collapse
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  
  // App Loading State
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Data State
  const [profile, setProfile] = useState<StoreProfile>(INITIAL_PROFILE);
  const [products, setProducts] = useState<Product[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [stockLogs, setStockLogs] = useState<StockLog[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [currentShift, setCurrentShift] = useState<ShiftRecord | null>(null);
  const [lastClosedShift, setLastClosedShift] = useState<ShiftRecord | null>(null);

  // Initial Data Load (IndexedDB)
  useEffect(() => {
    const loadData = async () => {
      try {
        const [loadedProducts, loadedTransactions, loadedShift, loadedProfile, loadedCustomers, loadedLastShift, loadedStockLogs] = await Promise.all([
          db.getAllProducts(),
          db.getAllTransactions(),
          db.getCurrentShift(),
          db.getProfile(),
          db.getAllCustomers(),
          db.getLastClosedShift(),
          db.getStockLogs()
        ]);

        if (loadedProducts.length > 0) {
            setProducts(loadedProducts);
        } else {
            // Seed initial products if DB is empty
            setProducts(INITIAL_PRODUCTS);
            loadedProducts.forEach(p => db.saveProduct(p)); 
        }

        // Sort transactions by date desc for UI
        setTransactions(loadedTransactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
        setStockLogs(loadedStockLogs);
        
        setCurrentShift(loadedShift);
        
        // Migration: Recalculate loyalty points based on total spent to fix inconsistencies
        const migratedCustomers = loadedCustomers.map(c => {
            const correctPoints = Math.floor((c.totalSpent || 0) / 100);
            if (c.loyaltyPoints !== correctPoints) {
                const updated = { ...c, loyaltyPoints: correctPoints };
                db.saveCustomer(updated); // Update DB in background
                return updated;
            }
            return c;
        });
        setCustomers(migratedCustomers);
        
        setLastClosedShift(loadedLastShift);
        
        if (loadedProfile) {
            setProfile(loadedProfile);
        } else {
            await db.saveProfile(INITIAL_PROFILE); // Save default
        }

      } catch (error) {
        console.error("Failed to load data from DB", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, []);

  // Theme Effect
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // --- Handlers (Updated to write to DB) ---

  const handleSale = async (transaction: Transaction) => {
    // 1. Update Transactions List (Local State)
    setTransactions(prev => [transaction, ...prev]);
    await db.saveTransaction(transaction); // Save the new one
    
    // 2. Update Stock
    const newProducts = products.map(p => {
      const soldItem = transaction.items.find(i => i.productId === p.id);
      if (soldItem) {
        const newStock = Number((p.stock - soldItem.quantity).toFixed(4));
        const updatedProduct = { ...p, stock: newStock };
        // Fire and forget DB update for individual product or await it
        db.saveProduct(updatedProduct); 
        return updatedProduct;
      }
      return p;
    });
    setProducts(newProducts);

    // 3. Update Customer (Debt, Credit, Loyalty)
    if (transaction.customerId) {
        const customer = customers.find(c => c.id === transaction.customerId);
        if (customer) {
            let updatedCustomer = { ...customer };
            
            // Handle Debt
            if (transaction.paymentMethod === 'Debt') {
                 const debtAdded = transaction.total - transaction.amountPaid;
                 updatedCustomer.totalDebt += debtAdded;
            }
            
            // Handle Credit
            if (transaction.paymentMethod === 'Credit') {
                 updatedCustomer.creditBalance = Math.max(0, (updatedCustomer.creditBalance || 0) - transaction.total);
            }

            // Handle Loyalty & Total Spent (All methods)
            updatedCustomer.totalSpent = (updatedCustomer.totalSpent || 0) + transaction.total;
            // Calculate points based on cumulative spend to account for small transactions adding up
            updatedCustomer.loyaltyPoints = Math.floor(updatedCustomer.totalSpent / 100);
            updatedCustomer.lastTransactionDate = new Date().toISOString();

            setCustomers(prev => prev.map(c => c.id === customer.id ? updatedCustomer : c));
            await db.saveCustomer(updatedCustomer);
        }
    }

    // 4. Update Shift if open
    if (currentShift && currentShift.isOpen) {
      let cashToAdd = 0;
      let mpesaToAdd = 0;

      if (transaction.paymentMethod === 'Cash') {
        cashToAdd = transaction.total;
      } else if (transaction.paymentMethod === 'M-Pesa') {
        mpesaToAdd = transaction.total;
      } else if (transaction.paymentMethod === 'Split' && transaction.splitDetails) {
        const change = transaction.amountPaid - transaction.total;
        cashToAdd = transaction.splitDetails.cash - change;
        mpesaToAdd = transaction.splitDetails.mpesa;
      } else if (transaction.paymentMethod === 'Debt') {
         // Handle upfront payment for debt
         if (transaction.amountPaid > 0) {
             if (transaction.splitDetails) {
                 cashToAdd = transaction.splitDetails.cash;
                 mpesaToAdd = transaction.splitDetails.mpesa;
             } else {
                 // Fallback default to cash if not specified
                 cashToAdd = transaction.amountPaid;
             }
         }
      }
      // Credit sales do not affect cash/mpesa drawer
      
      const updatedShift = {
        ...currentShift,
        closingCashCalculated: currentShift.closingCashCalculated + cashToAdd,
        closingMpesaCalculated: currentShift.closingMpesaCalculated + mpesaToAdd
      };
      
      setCurrentShift(updatedShift);
      await db.saveShift(updatedShift);
    }
  };

  const handleAddCustomer = async (customer: Customer) => {
      const newCustomer = { 
          ...customer, 
          creditBalance: 0,
          loyaltyPoints: 0,
          totalSpent: 0
      };
      setCustomers(prev => [...prev, newCustomer]);
      await db.saveCustomer(newCustomer);
  }

  const handleCustomerDeposit = async (customerId: string, amount: number, method: 'Cash' | 'M-Pesa') => {
      const customer = customers.find(c => c.id === customerId);
      if (!customer) return;

      const updatedCustomer = {
          ...customer,
          creditBalance: (customer.creditBalance || 0) + amount,
          lastTransactionDate: new Date().toISOString()
      };
      
      setCustomers(prev => prev.map(c => c.id === customerId ? updatedCustomer : c));
      await db.saveCustomer(updatedCustomer);

      // Update Shift
      if (currentShift && currentShift.isOpen) {
          const updatedShift = {
              ...currentShift,
              cashDeposits: (currentShift.cashDeposits || 0) + (method === 'Cash' ? amount : 0),
              mpesaDeposits: (currentShift.mpesaDeposits || 0) + (method === 'M-Pesa' ? amount : 0),
              closingCashCalculated: currentShift.closingCashCalculated + (method === 'Cash' ? amount : 0),
              closingMpesaCalculated: currentShift.closingMpesaCalculated + (method === 'M-Pesa' ? amount : 0)
          };
          setCurrentShift(updatedShift);
          await db.saveShift(updatedShift);
      }
  };

  const handleDeleteCustomer = async (customerId: string) => {
      // Optimistic update
      setCustomers(prev => prev.filter(c => c.id !== customerId));
      try {
          await db.deleteCustomer(customerId);
      } catch (error) {
          console.error("Failed to delete customer from DB", error);
          alert("Error deleting customer from database. Please reload.");
      }
  }

  const handleOpenShift = async (cash: number, mpesa: number) => {
    const newShift: ShiftRecord = {
      id: generateId(),
      date: new Date().toISOString(),
      openedAt: new Date().toISOString(),
      openingCash: cash,
      openingMpesa: mpesa,
      closingCashCalculated: cash,
      closingMpesaCalculated: mpesa,
      expenses: [],
      cashRefunds: 0,
      mpesaRefunds: 0,
      cashDeposits: 0,
      mpesaDeposits: 0,
      isOpen: true
    };
    setCurrentShift(newShift);
    await db.saveShift(newShift);
  };

  const handleUpdateShift = async (actualCash: number, actualMpesa: number) => {
    if (!currentShift) return;
    const updatedShift = {
      ...currentShift,
      actualClosingCash: actualCash,
      actualClosingMpesa: actualMpesa
    };
    setCurrentShift(updatedShift);
    await db.saveShift(updatedShift);
  };

  const handleCloseShift = async (actualCash: number, actualMpesa: number) => {
    if (!currentShift) return;
    const closedShift = {
      ...currentShift,
      closedAt: new Date().toISOString(),
      actualClosingCash: actualCash,
      actualClosingMpesa: actualMpesa,
      isOpen: false
    };
    setCurrentShift(closedShift);
    setLastClosedShift(closedShift); // Update this immediately so LoginView has latest data
    await db.saveShift(closedShift);
  };

  const handlePayDebt = async (id: string, method: 'Cash' | 'M-Pesa') => {
    const tx = transactions.find(t => t.id === id);
    if (!tx) return;

    const updatedTx = { ...tx, status: 'Completed' as const, amountPaid: tx.total };
    
    // Update State
    setTransactions(prev => prev.map(t => t.id === id ? updatedTx : t));
    await db.saveTransaction(updatedTx);

    // Update Customer Debt Balance
    if (tx.customerId) {
        const customer = customers.find(c => c.id === tx.customerId);
        if (customer) {
             // Calculate how much debt was outstanding for this transaction
             const debtPaid = tx.total - (tx.amountPaid || 0); // Previous amountPaid was the upfront
             
             const updatedCustomer = {
                ...customer,
                totalDebt: Math.max(0, customer.totalDebt - debtPaid)
             };
             setCustomers(prev => prev.map(c => c.id === customer.id ? updatedCustomer : c));
             await db.saveCustomer(updatedCustomer);
        }
    }
    
    // Update Shift if open
    if (currentShift && currentShift.isOpen) {
      const debtPaid = tx.total - (tx.amountPaid || 0);
      const updatedShift = { ...currentShift };
      
      if (method === 'Cash') {
          updatedShift.closingCashCalculated += debtPaid;
      } else {
          updatedShift.closingMpesaCalculated += debtPaid;
      }

      setCurrentShift(updatedShift);
      await db.saveShift(updatedShift);
    }
  };

  const handleExpense = async (amount: number, reason: string, source: 'Cash' | 'M-Pesa' = 'Cash', category?: string) => {
    if (currentShift && currentShift.isOpen) {
      const newExpense: Expense = {
        id: generateId(),
        amount,
        reason,
        date: new Date().toISOString(),
        source,
        category
      };
      
      const updatedShift = {
        ...currentShift,
        expenses: [...currentShift.expenses, newExpense],
        closingCashCalculated: source === 'Cash' ? currentShift.closingCashCalculated - amount : currentShift.closingCashCalculated,
        closingMpesaCalculated: source === 'M-Pesa' ? currentShift.closingMpesaCalculated - amount : currentShift.closingMpesaCalculated
      };

      setCurrentShift(updatedShift);
      await db.saveShift(updatedShift);
    }
  };

  const handleSetDueDate = async (transactionId: string, dueDate: string) => {
    const tx = transactions.find(t => t.id === transactionId);
    if (tx) {
      const updatedTx = { ...tx, dueDate };
      setTransactions(prev => prev.map(t => t.id === transactionId ? updatedTx : t));
      await db.saveTransaction(updatedTx);
    }
  };

  const handleRefund = async (transaction: Transaction) => {
    const updatedTx = { ...transaction, status: 'Refunded' as const, isRefunded: true };
    setTransactions(prev => prev.map(t => t.id === transaction.id ? updatedTx : t));
    await db.saveTransaction(updatedTx);

    // Restore Stock
    const newProducts = products.map(p => {
      const soldItem = transaction.items.find(i => i.productId === p.id);
      if (soldItem) {
        const newStock = Number((p.stock + soldItem.quantity).toFixed(4));
        const updatedProduct = { ...p, stock: newStock };
        db.saveProduct(updatedProduct);
        return updatedProduct;
      }
      return p;
    });
    setProducts(newProducts);

    // Adjust Shift
    if (currentShift && currentShift.isOpen) {
      let shiftUpdate = { ...currentShift };
      
      if (transaction.paymentMethod === 'Cash') {
         shiftUpdate.cashRefunds = (shiftUpdate.cashRefunds || 0) + transaction.total;
         shiftUpdate.closingCashCalculated -= transaction.total;
      } else if (transaction.paymentMethod === 'M-Pesa') {
         shiftUpdate.mpesaRefunds = (shiftUpdate.mpesaRefunds || 0) + transaction.total;
         shiftUpdate.closingMpesaCalculated -= transaction.total;
      } else if (transaction.paymentMethod === 'Split' && transaction.splitDetails) {
         const change = transaction.amountPaid - transaction.total;
         const cashPaid = transaction.splitDetails.cash - change;

         shiftUpdate.cashRefunds = (shiftUpdate.cashRefunds || 0) + cashPaid;
         shiftUpdate.mpesaRefunds = (shiftUpdate.mpesaRefunds || 0) + transaction.splitDetails.mpesa;
         shiftUpdate.closingCashCalculated -= cashPaid;
         shiftUpdate.closingMpesaCalculated -= transaction.splitDetails.mpesa;
      } else if (transaction.paymentMethod === 'Debt') {
          // Refund Upfront Payment if any
          if (transaction.amountPaid > 0 && transaction.splitDetails) {
              shiftUpdate.cashRefunds = (shiftUpdate.cashRefunds || 0) + transaction.splitDetails.cash;
              shiftUpdate.mpesaRefunds = (shiftUpdate.mpesaRefunds || 0) + transaction.splitDetails.mpesa;
              shiftUpdate.closingCashCalculated -= transaction.splitDetails.cash;
              shiftUpdate.closingMpesaCalculated -= transaction.splitDetails.mpesa;
          }
      }

      setCurrentShift(shiftUpdate);
      await db.saveShift(shiftUpdate);
    }
    
    // Adjust Debt if needed (Rare case where debt sale is refunded)
    if (transaction.paymentMethod === 'Debt' && transaction.customerId && transaction.status === 'Pending Debt') {
         const customer = customers.find(c => c.id === transaction.customerId);
         if (customer) {
             const debtAmount = transaction.total - transaction.amountPaid;
             const updatedCustomer = {
                 ...customer,
                 totalDebt: Math.max(0, customer.totalDebt - debtAmount)
             };
             setCustomers(prev => prev.map(c => c.id === customer.id ? updatedCustomer : c));
             await db.saveCustomer(updatedCustomer);
         }
    }
  };

  const handleAddProduct = async (p: Product) => {
    setProducts([...products, p]);
    await db.saveProduct(p);

    // Log Stock Creation
    if (p.stock > 0) {
        const log: StockLog = {
            id: generateId(),
            productId: p.id,
            productName: p.name,
            quantityChanged: p.stock,
            newStockLevel: p.stock,
            reason: "Initial Stock (New Product)",
            date: new Date().toISOString(),
            expiryDate: p.expiryDate
        };
        await db.saveStockLog(log);
    }
  };
  
  const handleBulkAddProducts = async (newProducts: Product[]) => {
      setProducts(prev => [...prev, ...newProducts]);
      await db.saveAllProducts(newProducts);
      
      // Log Bulk Import
      for (const p of newProducts) {
          if (p.stock > 0) {
             const log: StockLog = {
                id: generateId(),
                productId: p.id,
                productName: p.name,
                quantityChanged: p.stock,
                newStockLevel: p.stock,
                reason: "Bulk Import (Initial)",
                date: new Date().toISOString(),
                expiryDate: p.expiryDate
             };
             await db.saveStockLog(log);
          }
      }
  }

  const handleUpdateProduct = async (p: Product) => {
    setProducts(products.map(prev => prev.id === p.id ? p : prev));
    await db.saveProduct(p);
  };

  const handleDeleteProduct = async (id: string) => {
    const product = products.find(p => p.id === id);
    setProducts(products.filter(p => p.id !== id));
    await db.deleteProduct(id);

    // Log Deletion
    if (product) {
        const log: StockLog = {
            id: generateId(),
            productId: id,
            productName: product.name,
            quantityChanged: -product.stock,
            newStockLevel: 0,
            reason: "Product Deleted",
            date: new Date().toISOString()
        };
        await db.saveStockLog(log);
    }
  };

  const handleReorderProducts = async (newProducts: Product[]) => {
    setProducts(newProducts);
    await db.saveAllProducts(newProducts);
  };

  const handleRestock = async (productId: string, quantity: number, reason: string, expiryDate?: string) => {
      const product = products.find(p => p.id === productId);
      if (product) {
          const newStock = Number((product.stock + quantity).toFixed(4));
          const updatedProduct = { 
              ...product, 
              stock: newStock,
              expiryDate: expiryDate || product.expiryDate // Update expiry if provided, else keep old
          };
          
          // Save Product
          setProducts(prev => prev.map(p => p.id === productId ? updatedProduct : p));
          await db.saveProduct(updatedProduct);

          // Save Log
          const log: StockLog = {
              id: generateId(),
              productId,
              productName: product.name,
              quantityChanged: quantity,
              newStockLevel: newStock,
              reason,
              date: new Date().toISOString(),
              expiryDate // Log the expiry date of this specific batch
          };
          await db.saveStockLog(log);
      }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2000000) { // 2MB limit check
        alert("Image is too large. Please use an image under 2MB.");
        return;
      }
      const reader = new FileReader();
      reader.onloadend = async () => {
        const newProfile = { ...profile, logoUrl: reader.result as string };
        setProfile(newProfile);
        await db.saveProfile(newProfile);
      };
      reader.readAsDataURL(file);
    }
  };

  // Update Settings (Profile)
  const handleUpdateProfile = async (newProfile: StoreProfile) => {
      setProfile(newProfile);
      await db.saveProfile(newProfile);
  }
  
  const handleExportData = async () => {
    const stockLogs = await db.getStockLogs();
    const data = {
        profile,
        products,
        transactions,
        currentShift,
        stockLogs,
        customers
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `duka_backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleRestoreData = async (file: File) => {
     if(confirm("WARNING: Restoring will OVERWRITE all current data. This cannot be undone. Do you want to proceed?")) {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target?.result as string);
                if (!data.products || !data.transactions || !data.profile) {
                    alert("Invalid backup file. Missing required data.");
                    return;
                }
                
                await db.restoreDatabase(data);
                alert("Data restored successfully. The app will now reload.");
                window.location.reload();
            } catch (error) {
                console.error(error);
                alert("Failed to parse backup file.");
            }
        };
        reader.readAsText(file);
     }
  }

  const handleResetApp = async () => {
    if(confirm("CRITICAL WARNING: This will delete ALL data (Sales, Products, Inventory). This action cannot be undone. Are you sure?")) {
        if(confirm("Are you really sure? Did you export your data first?")) {
            await db.resetDatabase();
        }
    }
  }

  const handleAdminAccess = () => {
    setIsPinModalOpen(true);
  }

  const handleAdminSuccess = () => {
    setAppMode('ADMIN');
    setView(AppView.DASHBOARD);
    setIsPinModalOpen(false);
  }

  // Daily Sales Calculation for POS Header
  const today = new Date().toISOString().split('T')[0];
  const todaySales = useMemo(() => transactions
    .filter(t => t.date.startsWith(today) && t.status !== 'Refunded')
    .reduce((acc, t) => acc + t.total, 0), [transactions, today]);

  // Loading Screen
  if (isLoading) {
      return (
          <div className="min-h-screen flex flex-col items-center justify-center bg-[#F0F2F5] dark:bg-black text-gray-800 dark:text-white">
              <Loader2 className="w-12 h-12 animate-spin text-primary-600 mb-4" />
              <h2 className="text-xl font-bold animate-pulse">Loading DukaManager...</h2>
              <p className="text-sm text-gray-500">Setting up secure storage</p>
          </div>
      )
  }

  // Login Screen Component (Liquid Glass Design)
  if (!currentShift || !currentShift.isOpen) {
    return (
      <LoginView 
        profile={profile} 
        onOpenShift={handleOpenShift} 
        isDarkMode={isDarkMode} 
        setIsDarkMode={setIsDarkMode} 
        lastClosedShift={lastClosedShift}
      />
    );
  }

  // Settings Component (Inline)
  const SettingsView = () => (
    <div className="bg-white dark:bg-gray-900 p-8 rounded-2xl shadow-[0_4px_12px_rgba(0,0,0,0.08)] max-w-2xl mx-auto border border-gray-200 dark:border-gray-800">
      <h2 className="text-3xl font-black mb-8 dark:text-white tracking-tight">Store Settings</h2>
      <div className="space-y-6">
        <div>
          <label className="block text-sm font-bold mb-2 dark:text-gray-300">Store Name</label>
          <input 
            name="storeName"
            type="text" 
            value={profile.name} 
            onChange={e => handleUpdateProfile({...profile, name: e.target.value})}
            className="w-full p-3 border border-gray-300 dark:border-gray-700 rounded-xl dark:bg-gray-950 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none transition-all"
          />
        </div>
        <div>
          <label className="block text-sm font-bold mb-2 dark:text-gray-300">Location</label>
          <input 
            name="location"
            type="text" 
            value={profile.location} 
            onChange={e => handleUpdateProfile({...profile, location: e.target.value})}
            className="w-full p-3 border border-gray-300 dark:border-gray-700 rounded-xl dark:bg-gray-950 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none transition-all"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold mb-2 dark:text-gray-300">Currency Symbol</label>
              <input 
                name="currency"
                type="text" 
                value={profile.currency} 
                onChange={e => handleUpdateProfile({...profile, currency: e.target.value})}
                className="w-full p-3 border border-gray-300 dark:border-gray-700 rounded-xl dark:bg-gray-950 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-bold mb-2 dark:text-gray-300">Daily Sales Target</label>
              <input 
                name="dailyTarget"
                type="number" 
                value={profile.dailySalesTarget || ''} 
                onChange={e => handleUpdateProfile({...profile, dailySalesTarget: Number(e.target.value)})}
                className="w-full p-3 border border-gray-300 dark:border-gray-700 rounded-xl dark:bg-gray-950 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                placeholder="e.g. 10000"
              />
            </div>
        </div>
        
        {/* Security Section */}
        <div className="pt-4 border-t border-gray-100 dark:border-gray-800">
           <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-purple-500" />
                Security
            </h3>
            <div>
              <label className="block text-sm font-bold mb-2 dark:text-gray-300">Admin PIN (4 Digits)</label>
              <input 
                name="adminPin"
                type="password" 
                maxLength={4}
                value={profile.adminPin || '1234'} 
                onChange={e => handleUpdateProfile({...profile, adminPin: e.target.value.replace(/\D/g, '').slice(0, 4)})}
                className="w-full p-3 border border-gray-300 dark:border-gray-700 rounded-xl dark:bg-gray-950 dark:text-white focus:ring-2 focus:ring-purple-500 outline-none transition-all tracking-[0.5em] font-mono text-lg"
              />
              <p className="text-xs text-gray-400 mt-1">This PIN protects the Admin dashboard.</p>
            </div>
        </div>

        <div>
           <label className="block text-sm font-bold mb-2 dark:text-gray-300">Store Logo</label>
           <div className="flex gap-6 items-center p-4 border border-dashed border-gray-300 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-black/20">
             <img src={profile.logoUrl} alt="Logo" className="w-20 h-20 rounded-full border-2 border-white dark:border-gray-700 object-cover shadow-md" />
             <label className="cursor-pointer bg-white dark:bg-gray-800 px-5 py-3 rounded-xl text-sm hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-white transition-all border border-gray-200 dark:border-gray-700 font-bold shadow-sm">
                <Upload className="w-4 h-4 inline mr-2" />
                Upload New Logo
                <input 
                  type="file" 
                  accept="image/*"
                  ref={fileInputRef}
                  className="hidden" 
                  onChange={handleLogoUpload} 
                />
             </label>
           </div>
        </div>

        {/* Data Management Section */}
        <div className="pt-8 border-t border-gray-100 dark:border-gray-800">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <Database className="w-5 h-5 text-gray-500" />
                Data Management
            </h3>
            <div className="flex flex-col gap-4">
                <div className="flex gap-2">
                    <button 
                        onClick={handleExportData}
                        className="flex-1 flex items-center justify-center gap-2 px-5 py-3 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded-xl hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors font-bold"
                    >
                        <Download className="w-4 h-4" /> Backup Data
                    </button>
                    <label className="flex-1 cursor-pointer flex items-center justify-center gap-2 px-5 py-3 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors font-bold">
                        <Upload className="w-4 h-4" /> Restore Backup
                        <input 
                            type="file" 
                            className="hidden" 
                            accept=".json" 
                            onChange={(e) => {
                                if(e.target.files?.[0]) handleRestoreData(e.target.files[0]);
                            }}
                        />
                    </label>
                </div>
                <button 
                    onClick={handleResetApp}
                    className="flex items-center justify-center gap-2 px-5 py-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-xl hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors font-bold"
                >
                    <Trash2 className="w-4 h-4" /> Factory Reset App
                </button>
            </div>
            <p className="text-xs text-gray-400 mt-2">Export your data regularly to keep backups. Factory reset will delete all sales, products, and records permanently.</p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-[#F0F2F5] dark:bg-black text-gray-900 dark:text-gray-100 font-sans overflow-hidden transition-colors">
      <PinEntryModal 
        isOpen={isPinModalOpen} 
        onClose={() => setIsPinModalOpen(false)} 
        onSuccess={handleAdminSuccess}
        correctPin={profile.adminPin || "1234"}
      />

      {/* --- ADMIN SIDEBAR MODE --- */}
      {appMode === 'ADMIN' && (
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-50 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 shadow-xl lg:shadow-none transform transition-all duration-300 ease-in-out flex flex-col
        ${isSidebarOpen ? 'translate-x-0 w-72' : '-translate-x-full lg:translate-x-0'}
        ${isSidebarCollapsed ? 'lg:w-20' : 'lg:w-72'}
      `}>
        <div className={`flex items-center gap-3 border-b border-gray-100 dark:border-gray-800 transition-all duration-300 ${isSidebarCollapsed ? 'p-4 justify-center' : 'p-6'}`}>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center overflow-hidden shrink-0 shadow-lg ring-2 ring-white dark:ring-gray-800">
            <Lock className="w-5 h-5 text-white" />
          </div>
          {!isSidebarCollapsed && (
            <div className="min-w-0 animate-fade-in">
              <h1 className="font-black text-lg leading-tight truncate tracking-tight">Admin</h1>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate font-medium">Back Office</p>
            </div>
          )}
        </div>

        <nav className="flex-1 p-3 space-y-2 overflow-y-auto overflow-x-hidden">
          {[
            { id: AppView.DASHBOARD, icon: LayoutDashboard, label: 'Dashboard' },
            { id: AppView.INVENTORY, icon: Package, label: 'Inventory' },
            { id: AppView.FINANCE, icon: BarChart3, label: 'Finance' },
            { id: AppView.SETTINGS, icon: Settings, label: 'Settings' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => { setView(item.id); setIsSidebarOpen(false); }}
              title={isSidebarCollapsed ? item.label : ''}
              className={`w-full flex items-center gap-3 px-3 py-3.5 rounded-xl transition-all font-bold group relative ${
                view === item.id
                  ? 'bg-purple-50 text-purple-600 dark:bg-purple-600/10 dark:text-purple-400 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50 hover:text-gray-900 dark:hover:text-gray-200'
              } ${isSidebarCollapsed ? 'justify-center' : ''}`}
            >
              <item.icon className={`w-6 h-6 transition-transform duration-200 ${view === item.id ? 'scale-110' : 'scale-100'}`} />
              
              {!isSidebarCollapsed && <span className="whitespace-nowrap ml-1">{item.label}</span>}
              {view === item.id && !isSidebarCollapsed && (
                <div className="absolute right-3 w-1.5 h-1.5 rounded-full bg-purple-500"></div>
              )}
            </button>
          ))}
        </nav>

        <div className="p-3 border-t border-gray-100 dark:border-gray-800 space-y-2">
           {/* Switch to Selling Button */}
           <button
             onClick={() => setAppMode('POS')}
             title={isSidebarCollapsed ? "Switch to Selling" : ""}
             className={`w-full flex items-center gap-3 p-3 rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors font-bold ${isSidebarCollapsed ? 'justify-center' : ''}`}
           >
             <ShoppingCart className="w-5 h-5" />
             {!isSidebarCollapsed && "Selling Mode"}
           </button>

           <button
             onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
             className="hidden lg:flex w-full items-center justify-center p-2 rounded-lg text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
           >
             {isSidebarCollapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
           </button>

           <button
            onClick={() => {
              if(confirm("Logout and return to login screen?")) {
                window.location.reload(); 
              }
            }}
            title={isSidebarCollapsed ? "Logout" : ""}
            className={`w-full flex items-center gap-3 p-3 rounded-xl text-red-600 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors font-bold ${isSidebarCollapsed ? 'justify-center' : ''}`}
          >
            <LogOut className="w-5 h-5" />
            {!isSidebarCollapsed && "Logout"}
          </button>
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
             title={isSidebarCollapsed ? "Toggle Theme" : ""}
            className={`w-full flex items-center gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors font-bold ${isSidebarCollapsed ? 'justify-center' : ''}`}
          >
            {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            {!isSidebarCollapsed && (isDarkMode ? 'Light Mode' : 'Dark Mode')}
          </button>
        </div>
      </aside>
      )}

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* --- POS MODE HEADER --- */}
        {appMode === 'POS' && (
          <header className="h-16 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between px-6 z-10 shrink-0 gap-4">
            <div className="flex items-center gap-3 shrink-0">
               <div className="w-10 h-10 rounded-xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                  <img src={profile.logoUrl} alt="Logo" className="w-full h-full object-contain p-1 opacity-90" />
               </div>
               <div>
                  <h1 className="font-black text-lg tracking-tight leading-none text-gray-900 dark:text-white">{profile.name}</h1>
                  <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">{profile.location} • Selling Mode</p>
               </div>
            </div>
            
            {/* Sales Target Progress (Centered) */}
            {profile.dailySalesTarget && profile.dailySalesTarget > 0 && (
                <div className="hidden md:flex flex-1 flex-col justify-center max-w-sm mx-auto">
                    <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider mb-1 text-gray-500 dark:text-gray-400">
                        <span>Daily Target</span>
                        <span className={todaySales >= profile.dailySalesTarget ? "text-green-600" : ""}>
                            {Math.round((todaySales / profile.dailySalesTarget) * 100)}%
                        </span>
                    </div>
                    <div className="h-2 w-full bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div 
                            className={`h-full rounded-full transition-all duration-1000 ${todaySales >= profile.dailySalesTarget ? 'bg-green-500' : 'bg-primary-500'}`} 
                            style={{ width: `${Math.min(100, (todaySales / profile.dailySalesTarget) * 100)}%` }}
                        ></div>
                    </div>
                </div>
            )}
            
            <div className="flex items-center gap-3 shrink-0">
               <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wider ${isOnline ? 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800/50 dark:text-emerald-400' : 'bg-red-50 text-red-600 border-red-200 dark:bg-red-900/20 dark:border-red-800/50 dark:text-red-400'}`}>
                   {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                   <span className="hidden sm:inline">{isOnline ? 'Online' : 'Offline'}</span>
               </div>
               <button 
                 onClick={() => setIsDarkMode(!isDarkMode)}
                 className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors"
               >
                 {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
               </button>
               <div className="h-6 w-px bg-gray-200 dark:bg-gray-800 mx-1"></div>
               <button 
                 onClick={handleAdminAccess}
                 className="flex items-center gap-2 bg-gray-900 dark:bg-white text-white dark:text-black px-4 py-2 rounded-xl font-bold text-sm hover:shadow-lg hover:-translate-y-0.5 transition-all"
               >
                 <Lock className="w-4 h-4" />
                 <span className="hidden sm:inline">Admin</span>
               </button>
            </div>
          </header>
        )}

        {/* --- ADMIN MODE HEADER (Mobile) --- */}
        {appMode === 'ADMIN' && (
          <header className="h-16 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between px-4 lg:hidden z-10 shrink-0">
            <button onClick={() => setIsSidebarOpen(true)} className="p-2 -ml-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors">
              <Menu className="w-6 h-6" />
            </button>
            <span className="font-black text-lg tracking-tight">Admin Panel</span>
            <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wider ${isOnline ? 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800/50 dark:text-emerald-400' : 'bg-red-50 text-red-600 border-red-200 dark:bg-red-900/20 dark:border-red-800/50 dark:text-red-400'}`}>
                {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            </div>
          </header>
        )}

        <div className={`flex-1 relative ${appMode === 'POS' ? 'overflow-hidden p-2 lg:p-4' : 'overflow-auto p-4 lg:p-6'}`}>
           {/* Background decorative blobs (Shared) */}
           <div className="absolute top-0 left-0 w-64 h-64 bg-primary-500/5 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2 pointer-events-none"></div>
           <div className="absolute bottom-0 right-0 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl translate-x-1/3 translate-y-1/3 pointer-events-none"></div>
           
           <div className="relative z-10 h-full flex flex-col">
            
            {/* Frontend: POS VIEW */}
            {appMode === 'POS' && (
               <POS 
                products={products} 
                customers={customers}
                transactions={transactions}
                onAddCustomer={handleAddCustomer}
                onCompleteSale={handleSale} 
                onRecordExpense={handleExpense}
                storeProfile={profile}
                // Removed backup/restore props as they are now in Admin -> Settings
              />
            )}

            {/* Backend: ADMIN VIEWS */}
            {appMode === 'ADMIN' && view === AppView.DASHBOARD && (
              <Dashboard 
                products={products} 
                transactions={transactions} 
                storeProfile={profile} 
                currentShift={currentShift} 
                stockLogs={stockLogs}
                customers={customers}
                onNavigate={(view) => setView(view)}
                onUpdateProfile={handleUpdateProfile} 
              />
            )}
            
            {appMode === 'ADMIN' && view === AppView.INVENTORY && (
              <Inventory 
                products={products} 
                onAddProduct={handleAddProduct}
                onUpdateProduct={handleUpdateProduct}
                onDeleteProduct={handleDeleteProduct}
                onReorderProducts={handleReorderProducts}
                onBulkAddProducts={handleBulkAddProducts}
                storeProfile={profile}
                onRestock={handleRestock} 
              />
            )}
            
            {appMode === 'ADMIN' && view === AppView.FINANCE && (
              <Finance 
                transactions={transactions} 
                shift={currentShift}
                customers={customers}
                onAddCustomer={handleAddCustomer}
                onDeleteCustomer={handleDeleteCustomer}
                onCustomerDeposit={handleCustomerDeposit}
                onOpenShift={handleOpenShift} 
                onCloseShift={handleCloseShift}
                onUpdateShift={handleUpdateShift}
                onPayDebt={handlePayDebt}
                onRefund={handleRefund}
                onRecordExpense={handleExpense}
                onSetDueDate={handleSetDueDate}
                storeProfile={profile}
              />
            )}
            
            {appMode === 'ADMIN' && view === AppView.SETTINGS && <SettingsView />}
           </div>
        </div>
      </main>
    </div>
  );
};

export default App;
