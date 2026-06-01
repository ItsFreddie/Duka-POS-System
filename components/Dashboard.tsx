
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, PieChart, Pie, Cell, Legend, ComposedChart, Line } from 'recharts';
import { TrendingUp, DollarSign, AlertCircle, ShoppingBag, Sparkles, Loader2, Target, Edit3, PieChart as PieChartIcon, CreditCard, FileDown, Calendar, Wallet, Banknote, TrendingDown, ArrowRight, AlertTriangle, X, Check, AlertOctagon, Package, Activity, ChevronDown, Filter, Search, Truck } from 'lucide-react';
import { Product, Transaction, StoreProfile, AppView, ShiftRecord, StockLog, Customer, MissedSale } from '../types';
import * as db from '../utils/db';
import { getBusinessInsights, createBusinessChat } from '../services/geminiService';
import confetti from 'canvas-confetti';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { Chat } from '@google/genai';

interface DashboardProps {
  products: Product[];
  transactions: Transaction[];
  storeProfile: StoreProfile;
  currentShift: ShiftRecord | null;
  stockLogs: StockLog[];
  customers: Customer[];
  missedSales?: MissedSale[];
  onNavigate: (view: AppView) => void;
  onUpdateProfile: (profile: StoreProfile) => void;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#f43f5e', '#84cc16'];
const PIE_COLORS = ['#3b82f6', '#10b981', '#ef4444', '#f59e0b', '#8b5cf6']; // Cash(Blue), Mpesa(Green), Credit(Red), Split(Orange), Other(Violet)

export const Dashboard: React.FC<DashboardProps> = ({ products, transactions, storeProfile, currentShift, stockLogs, customers, missedSales = [], onNavigate, onUpdateProfile }) => {
  const [insight, setInsight] = useState<string | null>(null);
  const [chatSession, setChatSession] = useState<Chat | null>(null);
  const [chatMessages, setChatMessages] = useState<{role: 'user' | 'ai', text: string}[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [loadingInsight, setLoadingInsight] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [salesView, setSalesView] = useState<'weekly' | 'monthly' | 'yearly'>('weekly');
  const [viewDetails, setViewDetails] = useState<{ title: string; items: Product[] } | null>(null);
  const [selectedDayFilter, setSelectedDayFilter] = useState<string>('All');
  const [spendingMetric, setSpendingMetric] = useState<'spent' | 'points'>('spent');
  const [itemsSoldDate, setItemsSoldDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [isItemsSoldModalOpen, setIsItemsSoldModalOpen] = useState(false);
  const [showAllRestock, setShowAllRestock] = useState(false);
  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const dashboardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    db.getAllShifts().then(setShifts).catch(console.error);
  }, []);

  // --- 1. Daily Financial Overview Calculation ---
  const today = new Date().toISOString().split('T')[0];
  const todayTransactions = transactions.filter(t => t.date.startsWith(today) && t.status !== 'Refunded');
  
  const todaySales = todayTransactions.reduce((acc, t) => acc + t.total, 0);

  // --- Missed Sales Intelligence ---
  const missedSalesIntelligence = useMemo(() => {
    const items: Record<string, { name: string, dates: Set<string>, totalLost: number, count: number }> = {};
    
    missedSales.forEach(sale => {
      const date = sale.timestamp.split('T')[0];
      if (!items[sale.itemName]) {
        items[sale.itemName] = { name: sale.itemName, dates: new Set(), totalLost: 0, count: 0 };
      }
      items[sale.itemName].dates.add(date);
      items[sale.itemName].totalLost += sale.lostProfit;
      items[sale.itemName].count += 1;
    });

    const flaggedItems = Object.values(items).map(item => {
      // 3-Day Rule check: Flag if logged on 3 or more different days
      const isReinvestmentTarget = item.dates.size >= 3;
      
      // Bulk vs Daily logic
      const bulkItems = ['Sugar', 'Flour', 'Detergent', 'Cooking Oil', 'Rice', 'Soap', 'Salt'];
      const dailyItems = ['Milk', 'Bread', 'Eggs', 'Vegetables', 'Fruit', 'Yogurt'];
      
      let strategy: 'Bulk Batch Buying' | 'Inventory Volume Adjustment' | 'Evaluate' = 'Evaluate';
      if (bulkItems.some(bi => item.name.toLowerCase().includes(bi.toLowerCase()))) {
        strategy = 'Bulk Batch Buying';
      } else if (dailyItems.some(di => item.name.toLowerCase().includes(di.toLowerCase()))) {
        strategy = 'Inventory Volume Adjustment';
      }

      return {
        ...item,
        isReinvestmentTarget,
        strategy
      };
    }).filter(i => i.isReinvestmentTarget);

    return flaggedItems;
  }, [missedSales]);

  // Calculate All-Time High Sales
  const allTimeHighSales = useMemo(() => {
    const dailyTotals: Record<string, number> = {};
    transactions.forEach(t => {
      if (t.status === 'Refunded') return;
      const date = t.date.split('T')[0];
      if (date !== today) { // Only consider past days for the record
        dailyTotals[date] = (dailyTotals[date] || 0) + t.total;
      }
    });
    const maxHistorical = Math.max(0, ...Object.values(dailyTotals));
    return maxHistorical;
  }, [transactions, today]);

  const isAllTimeHigh = todaySales > 0 && todaySales >= allTimeHighSales && allTimeHighSales > 0;
  
  // Comparative Data (Last Week Same Day & SAME TIME)
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  const lastWeekDate = new Date();
  lastWeekDate.setDate(lastWeekDate.getDate() - 7);
  const lastWeekDateStr = lastWeekDate.toISOString().split('T')[0];
  const lastWeekDayName = lastWeekDate.toLocaleDateString('en-KE', { weekday: 'long' });
  
  const lastWeekSameTimeTransactions = transactions.filter(t => {
    if (t.status === 'Refunded') return false;
    const tDate = new Date(t.date);
    const tDateStr = tDate.toISOString().split('T')[0];
    
    // Must be same day last week
    if (tDateStr !== lastWeekDateStr) return false;
    
    // Check time: hour must be less than current, or equal hour with less/equal minute
    const tHour = tDate.getHours();
    const tMinute = tDate.getMinutes();
    
    if (tHour < currentHour) return true;
    if (tHour === currentHour && tMinute <= currentMinute) return true;
    
    return false;
  });

  const lastWeekSameTimeSales = lastWeekSameTimeTransactions.reduce((acc, t) => acc + t.total, 0);
  
  const salesGrowth = lastWeekSameTimeSales === 0 ? (todaySales > 0 ? 100 : 0) : ((todaySales - lastWeekSameTimeSales) / lastWeekSameTimeSales) * 100;

  // Calculate Profit: Revenue - Cost
  const todayCost = todayTransactions.reduce((acc, t) => {
    return acc + t.items.reduce((sum, item) => sum + (item.cost * item.quantity), 0);
  }, 0);
  const todayProfit = todaySales - todayCost;
  const todayMargin = todaySales > 0 ? ((todayProfit / todaySales) * 100).toFixed(1) : '0';

  // Sales Target Logic
  const salesTarget = storeProfile.dailySalesTarget || 0;
  const progressPercent = salesTarget > 0 ? Math.min(100, (todaySales / salesTarget) * 100) : 0;
  const isTargetMet = salesTarget > 0 && todaySales >= salesTarget;

  const lastWeekTargetTime = useMemo(() => {
    if (!salesTarget) return null;
    const lastWeekDate = new Date();
    lastWeekDate.setDate(lastWeekDate.getDate() - 7);
    const lastWeekDateString = lastWeekDate.toISOString().split('T')[0];

    const lastWeekTransactions = transactions
      .filter(t => t.date.startsWith(lastWeekDateString) && t.status !== 'Refunded')
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    let accumulated = 0;
    for (const t of lastWeekTransactions) {
      accumulated += t.total;
      if (accumulated >= salesTarget) {
        return new Date(t.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
    }
    return null;
  }, [transactions, salesTarget]);

  // Collection Breakdown
  const cashCollected = todayTransactions.reduce((acc, t) => {
    if (t.paymentMethod === 'Cash') return acc + t.total;
    if (t.paymentMethod === 'Split' && t.splitDetails) return acc + t.splitDetails.cash;
    if (t.paymentMethod === 'Debt' && t.amountPaid > 0) return acc + (t.splitDetails?.cash || t.amountPaid); 
    return acc;
  }, 0);

  const mpesaCollected = todayTransactions.reduce((acc, t) => {
    if (t.paymentMethod === 'M-Pesa') return acc + t.total;
    if (t.paymentMethod === 'Split' && t.splitDetails) return acc + t.splitDetails.mpesa;
    return acc;
  }, 0);


  // --- 2. Cash Accountability (Based on current shift if open) ---
  const expectedCash = currentShift ? currentShift.closingCashCalculated : 0;
  const actualCash = currentShift?.actualClosingCash;
  const cashVariance = actualCash !== undefined ? actualCash - expectedCash : 0;

  // --- 3. Inventory Value Trend ---
  const [inventoryTrendView, setInventoryTrendView] = useState<'weekly' | 'monthly' | 'yearly'>('weekly');

  const inventoryTrendData = useMemo(() => {
    const data = [];
    const now = new Date();
    
    // Create a map of current stock
    const currentStockMap = new Map<string, number>();
    products.forEach(p => currentStockMap.set(p.id, p.stock));

    // Helper to calculate total value
    const calculateValue = (stockMap: Map<string, number>) => {
      let total = 0;
      stockMap.forEach((qty, id) => {
        const product = products.find(p => p.id === id);
        if (product) {
          total += qty * product.buyPrice;
        }
      });
      return total;
    };

    if (inventoryTrendView === 'yearly') {
        // Yearly View: Last 12 Months (Monthly data points)
        for (let i = 0; i < 12; i++) {
            const date = new Date(now.getFullYear(), now.getMonth() - i, 1); // 1st of the month
            // We want the value at the END of this month. 
            // Actually, iterating backwards:
            // i=0: Current month. We are at "now". Value is current.
            // Then we reverse everything from "now" back to "start of month".
            // Wait, simpler: 
            // Point 0: Now (Current Value). Label: Current Month.
            // Reverse logs/txs from Now to Start of Current Month.
            // Point 1: End of Previous Month.
            
            // Let's stick to "End of Month" values.
            // For the current month (partial), we use "Now".
            // For previous months, we use "Last Day of Month".
            
            const monthName = date.toLocaleDateString('en-KE', { month: 'short', year: '2-digit' });
            
            // 1. Capture current state (End of this period)
            const value = calculateValue(currentStockMap);
            data.unshift({
                name: monthName,
                date: date.toISOString().slice(0, 7),
                value: value
            });

            // 2. Reverse changes for this entire month to get to the start of it (which is end of prev month)
            // Filter logs/txs that happened in this month (YYYY-MM)
            const monthPrefix = date.toISOString().slice(0, 7); // YYYY-MM
            
            // Reverse Stock Logs
            const monthLogs = stockLogs.filter(log => log.date.startsWith(monthPrefix));
            monthLogs.forEach(log => {
                const currentQty = currentStockMap.get(log.productId) || 0;
                currentStockMap.set(log.productId, currentQty - log.quantityChanged);
            });

            // Reverse Transactions (Sales)
            const monthTxs = transactions.filter(t => t.date.startsWith(monthPrefix) && t.status !== 'Refunded');
            monthTxs.forEach(t => {
                t.items.forEach(item => {
                    const currentQty = currentStockMap.get(item.productId) || 0;
                    currentStockMap.set(item.productId, currentQty + item.quantity); // Add back sold items
                });
            });
        }
    } else {
        // Weekly (7 days) or Monthly (30 days) - Daily data points
        const days = inventoryTrendView === 'weekly' ? 7 : 30;
        
        for (let i = 0; i < days; i++) {
            const date = new Date(now);
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            const dayName = date.toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });

            // 1. Capture value (End of this day)
            const value = calculateValue(currentStockMap);
            
            data.unshift({
                name: dayName,
                date: dateStr,
                value: value
            });

            // 2. Reverse logs/txs for this day to get to start of day
            
            // Reverse Stock Logs
            const daysLogs = stockLogs.filter(log => log.date.startsWith(dateStr));
            daysLogs.forEach(log => {
                const currentQty = currentStockMap.get(log.productId) || 0;
                currentStockMap.set(log.productId, currentQty - log.quantityChanged);
            });

            // Reverse Transactions (Sales)
            const dayTxs = transactions.filter(t => t.date.startsWith(dateStr) && t.status !== 'Refunded');
            dayTxs.forEach(t => {
                t.items.forEach(item => {
                    const currentQty = currentStockMap.get(item.productId) || 0;
                    currentStockMap.set(item.productId, currentQty + item.quantity); // Add back sold items
                });
            });
        }
    }

    return data;
  }, [products, stockLogs, transactions, inventoryTrendView]);

  const expectedMpesa = currentShift ? currentShift.closingMpesaCalculated : 0;
  const actualMpesa = currentShift?.actualClosingMpesa;
  const mpesaVariance = actualMpesa !== undefined ? actualMpesa - expectedMpesa : 0;
  
  const hasCashVariance = actualCash !== undefined && cashVariance !== 0;
  const hasMpesaVariance = actualMpesa !== undefined && mpesaVariance !== 0;

  // --- 3. Inventory Health ---
  const totalStockValue = products.reduce((acc, p) => acc + (p.buyPrice * p.stock), 0);
  const lowStockItems = products.filter(p => (p.reorderPoint !== undefined ? p.stock <= p.reorderPoint : p.stock <= 5) && p.stock > 0);
  const outOfStockItems = products.filter(p => p.stock <= 0);

  const restockSuggestions = useMemo(() => {
    const thirtyAgo = new Date();
    thirtyAgo.setDate(thirtyAgo.getDate() - 30);
    const startStr = thirtyAgo.toISOString().split('T')[0];

    // Filter transactions to last 30 days
    const last30DaysTx = transactions.filter(t => t.date >= startStr && t.status !== 'Refunded');

    // Count sold quantities for each product in last 30 days
    const productSoldQty: Record<string, number> = {};
    last30DaysTx.forEach(t => {
      t.items.forEach(item => {
        productSoldQty[item.productId] = (productSoldQty[item.productId] || 0) + item.quantity;
      });
    });

    return products.map(p => {
      const sold30 = productSoldQty[p.id] || 0;
      const salesVelocity = sold30 / 30; // units per day

      // Determine Lead Time based on Product Category (realistic supply chain defaults)
      let leadTime = 2; // general default in days
      const cat = (p.category || '').toLowerCase();
      if (cat.includes('drink') || cat.includes('beverage') || cat.includes('milk') || cat.includes('bread') || cat.includes('fresh')) {
        leadTime = 1; // 1-day rapid local delivery
      } else if (cat.includes('snack') || cat.includes('food') || cat.includes('grocer')) {
        leadTime = 2; // 2 days
      } else if (cat.includes('beauty') || cat.includes('cosmetic') || cat.includes('care') || cat.includes('apparel') || cat.includes('cloth')) {
        leadTime = 3; // 3 days
      } else if (cat.includes('electro') || cat.includes('tech') || cat.includes('phone') || cat.includes('access')) {
        leadTime = 5; // 5 days
      }

      // Calculate depleted days remaining
      const daysRemaining = salesVelocity > 0 ? p.stock / salesVelocity : Infinity;

      // Restock trigger threshold
      const restockBarrier = salesVelocity * leadTime;

      // Recommended Stock level: cover next 21 days + lead time buffer
      const idealStockTarget = Math.max(10, Math.ceil(salesVelocity * 21));
      const recommendedOrderQty = idealStockTarget - p.stock;
      const restockOutlay = recommendedOrderQty > 0 ? recommendedOrderQty * p.buyPrice : 0;

      // Classification Status:
      let status: 'critical' | 'warning' | 'safe' = 'safe';
      if (p.stock <= 0) {
        status = 'critical';
      } else if (salesVelocity > 0 && daysRemaining <= leadTime) {
        status = 'critical';
      } else if (salesVelocity > 0 && daysRemaining <= leadTime * 1.8) {
        status = 'warning';
      } else if (p.reorderPoint !== undefined && p.stock <= p.reorderPoint) {
        status = 'warning';
      }

      return {
        ...p,
        salesVelocity: parseFloat(salesVelocity.toFixed(2)),
        sold30,
        leadTime,
        daysRemaining: daysRemaining === Infinity ? -1 : parseFloat(daysRemaining.toFixed(1)),
        restockBarrier: parseFloat(restockBarrier.toFixed(1)),
        recommendedOrderQty: recommendedOrderQty > 0 ? recommendedOrderQty : 0,
        restockOutlay,
        status
      };
    }).filter(p => p.status === 'critical' || p.status === 'warning')
      .sort((a, b) => {
        const aOut = a.stock <= 0;
        const bOut = b.stock <= 0;
        if (aOut && !bOut) return -1;
        if (!aOut && bOut) return 1;
        return b.salesVelocity - a.salesVelocity;
      });
  }, [products, transactions]);

  // Expiring Soon (Next 2 Days)
  const expiringSoonItems = products.filter(p => {
      if (!p.expiryDate) return false;
      const expiry = new Date(p.expiryDate);
      const diffTime = expiry.getTime() - now.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return diffDays <= 2; // Includes expired items (negative days)
  });

  // Slow Moving: No sales in last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const recentProductIds = new Set(
    transactions
      .filter(t => new Date(t.date) >= thirtyDaysAgo)
      .flatMap(t => t.items.map(i => i.productId))
  );

  const slowMovingItems = products.filter(p => !recentProductIds.has(p.id) && p.stock > 0);
  const slowMovingValue = slowMovingItems.reduce((acc, p) => acc + (p.buyPrice * p.stock), 0);

  // --- 4. Trends Data & Filtered Transactions ---
  const periodTransactions = useMemo(() => {
    let startDate = new Date();
    
    if (salesView === 'yearly') {
        startDate.setMonth(startDate.getMonth() - 11);
        startDate.setDate(1); // First day of start month
    } else {
        const days = salesView === 'weekly' ? 7 : 30;
        startDate.setDate(startDate.getDate() - days);
    }
    
    const startStr = startDate.toISOString().split('T')[0];
    return transactions.filter(t => t.date >= startStr && t.status !== 'Refunded');
  }, [transactions, salesView]);

  const chartData = useMemo(() => {
    if (salesView === 'yearly') {
        return Array.from({ length: 12 }).map((_, i) => {
            const d = new Date();
            d.setMonth(d.getMonth() - (11 - i));
            d.setDate(1);
            
            const monthStr = d.toISOString().slice(0, 7); // YYYY-MM
            
            // Previous Year Comparison (Same month, last year)
            const prevD = new Date(d);
            prevD.setFullYear(prevD.getFullYear() - 1);
            const prevMonthStr = prevD.toISOString().slice(0, 7);

            // Current Year Data
            const monthSales = transactions.filter(t => t.date.startsWith(monthStr) && t.status !== 'Refunded');
            const revenue = monthSales.reduce((acc, t) => acc + t.total, 0);
            const profit = monthSales.reduce((acc, t) => {
                const cost = t.items.reduce((c, i) => c + (i.cost * i.quantity), 0);
                return acc + (t.total - cost);
            }, 0);

            // Prev Year Data
            const prevMonthSales = transactions.filter(t => t.date.startsWith(prevMonthStr) && t.status !== 'Refunded');
            const prevRevenue = prevMonthSales.reduce((acc, t) => acc + t.total, 0);

            return {
                name: d.toLocaleDateString('en-KE', { month: 'short' }),
                fullDate: d.toLocaleDateString('en-KE', { month: 'long', year: 'numeric' }),
                prevFullDate: prevD.toLocaleDateString('en-KE', { month: 'long', year: 'numeric' }),
                sales: revenue,
                profit: profit,
                prevSales: prevRevenue
            };
        });
    }

    const days = salesView === 'weekly' ? 7 : 30;
    const offset = days; // For "last week" or "last month" comparison

    return Array.from({ length: days }).map((_, i) => {
      // Current Period Date
      const d = new Date();
      d.setDate(d.getDate() - ((days - 1) - i));
      const dateStr = d.toISOString().split('T')[0];
      
      // Previous Period Date
      const prevD = new Date(d);
      prevD.setDate(d.getDate() - offset);
      const prevDateStr = prevD.toISOString().split('T')[0];

      // Current Data
      const daySales = transactions.filter(t => t.date.startsWith(dateStr) && t.status !== 'Refunded');
      const revenue = daySales.reduce((acc, t) => acc + t.total, 0);
      const profit = daySales.reduce((acc, t) => {
        const cost = t.items.reduce((c, i) => c + (i.cost * i.quantity), 0);
        return acc + (t.total - cost);
      }, 0);

      // Previous Period Data
      const prevDaySales = transactions.filter(t => t.date.startsWith(prevDateStr) && t.status !== 'Refunded');
      const prevRevenue = prevDaySales.reduce((acc, t) => acc + t.total, 0);

      return {
        name: salesView === 'weekly' 
            ? d.toLocaleDateString('en-KE', { weekday: 'short' }) 
            : d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short' }),
        fullDate: d.toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long' }),
        prevFullDate: prevD.toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long' }),
        sales: revenue,
        profit: profit,
        prevSales: prevRevenue
      };
    });
  }, [transactions, salesView]);

  // --- 5. Pie Chart Data (Based on Selected View) ---
  const paymentMethodData = useMemo(() => {
    let cash = 0;
    let mpesa = 0;
    let debt = 0;

    // Use todayTransactions to reset daily
    todayTransactions.forEach(t => {
       if (t.paymentMethod === 'Cash') cash += t.total;
       else if (t.paymentMethod === 'M-Pesa') mpesa += t.total;
       else if (t.paymentMethod === 'Split' && t.splitDetails) {
           cash += t.splitDetails.cash;
           mpesa += t.splitDetails.mpesa;
       } else if (t.paymentMethod === 'Debt') {
           cash += t.amountPaid; // Assuming upfront is cash
           debt += (t.total - t.amountPaid);
       }
    });

    return [
       { name: 'Cash', value: cash },
       { name: 'M-Pesa', value: mpesa },
       { name: 'Credit', value: debt }
    ].filter(d => d.value > 0);
  }, [todayTransactions]);

  const categoryData = useMemo(() => {
     const stats: Record<string, number> = {};
     periodTransactions.forEach(t => {
        t.items.forEach(item => {
             // We need to look up category from products list since it's not in transaction item snapshot
             const product = products.find(p => p.id === item.productId);
             const category = product?.category || 'Uncategorized';
             stats[category] = (stats[category] || 0) + (item.price * item.quantity);
        });
     });

     return Object.entries(stats)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value);
  }, [periodTransactions, products]);

  // --- 6. Product Performance ---
   const { bestSellersData } = useMemo(() => {
    const productStats: Record<string, number> = {};

    transactions.forEach(t => {
        if (t.status === 'Refunded') return;
        t.items.forEach(item => {
            const total = item.price * item.quantity;
            if (!productStats[item.name]) productStats[item.name] = 0;
            productStats[item.name] += total;
        });
    });

    return { 
        bestSellersData: Object.entries(productStats).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 5),
    };
  }, [transactions]);

  const itemsSoldData = useMemo(() => {
    const stats: Record<string, { quantity: number, unit: string }> = {};
    const dayTxs = transactions.filter(t => t.date.startsWith(itemsSoldDate) && t.status !== 'Refunded');
    
    dayTxs.forEach(t => {
        t.items.forEach(item => {
            if (!stats[item.name]) {
                const product = products.find(p => p.id === item.productId);
                stats[item.name] = { quantity: 0, unit: product?.measurementUnit || 'pcs' };
            }
            stats[item.name].quantity += item.quantity;
        });
    });

    return Object.entries(stats)
        .map(([name, data]) => ({ name, quantity: data.quantity, unit: data.unit }))
        .sort((a, b) => b.quantity - a.quantity);
  }, [transactions, itemsSoldDate, products]);

  // --- 7. Hourly Performance Data Logic ---
  const hourlyPerformanceData = useMemo(() => {
    const relevantTransactions = transactions.filter(t => t.status !== 'Refunded');
    
    // Apply Day Filter
    let filteredTransactions = relevantTransactions;
    if (selectedDayFilter !== 'All') {
        filteredTransactions = relevantTransactions.filter(t => {
            const dayName = new Date(t.date).toLocaleDateString('en-KE', { weekday: 'long' });
            return dayName === selectedDayFilter;
        });
    }

    // Determine Denominator for Averages
    const uniqueDates = new Set(filteredTransactions.map(t => new Date(t.date).toISOString().split('T')[0]));
    const daysCount = Math.max(1, uniqueDates.size);

    // Initialize buckets
    const buckets = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      totalSales: 0,
      transactionCount: 0,
    }));

    // Aggregate
    filteredTransactions.forEach(t => {
        const hour = new Date(t.date).getHours();
        buckets[hour].totalSales += t.total;
        buckets[hour].transactionCount += 1;
    });

    // Format results
    return buckets.map(b => {
        // We show typical performance, so we average sums over number of days available in that subset
        const avgSales = Math.round(b.totalSales / daysCount);
        const avgTxns = Number((b.transactionCount / daysCount).toFixed(1));
        // ATV is Total Sales / Total Txns (global ratio for that hour)
        const atv = b.transactionCount > 0 ? Math.round(b.totalSales / b.transactionCount) : 0;

        return {
            name: `${b.hour}:00`,
            avgSales,
            avgTxns,
            atv
        };
    });
  }, [transactions, selectedDayFilter]);

  const topSpendersData = useMemo(() => {
    return [...customers]
      .sort((a, b) => {
        if (spendingMetric === 'spent') return (b.totalSpent || 0) - (a.totalSpent || 0);
        return (b.loyaltyPoints || 0) - (a.loyaltyPoints || 0);
      })
      .slice(0, 5)
      .map(c => ({
        name: c.name,
        value: spendingMetric === 'spent' ? (c.totalSpent || 0) : (c.loyaltyPoints || 0)
      }));
  }, [customers, spendingMetric]);

  const expensesTrendData = useMemo(() => {
    if (!shifts || shifts.length === 0) return [];
    
    // Group expenses by date
    const expensesByDate: Record<string, number> = {};
    
    shifts.forEach(shift => {
      const date = shift.date;
      if (!expensesByDate[date]) expensesByDate[date] = 0;
      
      const shiftExpenses = shift.expenses?.reduce((sum, exp) => sum + exp.amount, 0) || 0;
      expensesByDate[date] += shiftExpenses;
    });
    
    // Sort dates and take the last 7 or 14 days
    const sortedDates = Object.keys(expensesByDate).sort();
    const recentDates = sortedDates.slice(-14); // Last 14 days with shifts
    
    return recentDates.map(date => {
      const d = new Date(date);
      return {
        name: d.toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric' }),
        fullDate: date,
        amount: expensesByDate[date]
      };
    });
  }, [shifts]);

  const bestSellersByDayOfWeek = useMemo(() => {
    const dayIndices = [1, 2, 3, 4, 5, 6, 0]; // Mon, Tue, Wed, Thu, Fri, Sat, Sun
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    
    const stats: Record<number, Record<string, { quantity: number; revenue: number; name: string }>> = {
      0: {}, 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {}
    };

    transactions.forEach(t => {
      if (t.status === 'Refunded') return;
      const dateObj = new Date(t.date);
      const wDay = dateObj.getDay();
      
      t.items.forEach(item => {
        if (!stats[wDay][item.productId]) {
          stats[wDay][item.productId] = { quantity: 0, revenue: 0, name: item.name };
        }
        stats[wDay][item.productId].quantity += item.quantity;
        stats[wDay][item.productId].revenue += item.price * item.quantity;
      });
    });

    return dayIndices.map((idx, index) => {
      const dayData = stats[idx];
      const items = Object.values(dayData);
      items.sort((a, b) => b.quantity - a.quantity);
      
      const topProducts = items.slice(0, 5).map(item => ({
        name: item.name,
        quantity: item.quantity,
        revenue: item.revenue
      }));

      return {
        dayIndex: idx,
        dayName: dayNames[index],
        topProducts
      };
    });
  }, [transactions]);

  const revenuePrediction = useMemo(() => {
    // Filter active and non-refunded transactions
    const nonRefunded = transactions.filter(t => t.status !== 'Refunded');
    if (nonRefunded.length === 0) {
      return {
        predictedTotal: 0,
        chartData: [],
        confidence: 'Low' as const,
        baseline: 0,
        trendDirection: 'Stable' as const,
        hasData: false,
        slope: 0
      };
    }

    // Map to YYYY-MM-DD to accumulate actual daily sales
    const dailyVolume: Record<string, number> = {};
    nonRefunded.forEach(t => {
      const dateKey = t.date.split('T')[0];
      dailyVolume[dateKey] = (dailyVolume[dateKey] || 0) + t.total;
    });

    // Find first date of transaction up to today to generate dense list of days
    const dates = Object.keys(dailyVolume).sort();
    if (dates.length === 0) {
      return {
        predictedTotal: 0,
        chartData: [],
        confidence: 'Low' as const,
        baseline: 0,
        trendDirection: 'Stable' as const,
        hasData: false,
        slope: 0
      };
    }

    const firstDate = new Date(dates[0]);
    const todayDate = new Date();
    const msInDay = 24 * 60 * 60 * 1000;
    const daySpan = Math.max(1, Math.ceil((todayDate.getTime() - firstDate.getTime()) / msInDay));

    // Construct dense list of values (including zero-sales days)
    const denseDaily: { dateStr: string; val: number; dayOfWeek: number; tIndex: number }[] = [];
    for (let i = 0; i <= daySpan; i++) {
      const current = new Date(firstDate.getTime() + i * msInDay);
      const dateKey = current.toISOString().split('T')[0];
      denseDaily.push({
        dateStr: dateKey,
        val: dailyVolume[dateKey] || 0,
        dayOfWeek: current.getDay(),
        tIndex: i
      });
    }

    // Average daily sales (Baseline)
    const totalVolume = denseDaily.reduce((sum, d) => sum + d.val, 0);
    const baseline = totalVolume / denseDaily.length;

    // Weekday multipliers (0-6)
    const weekdaySum: Record<number, number> = { 0:0, 1:0, 2:0, 3:0, 4:0, 5:0, 6:0 };
    const weekdayCount: Record<number, number> = { 0:0, 1:0, 2:0, 3:0, 4:0, 5:0, 6:0 };
    denseDaily.forEach(d => {
      weekdaySum[d.dayOfWeek] += d.val;
      weekdayCount[d.dayOfWeek] += 1;
    });

    const weekdayFactors: Record<number, number> = {};
    for (let i = 0; i < 7; i++) {
      if (weekdayCount[i] > 0) {
        const avg = weekdaySum[i] / weekdayCount[i];
        // Seasonality index = weekday average / global average
        const multiplier = baseline > 0 ? avg / baseline : 1;
        // Clamp multiplier to prevent extreme isolated swings
        weekdayFactors[i] = Math.min(2.5, Math.max(0.3, multiplier));
      } else {
        weekdayFactors[i] = 1;
      }
    }

    // Calculate linear trends via simple least squares regression
    // y = mx + c
    let slope = 0;
    if (denseDaily.length >= 3) {
      const n = denseDaily.length;
      let sumX = 0;
      let sumY = 0;
      let sumXY = 0;
      let sumXX = 0;
      denseDaily.forEach(d => {
        sumX += d.tIndex;
        sumY += d.val;
        sumXY += d.tIndex * d.val;
        sumXX += d.tIndex * d.tIndex;
      });
      const numerator = (n * sumXY) - (sumX * sumY);
      const denominator = (n * sumXX) - (sumX * sumX);
      if (denominator !== 0) {
        slope = numerator / denominator;
      }
    }

    // Dampen slope to avoid projecting hyper-aggressive shifts
    const maxSlope = baseline * 0.1; // Limit growth rate projection to 10% average daily sales per day
    slope = Math.min(maxSlope, Math.max(-maxSlope, slope));

    // Predict the next 7 days (starting tomorrow)
    const predictions: { date: string; dayIndex: number; dayName: string; predictedVal: number }[] = [];
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    let predictedTotal = 0;
    for (let i = 1; i <= 7; i++) {
      const futureDate = new Date(todayDate.getTime() + i * msInDay);
      const futureDateStr = futureDate.toISOString().split('T')[0];
      const futureDayIdx = futureDate.getDay();
      
      // Calculate future trend point
      const xValue = denseDaily.length - 1 + i;
      const trendPoint = baseline + (slope * xValue);
      const seasonality = weekdayFactors[futureDayIdx];
      
      // Combine components
      let predictedVal = Math.max(0, trendPoint) * seasonality;
      predictedVal = isNaN(predictedVal) ? 0 : parseFloat(predictedVal.toFixed(2));
      
      predictions.push({
        date: futureDateStr,
        dayIndex: futureDayIdx,
        dayName: dayNames[futureDayIdx],
        predictedVal
      });
      predictedTotal += predictedVal;
    }

    // Historical past 7 days for comparison in chart
    const historicalPast7 = denseDaily.slice(-7).map(d => ({
      date: d.dateStr,
      dayName: dayNames[d.dayOfWeek].slice(0, 3),
      value: parseFloat(d.val.toFixed(2)),
      isPrediction: false
    }));

    // Combined chart data: historical in first 7 slots, predicted in next 7 slots
    const combinedChartData = [
      ...historicalPast7.map(h => ({
        name: h.dayName,
        actual: h.value,
        predicted: null,
        label: 'Historical'
      })),
      ...predictions.map(p => ({
        name: p.dayName.slice(0, 3) + '*',
        actual: null,
        predicted: p.predictedVal,
        label: 'Expected'
      }))
    ];

    let confidence: 'High' | 'Moderate' | 'Low' = 'Low';
    if (denseDaily.length >= 14) {
      confidence = 'High';
    } else if (denseDaily.length >= 5) {
      confidence = 'Moderate';
    }

    let trendDirection: 'Rising' | 'Declining' | 'Stable' = 'Stable';
    if (slope > baseline * 0.015) {
      trendDirection = 'Rising';
    } else if (slope < -baseline * 0.015) {
      trendDirection = 'Declining';
    }

    return {
      predictedTotal: Math.round(predictedTotal),
      chartData: combinedChartData,
      confidence,
      baseline: Math.round(baseline),
      trendDirection,
      hasData: true,
      slope: parseFloat(slope.toFixed(2))
    };
  }, [transactions]);

  const handleExportPDF = async () => {
    if (!dashboardRef.current) return;
    setIsExporting(true);
    try {
        await new Promise(resolve => setTimeout(resolve, 100));
        const canvas = await html2canvas(dashboardRef.current, { scale: 2, useCORS: true, backgroundColor: document.documentElement.classList.contains('dark') ? '#000000' : '#fdf2f8' });
        const imgData = canvas.toDataURL('image/png');
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
        pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
        pdf.save(`dashboard_${today}.pdf`);
    } catch (error) {
        console.error(error);
    } finally {
        setIsExporting(false);
    }
  };

  const fetchInsight = async () => {
    setLoadingInsight(true);
    try {
      const chat = createBusinessChat(transactions, products);
      if (chat) {
        setChatSession(chat);
        const response = await chat.sendMessage({ message: "Provide 3 brief, actionable insights or tips (bullet points) to improve profit, manage stock, or handle cash flow better. Keep it encouraging and professional." });
        setChatMessages([{ role: 'ai', text: response.text || "No insights available at the moment." }]);
        setInsight(response.text || "No insights available at the moment.");
      } else {
        setInsight("Please configure your API Key to receive AI insights.");
      }
    } catch (error) {
      console.error("Gemini Error:", error);
      setInsight("Unable to fetch insights. Please check your internet connection.");
    }
    setLoadingInsight(false);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !chatSession) return;

    const userMsg = chatInput;
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setIsSendingMessage(true);

    try {
      const response = await chatSession.sendMessage({ message: userMsg });
      setChatMessages(prev => [...prev, { role: 'ai', text: response.text || "I'm sorry, I couldn't generate a response." }]);
    } catch (error) {
      console.error("Chat Error:", error);
      setChatMessages(prev => [...prev, { role: 'ai', text: "Error communicating with AI." }]);
    }
    setIsSendingMessage(false);
  };

  // Custom Tooltips
  const SalesTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white dark:bg-gray-900 p-4 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-xl z-50">
          <div className="space-y-3">
            <div>
              <p className="font-bold text-gray-900 dark:text-white text-sm border-b border-gray-100 dark:border-gray-800 pb-1 mb-1">{payload[0].payload.fullDate}</p>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                <span className="text-gray-600 dark:text-gray-400 text-xs">This Period:</span>
                <span className="font-bold text-gray-900 dark:text-white ml-auto text-sm">{storeProfile.currency} {payload[0].value.toLocaleString()}</span>
              </div>
            </div>
            {payload[1] && (
              <div>
                <p className="font-bold text-gray-500 dark:text-gray-400 text-xs border-b border-gray-100 dark:border-gray-800 pb-1 mb-1">{payload[0].payload.prevFullDate}</p>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-300"></div>
                  <span className="text-gray-500 dark:text-gray-500 text-xs">Previous:</span>
                  <span className="font-bold text-gray-700 dark:text-gray-300 ml-auto text-sm">{storeProfile.currency} {payload[1].value.toLocaleString()}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  const HourlyTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-white dark:bg-gray-900 p-4 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-xl z-50">
                <p className="font-bold text-gray-900 dark:text-white mb-2 border-b border-gray-100 dark:border-gray-800 pb-2">{label}</p>
                <div className="space-y-1.5 text-sm">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                        <span className="text-gray-600 dark:text-gray-400">Total Sales:</span>
                        <span className="font-bold text-gray-900 dark:text-white ml-auto">{storeProfile.currency} {payload.find((p:any) => p.dataKey === 'avgSales')?.value.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                        <span className="text-gray-600 dark:text-gray-400">Transactions:</span>
                        <span className="font-bold text-gray-900 dark:text-white ml-auto">{payload.find((p:any) => p.dataKey === 'avgTxns')?.value}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                        <span className="text-gray-600 dark:text-gray-400">Avg. Value:</span>
                        <span className="font-bold text-gray-900 dark:text-white ml-auto">{storeProfile.currency} {payload.find((p:any) => p.dataKey === 'atv')?.value.toLocaleString()}</span>
                    </div>
                </div>
            </div>
        );
    }
    return null;
  };

  return (
    <div ref={dashboardRef} className="space-y-8 animate-fade-in pb-12">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
           <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 mb-1">
             <Calendar className="w-4 h-4" />
             <span className="text-sm font-medium">{new Date().toLocaleDateString('en-KE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
           </div>
           <h1 className="text-3xl font-black text-gray-900 dark:text-white tracking-tight">Dashboard</h1>
        </div>
        <div className="flex gap-2 no-export flex-wrap">
            <button onClick={() => setIsItemsSoldModalOpen(true)} className="bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-100 dark:border-gray-800 px-4 py-2 rounded-2xl font-bold text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-2 shadow-sm">
                <ShoppingBag className="w-4 h-4 text-blue-500" /> Items Sold
            </button>
            <button onClick={handleExportPDF} disabled={isExporting} className="bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-100 dark:border-gray-800 px-4 py-2 rounded-2xl font-bold text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-2 shadow-sm">
                {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />} Export
            </button>
            <button onClick={fetchInsight} disabled={loadingInsight} className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white px-4 py-2 rounded-2xl font-bold text-sm hover:shadow-lg transition-all flex items-center gap-2">
                {loadingInsight ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} AI Tips
            </button>
        </div>
      </div>

      {/* 1. ACTION PANEL (Insights & Critical Alerts) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 border border-indigo-100 dark:border-indigo-800 rounded-3xl p-6 relative overflow-hidden shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)] transition-all">
             <div className="absolute top-0 right-0 p-4 opacity-10"><Sparkles className="w-24 h-24 text-indigo-500" /></div>
             <h3 className="text-indigo-900 dark:text-indigo-200 font-bold flex items-center gap-2 mb-3">
                <Sparkles className="w-5 h-5" /> Today's Focus
             </h3>
             <div className="prose prose-sm dark:prose-invert text-gray-700 dark:text-gray-300 font-medium max-w-none">
                {insight ? (
                    <div className="flex flex-col h-full max-h-[400px]">
                        <div className="flex-1 overflow-y-auto pr-2 space-y-4 mb-4 custom-scrollbar">
                            {chatMessages.map((msg, idx) => (
                                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[85%] rounded-3xl px-4 py-3 ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-bl-none shadow-sm border border-gray-100 dark:border-gray-700'}`}>
                                        <div className="whitespace-pre-line text-sm">{msg.text}</div>
                                    </div>
                                </div>
                            ))}
                            {isSendingMessage && (
                                <div className="flex justify-start">
                                    <div className="bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-3xl rounded-bl-none px-4 py-3 shadow-sm border border-gray-100 dark:border-gray-700">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    </div>
                                </div>
                            )}
                        </div>
                        <form onSubmit={handleSendMessage} className="flex gap-2 mt-auto">
                            <input 
                                type="text" 
                                value={chatInput}
                                onChange={e => setChatInput(e.target.value)}
                                placeholder="Ask a follow-up question..."
                                className="flex-1 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                                disabled={isSendingMessage}
                            />
                            <button 
                                type="submit" 
                                disabled={isSendingMessage || !chatInput.trim()}
                                className="bg-indigo-600 text-white p-2 rounded-2xl hover:bg-indigo-700 transition-colors disabled:opacity-50"
                            >
                                <ArrowRight className="w-5 h-5" />
                            </button>
                        </form>
                    </div>
                ) : (
                    <p>
                        Welcome back! {hasCashVariance || hasMpesaVariance ? "There are cash discrepancies today." : "Everything looks balanced so far."}
                        <br/>
                        Check your <strong>low stock items</strong> and keep an eye on <strong>cash accountability</strong>.
                    </p>
                )}
             </div>
          </div>

          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/30 rounded-3xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)] transition-all">
             <h3 className="text-amber-900 dark:text-amber-200 font-bold flex items-center gap-2 mb-4">
                <AlertTriangle className="w-5 h-5" /> Needs Attention
             </h3>
             <ul className="space-y-3">
                {/* Variance Alerts */}
                {hasCashVariance && (
                     <li className="flex items-start gap-3 text-sm text-red-800 dark:text-red-200 cursor-pointer" onClick={() => onNavigate(AppView.FINANCE)}>
                        <div className="bg-red-200 dark:bg-red-800 p-1 rounded mt-0.5"><AlertOctagon className="w-3 h-3" /></div>
                        <div>
                             Cash is <strong>{cashVariance > 0 ? 'Over' : 'Short'}</strong> by {Math.abs(cashVariance).toLocaleString()}
                        </div>
                    </li>
                )}
                 {hasMpesaVariance && (
                     <li className="flex items-start gap-3 text-sm text-red-800 dark:text-red-200 cursor-pointer" onClick={() => onNavigate(AppView.FINANCE)}>
                        <div className="bg-red-200 dark:bg-red-800 p-1 rounded mt-0.5"><AlertOctagon className="w-3 h-3" /></div>
                        <div>
                             M-Pesa is <strong>{mpesaVariance > 0 ? 'Over' : 'Short'}</strong> by {Math.abs(mpesaVariance).toLocaleString()}
                        </div>
                    </li>
                )}

                {/* Stock Alerts */}
                {lowStockItems.length > 0 && (
                    <li className="flex items-start gap-3 text-sm text-amber-800 dark:text-amber-100 cursor-pointer hover:underline" onClick={() => setViewDetails({ title: 'Low Stock Risks', items: lowStockItems })}>
                        <div className="bg-amber-200 dark:bg-amber-800 p-1 rounded mt-0.5"><AlertCircle className="w-3 h-3" /></div>
                        <div><span className="font-black">{lowStockItems.length} items</span> are running low on stock.</div>
                    </li>
                )}
                
                {/* Expiry Alerts */}
                {expiringSoonItems.length > 0 && (
                    <li className="flex items-start gap-3 text-sm text-orange-800 dark:text-orange-200 cursor-pointer hover:underline" onClick={() => setViewDetails({ title: 'Expiring Items (<2 Days)', items: expiringSoonItems })}>
                         <div className="bg-orange-200 dark:bg-orange-800 p-1 rounded mt-0.5"><AlertTriangle className="w-3 h-3" /></div>
                         <div><span className="font-black">{expiringSoonItems.length} items</span> are expiring soon.</div>
                    </li>
                )}

                {outOfStockItems.length > 0 && (
                    <li className="flex items-start gap-3 text-sm text-red-800 dark:text-red-200 cursor-pointer hover:underline" onClick={() => setViewDetails({ title: 'Out of Stock Items', items: outOfStockItems })}>
                        <div className="bg-red-200 dark:bg-red-800 p-1 rounded mt-0.5"><X className="w-3 h-3" /></div>
                        <div><span className="font-black">{outOfStockItems.length} items</span> are completely out of stock.</div>
                    </li>
                )}
                {!currentShift && (
                    <li className="flex items-start gap-3 text-sm text-gray-700 dark:text-gray-300">
                         <div className="bg-gray-200 dark:bg-gray-700 p-1 rounded mt-0.5"><Wallet className="w-3 h-3" /></div>
                         <div>Shift is currently closed.</div>
                    </li>
                )}
                
                {/* Empty State */}
                {lowStockItems.length === 0 && outOfStockItems.length === 0 && expiringSoonItems.length === 0 && !hasCashVariance && !hasMpesaVariance && (
                     <li className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                        <Check className="w-4 h-4" /> Operations looking good!
                     </li>
                )}
             </ul>
          </div>
      </div>

      {/* 2. FINANCIAL TRUTHS (Cards) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
         {/* Sales & Profit Card - Combined for maximum utility */}
         <div className={`rounded-3xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)] border flex flex-col justify-between relative overflow-hidden transition-all ${
             isAllTimeHigh 
                ? 'bg-gradient-to-br from-yellow-400 via-yellow-500 to-yellow-600 border-yellow-300 dark:border-yellow-500 shadow-yellow-500/30' 
                : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-800'
         }`}>
            {/* Background decoration for target met */}
            {isAllTimeHigh && <div className="absolute top-0 right-0 w-32 h-32 bg-white/20 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none"></div>}
            {!isAllTimeHigh && isTargetMet && <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none"></div>}
            
            <div>
                <div className="flex justify-between items-start mb-4">
                    <div>
                        <div className="flex items-center gap-2">
                            <p className={`text-xs font-bold uppercase tracking-wider ${isAllTimeHigh ? 'text-yellow-900/80' : 'text-gray-500 dark:text-gray-400'}`}>Today's Sales</p>
                            {isAllTimeHigh && <span className="bg-yellow-100 text-yellow-800 text-[9px] font-bold px-1.5 py-0.5 rounded-sm uppercase tracking-widest">All-Time High</span>}
                        </div>
                        <h2 className={`text-3xl font-black mt-1 ${isAllTimeHigh ? 'text-white drop-shadow-md' : 'text-gray-900 dark:text-white'}`}>{storeProfile.currency} {todaySales.toLocaleString()}</h2>
                        
                        {/* Percentage Change Indicator */}
                        <div className={`flex items-center gap-1 mt-2 text-xs font-bold ${isAllTimeHigh ? 'text-yellow-100' : (salesGrowth >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}`}>
                            {salesGrowth >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                            <span>{Math.abs(salesGrowth).toFixed(1)}%</span>
                            <span className={`font-normal ${isAllTimeHigh ? 'text-yellow-800/60' : 'text-gray-400'}`}>vs. last {lastWeekDayName} same time</span>
                        </div>
                    </div>
                    <div className={`p-3 rounded-2xl relative ${isAllTimeHigh ? 'bg-white/20 text-white' : (isTargetMet ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400')}`}>
                        {isAllTimeHigh && <Sparkles className="w-4 h-4 absolute -top-1 -right-1 text-yellow-200 animate-pulse" />}
                        {isTargetMet ? <Target className="w-6 h-6" /> : <ShoppingBag className="w-6 h-6" />}
                    </div>
                </div>

                {/* Target Progress */}
                {salesTarget > 0 && (
                    <div className="mb-4 relative">
                        <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider mb-1.5">
                            <span className="text-gray-400">Daily Target</span>
                            <span className={isTargetMet ? "text-emerald-600 dark:text-emerald-400" : "text-gray-600 dark:text-gray-300"}>
                               {Math.round(progressPercent)}% of {storeProfile.currency} {salesTarget.toLocaleString()}
                            </span>
                        </div>
                        <div className="h-2.5 w-full bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden relative">
                            <div 
                                className={`h-full rounded-full transition-all duration-1000 ease-out relative ${isTargetMet ? 'bg-gradient-to-r from-emerald-500 to-green-400' : 'bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500'}`}
                                style={{ width: `${progressPercent}%` }}
                            >
                                <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
                            </div>
                        </div>
                        {isTargetMet && (
                            <div className="absolute -top-2 -right-2 bg-yellow-400 text-yellow-900 text-[8px] font-black px-2 py-0.5 rounded-full shadow-md transform rotate-12 flex items-center gap-1 z-10 border border-yellow-300">
                                <Sparkles className="w-2 h-2" /> TARGET MET!
                            </div>
                        )}
                        {lastWeekTargetTime && (
                            <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1.5 font-medium flex items-center justify-end gap-1">
                                <Calendar className="w-3 h-3 opacity-70" /> 
                                Last week reached at <span className="font-bold text-gray-700 dark:text-gray-300">{lastWeekTargetTime}</span>
                            </p>
                        )}
                    </div>
                )}
            </div>

            <div className="border-t border-gray-100 dark:border-gray-700 pt-3 mt-1 flex justify-between items-center">
                 <div>
                    <p className="text-xs text-gray-500">Net Profit</p>
                    <p className="font-bold text-emerald-600 dark:text-emerald-400">{storeProfile.currency} {todayProfit.toLocaleString()}</p>
                 </div>
                 <span className="bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-md text-xs font-bold">{todayMargin}% Margin</span>
            </div>
         </div>

         {/* Cash Accountability */}
         <div className={`rounded-3xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)] border relative overflow-hidden ${hasCashVariance ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800' : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-800'}`}>
            <div className="absolute top-0 right-0 w-20 h-20 bg-gray-50 dark:bg-gray-700 rounded-bl-full -mr-4 -mt-4 z-0 opacity-50"></div>
            <div className="relative z-10">
                <div className="flex justify-between items-start mb-4">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Cash In Drawer</p>
                        <h2 className="text-3xl font-black text-gray-900 dark:text-white mt-1">{storeProfile.currency} {expectedCash.toLocaleString()}</h2>
                    </div>
                    <div className="p-3 bg-gray-100 dark:bg-gray-700 rounded-2xl text-gray-600 dark:text-gray-300">
                        <Banknote className="w-6 h-6" />
                    </div>
                </div>
                <div className="flex flex-col gap-1 text-sm border-t border-gray-100 dark:border-gray-700 pt-3 mt-1">
                    <div className="flex justify-between text-gray-500 dark:text-gray-400">
                        <span>Collected:</span>
                        <span className="font-bold text-gray-900 dark:text-white">+{cashCollected.toLocaleString()}</span>
                    </div>
                    {actualCash !== undefined && (
                        <div className="flex justify-between items-center pt-1 mt-1 border-t border-dashed border-gray-100 dark:border-gray-800">
                            <span className="text-xs font-bold uppercase">Variance:</span>
                            <span className={`font-black ${cashVariance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {cashVariance > 0 ? '+' : ''}{cashVariance.toLocaleString()}
                            </span>
                        </div>
                    )}
                </div>
            </div>
         </div>

          {/* M-Pesa Till */}
         <div className={`rounded-3xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)] border relative overflow-hidden transition-all ${hasMpesaVariance ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800' : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-800'}`}>
            <div className="flex justify-between items-start mb-4">
                <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">M-Pesa Till</p>
                    <h2 className="text-3xl font-black text-green-600 dark:text-green-400 mt-1">{storeProfile.currency} {expectedMpesa.toLocaleString()}</h2>
                </div>
                <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-2xl text-green-600 dark:text-green-400">
                    <CreditCard className="w-6 h-6" />
                </div>
            </div>
            <div className="flex flex-col gap-1 text-sm border-t border-gray-100 dark:border-gray-700 pt-3 mt-1">
                 <div className="flex justify-between text-gray-500 dark:text-gray-400">
                    <span>Collected:</span>
                    <span className="font-bold text-gray-900 dark:text-white">+{mpesaCollected.toLocaleString()}</span>
                </div>
                {actualMpesa !== undefined && (
                    <div className="flex justify-between items-center pt-1 mt-1 border-t border-dashed border-gray-100 dark:border-gray-800">
                        <span className="text-xs font-bold uppercase">Variance:</span>
                        <span className={`font-black ${mpesaVariance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {mpesaVariance > 0 ? '+' : ''}{mpesaVariance.toLocaleString()}
                        </span>
                    </div>
                )}
            </div>
         </div>
      </div>

      {/* 3. STRATEGIC GROWTH HUB */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
             {/* Missed Sales & Reinvestment Sprint (2/3 width) */}
             <div className="bg-white dark:bg-gray-800 p-6 rounded-3xl shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)] transition-all border border-gray-100 dark:border-gray-800 flex flex-col h-full lg:col-span-2">
                 <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2 mb-6 uppercase text-sm tracking-widest">
                    <Target className="w-5 h-5 text-purple-500" /> Reinvestment Sprint Intelligence
                 </h3>
                 <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <div>
                        <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4">Opportunity Cost</h4>
                        <div className="bg-purple-50 dark:bg-purple-900/10 border border-purple-100 dark:border-purple-900/30 rounded-2xl p-4 flex items-center justify-between">
                            <div>
                                <p className="text-2xl font-black text-purple-600 dark:text-purple-400 tracking-tight">
                                    {storeProfile.currency} {missedSales.reduce((acc, sale) => acc + sale.lostProfit, 0).toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}
                                </p>
                                <p className="text-[9px] text-purple-500 dark:text-purple-500 mt-1 uppercase font-bold tracking-tighter">Lost Profit</p>
                            </div>
                            <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/50 rounded-full flex items-center justify-center">
                                <TrendingDown className="w-5 h-5 text-purple-500" />
                            </div>
                        </div>
                        
                        <div className="mt-6">
                            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Goal Progress</h4>
                            <div className="bg-gray-100 dark:bg-gray-700 h-2 rounded-full overflow-hidden mb-2">
                                <div 
                                    className="h-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                                    style={{ width: `${Math.min(100, ((storeProfile.currentPersonalSavings || 0) / (storeProfile.personalSavingsGoal || 1)) * 100)}%` }}
                                ></div>
                            </div>
                            <div className="flex justify-between text-[10px] font-bold">
                                <span className="text-gray-500">{(storeProfile.currentPersonalSavings || 0).toLocaleString()} saved</span>
                                <span className="text-emerald-600">Goal: {(storeProfile.personalSavingsGoal || 0).toLocaleString()}</span>
                            </div>
                            <p className="text-[9px] text-gray-500 mt-3 font-medium bg-gray-50 dark:bg-gray-900/50 p-2 rounded-xl border border-gray-100 dark:border-gray-800 leading-tight">
                                <span className="text-purple-600 font-bold uppercase tracking-tighter">Tip:</span> Capturing your lost profit would close the gap by <span className="text-purple-700 font-black">{(((missedSales.reduce((acc, sale) => acc + sale.lostProfit, 0)) / (storeProfile.personalSavingsGoal || 1)) * 100).toFixed(1)}%</span>!
                            </p>
                        </div>
                    </div>
                    
                    <div>
                        <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-amber-500" /> Stock Intelligence
                        </h4>
                        <div className="space-y-3">
                            {missedSalesIntelligence.length > 0 ? (
                                missedSalesIntelligence.slice(0, 2).map((item, idx) => (
                                    <div key={idx} className="p-3 bg-amber-50/50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/30 rounded-2xl relative overflow-hidden group">
                                        <div className="absolute top-0 right-0 p-1">
                                            <div className="bg-amber-500 text-[7px] text-white px-1.5 py-0.5 rounded-bl-lg font-black uppercase tracking-tighter">High Priority</div>
                                        </div>
                                        <p className="font-bold text-xs text-amber-900 dark:text-amber-100 truncate">{item.name}</p>
                                        <p className="text-[9px] text-amber-700 dark:text-amber-400 font-medium mb-1">Missed {item.dates.size} days</p>
                                        <div className="text-[8px] font-black uppercase px-2 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 inline-block">
                                            {item.strategy}
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="text-center py-6 border-2 border-dashed border-gray-100 dark:border-gray-800 rounded-2xl">
                                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-tight">Data logging<br/>in progress...</p>
                                </div>
                            )}
                            <div className="p-3 bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 rounded-2xl text-[9px] text-blue-700 dark:text-blue-400 leading-tight">
                                <strong className="block mb-1 text-blue-900 dark:text-blue-200 uppercase tracking-widest">The 3-Day Rule</strong>
                                Bulk re-invest only after 3 missed days. Stock small volumes for daily items first.
                            </div>
                        </div>
                    </div>

                    <div className="bg-gray-50 dark:bg-gray-900/50 rounded-2xl border border-gray-100 dark:border-gray-800 p-4">
                        <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4">Recent Missed</h4>
                        <div className="space-y-2 overflow-y-auto max-h-[160px] custom-scrollbar pr-1">
                            {missedSales.length > 0 ? (
                                missedSales.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 5).map(sale => (
                                    <div key={sale.id} className="bg-white dark:bg-gray-800 p-2 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm flex items-center justify-between group h-10">
                                        <p className="font-bold text-[10px] text-gray-800 dark:text-gray-200 truncate pr-2 flex-1">{sale.itemName}</p>
                                        <div className="text-right shrink-0">
                                            <p className="text-[9px] font-black text-red-500">-{sale.lostProfit.toFixed(0)}</p>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="text-center py-8 text-gray-300">
                                    <Search className="w-5 h-5 mx-auto mb-1 opacity-20" />
                                    <p className="text-[9px] uppercase font-bold tracking-widest">Empty</p>
                                </div>
                            )}
                        </div>
                    </div>
                 </div>
             </div>

             {/* Stock Health Snapshot (1/3 width) */}
             <div className="bg-white dark:bg-gray-800 p-6 rounded-3xl shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)] transition-all border border-gray-100 dark:border-gray-800 flex flex-col h-full">
                <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2 mb-6 uppercase text-sm tracking-widest">
                    <Package className="w-5 h-5 text-indigo-500" /> Stock Health
                </h3>
                
                <div className="space-y-4">
                    <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900/50 rounded-2xl border border-gray-100 dark:border-gray-800">
                        <div>
                            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Total Value</p>
                            <p className="text-xl font-black text-gray-900 dark:text-white">{storeProfile.currency} {totalStockValue.toLocaleString()}</p>
                        </div>
                        <div className="w-10 h-10 bg-indigo-50 dark:bg-indigo-900/20 rounded-full flex items-center justify-center text-indigo-600">
                            <DollarSign className="w-5 h-5" />
                        </div>
                    </div>

                    <div 
                        className="flex items-center justify-between p-3 bg-amber-50 dark:bg-amber-900/10 rounded-2xl border border-amber-100 dark:border-amber-900/30 cursor-pointer hover:bg-amber-100 transition-all shadow-sm"
                        onClick={() => setViewDetails({ title: 'Low Stock Risks', items: lowStockItems })}
                    >
                        <div>
                            <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest">Low Stock</p>
                            <p className="text-xl font-black text-amber-900 dark:text-amber-100">{lowStockItems.length} Items</p>
                        </div>
                        <div className="w-10 h-10 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center text-amber-600">
                            <AlertCircle className="w-5 h-5" />
                        </div>
                    </div>

                    <div 
                        className="flex items-center justify-between p-3 bg-orange-50 dark:bg-orange-900/10 rounded-2xl border border-orange-100 dark:border-orange-900/30 cursor-pointer hover:bg-orange-100 transition-all shadow-sm"
                        onClick={() => setViewDetails({ title: 'Expiring Items', items: expiringSoonItems })}
                    >
                        <div>
                            <p className="text-[9px] font-black text-orange-600 uppercase tracking-widest">Expiring Soon</p>
                            <p className="text-xl font-black text-orange-900 dark:text-orange-100">{expiringSoonItems.length} Items</p>
                        </div>
                        <div className="w-10 h-10 bg-orange-100 dark:bg-orange-900/30 rounded-full flex items-center justify-center text-orange-600">
                            <AlertTriangle className="w-5 h-5" />
                        </div>
                    </div>

                    <div 
                        className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900/50 rounded-2xl border border-gray-100 dark:border-gray-800 cursor-pointer hover:bg-gray-100 transition-all opacity-80"
                        onClick={() => setViewDetails({ title: 'Slow Moving Items', items: slowMovingItems })}
                    >
                        <div>
                            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Slow Moving</p>
                            <p className="text-lg font-black text-gray-700 dark:text-gray-300 truncate max-w-[120px]">{storeProfile.currency} {slowMovingValue.toLocaleString()}</p>
                        </div>
                        <div className="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center text-gray-400">
                            <TrendingDown className="w-5 h-5" />
                        </div>
                    </div>
                </div>
             </div>
      </div>

      {/* 4. FINANCIAL TRENDS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
             {/* Sales Chart */}
             <div className="bg-white dark:bg-gray-800 p-6 rounded-3xl shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)] transition-all border border-gray-100 dark:border-gray-800">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-blue-500" /> Sales Trend
                    </h3>
                    <div className="flex bg-gray-100 dark:bg-gray-700 rounded-xl p-1">
                        <button onClick={() => setSalesView('weekly')} className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${salesView === 'weekly' ? 'bg-white dark:bg-gray-600 shadow-sm text-black dark:text-white' : 'text-gray-500'}`}>Week</button>
                        <button onClick={() => setSalesView('monthly')} className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${salesView === 'monthly' ? 'bg-white dark:bg-gray-600 shadow-sm text-black dark:text-white' : 'text-gray-500'}`}>Month</button>
                        <button onClick={() => setSalesView('yearly')} className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${salesView === 'yearly' ? 'bg-white dark:bg-gray-600 shadow-sm text-black dark:text-white' : 'text-gray-500'}`}>Year</button>
                    </div>
                </div>
                <div className="h-64 w-full">
                     <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData}>
                            <defs>
                            <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4}/>
                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                            </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.1} vertical={false} />
                            <XAxis dataKey="name" stroke="#9ca3af" fontSize={10} tickLine={false} axisLine={false} dy={10} interval={salesView === 'monthly' ? 2 : 0} />
                            <YAxis stroke="#9ca3af" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}`} />
                            <Tooltip content={<SalesTooltip />} />
                            <Area type="monotone" dataKey="sales" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorSales)" name="Sales" />
                            <Line type="monotone" dataKey="prevSales" stroke="#94a3b8" strokeWidth={3} strokeDasharray="5 5" dot={false} name="Previous Sales" />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
             </div>

             {/* Profit Chart */}
             <div className="bg-white dark:bg-gray-800 p-6 rounded-3xl shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)] transition-all border border-gray-100 dark:border-gray-800">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <DollarSign className="w-5 h-5 text-emerald-500" /> Profit Trend
                    </h3>
                    <div className="flex bg-gray-100 dark:bg-gray-700 rounded-xl p-1">
                        <button onClick={() => setSalesView('weekly')} className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${salesView === 'weekly' ? 'bg-white dark:bg-gray-600 shadow-sm text-black dark:text-white' : 'text-gray-500'}`}>Week</button>
                        <button onClick={() => setSalesView('monthly')} className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${salesView === 'monthly' ? 'bg-white dark:bg-gray-600 shadow-sm text-black dark:text-white' : 'text-gray-500'}`}>Month</button>
                        <button onClick={() => setSalesView('yearly')} className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${salesView === 'yearly' ? 'bg-white dark:bg-gray-600 shadow-sm text-black dark:text-white' : 'text-gray-500'}`}>Year</button>
                    </div>
                </div>
                <div className="h-64 w-full">
                     <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData}>
                            <defs>
                            <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.4}/>
                                <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                            </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.1} vertical={false} />
                            <XAxis dataKey="name" stroke="#9ca3af" fontSize={10} tickLine={false} axisLine={false} dy={10} interval={salesView === 'monthly' ? 2 : 0} />
                            <YAxis stroke="#9ca3af" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}`} />
                            <Tooltip contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', color: '#fff', borderRadius: '12px' }} itemStyle={{ color: '#fff' }} />
                            <Area type="monotone" dataKey="profit" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorProfit)" name="Profit" />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
             </div>
      </div>

      {/* 5. OPERATIONAL TRENDS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
             {/* Inventory Value Trend Chart */}
             <div className="bg-white dark:bg-gray-800 p-6 rounded-3xl shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)] transition-all border border-gray-100 dark:border-gray-800">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <Package className="w-5 h-5 text-purple-500" /> Inventory Value Trend
                    </h3>
                    <div className="flex bg-gray-100 dark:bg-gray-700 rounded-xl p-1">
                        <button onClick={() => setInventoryTrendView('weekly')} className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${inventoryTrendView === 'weekly' ? 'bg-white dark:bg-gray-600 shadow-sm text-black dark:text-white' : 'text-gray-500'}`}>Week</button>
                        <button onClick={() => setInventoryTrendView('monthly')} className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${inventoryTrendView === 'monthly' ? 'bg-white dark:bg-gray-600 shadow-sm text-black dark:text-white' : 'text-gray-500'}`}>Month</button>
                        <button onClick={() => setInventoryTrendView('yearly')} className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${inventoryTrendView === 'yearly' ? 'bg-white dark:bg-gray-600 shadow-sm text-black dark:text-white' : 'text-gray-500'}`}>Year</button>
                    </div>
                </div>
                <div className="h-64 w-full">
                     <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={inventoryTrendData}>
                            <defs>
                            <linearGradient id="colorInventory" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4}/>
                                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                            </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.1} vertical={false} />
                            <XAxis dataKey="name" stroke="#9ca3af" fontSize={10} tickLine={false} axisLine={false} dy={10} />
                            <YAxis stroke="#9ca3af" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${(value/1000).toFixed(0)}k`} />
                            <Tooltip 
                                contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', color: '#fff', borderRadius: '12px' }} 
                                itemStyle={{ color: '#fff' }}
                                formatter={(value: number) => [`${storeProfile.currency} ${value.toLocaleString()}`, 'Value']}
                            />
                            <Area type="monotone" dataKey="value" stroke="#8b5cf6" strokeWidth={3} fillOpacity={1} fill="url(#colorInventory)" name="Value" />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
             </div>

             {/* Expenses Trend Chart */}
             <div className="bg-white dark:bg-gray-800 p-6 rounded-3xl shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)] transition-all border border-gray-100 dark:border-gray-800">
                 <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2 mb-6">
                    <TrendingDown className="w-5 h-5 text-red-500" /> Expenses Trend
                 </h3>
                 <div className="h-64 w-full">
                     {expensesTrendData.length > 0 ? (
                         <ResponsiveContainer width="100%" height="100%">
                             <AreaChart data={expensesTrendData}>
                                 <defs>
                                     <linearGradient id="colorExpense" x1="0" y1="0" x2="0" y2="1">
                                         <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4}/>
                                         <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                                     </linearGradient>
                                 </defs>
                                 <CartesianGrid strokeDasharray="3 3" opacity={0.1} vertical={false} />
                                 <XAxis dataKey="name" stroke="#9ca3af" fontSize={10} tickLine={false} axisLine={false} dy={10} />
                                 <YAxis stroke="#9ca3af" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(val) => `${(val/1000).toFixed(0)}k`} />
                                 <Tooltip contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', color: '#fff', borderRadius: '12px' }} itemStyle={{ color: '#fff' }} formatter={(value: number) => [`${storeProfile.currency} ${value.toLocaleString()}`, 'Expenses']} />
                                 <Area type="monotone" dataKey="amount" stroke="#ef4444" strokeWidth={3} fillOpacity={1} fill="url(#colorExpense)" name="Expenses" />
                             </AreaChart>
                         </ResponsiveContainer>
                     ) : (
                         <div className="h-full flex flex-col items-center justify-center text-gray-400 text-sm">
                             <Banknote className="w-8 h-8 mb-2 opacity-20" />
                             No expense data available
                         </div>
                     )}
                 </div>
             </div>
      </div>

      {/* 6. DETAILED ANALYSIS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
             {/* Hourly Activity Pattern */}
             <div className="lg:col-span-2 bg-white dark:bg-gray-800 p-6 rounded-3xl shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)] transition-all border border-gray-100 dark:border-gray-800">
                 <div className="flex flex-col sm:flex-row justify-between items-center mb-6 gap-4">
                     <div>
                         <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                             <Activity className="w-5 h-5 text-orange-500" /> Hourly Activity Pattern
                         </h3>
                         <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Average performance by hour of day</p>
                     </div>
                     <div className="relative min-w-[160px]">
                         <select
                             value={selectedDayFilter}
                             onChange={(e) => setSelectedDayFilter(e.target.value)}
                             className="w-full appearance-none pl-4 pr-10 py-2.5 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-2xl text-sm font-bold text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500 cursor-pointer shadow-sm"
                         >
                             <option value="All">All Days (Avg.)</option>
                             {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => (
                                 <option key={day} value={day}>{day}</option>
                             ))}
                         </select>
                         <Filter className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
                     </div>
                 </div>
                 <div className="h-[400px] w-full">
                     <ResponsiveContainer width="100%" height="100%">
                         <ComposedChart data={hourlyPerformanceData} margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                             <defs>
                                 <linearGradient id="colorHourlySales" x1="0" y1="0" x2="0" y2="1">
                                     <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                                     <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.2}/>
                                 </linearGradient>
                             </defs>
                             <CartesianGrid strokeDasharray="3 3" opacity={0.1} vertical={false} />
                             <XAxis 
                               dataKey="name" 
                               stroke="#9ca3af" 
                               fontSize={10} 
                               tickLine={false} 
                               axisLine={false} 
                               dy={10} 
                             />
                             {/* Left Axis: Sales */}
                             <YAxis 
                               yAxisId="left" 
                               stroke="#3b82f6" 
                               fontSize={10} 
                               tickLine={false} 
                               axisLine={false}
                               tickFormatter={(val) => `${(val/1000).toFixed(0)}k`} 
                             />
                             {/* Right Axis: Transactions (Count) */}
                             <YAxis 
                               yAxisId="right" 
                               orientation="right" 
                               stroke="#f59e0b" 
                               fontSize={10} 
                               tickLine={false} 
                               axisLine={false}
                             />
                             
                             <Tooltip content={<HourlyTooltip />} />
                             <Legend iconType="circle" />
                             
                             <Bar yAxisId="left" dataKey="avgSales" name="Avg Sales (KES)" fill="url(#colorHourlySales)" radius={[4, 4, 0, 0]} barSize={20} />
                             <Line yAxisId="right" type="monotone" dataKey="avgTxns" name="Avg Transactions" stroke="#f59e0b" strokeWidth={3} dot={{r: 3, fill:'#f59e0b'}} activeDot={{ r: 6 }} />
                             <Line yAxisId="left" type="monotone" dataKey="atv" name="Avg Txn Value (KES)" stroke="#10b981" strokeWidth={3} strokeDasharray="5 5" dot={false} />
                         </ComposedChart>
                     </ResponsiveContainer>
                 </div>
             </div>

             {/* Payment Methods Pie */}
             <div className="bg-white dark:bg-gray-800 p-6 rounded-3xl shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)] transition-all border border-gray-100 dark:border-gray-800">
                 <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2 mb-6">
                    <Wallet className="w-5 h-5 text-purple-500" /> Revenue Source (Today)
                 </h3>
                 <div className="h-[400px] w-full flex items-center justify-center">
                     {paymentMethodData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={paymentMethodData}
                                    cx="50%"
                                    cy="45%"
                                    innerRadius={60}
                                    outerRadius={80}
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {paymentMethodData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', color: '#fff', borderRadius: '12px' }} itemStyle={{ color: '#fff' }} />
                                <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ paddingTop: '20px' }} />
                            </PieChart>
                        </ResponsiveContainer>
                     ) : (
                        <div className="text-gray-400 text-sm">No payment data for today</div>
                     )}
                 </div>
             </div>
      </div>

      {/* 7. PERFORMANCE & CATEGORIES */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
             {/* Performers & Spenders */}
             <div className="bg-white dark:bg-gray-800 p-6 rounded-3xl shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)] transition-all border border-gray-100 dark:border-gray-800 flex flex-col h-full lg:col-span-1">
                 <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2 mb-6 uppercase text-sm tracking-widest">
                    <PieChartIcon className="w-5 h-5 text-indigo-500" /> Top Performers
                </h3>
                
                {/* Added Pie Chart Section */}
                {bestSellersData.length > 0 && (
                    <div className="h-48 w-full mb-4 shrink-0">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={bestSellersData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={40}
                                    outerRadius={70}
                                    paddingAngle={4}
                                    dataKey="value"
                                    cornerRadius={4}
                                >
                                    {bestSellersData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip 
                                    formatter={(value: number) => [`${storeProfile.currency} ${value.toLocaleString()}`, 'Sales']}
                                    contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', color: '#fff', borderRadius: '12px' }} 
                                    itemStyle={{ color: '#fff' }} 
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                )}

                <div className="space-y-4 flex-1 overflow-y-auto pr-1">
                    {bestSellersData.length > 0 ? bestSellersData.map((item, index) => (
                        <div key={index} className="flex items-center justify-between group hover:bg-gray-50 dark:hover:bg-gray-700/50 p-2 rounded-xl transition-colors">
                            <div className="flex items-center gap-3">
                                <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-sm shrink-0" style={{ backgroundColor: COLORS[index % COLORS.length] }}>
                                    {index + 1}
                                </div>
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate max-w-[120px] group-hover:text-gray-900 dark:group-hover:text-white transition-colors">{item.name}</span>
                            </div>
                            <span className="text-sm font-bold text-gray-900 dark:text-white">{storeProfile.currency} {item.value.toLocaleString()}</span>
                        </div>
                    )) : (
                         <div className="text-center text-gray-400 py-8 text-sm flex flex-col items-center">
                            <PieChartIcon className="w-8 h-8 mb-2 opacity-20" />
                            No sales data available yet
                         </div>
                    )}
                </div>
                <button className="w-full mt-6 py-2.5 text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 rounded-2xl hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors" onClick={() => onNavigate(AppView.INVENTORY)}>
                    View Full Inventory
                </button>
             </div>

             {/* Top Spenders Chart */}
             <div className="bg-white dark:bg-gray-800 p-6 rounded-3xl shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)] transition-all border border-gray-100 dark:border-gray-800 flex flex-col h-full lg:col-span-1">
                 <div className="flex justify-between items-center mb-6">
                    <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2 uppercase text-sm tracking-widest">
                        <Target className="w-5 h-5 text-emerald-500" /> Top Spenders
                    </h3>
                    <div className="flex bg-gray-100 dark:bg-gray-700 rounded-xl p-1">
                        <button onClick={() => setSpendingMetric('spent')} className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${spendingMetric === 'spent' ? 'bg-white dark:bg-gray-600 shadow-sm text-black dark:text-white' : 'text-gray-500'}`}>Spent</button>
                        <button onClick={() => setSpendingMetric('points')} className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${spendingMetric === 'points' ? 'bg-white dark:bg-gray-600 shadow-sm text-black dark:text-white' : 'text-gray-500'}`}>Points</button>
                    </div>
                 </div>

                 {topSpendersData.length > 0 ? (
                    <>
                        <div className="h-48 w-full mb-4 shrink-0">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={topSpendersData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={40}
                                        outerRadius={70}
                                        paddingAngle={4}
                                        dataKey="value"
                                        cornerRadius={4}
                                    >
                                        {topSpendersData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip 
                                        formatter={(value: number) => [spendingMetric === 'spent' ? `${storeProfile.currency} ${value.toLocaleString()}` : `${value.toLocaleString()} pts`, spendingMetric === 'spent' ? 'Total Spent' : 'Loyalty Points']}
                                        contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', color: '#fff', borderRadius: '12px' }} 
                                        itemStyle={{ color: '#fff' }} 
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                        <div className="space-y-3 flex-1 overflow-y-auto pr-1">
                            {topSpendersData.map((item, index) => (
                                <div key={index} className="flex items-center justify-between group hover:bg-gray-50 dark:hover:bg-gray-700/50 p-2 rounded-xl transition-colors">
                                    <div className="flex items-center gap-3">
                                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-sm shrink-0" style={{ backgroundColor: COLORS[index % COLORS.length] }}>
                                            {index + 1}
                                        </div>
                                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate max-w-[120px] group-hover:text-gray-900 dark:group-hover:text-white transition-colors">{item.name}</span>
                                    </div>
                                    <span className="text-sm font-bold text-gray-900 dark:text-white">
                                        {spendingMetric === 'spent' ? `${storeProfile.currency} ${item.value.toLocaleString()}` : `${item.value.toLocaleString()} pts`}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </>
                 ) : (
                     <div className="text-center text-gray-400 py-8 text-sm flex flex-col items-center">
                        <Target className="w-8 h-8 mb-2 opacity-20" />
                        No customer data available yet
                     </div>
                 )}
             </div>

             {/* Category Sales Pie */}
             <div className="bg-white dark:bg-gray-800 p-6 rounded-3xl shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)] transition-all border border-gray-100 dark:border-gray-800 flex flex-col h-full lg:col-span-1">
                 <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2 mb-6 uppercase text-sm tracking-widest">
                    <PieChartIcon className="w-5 h-5 text-orange-500" /> Categories
                 </h3>
                 <div className="flex-1 w-full flex items-center justify-center min-h-[250px]">
                     {categoryData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={categoryData}
                                    cx="50%"
                                    cy="45%"
                                    innerRadius={60}
                                    outerRadius={80}
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {categoryData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', color: '#fff', borderRadius: '12px' }} itemStyle={{ color: '#fff' }} />
                                <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ paddingTop: '20px' }} />
                            </PieChart>
                        </ResponsiveContainer>
                     ) : (
                        <div className="text-gray-400 text-sm">No sales data for this period</div>
                     )}
                 </div>
             </div>
      </div>

      {/* LEAD-TIME AWARE AUTOMATED RESTOCKING PLANNER */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-3xl shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)] transition-all border border-gray-100 dark:border-gray-800 mb-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5">
              <div>
                  <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2 text-base">
                     <Truck className="w-5 h-5 text-indigo-500 animate-pulse" /> AI Restock Planner (Lead-Time & Velocity Aware)
                  </h3>
                  <p className="text-gray-500 text-xs mt-1">
                     Scans standard 30-day product demand speeds against supplier delivery buffer times, flagging items requiring immediate ordering to stave off stockouts.
                  </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 self-start md:self-auto">
                  <div className="flex items-center gap-2 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-400 text-xs px-3 py-1.5 rounded-xl border border-indigo-100 dark:border-indigo-900/40 font-bold">
                     <span>{restockSuggestions.filter(s => s.status === 'critical').length} Urgent</span>
                     <span className="text-gray-300 dark:text-gray-700">|</span>
                     <span>{restockSuggestions.filter(s => s.status === 'warning').length} Warning</span>
                  </div>
                  {restockSuggestions.length > 6 && (
                      <button
                          onClick={() => setShowAllRestock(!showAllRestock)}
                          className="px-3 py-1.5 text-xs font-bold transition-all bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-sm hover:shadow-md cursor-pointer whitespace-nowrap"
                      >
                          {showAllRestock ? 'Show Less' : `View All (${restockSuggestions.length})`}
                      </button>
                  )}
              </div>
          </div>

          {restockSuggestions.length === 0 ? (
              <div className="text-center text-emerald-600 dark:text-emerald-400 py-8 text-xs flex flex-col items-center justify-center bg-emerald-50/40 dark:bg-emerald-950/10 rounded-2xl border border-emerald-100/50 dark:border-emerald-900/10">
                  <span className="text-2xl mb-2">✅</span>
                  <p className="font-bold">Supply Chain is Secure</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">All products maintain a healthy stock buffer based on current sales speed.</p>
              </div>
          ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {(showAllRestock ? restockSuggestions : restockSuggestions.slice(0, 6)).map((item) => {
                      const isCritical = item.status === 'critical';
                      return (
                          <div
                              key={item.id}
                              className={`p-4 rounded-2xl border transition-all duration-300 flex flex-col justify-between ${
                                  isCritical 
                                      ? 'bg-rose-50/55 dark:bg-rose-950/15 border-rose-100 dark:border-rose-900/30 hover:border-rose-200' 
                                      : 'bg-amber-50/55 dark:bg-amber-950/10 border-amber-100 dark:border-amber-900/20 hover:border-amber-200'
                              }`}
                          >
                              {/* Header details */}
                              <div>
                                  <div className="flex justify-between items-start gap-2 mb-2">
                                      <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider ${
                                          isCritical 
                                              ? 'bg-rose-500 text-white animate-pulse' 
                                              : 'bg-amber-500 text-white'
                                      }`}>
                                          {isCritical ? 'Restock Now' : 'Warning'}
                                      </span>
                                      
                                      <span className="text-[10px] text-gray-400 font-bold font-mono">
                                          {item.category || 'Retail'}
                                      </span>
                                  </div>

                                  <h4 className="font-extrabold text-gray-800 dark:text-gray-100 text-xs truncate max-w-full uppercase tracking-tight" title={item.name}>
                                      {item.name}
                                  </h4>

                                  {/* Depletion Countdown Meter */}
                                  <div className="mt-3 bg-white/70 dark:bg-black/30 p-2.5 rounded-xl border border-black/[0.03] dark:border-white/[0.03] text-[11px] space-y-1">
                                      <div className="flex justify-between text-gray-600 dark:text-gray-300">
                                          <span>Current Stock:</span>
                                          <strong className="font-extrabold text-gray-850 dark:text-gray-100">
                                              {item.stock} {item.measurementUnit || 'pcs'}
                                          </strong>
                                      </div>
                                      <div className="flex justify-between text-gray-600 dark:text-gray-300">
                                          <span>Sales Speed:</span>
                                          <strong className="font-bold text-indigo-600 dark:text-indigo-400">
                                              {item.salesVelocity} units/day
                                          </strong>
                                      </div>
                                      <div className="flex justify-between text-gray-600 dark:text-gray-300">
                                          <span>Supplier Turnaround:</span>
                                          <strong className="font-bold text-gray-700 dark:text-gray-200">
                                              {item.leadTime} {item.leadTime === 1 ? 'day' : 'days'}
                                          </strong>
                                      </div>

                                      <div className="pt-1.5 mt-1.5 border-t border-black/[0.04] dark:border-white/[0.04] flex items-center justify-between font-bold">
                                          <span className="text-gray-500">Runout ETA:</span>
                                          {item.stock <= 0 ? (
                                              <span className="text-red-500 font-black uppercase tracking-wider text-[10px]">
                                                  Exhausted!
                                              </span>
                                          ) : item.daysRemaining <= item.leadTime ? (
                                              <span className="text-rose-500 font-black">
                                                  {item.daysRemaining} days (Shortfall!)
                                              </span>
                                          ) : (
                                              <span className="text-amber-600 dark:text-amber-400 font-extrabold">
                                                  {item.daysRemaining} days remaining
                                              </span>
                                          )}
                                      </div>
                                  </div>
                              </div>

                              {/* Ordering Suggestion Footer */}
                              <div className="mt-3.5 pt-3 border-t border-black/[0.04] dark:border-white/[0.04] flex items-center justify-between font-sans">
                                  <div className="text-[10px] text-gray-400">
                                      <p className="font-semibold text-gray-500 uppercase tracking-wider text-[8px]">Restore Safety Margin</p>
                                      <p className="font-black text-xs text-indigo-600 dark:text-indigo-400 mt-0.5">+{item.recommendedOrderQty} units</p>
                                  </div>
                                  <div className="text-[10px] text-right font-sans">
                                      <p className="font-semibold text-gray-500 uppercase tracking-wider text-[8px]">Est. Cash Outlay</p>
                                      <p className="font-bold text-gray-700 dark:text-gray-200 mt-0.5">
                                          {storeProfile.currency} {item.restockOutlay.toLocaleString()}
                                      </p>
                                  </div>
                              </div>
                          </div>
                      );
                  })}
              </div>
          )}
      </div>

      {/* 8. WEEKDAY INTELLIGENCE TOOL (Stock Planner for Cash Crunches) */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-3xl shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)] transition-all border border-gray-100 dark:border-gray-800 mb-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
              <div>
                  <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2 text-base">
                     <Calendar className="w-5 h-5 text-indigo-500" /> Stocking Planner (Daily Demand Profile)
                  </h3>
                  <p className="text-gray-500 text-xs mt-1">
                     Tracks item velocity by day of the week to maximize utility of limited inventory capital during cash crunches.
                  </p>
              </div>
              <div className="bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 text-xs px-3 py-1.5 rounded-lg border border-indigo-100 dark:border-indigo-900/30 font-bold self-start md:self-auto">
                 💡 Pro-Tip: Minimize slow-moving inventory on peak demand days.
              </div>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
              {bestSellersByDayOfWeek.map((dayData, index) => {
                  return (
                      <div key={index} className="bg-gray-50/50 dark:bg-gray-900/50 p-4 rounded-2xl border border-gray-100 dark:border-gray-800/80 shadow-sm flex flex-col justify-between hover:bg-gray-50 dark:hover:bg-gray-800/20 transition-all duration-300">
                          <div>
                              <div className="flex items-center justify-between mb-3 border-b border-gray-100 dark:border-gray-800 pb-2">
                                  <span className="text-xs font-black uppercase text-indigo-600 dark:text-indigo-400 tracking-wider">
                                      {dayData.dayName.slice(0, 3)}
                                  </span>
                                  <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-bold px-2 py-0.5 rounded-md">
                                     {dayData.topProducts.length} items
                                  </span>
                              </div>
                              
                              {dayData.topProducts.length > 0 ? (
                                  <div className="space-y-2.5">
                                      {dayData.topProducts.map((p, pIdx) => (
                                          <div key={pIdx} className="flex items-start justify-between gap-1.5 border-b border-dashed border-gray-150 dark:border-gray-800/50 last:border-0 pb-1.5 last:pb-0">
                                              <span className="text-[11px] font-bold text-gray-800 dark:text-gray-200 line-clamp-1 truncate uppercase" title={p.name}>
                                                  {p.name}
                                              </span>
                                              <span className="text-[9px] bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-black px-1.5 py-0.5 rounded shrink-0">
                                                 {p.quantity}
                                              </span>
                                          </div>
                                      ))}
                                  </div>
                              ) : (
                                  <div className="text-gray-400 dark:text-gray-650 py-6 text-center">
                                      <p className="text-xs italic font-medium">No sales logs</p>
                                  </div>
                              )}
                          </div>
                      </div>
                  );
              })}
          </div>
      </div>

      {/* 9. PREDICTIVE REVENUE INTELLIGENCE TOOL (7-Day Forecast) */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-3xl shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)] transition-all border border-gray-100 dark:border-gray-800 mb-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
              <div>
                  <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2 text-base">
                     <Sparkles className="w-5 h-5 text-purple-500 animate-pulse" /> AI Revenue Predictor (Next 7 Days)
                  </h3>
                  <p className="text-gray-500 text-xs mt-1">
                     Projects store revenue for the upcoming week based on historic baseline trends and weekday seasonal demand patterns.
                  </p>
              </div>
              <div className="flex items-center gap-3 self-start md:self-auto">
                  <span className="text-xs text-gray-400 dark:text-gray-500 font-bold">Confidence:</span>
                  <span className={`px-2.5 py-1 text-xs font-black rounded-lg ${
                      revenuePrediction.confidence === 'High' ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/40' :
                      revenuePrediction.confidence === 'Moderate' ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-100 dark:border-amber-900/45' :
                      'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                  }`}>
                      {revenuePrediction.confidence} Confidence
                  </span>
              </div>
          </div>

          {!revenuePrediction.hasData ? (
              <div className="text-center text-gray-400 py-10 text-sm flex flex-col items-center">
                  <Activity className="w-10 h-10 mb-3 text-gray-300 animate-bounce" />
                  <p className="font-bold">Insufficient Sales History</p>
                  <p className="text-xs mt-1">Record a few transactions to enable AI-powered 7-day revenue forecasts.</p>
              </div>
          ) : (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                  {/* Left stats card */}
                  <div className="lg:col-span-4 flex flex-col gap-4">
                      <div className="flex-1 bg-gradient-to-br from-purple-50/50 to-indigo-50/20 dark:from-purple-950/20 dark:to-indigo-950/5 p-5 rounded-2xl border border-purple-100/50 dark:border-purple-900/20 flex flex-col justify-between">
                          <div>
                              <span className="text-[10px] font-bold text-indigo-500 dark:text-indigo-400 uppercase tracking-wider block mb-1">Expected 7-Day Revenue</span>
                              <div className="text-3xl font-black text-indigo-900 dark:text-indigo-100 tracking-tight">
                                  {storeProfile.currency} {revenuePrediction.predictedTotal.toLocaleString()}
                              </div>
                              <p className="text-xs text-gray-500 mt-2 leading-relaxed">
                                  Weighted projection calculated using {transactions.filter(t => t.status !== 'Refunded').length} historic logs, accounting for local seasonal peaks.
                              </p>
                          </div>
                          
                          <div className="mt-4 pt-4 border-t border-purple-100/50 dark:border-purple-900/30 grid grid-cols-2 gap-4">
                              <div>
                                  <span className="text-[9px] font-bold text-gray-400 dark:text-gray-500 uppercase block">Daily Baseline</span>
                                  <span className="text-sm font-extrabold text-gray-700 dark:text-gray-300">
                                      {storeProfile.currency} {revenuePrediction.baseline.toLocaleString()}
                                  </span>
                              </div>
                              <div>
                                  <span className="text-[9px] font-bold text-gray-400 dark:text-gray-500 uppercase block">Trend Slope</span>
                                  <span className={`text-sm font-extrabold flex items-center gap-1 ${
                                      revenuePrediction.trendDirection === 'Rising' ? 'text-emerald-500' :
                                      revenuePrediction.trendDirection === 'Declining' ? 'text-rose-500' :
                                      'text-gray-500'
                                  }`}>
                                      {revenuePrediction.trendDirection === 'Rising' ? '▲' : revenuePrediction.trendDirection === 'Declining' ? '▼' : '▬'} {revenuePrediction.trendDirection}
                                  </span>
                              </div>
                          </div>
                      </div>

                      <div className="bg-gray-50/50 dark:bg-gray-900/40 p-4 rounded-2xl border border-gray-100 dark:border-gray-800/80">
                          <span className="text-[9px] font-bold text-[#4f46e5] dark:text-[#818cf8] uppercase tracking-wider block mb-1">Forecast Parameters</span>
                          <div className="space-y-1.5 text-xs text-gray-600 dark:text-gray-400 leading-relaxed font-sans">
                              <p>• <span className="font-semibold text-gray-800 dark:text-gray-200">Seasonality Multiplier:</span> Adjusted for high-volume weekends and mid-week quiet spells automatically.</p>
                              <p>• <span className="font-semibold text-gray-800 dark:text-gray-200">Linear Slope:</span> Overall daily sales velocity is trending at <span className="font-bold text-indigo-500">{revenuePrediction.slope >= 0 ? '+' : ''}{revenuePrediction.slope}</span> units / day.</p>
                          </div>
                      </div>
                  </div>

                  {/* Right chart card */}
                  <div className="lg:col-span-8 bg-gray-50/45 dark:bg-gray-900/20 p-5 rounded-2xl border border-gray-100 dark:border-gray-800 flex flex-col justify-between">
                      <div>
                          <div className="flex items-center justify-between mb-4">
                              <span className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Forecast Waveform</span>
                              <div className="flex items-center gap-4 text-[10px] font-bold">
                                  <span className="flex items-center gap-1.5 text-gray-500">
                                      <span className="w-3 h-3 rounded-full bg-indigo-200 dark:bg-indigo-950 border border-indigo-500"></span> Historic Sales
                                  </span>
                                  <span className="flex items-center gap-1.5 text-indigo-500">
                                      <span className="w-3 h-3 rounded-full bg-purple-500"></span> Expected Forecast (*)
                                  </span>
                              </div>
                          </div>

                          <div className="h-[220px] w-full">
                              <ResponsiveContainer width="100%" height="100%">
                                  <ComposedChart data={revenuePrediction.chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                      <CartesianGrid strokeDasharray="3 3" opacity={0.1} vertical={false} />
                                      <XAxis dataKey="name" stroke="#9ca3af" fontSize={10} tickLine={false} axisLine={false} />
                                      <YAxis stroke="#4f46e5" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                                      <Tooltip 
                                          formatter={(value: any, name: string) => {
                                              const label = name === 'actual' ? 'Actual Revenue' : 'Expected Forecast';
                                              return [`${storeProfile.currency} ${parseFloat(value).toLocaleString()}`, label];
                                          }}
                                          contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', color: '#fff', borderRadius: '12px' }} 
                                          itemStyle={{ color: '#fff' }} 
                                          labelStyle={{ fontWeight: 'bold' }}
                                      />
                                      {/* Past Actual Sales Area */}
                                      <Area type="monotone" dataKey="actual" fill="#818cf8" stroke="#4f46e5" strokeWidth={2.5} fillOpacity={0.15} />
                                      {/* Predicted Future Sales Bar */}
                                      <Bar dataKey="predicted" fill="#a855f7" radius={[4, 4, 0, 0]} barSize={24} />
                                  </ComposedChart>
                              </ResponsiveContainer>
                          </div>
                      </div>

                      <div className="text-[10px] text-gray-400 dark:text-gray-500 text-center mt-3 border-t border-gray-100 dark:border-gray-800 pt-3">
                          * Days marked with an asterisk (*) represent simulated predictions. Real outcome may fluctuate based on local macro factors.
                      </div>
                  </div>
              </div>
          )}
      </div>

      {/* 7. DETAILS MODAL (For Slow Moving & Low Stock Cards) */}
      {viewDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md" onClick={() => setViewDetails(null)}>
          <div className="bg-white dark:bg-gray-900 w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] border border-gray-200 dark:border-gray-800 animate-fade-in transform scale-100" onClick={e => e.stopPropagation()}>
             <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50 dark:bg-black/50">
               <div>
                  <h3 className="text-xl font-black text-gray-900 dark:text-white tracking-tight">{viewDetails.title}</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">{viewDetails.items.length} Products Found</p>
               </div>
               <button onClick={() => setViewDetails(null)} className="p-2 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 transition-colors">
                 <X className="w-5 h-5" />
               </button>
             </div>
             <div className="overflow-y-auto p-4 bg-gray-50/50 dark:bg-black/20">
                {viewDetails.items.length === 0 ? (
                   <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                      <Package className="w-12 h-12 mb-3 opacity-50" />
                      <p className="font-medium">No items found in this category.</p>
                   </div>
                ) : (
                   <div className="grid gap-3">
                      {viewDetails.items.map(item => (
                         <div key={item.id} className="flex items-center gap-4 p-3 bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm">
                            <img src={item.image} alt={item.name} className="w-12 h-12 rounded-xl object-cover bg-gray-100 dark:bg-gray-900" />
                            <div className="flex-1 min-w-0">
                               <h4 className="font-bold text-gray-900 dark:text-white truncate">{item.name}</h4>
                               <p className="text-xs text-gray-500 dark:text-gray-400">{item.category}</p>
                               {item.expiryDate && (
                                    <p className={`text-xs mt-1 font-bold ${new Date(item.expiryDate) < new Date() ? 'text-red-500' : 'text-orange-500'}`}>
                                        Exp: {new Date(item.expiryDate).toLocaleDateString()}
                                    </p>
                               )}
                            </div>
                            <div className="text-right">
                               <p className={`text-sm font-bold ${(item.reorderPoint !== undefined ? item.stock <= item.reorderPoint : item.stock <= 5) ? 'text-red-500' : 'text-gray-900 dark:text-white'}`}>
                                 {item.stock} {item.measurementUnit || 'pcs'}
                               </p>
                               <p className="text-xs text-gray-500 dark:text-gray-400">Price: {storeProfile.currency} {item.sellPrice}</p>
                            </div>
                         </div>
                      ))}
                   </div>
                )}
             </div>
             <div className="p-4 border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
                <button 
                  onClick={() => {
                     setViewDetails(null);
                     onNavigate(AppView.INVENTORY);
                  }}
                  className="w-full py-3 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-2xl font-bold hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                >
                  Go to Inventory Manager
                </button>
             </div>
          </div>
        </div>
      )}

      {/* 8. ITEMS SOLD MODAL */}
      {isItemsSoldModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md" onClick={() => setIsItemsSoldModalOpen(false)}>
          <div className="bg-white dark:bg-gray-900 w-full max-w-md rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] border border-gray-200 dark:border-gray-800 animate-fade-in transform scale-100" onClick={e => e.stopPropagation()}>
             <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50 dark:bg-black/50">
               <div>
                  <h3 className="text-xl font-black text-gray-900 dark:text-white flex items-center gap-2">
                      <ShoppingBag className="w-5 h-5 text-blue-500" /> Items Sold
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 font-medium mt-1">Daily Sales History</p>
               </div>
               <button onClick={() => setIsItemsSoldModalOpen(false)} className="p-2 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 transition-colors">
                 <X className="w-5 h-5" />
               </button>
             </div>
             
             <div className="p-4 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Select Date</label>
                <input 
                    type="date" 
                    value={itemsSoldDate}
                    onChange={(e) => setItemsSoldDate(e.target.value)}
                    className="w-full bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white px-4 py-3 rounded-2xl border border-gray-100 dark:border-gray-800 focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium"
                />
             </div>

             <div className="overflow-y-auto p-4 bg-gray-50/50 dark:bg-black/20 flex-1 custom-scrollbar">
                 {itemsSoldData.length > 0 ? (
                     <div className="space-y-3">
                         {itemsSoldData.map((item, index) => (
                             <div key={index} className="bg-white dark:bg-gray-800 p-3 rounded-2xl border border-gray-100 dark:border-gray-800 flex items-center justify-between shadow-sm hover:shadow-md transition-all group">
                                 <div className="flex items-center gap-3">
                                     <div className="w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 font-black text-sm border border-blue-100 dark:border-blue-800/50">
                                         {item.quantity}
                                     </div>
                                     <span className="font-bold text-gray-700 dark:text-gray-200 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">{item.name}</span>
                                 </div>
                                 <span className="text-xs font-bold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-2.5 py-1.5 rounded-xl">
                                     {item.unit}
                                 </span>
                             </div>
                         ))}
                     </div>
                 ) : (
                     <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                         <Package className="w-12 h-12 mb-3 opacity-30" />
                         <p className="font-medium text-sm">No items sold on this date.</p>
                     </div>
                 )}
             </div>
          </div>
        </div>
      )}
    </div>
  );
};
