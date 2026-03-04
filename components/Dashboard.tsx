
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, PieChart, Pie, Cell, Legend, ComposedChart, Line } from 'recharts';
import { TrendingUp, DollarSign, AlertCircle, ShoppingBag, Sparkles, Loader2, Target, Edit3, PieChart as PieChartIcon, CreditCard, FileDown, Calendar, Wallet, Banknote, TrendingDown, ArrowRight, AlertTriangle, X, Check, AlertOctagon, Package, Activity, ChevronDown, Filter } from 'lucide-react';
import { Product, Transaction, StoreProfile, AppView, ShiftRecord, StockLog, Customer } from '../types';
import { getBusinessInsights } from '../services/geminiService';
import confetti from 'canvas-confetti';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

interface DashboardProps {
  products: Product[];
  transactions: Transaction[];
  storeProfile: StoreProfile;
  currentShift: ShiftRecord | null;
  stockLogs: StockLog[];
  customers: Customer[];
  onNavigate: (view: AppView) => void;
  onUpdateProfile?: (profile: StoreProfile) => void;
}

const COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#6366f1', '#14b8a6'];
const PIE_COLORS = ['#3b82f6', '#10b981', '#ef4444', '#f59e0b']; // Cash(Blue), Mpesa(Green), Credit(Red), Split(Orange)

export const Dashboard: React.FC<DashboardProps> = ({ products, transactions, storeProfile, currentShift, stockLogs, customers, onNavigate, onUpdateProfile }) => {
  const [insight, setInsight] = useState<string | null>(null);
  const [loadingInsight, setLoadingInsight] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [salesView, setSalesView] = useState<'weekly' | 'monthly' | 'yearly'>('weekly');
  const [viewDetails, setViewDetails] = useState<{ title: string; items: Product[] } | null>(null);
  const [selectedDayFilter, setSelectedDayFilter] = useState<string>('All');
  const [spendingMetric, setSpendingMetric] = useState<'spent' | 'points'>('spent');
  const dashboardRef = useRef<HTMLDivElement>(null);

  // --- 1. Daily Financial Overview Calculation ---
  const today = new Date().toISOString().split('T')[0];
  const todayTransactions = transactions.filter(t => t.date.startsWith(today) && t.status !== 'Refunded');
  
  const todaySales = todayTransactions.reduce((acc, t) => acc + t.total, 0);
  
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

  // --- 3. Inventory Value Trend (Last 7 Days) ---
  const inventoryTrendData = useMemo(() => {
    const days = 7;
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

    // Iterate backwards
    for (let i = 0; i < days; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const dayName = date.toLocaleDateString('en-KE', { weekday: 'short' });

      // Calculate value for end of this day (which is current state for today, or after reversing future logs for past days)
      const value = calculateValue(currentStockMap);
      
      data.unshift({
        name: dayName,
        date: dateStr,
        value: value
      });

      // Reverse logs for this day to get state at start of day (end of previous day)
      const daysLogs = stockLogs.filter(log => log.date.startsWith(dateStr));
      daysLogs.forEach(log => {
        const currentQty = currentStockMap.get(log.productId) || 0;
        // If log added stock (+), we subtract to go back. If removed (-), we add.
        currentStockMap.set(log.productId, currentQty - log.quantityChanged);
      });
    }
    return data;
  }, [products, stockLogs]);

  const expectedMpesa = currentShift ? currentShift.closingMpesaCalculated : 0;
  const actualMpesa = currentShift?.actualClosingMpesa;
  const mpesaVariance = actualMpesa !== undefined ? actualMpesa - expectedMpesa : 0;
  
  const hasCashVariance = actualCash !== undefined && cashVariance !== 0;
  const hasMpesaVariance = actualMpesa !== undefined && mpesaVariance !== 0;

  // --- 3. Inventory Health ---
  const totalStockValue = products.reduce((acc, p) => acc + (p.buyPrice * p.stock), 0);
  const lowStockItems = products.filter(p => p.stock <= 5 && p.stock > 0);
  const outOfStockItems = products.filter(p => p.stock <= 0);

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
    const result = await getBusinessInsights(transactions, products);
    setInsight(result);
    setLoadingInsight(false);
  };

  // Custom Tooltips
  const SalesTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white dark:bg-gray-900 p-4 border border-gray-200 dark:border-gray-800 rounded-xl shadow-xl z-50">
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
            <div className="bg-white dark:bg-gray-900 p-4 border border-gray-200 dark:border-gray-800 rounded-xl shadow-xl z-50">
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
        <div className="flex gap-2 no-export">
            <button onClick={handleExportPDF} disabled={isExporting} className="bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 px-4 py-2 rounded-xl font-bold text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-2 shadow-sm">
                {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />} Export
            </button>
            <button onClick={fetchInsight} disabled={loadingInsight} className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white px-4 py-2 rounded-xl font-bold text-sm hover:shadow-lg transition-all flex items-center gap-2">
                {loadingInsight ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} AI Tips
            </button>
        </div>
      </div>

      {/* 1. ACTION PANEL (Insights & Critical Alerts) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 border border-indigo-100 dark:border-indigo-800 rounded-2xl p-6 relative overflow-hidden shadow-[0_4px_12px_rgba(0,0,0,0.08)]">
             <div className="absolute top-0 right-0 p-4 opacity-10"><Sparkles className="w-24 h-24 text-indigo-500" /></div>
             <h3 className="text-indigo-900 dark:text-indigo-200 font-bold flex items-center gap-2 mb-3">
                <Sparkles className="w-5 h-5" /> Today's Focus
             </h3>
             <div className="prose prose-sm dark:prose-invert text-gray-700 dark:text-gray-300 font-medium max-w-none">
                {insight ? (
                    <div className="whitespace-pre-line">{insight}</div>
                ) : (
                    <p>
                        Welcome back! {hasCashVariance || hasMpesaVariance ? "There are cash discrepancies today." : "Everything looks balanced so far."}
                        <br/>
                        Check your <strong>low stock items</strong> and keep an eye on <strong>cash accountability</strong>.
                    </p>
                )}
             </div>
          </div>

          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/30 rounded-2xl p-6 shadow-[0_4px_12px_rgba(0,0,0,0.08)]">
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
         <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-[0_4px_12px_rgba(0,0,0,0.08)] border border-gray-200 dark:border-gray-700 flex flex-col justify-between relative overflow-hidden">
            {/* Background decoration for target met */}
            {isTargetMet && <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none"></div>}
            
            <div>
                <div className="flex justify-between items-start mb-4">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Today's Sales</p>
                        <h2 className="text-3xl font-black text-gray-900 dark:text-white mt-1">{storeProfile.currency} {todaySales.toLocaleString()}</h2>
                        
                        {/* Percentage Change Indicator */}
                        <div className={`flex items-center gap-1 mt-2 text-xs font-bold ${salesGrowth >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                            {salesGrowth >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                            <span>{Math.abs(salesGrowth).toFixed(1)}%</span>
                            <span className="text-gray-400 font-normal">vs. last {lastWeekDayName} same time</span>
                        </div>
                    </div>
                    <div className={`p-3 rounded-xl ${isTargetMet ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400'}`}>
                        {isTargetMet ? <Target className="w-6 h-6" /> : <ShoppingBag className="w-6 h-6" />}
                    </div>
                </div>

                {/* Target Progress */}
                {salesTarget > 0 && (
                    <div className="mb-4">
                        <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider mb-1.5">
                            <span className="text-gray-400">Daily Target</span>
                            <span className={isTargetMet ? "text-emerald-600 dark:text-emerald-400" : "text-gray-600 dark:text-gray-300"}>
                                {Math.round(progressPercent)}% of {storeProfile.currency} {salesTarget.toLocaleString()}
                            </span>
                        </div>
                        <div className="h-2.5 w-full bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                            <div 
                                className={`h-full rounded-full transition-all duration-1000 ease-out ${isTargetMet ? 'bg-gradient-to-r from-emerald-500 to-green-400' : 'bg-gradient-to-r from-indigo-500 to-blue-500'}`}
                                style={{ width: `${progressPercent}%` }}
                            ></div>
                        </div>
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
         <div className={`rounded-2xl p-6 shadow-[0_4px_12px_rgba(0,0,0,0.08)] border relative overflow-hidden ${hasCashVariance ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'}`}>
            <div className="absolute top-0 right-0 w-20 h-20 bg-gray-50 dark:bg-gray-700 rounded-bl-full -mr-4 -mt-4 z-0 opacity-50"></div>
            <div className="relative z-10">
                <div className="flex justify-between items-start mb-4">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Cash In Drawer</p>
                        <h2 className="text-3xl font-black text-gray-900 dark:text-white mt-1">{storeProfile.currency} {expectedCash.toLocaleString()}</h2>
                    </div>
                    <div className="p-3 bg-gray-100 dark:bg-gray-700 rounded-xl text-gray-600 dark:text-gray-300">
                        <Banknote className="w-6 h-6" />
                    </div>
                </div>
                <div className="flex flex-col gap-1 text-sm border-t border-gray-100 dark:border-gray-700 pt-3 mt-1">
                    <div className="flex justify-between text-gray-500 dark:text-gray-400">
                        <span>Collected:</span>
                        <span className="font-bold text-gray-900 dark:text-white">+{cashCollected.toLocaleString()}</span>
                    </div>
                    {actualCash !== undefined && (
                        <div className="flex justify-between items-center pt-1 mt-1 border-t border-dashed border-gray-200 dark:border-gray-700">
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
         <div className={`rounded-2xl p-6 shadow-[0_4px_12px_rgba(0,0,0,0.08)] border relative overflow-hidden ${hasMpesaVariance ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'}`}>
            <div className="flex justify-between items-start mb-4">
                <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">M-Pesa Till</p>
                    <h2 className="text-3xl font-black text-green-600 dark:text-green-400 mt-1">{storeProfile.currency} {expectedMpesa.toLocaleString()}</h2>
                </div>
                <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-xl text-green-600 dark:text-green-400">
                    <CreditCard className="w-6 h-6" />
                </div>
            </div>
            <div className="flex flex-col gap-1 text-sm border-t border-gray-100 dark:border-gray-700 pt-3 mt-1">
                 <div className="flex justify-between text-gray-500 dark:text-gray-400">
                    <span>Collected:</span>
                    <span className="font-bold text-gray-900 dark:text-white">+{mpesaCollected.toLocaleString()}</span>
                </div>
                {actualMpesa !== undefined && (
                    <div className="flex justify-between items-center pt-1 mt-1 border-t border-dashed border-gray-200 dark:border-gray-700">
                        <span className="text-xs font-bold uppercase">Variance:</span>
                        <span className={`font-black ${mpesaVariance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {mpesaVariance > 0 ? '+' : ''}{mpesaVariance.toLocaleString()}
                        </span>
                    </div>
                )}
            </div>
         </div>
      </div>

      {/* 3. INVENTORY HEALTH ROW */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
         <div className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-[0_4px_12px_rgba(0,0,0,0.08)] flex items-center justify-between">
            <div>
                <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">Total Stock Value</p>
                <p className="text-xl font-black text-gray-900 dark:text-white mt-1">{storeProfile.currency} {totalStockValue.toLocaleString()}</p>
            </div>
            <div className="bg-blue-50 dark:bg-blue-900/20 p-2 rounded-lg text-blue-600">
                <DollarSign className="w-5 h-5" />
            </div>
         </div>
         <div 
             className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-[0_4px_12px_rgba(0,0,0,0.08)] flex items-center justify-between cursor-pointer hover:border-amber-300 dark:hover:border-amber-700 transition-all hover:shadow-lg hover:-translate-y-0.5" 
             onClick={() => setViewDetails({ title: 'Low Stock Risks', items: lowStockItems })}
         >
            <div>
                <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">Low Stock Risks</p>
                <p className="text-xl font-black text-amber-600 dark:text-amber-400 mt-1">{lowStockItems.length} Items</p>
            </div>
            <div className="bg-amber-50 dark:bg-amber-900/20 p-2 rounded-lg text-amber-600">
                <AlertCircle className="w-5 h-5" />
            </div>
         </div>
         <div 
             className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-[0_4px_12px_rgba(0,0,0,0.08)] flex items-center justify-between cursor-pointer hover:border-gray-300 dark:hover:border-gray-600 transition-all hover:shadow-lg hover:-translate-y-0.5"
             onClick={() => setViewDetails({ title: 'Slow Moving Items (>30 Days)', items: slowMovingItems })}
         >
            <div>
                <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">Slow Moving (&gt;30 Days)</p>
                <p className="text-xl font-black text-gray-900 dark:text-white mt-1">{storeProfile.currency} {slowMovingValue.toLocaleString()}</p>
            </div>
             <div className="bg-gray-100 dark:bg-gray-700 p-2 rounded-lg text-gray-600 dark:text-gray-300">
                <TrendingDown className="w-5 h-5" />
            </div>
         </div>
      </div>

      {/* 4. CHARTS ROW (Trends & Top Items) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
         <div className="lg:col-span-2 flex flex-col gap-6">
             {/* Sales Chart */}
             <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-[0_4px_12px_rgba(0,0,0,0.08)] border border-gray-200 dark:border-gray-700">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-blue-500" /> Sales Trend
                    </h3>
                    <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
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
                                <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3}/>
                                <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
                            </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.1} vertical={false} />
                            <XAxis dataKey="name" stroke="#9ca3af" fontSize={10} tickLine={false} axisLine={false} dy={10} interval={salesView === 'monthly' ? 2 : 0} />
                            <YAxis stroke="#9ca3af" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}`} />
                            <Tooltip content={<SalesTooltip />} />
                            <Area type="monotone" dataKey="sales" stroke="#0ea5e9" strokeWidth={2} fillOpacity={1} fill="url(#colorSales)" name="Sales" />
                            <Line type="monotone" dataKey="prevSales" stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Previous Sales" />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
             </div>

             {/* Profit Chart */}
             <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-[0_4px_12px_rgba(0,0,0,0.08)] border border-gray-200 dark:border-gray-700">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <DollarSign className="w-5 h-5 text-emerald-500" /> Profit Trend
                    </h3>
                    <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
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
                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                                <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                            </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.1} vertical={false} />
                            <XAxis dataKey="name" stroke="#9ca3af" fontSize={10} tickLine={false} axisLine={false} dy={10} interval={salesView === 'monthly' ? 2 : 0} />
                            <YAxis stroke="#9ca3af" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}`} />
                            <Tooltip contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', color: '#fff', borderRadius: '12px' }} itemStyle={{ color: '#fff' }} />
                            <Area type="monotone" dataKey="profit" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorProfit)" name="Profit" />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
             </div>

             {/* Inventory Value Trend Chart */}
             <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-[0_4px_12px_rgba(0,0,0,0.08)] border border-gray-200 dark:border-gray-700">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <Package className="w-5 h-5 text-purple-500" /> Inventory Value Trend
                    </h3>
                </div>
                <div className="h-64 w-full">
                     <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={inventoryTrendData}>
                            <defs>
                            <linearGradient id="colorInventory" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3}/>
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
                            <Area type="monotone" dataKey="value" stroke="#8b5cf6" strokeWidth={2} fillOpacity={1} fill="url(#colorInventory)" name="Value" />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
             </div>
         </div>

         <div className="flex flex-col gap-6">
             {/* Best Sellers List */}
             <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-[0_4px_12px_rgba(0,0,0,0.08)] border border-gray-200 dark:border-gray-700 flex flex-col">
                 <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2 mb-6">
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
                        <div key={index} className="flex items-center justify-between group hover:bg-gray-50 dark:hover:bg-gray-700/50 p-2 rounded-lg transition-colors">
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
                <button className="w-full mt-6 py-2.5 text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors" onClick={() => onNavigate(AppView.INVENTORY)}>
                    View Full Inventory
                </button>
             </div>

             {/* Top Spenders Chart */}
             <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-[0_4px_12px_rgba(0,0,0,0.08)] border border-gray-200 dark:border-gray-700 flex flex-col">
                 <div className="flex justify-between items-center mb-6">
                    <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <Target className="w-5 h-5 text-emerald-500" /> Top Spenders
                    </h3>
                    <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
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
                        <div className="space-y-3">
                            {topSpendersData.map((item, index) => (
                                <div key={index} className="flex items-center justify-between group hover:bg-gray-50 dark:hover:bg-gray-700/50 p-2 rounded-lg transition-colors">
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
         </div>
      </div>

      {/* 5. HOURLY PERFORMANCE DASHBOARD */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-[0_4px_12px_rgba(0,0,0,0.08)] border border-gray-200 dark:border-gray-700">
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
                      className="w-full appearance-none pl-4 pr-10 py-2.5 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-sm font-bold text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500 cursor-pointer shadow-sm"
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
                        stroke="#0ea5e9" 
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
                      
                      <Bar yAxisId="left" dataKey="avgSales" name="Avg Sales (KES)" fill="#0ea5e9" radius={[4, 4, 0, 0]} barSize={20} fillOpacity={0.8} />
                      <Line yAxisId="right" type="monotone" dataKey="avgTxns" name="Avg Transactions" stroke="#f59e0b" strokeWidth={3} dot={{r: 3, fill:'#f59e0b'}} activeDot={{ r: 6 }} />
                      <Line yAxisId="left" type="monotone" dataKey="atv" name="Avg Txn Value (KES)" stroke="#10b981" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                  </ComposedChart>
              </ResponsiveContainer>
          </div>
      </div>

      {/* 6. PIE CHARTS ROW */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Payment Methods Pie */}
          <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-[0_4px_12px_rgba(0,0,0,0.08)] border border-gray-200 dark:border-gray-700">
             <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2 mb-6">
                <Wallet className="w-5 h-5 text-purple-500" /> Revenue Source (Today)
             </h3>
             <div className="h-64 w-full flex items-center justify-center">
                 {paymentMethodData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                                data={paymentMethodData}
                                cx="50%"
                                cy="50%"
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
                            <Legend verticalAlign="bottom" height={36} iconType="circle" />
                        </PieChart>
                    </ResponsiveContainer>
                 ) : (
                    <div className="text-gray-400 text-sm">No payment data for today</div>
                 )}
             </div>
          </div>

          {/* Category Sales Pie */}
          <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-[0_4px_12px_rgba(0,0,0,0.08)] border border-gray-200 dark:border-gray-700">
             <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2 mb-6">
                <PieChartIcon className="w-5 h-5 text-orange-500" /> Category Distribution
             </h3>
             <div className="h-64 w-full flex items-center justify-center">
                 {categoryData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                                data={categoryData}
                                cx="50%"
                                cy="50%"
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
                            <Legend verticalAlign="bottom" height={36} iconType="circle" />
                        </PieChart>
                    </ResponsiveContainer>
                 ) : (
                    <div className="text-gray-400 text-sm">No sales data for this period</div>
                 )}
             </div>
          </div>
      </div>

      {/* 7. DETAILS MODAL (For Slow Moving & Low Stock Cards) */}
      {viewDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md" onClick={() => setViewDetails(null)}>
          <div className="bg-white dark:bg-gray-900 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] border border-gray-200 dark:border-gray-800 animate-fade-in transform scale-100" onClick={e => e.stopPropagation()}>
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
                         <div key={item.id} className="flex items-center gap-4 p-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
                            <img src={item.image} alt={item.name} className="w-12 h-12 rounded-lg object-cover bg-gray-100 dark:bg-gray-900" />
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
                               <p className={`text-sm font-bold ${item.stock <= 5 ? 'text-red-500' : 'text-gray-900 dark:text-white'}`}>
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
                  className="w-full py-3 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-xl font-bold hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                >
                  Go to Inventory Manager
                </button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};
