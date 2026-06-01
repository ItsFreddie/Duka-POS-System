import React, { useState, useMemo, useEffect, useRef } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell } from 'recharts';
import { Transaction, ShiftRecord, StoreProfile, Expense, Customer, Product } from '../types';
import { Clock, CheckCircle, XCircle, AlertTriangle, FileText, Banknote, CreditCard, ChevronDown, ChevronUp, User, ArrowRight, RotateCcw, Search, Filter, FileDown, History, Plus, X, Phone, LogOut, Printer, Trash2, ClipboardList, Edit3, Target, TrendingUp, Percent } from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';
import { getStockLogs, getAllShifts } from '../utils/db';

// Utility Safe ID (Duplicate for safety/isolation)
const generateId = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 9);

interface FinanceProps {
  products: Product[];
  transactions: Transaction[];
  shift: ShiftRecord | null;
  customers: Customer[];
  onAddCustomer: (customer: Customer) => void;
  onUpdateCustomer: (customer: Customer) => void;
  onDeleteCustomer: (id: string) => void;
  onCustomerDeposit: (customerId: string, amount: number, method: 'Cash' | 'M-Pesa') => void;
  onOpenShift: (cash: number, mpesa: number) => void;
  onCloseShift: (cash: number, mpesa: number) => void;
  onUpdateShift: (cash: number, mpesa: number) => void;
  onPayDebt: (transactionId: string, amount: number, method: 'Cash' | 'M-Pesa') => void;
  onSettleAllDebt: (customerId: string, method: 'Cash' | 'M-Pesa') => void;
  onRefund: (transaction: Transaction) => void;
  onRecordExpense: (amount: number, reason: string, source: 'Cash' | 'M-Pesa', category?: string) => void;
  onSetDueDate?: (transactionId: string, dueDate: string) => void;
  storeProfile: StoreProfile;
}

export const Finance: React.FC<FinanceProps> = ({ products, transactions, shift, customers, onAddCustomer, onUpdateCustomer, onDeleteCustomer, onCustomerDeposit, onOpenShift, onCloseShift, onUpdateShift, onPayDebt, onSettleAllDebt, onRefund, onRecordExpense, onSetDueDate, storeProfile }) => {
  const [activeTab, setActiveTab] = useState<'shift' | 'receipts' | 'debts' | 'expenses' | 'shiftHistory' | 'loyalty' | 'analytics'>('shift');
  const [openingCash, setOpeningCash] = useState('');
  const [openingMpesa, setOpeningMpesa] = useState('');
  const [closingCash, setClosingCash] = useState('');
  const [closingMpesa, setClosingMpesa] = useState('');

  // Filtering State
  const [showHistory, setShowHistory] = useState(false); // Default to false so receipts reset per shift
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [filterPaymentMethod, setFilterPaymentMethod] = useState<string>('All');
  const [filterStatus, setFilterStatus] = useState<string>('All');

  // Customer Management State
  const [isAddCustomerOpen, setIsAddCustomerOpen] = useState(false);
  const [isEditCustomerOpen, setIsEditCustomerOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [expandedCustomerId, setExpandedCustomerId] = useState<string | null>(null);

  // Deposit State
  const [depositModal, setDepositModal] = useState<{ isOpen: boolean; customerId: string | null }>({ isOpen: false, customerId: null });
  const [depositAmount, setDepositAmount] = useState('');
  const [depositMethod, setDepositMethod] = useState<'Cash' | 'M-Pesa'>('Cash');

  // Debt Payment State
  const [payDebtModal, setPayDebtModal] = useState<{ isOpen: boolean; transaction: Transaction | null }>({ isOpen: false, transaction: null });
  const [settleAllDebtModal, setSettleAllDebtModal] = useState<{ isOpen: boolean; customerId: string | null; totalDebt: number }>({ isOpen: false, customerId: null, totalDebt: 0 });
  const [debtAmount, setDebtAmount] = useState<string>('');

  // Receipt Viewer State
  const [selectedReceipt, setSelectedReceipt] = useState<Transaction | null>(null);
  const receiptRef = useRef<HTMLDivElement>(null);

  // All Shifts State for Expenses
  const [allShifts, setAllShifts] = useState<ShiftRecord[]>([]);
  const [isAddExpenseOpen, setIsAddExpenseOpen] = useState(false);
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseReason, setExpenseReason] = useState('');
  const [expenseCategory, setExpenseCategory] = useState('Supplies');
  const [expenseSource, setExpenseSource] = useState<'Cash' | 'M-Pesa'>('Cash');
  const [selectedLoyaltyCustomer, setSelectedLoyaltyCustomer] = useState<Customer | null>(null);
  const [loyaltySortBy, setLoyaltySortBy] = useState<'points' | 'spent' | 'name' | 'visit'>('points');
  
  // Debt Sorting State
  const [debtSortField, setDebtSortField] = useState<'name' | 'phone' | 'totalDebt' | 'creditBalance' | 'lastActivity'>('totalDebt');
  const [debtSortDirection, setDebtSortDirection] = useState<'asc' | 'desc'>('desc');

  // Heatmap State
  const [heatmapSearch, setHeatmapSearch] = useState('');
  const [heatmapCategory, setHeatmapCategory] = useState('All');
  const [heatmapSort, setHeatmapSort] = useState<'margin-desc' | 'margin-asc' | 'profit-desc' | 'sell-desc'>('margin-desc');

  const expenseCategories = ['Supplies', 'Rent', 'Utilities', 'Transport', 'Salaries', 'Other'];

  useEffect(() => {
    const loadShifts = async () => {
      const shifts = await getAllShifts();
      setAllShifts(shifts);
    };
    loadShifts();
  }, [shift]);

  // Sync inputs with shift data if it exists
  useEffect(() => {
    if (shift) {
        if (shift.actualClosingCash !== undefined) setClosingCash(shift.actualClosingCash.toString());
        if (shift.actualClosingMpesa !== undefined) setClosingMpesa(shift.actualClosingMpesa.toString());
    }
  }, [shift]);

  // Derived Data
  const debts = transactions.filter(t => t.paymentMethod === 'Debt' && t.status === 'Pending Debt');
  const totalOutstandingDebt = useMemo(() => customers.reduce((sum, c) => sum + c.totalDebt, 0), [customers]);
  
  const sortedCustomers = useMemo(() => {
    return [...customers].sort((a, b) => {
      let valA: any = a[debtSortField === 'lastActivity' ? 'lastTransactionDate' : debtSortField];
      let valB: any = b[debtSortField === 'lastActivity' ? 'lastTransactionDate' : debtSortField];

      if (debtSortField === 'totalDebt' || debtSortField === 'creditBalance') {
        valA = valA || 0;
        valB = valB || 0;
      } else if (debtSortField === 'lastActivity') {
          valA = valA ? new Date(valA).getTime() : 0;
          valB = valB ? new Date(valB).getTime() : 0;
      } else {
        valA = (valA || '').toString().toLowerCase();
        valB = (valB || '').toString().toLowerCase();
      }

      if (valA < valB) return debtSortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return debtSortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [customers, debtSortField, debtSortDirection]);

  const handleDebtSort = (field: 'name' | 'phone' | 'totalDebt' | 'creditBalance' | 'lastActivity') => {
    if (debtSortField === field) {
      setDebtSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setDebtSortField(field);
      setDebtSortDirection('desc');
    }
  };
  
  // Filter Logic for Receipts
  const filteredTransactions = useMemo(() => {
    return transactions.filter(t => {
      // Current Shift Filter (Default behavior: Reset receipts to none/current shift)
      if (!showHistory && shift?.isOpen) {
         if (new Date(t.date) < new Date(shift.openedAt)) return false;
      }

      // Status Filter
      if (filterStatus !== 'All' && t.status !== filterStatus) return false;
      
      // Payment Method Filter
      if (filterPaymentMethod !== 'All' && t.paymentMethod !== filterPaymentMethod) return false;
      
      // Date Range Filter
      if (filterStartDate) {
         const txDate = new Date(t.date).toISOString().split('T')[0];
         if (txDate < filterStartDate) return false;
      }
      if (filterEndDate) {
         const txDate = new Date(t.date).toISOString().split('T')[0];
         if (txDate > filterEndDate) return false;
      }

      // Search Filter (ID, Customer Name, Items)
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const matchesId = t.id.toLowerCase().includes(term);
        const matchesCustomer = t.customerName?.toLowerCase().includes(term);
        const matchesItems = t.items.some(i => i.name.toLowerCase().includes(term));
        return matchesId || matchesCustomer || matchesItems;
      }

      return true;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [transactions, searchTerm, filterStartDate, filterEndDate, filterPaymentMethod, filterStatus, showHistory, shift]);
  
  // Sales Calculation Logic
  const currentShiftSales = shift && shift.isOpen 
    ? transactions
        .filter(t => new Date(t.date) >= new Date(shift.openedAt) && t.status === 'Completed' && t.paymentMethod !== 'Credit') // Exclude credit usage from cash sales
        .reduce((acc, t) => acc + (t.amountPaid || 0), 0) // Use amountPaid to capture cash/mpesa part only
    : 0;

  const handleOpenShift = (e: React.FormEvent) => {
    e.preventDefault();
    onOpenShift(Number(openingCash), Number(openingMpesa));
    setOpeningCash('');
    setOpeningMpesa('');
  };

  const handleSaveCounts = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateShift(Number(closingCash), Number(closingMpesa));
    alert("Counts saved successfully. You can now export the report.");
  };

  const handleEndShift = () => {
    if(confirm("This will close the shift and log you out. Ensure you have exported your reports. Continue?")) {
        onCloseShift(Number(closingCash), Number(closingMpesa));
    }
  };

  const handleRefundClick = (e: React.MouseEvent, t: Transaction) => {
    e.stopPropagation(); // Prevent opening modal
    if (confirm(`Are you sure you want to refund this sale of ${storeProfile.currency} ${t.total}? This will restore stock.`)) {
      onRefund(t);
    }
  };

  const handleDeleteClick = (c: Customer) => {
      if (c.totalDebt > 0) {
          if (!window.confirm(`Warning: This customer has an outstanding debt of ${storeProfile.currency} ${c.totalDebt}. Deleting will remove this debt record permanently. Are you sure?`)) {
              return;
          }
      } else {
          if (!window.confirm(`Are you sure you want to delete the account for ${c.name}?`)) {
              return;
          }
      }
      
      // Ensure function exists before calling
      if (onDeleteCustomer) {
          onDeleteCustomer(c.id);
      } else {
          console.error("onDeleteCustomer function is missing");
      }
  }

  const handlePayDebtClick = (t: Transaction) => {
    // Force re-render just in case by creating new object reference
    setPayDebtModal({ isOpen: true, transaction: t });
    setDebtAmount((t.total - (t.amountPaid || 0)).toString());
  };

  const confirmPayDebt = (method: 'Cash' | 'M-Pesa') => {
    if (payDebtModal.transaction && debtAmount) {
      onPayDebt(payDebtModal.transaction.id, Number(debtAmount), method);
      setPayDebtModal({ isOpen: false, transaction: null });
      setDebtAmount('');
    }
  };

  const handleSettleAllClick = (e: React.MouseEvent, customerId: string, totalDebt: number) => {
    e.stopPropagation();
    setSettleAllDebtModal({ isOpen: true, customerId, totalDebt });
  };

  const confirmSettleAllDebt = (method: 'Cash' | 'M-Pesa') => {
    if (settleAllDebtModal.customerId) {
      onSettleAllDebt(settleAllDebtModal.customerId, method);
      setSettleAllDebtModal({ isOpen: false, customerId: null, totalDebt: 0 });
    }
  };

  const handleDepositClick = (e: React.MouseEvent, customerId: string) => {
      e.stopPropagation();
      setDepositModal({ isOpen: true, customerId });
  };

  const handleDepositSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (depositModal.customerId && depositAmount) {
          onCustomerDeposit(depositModal.customerId, Number(depositAmount), depositMethod);
          setDepositModal({ isOpen: false, customerId: null });
          setDepositAmount('');
          setDepositMethod('Cash');
          alert("Deposit successful!");
      }
  };

  const handleAddExpenseSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (expenseAmount && expenseReason) {
          onRecordExpense(Number(expenseAmount), expenseReason, expenseSource, expenseCategory);
          setIsAddExpenseOpen(false);
          setExpenseAmount('');
          setExpenseReason('');
          setExpenseCategory('Supplies');
          setExpenseSource('Cash');
          alert("Expense recorded successfully!");
      }
  };

  const clearFilters = () => {
    setSearchTerm('');
    setFilterStartDate('');
    setFilterEndDate('');
    setFilterPaymentMethod('All');
    setFilterStatus('All');
  }

  const handleAddCustomerSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (!newCustomerName) return;
      
      const newCustomer: Customer = {
          id: generateId(),
          name: newCustomerName,
          phone: newCustomerPhone,
          totalDebt: 0,
          creditBalance: 0
      };
      
      onAddCustomer(newCustomer);
      setIsAddCustomerOpen(false);
      setNewCustomerName('');
      setNewCustomerPhone('');
  }

  const handleGenerateMasterStockReport = async () => {
    try {
        const logs = await getStockLogs();
        // Sort logs by date desc
        logs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        const doc = new jsPDF();
        
        // Header
        doc.setFontSize(16);
        doc.text("Stock Movement Master Report", 14, 15);
        doc.setFontSize(10);
        doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 22);
        doc.text(storeProfile.name, 14, 27);

        const tableData = logs.map(log => [
            new Date(log.date).toLocaleString(),
            log.productName,
            log.quantityChanged > 0 ? `+${log.quantityChanged}` : `${log.quantityChanged}`,
            log.newStockLevel,
            log.reason
        ]);

        autoTable(doc, {
            startY: 35,
            head: [['Date/Time', 'Product', 'Change', 'Level', 'Reason']],
            body: tableData,
            theme: 'striped',
            headStyles: { fillColor: [41, 128, 185], textColor: 255 },
            styles: { fontSize: 8 },
            columnStyles: {
                0: { cellWidth: 35 },
                1: { cellWidth: 50 },
                2: { cellWidth: 20, halign: 'right' },
                3: { cellWidth: 20, halign: 'right' },
                4: { cellWidth: 'auto' }
            }
        });

        doc.save(`stock_master_report_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (error) {
        console.error("Failed to generate report", error);
        alert("Could not generate stock report.");
    }
  };

  const handleExportPDF = () => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;

    // Report Header
    doc.setFontSize(16);
    doc.setTextColor(0, 0, 0);
    doc.text(storeProfile.name, pageWidth / 2, 15, { align: 'center' });
    
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(storeProfile.location, pageWidth / 2, 20, { align: 'center' });
    doc.text(`Generated: ${new Date().toLocaleString()}`, pageWidth / 2, 25, { align: 'center' });

    doc.setFontSize(12);
    doc.setTextColor(0);
    doc.text(`Report: ${activeTab === 'shift' ? 'Shift Reconciliation' : activeTab === 'receipts' ? 'Sales Receipts' : activeTab === 'debts' ? 'Customer Debt Accounts' : activeTab === 'expenses' ? 'Expenses Report' : 'Shift History'}`, 14, 35);

    if (activeTab === 'shift') {
        if (!shift) {
            alert("No active shift data found to export.");
            return;
        }
        
        // Shift Summary
        autoTable(doc, {
            startY: 40,
            head: [['Description', 'Amount']],
            body: [
                ['Opening Cash', `${storeProfile.currency} ${shift.openingCash}`],
                ['Opening M-Pesa', `${storeProfile.currency} ${shift.openingMpesa}`],
                ['Total Sales (Current Shift)', `${storeProfile.currency} ${currentShiftSales}`],
                ['Total Expenses', `${storeProfile.currency} ${shift.expenses.reduce((a, b) => a + b.amount, 0)}`],
                ['Expected Cash Closing', `${storeProfile.currency} ${shift.closingCashCalculated}`],
                ['Expected M-Pesa Closing', `${storeProfile.currency} ${shift.closingMpesaCalculated}`],
                ['Actual Cash Closing', shift.actualClosingCash ? `${storeProfile.currency} ${shift.actualClosingCash}` : 'Pending'],
                ['Actual M-Pesa Closing', shift.actualClosingMpesa ? `${storeProfile.currency} ${shift.actualClosingMpesa}` : 'Pending'],
            ],
            theme: 'grid',
            headStyles: { fillColor: [66, 66, 66], textColor: 255 },
            styles: { fontSize: 10 }
        });

        // Expenses Table
        if (shift.expenses.length > 0) {
            const finalY = (doc as any).lastAutoTable.finalY || 40;
            doc.text("Expenses Detail", 14, finalY + 10);
            autoTable(doc, {
                startY: finalY + 15,
                head: [['Time', 'Reason', 'Source', 'Amount']],
                body: shift.expenses.map(e => [
                    new Date(e.date).toLocaleTimeString(),
                    e.reason,
                    e.source || 'Cash', // Default to Cash for backward compatibility
                    `${storeProfile.currency} ${e.amount}`
                ]),
                theme: 'striped',
                headStyles: { fillColor: [220, 53, 69], textColor: 255 }
            });
        }
    } else if (activeTab === 'receipts') {
        autoTable(doc, {
            startY: 40,
            head: [['Date/Time', 'Items', 'Total', 'Method', 'Status']],
            body: filteredTransactions.map(t => [
                new Date(t.date).toLocaleString(),
                `${t.items[0].name} ${t.items.length > 1 ? `+${t.items.length - 1}` : ''}`,
                `${storeProfile.currency} ${t.total}`,
                t.paymentMethod,
                t.status
            ]),
            theme: 'striped',
            headStyles: { fillColor: [41, 128, 185], textColor: 255 },
            styles: { fontSize: 8 }
        });
    } else if (activeTab === 'debts') {
        autoTable(doc, {
            startY: 40,
            head: [['Customer', 'Phone', 'Total Debt']],
            body: sortedCustomers.map(c => [
                c.name,
                c.phone || 'N/A',
                `${storeProfile.currency} ${c.totalDebt}`
            ]),
            theme: 'striped',
            headStyles: { fillColor: [231, 76, 60], textColor: 255 }
        });
    } else if (activeTab === 'expenses') {
        autoTable(doc, {
            startY: 40,
            head: [['Date', 'Category', 'Reason', 'Source', 'Amount']],
            body: allShifts.flatMap(s => s.expenses).sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(exp => [
                new Date(exp.date).toLocaleString(),
                exp.category || 'Uncategorized',
                exp.reason,
                exp.source || 'Cash',
                `${storeProfile.currency} ${exp.amount}`
            ]),
            theme: 'striped',
            headStyles: { fillColor: [220, 53, 69], textColor: 255 }
        });
    } else if (activeTab === 'shiftHistory') {
        autoTable(doc, {
            startY: 40,
            head: [['Date', 'Opened', 'Closed', 'Exp. Cash', 'Act. Cash', 'Exp. M-Pesa', 'Act. M-Pesa', 'Status']],
            body: allShifts.sort((a,b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime()).map(s => [
                new Date(s.date).toLocaleDateString(),
                new Date(s.openedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
                s.closedAt ? new Date(s.closedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '-',
                `${storeProfile.currency} ${s.closingCashCalculated}`,
                s.actualClosingCash !== undefined ? `${storeProfile.currency} ${s.actualClosingCash}` : '-',
                `${storeProfile.currency} ${s.closingMpesaCalculated}`,
                s.actualClosingMpesa !== undefined ? `${storeProfile.currency} ${s.actualClosingMpesa}` : '-',
                s.isOpen ? 'Open' : 'Closed'
            ]),
            theme: 'striped',
            headStyles: { fillColor: [142, 68, 173], textColor: 255 },
            styles: { fontSize: 8 }
        });
    } else if (activeTab === 'loyalty') {
        autoTable(doc, {
            startY: 40,
            head: [['Customer', 'Phone', 'Total Spent', 'Points', 'Last Visit']],
            body: customers.sort((a,b) => (b.loyaltyPoints || 0) - (a.loyaltyPoints || 0)).map(c => [
                c.name,
                c.phone || '-',
                `${storeProfile.currency} ${(c.totalSpent || 0).toLocaleString()}`,
                (c.loyaltyPoints || 0).toLocaleString(),
                c.lastTransactionDate ? new Date(c.lastTransactionDate).toLocaleDateString() : '-'
            ]),
            theme: 'striped',
            headStyles: { fillColor: [52, 152, 219], textColor: 255 }
        });
    }

    doc.save(`duka_report_${activeTab}_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  const handleDownloadReceipt = async () => {
    if (!receiptRef.current || !selectedReceipt) return;

    try {
        const canvas = await html2canvas(receiptRef.current, {
            scale: 2,
            backgroundColor: '#ffffff'
        });
        
        const imgData = canvas.toDataURL('image/png');
        const pdf = new jsPDF('p', 'mm', [80, 200]); // approx 80mm thermal paper width
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
        
        pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
        pdf.save(`receipt_${selectedReceipt.id.slice(-6)}.pdf`);
    } catch (err) {
        console.error("Receipt download failed", err);
        alert("Could not generate receipt image");
    }
  };

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center bg-white dark:bg-gray-900 p-4 rounded-2xl shadow-[0_4px_12px_rgba(0,0,0,0.08)] border border-gray-200 dark:border-gray-800 gap-4">
        <div className="flex gap-4">
            <button
            onClick={() => setActiveTab('shift')}
            className={`pb-2 px-1 font-medium text-sm transition-colors relative ${activeTab === 'shift' ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'}`}
            >
            Shift & Reconciliation
            {activeTab === 'shift' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-primary-600 rounded-t-full"></div>}
            </button>
            <button
            onClick={() => setActiveTab('receipts')}
            className={`pb-2 px-1 font-medium text-sm transition-colors relative ${activeTab === 'receipts' ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'}`}
            >
            Receipts & Refunds
            {activeTab === 'receipts' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-primary-600 rounded-t-full"></div>}
            </button>
            <button
            onClick={() => setActiveTab('debts')}
            className={`pb-2 px-1 font-medium text-sm transition-colors relative ${activeTab === 'debts' ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'}`}
            >
            Debts <span className="ml-1 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-xs px-2 py-0.5 rounded-full">{customers.filter(c => c.totalDebt > 0).length}</span>
            {activeTab === 'debts' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-primary-600 rounded-t-full"></div>}
            </button>
            <button
            onClick={() => setActiveTab('expenses')}
            className={`pb-2 px-1 font-medium text-sm transition-colors relative ${activeTab === 'expenses' ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'}`}
            >
            Expenses
            {activeTab === 'expenses' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-primary-600 rounded-t-full"></div>}
            </button>
            <button
            onClick={() => setActiveTab('shiftHistory')}
            className={`pb-2 px-1 font-medium text-sm transition-colors relative ${activeTab === 'shiftHistory' ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'}`}
            >
            Shift History
            {activeTab === 'shiftHistory' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-primary-600 rounded-t-full"></div>}
            </button>
            <button
            onClick={() => setActiveTab('loyalty')}
            className={`pb-2 px-1 font-medium text-sm transition-colors relative ${activeTab === 'loyalty' ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'}`}
            >
            Loyalty
            {activeTab === 'loyalty' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-primary-600 rounded-t-full"></div>}
            </button>
            <button
            onClick={() => setActiveTab('analytics')}
            className={`pb-2 px-1 font-medium text-sm transition-colors relative ${activeTab === 'analytics' ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'}`}
            >
            Category Margins
            {activeTab === 'analytics' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-primary-600 rounded-t-full"></div>}
            </button>
        </div>
        
        <div className="flex gap-2 w-full xl:w-auto">
            <button 
                onClick={handleGenerateMasterStockReport}
                className="flex-1 xl:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 rounded-xl hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors text-sm font-bold shadow-sm border border-purple-100 dark:border-purple-800"
            >
                <ClipboardList className="w-4 h-4" /> Stock Audit Report
            </button>
            <button 
                onClick={handleExportPDF}
                className="flex-1 xl:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-sm font-bold shadow-sm"
            >
                <FileDown className="w-4 h-4" /> Export Report (PDF)
            </button>
        </div>
      </div>

      {/* SHIFT TAB */}
      {activeTab === 'shift' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-fade-in">
          <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-[0_4px_12px_rgba(0,0,0,0.08)] border border-gray-200 dark:border-gray-800">
            <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-white flex items-center gap-2">
              <Clock className="w-5 h-5 text-primary-600" /> Closing Reconciliation
            </h3>
            {shift && shift.isOpen ? (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                   <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">
                     <p className="text-xs text-gray-500 dark:text-gray-400 font-bold uppercase mb-1">Opening Cash</p>
                     <p className="font-black text-lg dark:text-white">{storeProfile.currency} {shift.openingCash.toLocaleString()}</p>
                   </div>
                   <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">
                     <p className="text-xs text-gray-500 dark:text-gray-400 font-bold uppercase mb-1">Opening M-Pesa</p>
                     <p className="font-black text-lg dark:text-white">{storeProfile.currency} {shift.openingMpesa.toLocaleString()}</p>
                   </div>
                </div>

                {/* Expenses Summary */}
                {shift.expenses.length > 0 && (
                   <div className="p-4 bg-red-50 dark:bg-red-900/10 rounded-xl border border-red-100 dark:border-red-900/30">
                     <p className="text-xs font-bold text-red-700 dark:text-red-300 mb-2 uppercase tracking-wide">Expenses & Withdrawals</p>
                     <ul className="space-y-2 text-sm">
                       {shift.expenses.map(exp => (
                         <li key={exp.id} className="flex justify-between items-center text-red-600 dark:text-red-400">
                           <div className="flex flex-col">
                             <span className="font-medium">{exp.reason}</span>
                             <span className="text-[10px] uppercase bg-white/50 dark:bg-black/30 px-1.5 py-0.5 rounded w-fit mt-0.5">{exp.source || 'Cash'}</span>
                           </div>
                           <span className="font-black">- {exp.amount.toLocaleString()}</span>
                         </li>
                       ))}
                     </ul>
                   </div>
                )}
                
                 <div className="grid grid-cols-2 gap-4">
                   <div className="p-4 bg-blue-50 dark:bg-blue-900/10 rounded-xl border border-blue-100 dark:border-blue-900/30">
                     <p className="text-xs text-blue-600 dark:text-blue-300 mb-1 font-bold uppercase">Expected Cash</p>
                     <p className="font-black text-2xl text-blue-700 dark:text-blue-200">{storeProfile.currency} {shift.closingCashCalculated.toLocaleString()}</p>
                     <p className="text-[10px] text-blue-500 mt-1 font-medium">Net of Expenses & Refunds</p>
                   </div>
                   <div className="p-4 bg-green-50 dark:bg-green-900/10 rounded-xl border border-green-100 dark:border-green-900/30">
                     <p className="text-xs text-green-600 dark:text-green-300 mb-1 font-bold uppercase">Expected M-Pesa</p>
                     <p className="font-black text-2xl text-green-700 dark:text-green-200">{storeProfile.currency} {shift.closingMpesaCalculated.toLocaleString()}</p>
                     <p className="text-[10px] text-green-600/70 dark:text-green-400/70 mt-1 font-medium">Net of Withdrawals</p>
                   </div>
                </div>

                <form onSubmit={handleSaveCounts} className="space-y-4 pt-6 border-t border-gray-100 dark:border-gray-800">
                  <h4 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                      <Edit3 className="w-4 h-4 text-gray-400" /> Enter Actual Count
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="closing-cash" className="block text-xs font-bold mb-1.5 dark:text-gray-300 uppercase">Actual Cash</label>
                      <input 
                        id="closing-cash"
                        name="closingCash"
                        required 
                        type="number" 
                        value={closingCash}
                        onChange={e => setClosingCash(e.target.value)}
                        className="w-full p-3 border border-gray-200 rounded-xl dark:bg-black dark:border-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none font-bold" 
                        placeholder="0.00" 
                      />
                    </div>
                    <div>
                      <label htmlFor="closing-mpesa" className="block text-xs font-bold mb-1.5 dark:text-gray-300 uppercase">Actual M-Pesa</label>
                      <input 
                        id="closing-mpesa"
                        name="closingMpesa"
                        required 
                        type="number" 
                        value={closingMpesa}
                        onChange={e => setClosingMpesa(e.target.value)}
                        className="w-full p-3 border border-gray-200 rounded-xl dark:bg-black dark:border-gray-700 dark:text-white focus:ring-2 focus:ring-green-500 outline-none font-bold" 
                        placeholder="0.00" 
                      />
                    </div>
                  </div>
                  
                  {/* Real-time Variance Calculation */}
                  {(closingCash || closingMpesa) && (
                     <div className="text-sm p-4 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">
                       <div className="flex justify-between mb-2 pb-2 border-b border-gray-200 dark:border-gray-700">
                         <span className="font-medium text-gray-600 dark:text-gray-400">Cash Difference:</span>
                         <span className={`font-black ${Number(closingCash) - shift.closingCashCalculated >= 0 ? "text-green-600" : "text-red-600"}`}>
                            {Number(closingCash) - shift.closingCashCalculated}
                         </span>
                       </div>
                       <div className="flex justify-between">
                         <span className="font-medium text-gray-600 dark:text-gray-400">M-Pesa Difference:</span>
                         <span className={`font-black ${Number(closingMpesa) - shift.closingMpesaCalculated >= 0 ? "text-green-600" : "text-red-600"}`}>
                            {Number(closingMpesa) - shift.closingMpesaCalculated}
                         </span>
                       </div>
                     </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <button type="submit" className="w-full bg-blue-600 text-white py-3.5 rounded-xl hover:bg-blue-700 font-bold shadow-lg shadow-blue-900/20 transform active:scale-95 transition-all">
                        Save Counts
                    </button>
                    <button type="button" onClick={handleEndShift} className="w-full bg-red-600 text-white py-3.5 rounded-xl hover:bg-red-700 font-bold shadow-lg shadow-red-900/20 flex items-center justify-center gap-2 transform active:scale-95 transition-all">
                        <LogOut className="w-4 h-4" /> End Shift
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                <p>Shift is closed. Please start a new shift from the login screen.</p>
              </div>
            )}
          </div>
          
           {/* Summary of Day */}
           <div className="space-y-4">
              <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-[0_4px_12px_rgba(0,0,0,0.08)] border border-gray-200 dark:border-gray-800">
                  <h3 className="font-bold text-gray-800 dark:text-white mb-4 flex items-center gap-2">
                      <Target className="w-5 h-5 text-indigo-500" /> Current Shift Summary
                  </h3>
                  <div className="space-y-3">
                     <div className="flex justify-between p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-800">
                        <span className="text-gray-600 dark:text-gray-400 font-medium">Total Sales</span>
                        <span className="font-black dark:text-white text-lg">
                           {storeProfile.currency} {currentShiftSales.toLocaleString()}
                        </span>
                     </div>
                      <div className="flex justify-between p-3 bg-emerald-50 dark:bg-emerald-900/10 rounded-xl border border-emerald-100 dark:border-emerald-900/30 text-emerald-600 dark:text-emerald-400">
                        <span className="font-medium">Deposits (Credit)</span>
                        <span className="font-bold">
                           {storeProfile.currency} {((shift?.cashDeposits || 0) + (shift?.mpesaDeposits || 0)).toLocaleString()}
                        </span>
                     </div>
                      <div className="flex justify-between p-3 bg-red-50 dark:bg-red-900/10 rounded-xl border border-red-100 dark:border-red-900/30 text-red-600 dark:text-red-400">
                        <span className="font-medium">Total Expenses</span>
                        <span className="font-bold">
                           {storeProfile.currency} {shift?.expenses.reduce((a, b) => a + b.amount, 0).toLocaleString() || 0}
                        </span>
                     </div>
                     <div className="flex justify-between p-3 bg-orange-50 dark:bg-orange-900/10 rounded-xl border border-orange-100 dark:border-orange-900/30 text-orange-600 dark:text-orange-400">
                        <span className="font-medium">Refunds Issued</span>
                        <span className="font-bold">
                           {storeProfile.currency} {((shift?.cashRefunds || 0) + (shift?.mpesaRefunds || 0)).toLocaleString()}
                        </span>
                     </div>
                  </div>
              </div>
           </div>
        </div>
      )}

      {/* RECEIPTS & REFUNDS TAB */}
      {activeTab === 'receipts' && (
        <div className="space-y-4 animate-fade-in">
          {/* Filters */}
          <div className="bg-white dark:bg-gray-900 p-4 rounded-2xl shadow-[0_4px_12px_rgba(0,0,0,0.08)] border border-gray-200 dark:border-gray-800 flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-1 block uppercase tracking-wider">Search</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input 
                  type="text" 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="ID, Customer, Item..."
                  className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-black dark:text-white outline-none focus:ring-2 focus:ring-primary-500 transition-all"
                />
              </div>
            </div>
            
            <div className="flex flex-col">
              <label className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-1 block uppercase tracking-wider">History</label>
              <button 
                onClick={() => setShowHistory(!showHistory)}
                className={`px-4 py-2.5 text-sm font-bold rounded-xl transition-all flex items-center gap-2 border ${showHistory ? 'bg-primary-100 text-primary-700 border-primary-200 dark:bg-primary-900/30 dark:text-primary-400 dark:border-primary-800' : 'bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
              >
                <History className="w-4 h-4" />
                {showHistory ? 'Showing All' : 'Current Shift Only'}
              </button>
            </div>

            <div>
              <label className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-1 block uppercase tracking-wider">Date Range</label>
              <div className="flex items-center gap-2">
                <input 
                  type="date" 
                  value={filterStartDate}
                  onChange={(e) => setFilterStartDate(e.target.value)}
                  className="px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-black dark:text-white outline-none focus:ring-2 focus:ring-primary-500 transition-all font-medium"
                />
                <span className="text-gray-400 font-bold">-</span>
                <input 
                  type="date" 
                  value={filterEndDate}
                  onChange={(e) => setFilterEndDate(e.target.value)}
                  className="px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-black dark:text-white outline-none focus:ring-2 focus:ring-primary-500 transition-all font-medium"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-1 block uppercase tracking-wider">Payment</label>
              <select 
                value={filterPaymentMethod}
                onChange={(e) => setFilterPaymentMethod(e.target.value)}
                className="px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-black dark:text-white outline-none focus:ring-2 focus:ring-primary-500 transition-all font-medium min-w-[120px]"
              >
                <option value="All">All Methods</option>
                <option value="Cash">Cash</option>
                <option value="M-Pesa">M-Pesa</option>
                <option value="Debt">Debt</option>
                <option value="Split">Split</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-1 block uppercase tracking-wider">Status</label>
              <select 
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-black dark:text-white outline-none focus:ring-2 focus:ring-primary-500 transition-all font-medium min-w-[120px]"
              >
                <option value="All">All Status</option>
                <option value="Completed">Completed</option>
                <option value="Refunded">Refunded</option>
                <option value="Pending Debt">Pending</option>
              </select>
            </div>

            <button 
              onClick={clearFilters}
              className="px-4 py-2.5 text-sm font-bold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
            >
              Clear
            </button>
          </div>

          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-[0_4px_12px_rgba(0,0,0,0.08)] border border-gray-200 dark:border-gray-800 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-gray-50 dark:bg-black text-gray-500 dark:text-gray-400 text-sm border-b border-gray-100 dark:border-gray-800">
                  <tr>
                    <th className="p-4 font-bold">Time</th>
                    <th className="p-4 font-bold">Items</th>
                    <th className="p-4 font-bold">Total</th>
                    <th className="p-4 font-bold">Method</th>
                    <th className="p-4 font-bold">Status</th>
                    <th className="p-4 text-right font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {filteredTransactions.slice(0, 100).map(t => (
                    <tr 
                        key={t.id} 
                        onClick={() => setSelectedReceipt(t)}
                        className={`hover:bg-gray-50 dark:hover:bg-gray-800/30 cursor-pointer transition-colors ${t.status === 'Refunded' ? 'opacity-60 bg-red-50/10' : ''}`}
                    >
                      <td className="p-4 text-sm text-gray-600 dark:text-gray-400">
                        <span className="font-bold text-gray-900 dark:text-white">{new Date(t.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                        <div className="text-[10px] text-gray-400 font-medium uppercase mt-0.5">{new Date(t.date).toLocaleDateString()}</div>
                      </td>
                      <td className="p-4">
                        <div className="flex flex-col">
                          <span className="font-bold text-sm dark:text-white">{t.items[0].name} {t.items.length > 1 && `+ ${t.items.length - 1} others`}</span>
                          <span className="text-xs text-gray-400 font-medium">{t.items.reduce((a, b) => a + b.quantity, 0)} items total</span>
                        </div>
                      </td>
                      <td className="p-4 font-black dark:text-white">
                        {t.paymentMethod === 'Debt' && t.status !== 'Refunded' ? (
                            <div>
                                <div>{storeProfile.currency} {t.total.toLocaleString()}</div>
                                <div className="text-xs text-gray-400 font-medium">Paid: {storeProfile.currency} {(t.amountPaid || 0).toLocaleString()}</div>
                            </div>
                        ) : (
                            `${storeProfile.currency} ${t.total.toLocaleString()}`
                        )}
                      </td>
                      <td className="p-4">
                        <div className="flex flex-col">
                          <span className={`flex items-center gap-1 text-sm font-bold ${t.paymentMethod === 'M-Pesa' ? 'text-green-600' : 'text-gray-700 dark:text-gray-300'}`}>
                            {t.paymentMethod === 'M-Pesa' ? <CreditCard className="w-3 h-3" /> : t.paymentMethod === 'Cash' ? <Banknote className="w-3 h-3" /> : t.paymentMethod === 'Split' ? <div className="flex"><Banknote className="w-3 h-3" /><CreditCard className="w-3 h-3" /></div> : <User className="w-3 h-3" />}
                            {t.paymentMethod}
                          </span>
                          {t.mpesaCode && <span className="text-[10px] font-mono text-gray-500 dark:text-gray-400 uppercase mt-0.5 tracking-wider">{t.mpesaCode}</span>}
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex flex-col items-start gap-1">
                            <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${t.status === 'Completed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                              {t.status}
                            </span>
                            {t.status === 'Pending Debt' && (
                                <span className="text-[10px] text-red-500 font-medium whitespace-nowrap">
                                    {(() => {
                                        const now = new Date();
                                        now.setHours(0, 0, 0, 0);
                                        
                                        if (t.dueDate) {
                                            const [year, month, day] = t.dueDate.split('-').map(Number);
                                            const dueDate = new Date(year, month - 1, day);
                                            dueDate.setHours(0, 0, 0, 0);
                                            const diffTime = now.getTime() - dueDate.getTime();
                                            const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
                                            
                                            if (diffDays > 0) {
                                                return diffDays === 1 ? '1 day past due' : `${diffDays} days past due`;
                                            } else if (diffDays === 0) {
                                                return 'Due today';
                                            } else {
                                                const absDays = Math.abs(diffDays);
                                                return absDays === 1 ? 'Due tomorrow' : `Due in ${absDays} days`;
                                            }
                                        } else {
                                            const txDate = new Date(t.date);
                                            txDate.setHours(0, 0, 0, 0);
                                            const diffTime = now.getTime() - txDate.getTime();
                                            const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
                                            if (diffDays === 0) return 'Outstanding today';
                                            if (diffDays === 1) return 'Outstanding 1 day';
                                            return `Outstanding ${diffDays} days`;
                                        }
                                    })()}
                                </span>
                            )}
                        </div>
                      </td>
                      <td className="p-4 text-right">
                         {t.status === 'Completed' && (
                           <button 
                             onClick={(e) => handleRefundClick(e, t)}
                             className="text-xs flex items-center gap-1 ml-auto text-orange-600 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300 font-bold bg-orange-50 dark:bg-orange-900/20 px-2 py-1 rounded-lg hover:bg-orange-100 transition-colors z-10 relative"
                           >
                             <RotateCcw className="w-3 h-3" /> Refund
                           </button>
                         )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredTransactions.length === 0 && (
                  <div className="p-12 text-center text-gray-500 dark:text-gray-500">
                      <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <p className="font-medium">{showHistory ? "No receipts found matching your filters." : "No new receipts in current shift."}</p>
                      {!showHistory && <p className="text-xs mt-1">Turn on 'Show All History' to see past sales.</p>}
                  </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* DEBTS TAB */}
      {activeTab === 'debts' && (
        <div className="space-y-4 animate-fade-in">
            <div className="flex justify-between items-center">
                <h3 className="font-black text-gray-900 dark:text-white text-xl tracking-tight">Customer Accounts & Debt</h3>
                <button 
                  onClick={() => setIsAddCustomerOpen(true)}
                  className="flex items-center gap-2 bg-red-600 text-white px-4 py-2.5 rounded-xl hover:bg-red-700 font-bold shadow-lg shadow-red-900/20 transition-all transform active:scale-95"
                >
                    <Plus className="w-5 h-5" /> Add Customer
                </button>
            </div>

            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-[0_4px_12px_rgba(0,0,0,0.08)] border border-gray-200 dark:border-gray-800 overflow-hidden">
                {customers.length === 0 ? (
                    <div className="p-12 text-center text-gray-500 dark:text-gray-500">
                    <User className="w-12 h-12 mx-auto mb-3 text-red-300" />
                    <p className="font-bold text-lg text-gray-800 dark:text-white">No customer accounts yet</p>
                    <p className="text-sm">Add a customer to start tracking debts.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-red-50 dark:bg-red-900/10 text-red-900 dark:text-red-200 text-sm border-b border-red-100 dark:border-red-900/20">
                        <tr>
                            <th className="p-4 font-bold cursor-pointer hover:bg-red-100/50 transition-colors" onClick={() => handleDebtSort('name')}>
                                <div className="flex items-center gap-1">
                                    Customer Name
                                    {debtSortField === 'name' && (debtSortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                                </div>
                            </th>
                            <th className="p-4 font-bold cursor-pointer hover:bg-red-100/50 transition-colors" onClick={() => handleDebtSort('phone')}>
                                <div className="flex items-center gap-1">
                                    Phone
                                    {debtSortField === 'phone' && (debtSortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                                </div>
                            </th>
                            <th className="p-4 font-bold cursor-pointer hover:bg-red-100/50 transition-colors" onClick={() => handleDebtSort('totalDebt')}>
                                <div className="flex items-center gap-1">
                                    Total Debt
                                    {debtSortField === 'totalDebt' && (debtSortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                                </div>
                            </th>
                            <th className="p-4 font-bold cursor-pointer hover:bg-red-100/50 transition-colors" onClick={() => handleDebtSort('creditBalance')}>
                                <div className="flex items-center gap-1">
                                    Credit Balance
                                    {debtSortField === 'creditBalance' && (debtSortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                                </div>
                            </th>
                            <th className="p-4 font-bold cursor-pointer hover:bg-red-100/50 transition-colors" onClick={() => handleDebtSort('lastActivity')}>
                                <div className="flex items-center gap-1">
                                    Last Activity
                                    {debtSortField === 'lastActivity' && (debtSortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                                </div>
                            </th>
                            <th className="p-4 text-right font-bold">Actions</th>
                        </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {sortedCustomers.map(c => (
                            <React.Fragment key={c.id}>
                                <tr className="hover:bg-gray-50 dark:hover:bg-gray-800/30 cursor-pointer transition-colors" onClick={() => setExpandedCustomerId(expandedCustomerId === c.id ? null : c.id)}>
                                    <td className="p-4 font-bold dark:text-white flex items-center gap-2">
                                        <div className={`p-1 rounded-md transition-colors ${expandedCustomerId === c.id ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'}`}>
                                            {expandedCustomerId === c.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                        </div>
                                        {c.name}
                                    </td>
                                    <td className="p-4 text-gray-500 dark:text-gray-400 font-medium">{c.phone || '-'}</td>
                                    <td className={`p-4 font-black ${c.totalDebt > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400'}`}>
                                        {storeProfile.currency} {c.totalDebt.toLocaleString()}
                                    </td>
                                    <td className={`p-4 font-black ${c.creditBalance && c.creditBalance > 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}`}>
                                        {storeProfile.currency} {(c.creditBalance || 0).toLocaleString()}
                                    </td>
                                    <td className="p-4 text-sm text-gray-500 dark:text-gray-400 font-medium">
                                        {c.lastTransactionDate ? new Date(c.lastTransactionDate).toLocaleDateString() : 'Never'}
                                    </td>
                                    <td className="p-4 text-right text-sm text-gray-400">
                                        <div className="flex justify-end gap-2 items-center">
                                            <button 
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setEditingCustomer(c);
                                                    setNewCustomerName(c.name);
                                                    setNewCustomerPhone(c.phone || '');
                                                    setIsEditCustomerOpen(true);
                                                }}
                                                className="px-3 py-1.5 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40 rounded-lg text-xs font-bold transition-colors border border-blue-100 dark:border-blue-900/30"
                                            >
                                                Edit
                                            </button>
                                            <button 
                                                onClick={(e) => handleDepositClick(e, c.id)}
                                                className="px-3 py-1.5 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/40 rounded-lg text-xs font-bold transition-colors border border-green-100 dark:border-green-900/30"
                                            >
                                                Deposit
                                            </button>
                                            {c.totalDebt > 0 && (
                                                <button 
                                                    onClick={(e) => handleSettleAllClick(e, c.id, c.totalDebt)}
                                                    className="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 rounded-lg text-xs font-bold transition-colors border border-emerald-100 dark:border-emerald-900/30"
                                                >
                                                    Mark as Paid
                                                </button>
                                            )}
                                            <span className="text-xs mr-2 font-bold uppercase tracking-wider text-gray-300">
                                                {expandedCustomerId === c.id ? 'Close' : 'View'}
                                            </span>
                                            <button 
                                                onClick={(e) => { 
                                                    e.stopPropagation(); 
                                                    handleDeleteClick(c); 
                                                }}
                                                className="p-2 bg-red-50 dark:bg-red-900/20 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/40 rounded-full transition-colors z-10 relative"
                                                title="Delete Account"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                                {expandedCustomerId === c.id && (
                                    <tr className="bg-gray-50/50 dark:bg-black/30">
                                        <td colSpan={6} className="p-6">
                                            <div className="pl-2">
                                                <div className="flex items-center justify-between mb-4">
                                                    <h4 className="text-xs font-black uppercase text-gray-400 tracking-widest flex items-center gap-2">
                                                        <History className="w-4 h-4" /> Transaction History
                                                    </h4>
                                                </div>
                                                
                                                {transactions.filter(t => t.customerId === c.id).length === 0 ? (
                                                    <div className="text-sm text-gray-400 italic flex items-center gap-2">
                                                        <CheckCircle className="w-4 h-4" /> No transactions found for this customer.
                                                    </div>
                                                ) : (
                                                    <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
                                                        <table className="w-full text-left text-sm">
                                                            <thead className="bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                                                                <tr>
                                                                    <th className="p-3 font-bold">Date</th>
                                                                    <th className="p-3 font-bold">Items</th>
                                                                    <th className="p-3 font-bold">Total</th>
                                                                    <th className="p-3 font-bold">Paid</th>
                                                                    <th className="p-3 font-bold">Status</th>
                                                                    <th className="p-3 font-bold">Due Date</th>
                                                                    <th className="p-3 font-bold text-right">Action</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800 bg-white dark:bg-gray-900">
                                                                {transactions.filter(t => t.customerId === c.id).sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(t => (
                                                                    <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                                                                        <td className="p-3 text-gray-600 dark:text-gray-400">
                                                                            <div className="font-medium">{new Date(t.date).toLocaleDateString()}</div>
                                                                            <div className="text-xs">{new Date(t.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                                                                        </td>
                                                                        <td className="p-3">
                                                                            <div className="text-gray-900 dark:text-white font-medium line-clamp-1 max-w-[200px]" title={t.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}>
                                                                                {t.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}
                                                                            </div>
                                                                        </td>
                                                                        <td className="p-3 font-bold text-gray-900 dark:text-white">
                                                                            {storeProfile.currency} {t.total.toLocaleString()}
                                                                        </td>
                                                                        <td className="p-3 font-bold text-green-600 dark:text-green-400">
                                                                            {storeProfile.currency} {(t.amountPaid || 0).toLocaleString()}
                                                                        </td>
                                                                        <td className="p-3">
                                                                            <div className="flex flex-col items-start gap-1">
                                                                                <span className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                                                                                    t.status === 'Completed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                                                                                    t.status === 'Pending Debt' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                                                                                    'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400'
                                                                                }`}>
                                                                                    {t.status}
                                                                                </span>
                                                                                {t.status === 'Pending Debt' && (
                                                                                    <span className="text-[10px] text-red-500 font-medium whitespace-nowrap">
                                                                                        {(() => {
                                                                                            const now = new Date();
                                                                                            now.setHours(0, 0, 0, 0);
                                                                                            
                                                                                            if (t.dueDate) {
                                                                                                const [year, month, day] = t.dueDate.split('-').map(Number);
                                                                                                const dueDate = new Date(year, month - 1, day);
                                                                                                dueDate.setHours(0, 0, 0, 0);
                                                                                                const diffTime = now.getTime() - dueDate.getTime();
                                                                                                const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
                                                                                                
                                                                                                if (diffDays > 0) {
                                                                                                    return diffDays === 1 ? '1 day past due' : `${diffDays} days past due`;
                                                                                                } else if (diffDays === 0) {
                                                                                                    return 'Due today';
                                                                                                } else {
                                                                                                    const absDays = Math.abs(diffDays);
                                                                                                    return absDays === 1 ? 'Due tomorrow' : `Due in ${absDays} days`;
                                                                                                }
                                                                                            } else {
                                                                                                const txDate = new Date(t.date);
                                                                                                txDate.setHours(0, 0, 0, 0);
                                                                                                const diffTime = now.getTime() - txDate.getTime();
                                                                                                const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
                                                                                                if (diffDays === 0) return 'Outstanding today';
                                                                                                if (diffDays === 1) return 'Outstanding 1 day';
                                                                                                return `Outstanding ${diffDays} days`;
                                                                                            }
                                                                                        })()}
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                        </td>
                                                                        <td className="p-3">
                                                                            {t.status === 'Pending Debt' ? (
                                                                                <input 
                                                                                    type="date" 
                                                                                    value={t.dueDate || ''}
                                                                                    onChange={(e) => onSetDueDate && onSetDueDate(t.id, e.target.value)}
                                                                                    className="px-2 py-1 text-xs border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-black dark:text-white outline-none focus:ring-1 focus:ring-primary-500"
                                                                                />
                                                                            ) : (
                                                                                <span className="text-gray-400 text-xs">-</span>
                                                                            )}
                                                                        </td>
                                                                        <td className="p-3 text-right">
                                                                            {t.status === 'Pending Debt' && (
                                                                                <button 
                                                                                    onClick={(e) => { e.stopPropagation(); handlePayDebtClick(t); }}
                                                                                    className="px-3 py-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400 dark:hover:bg-emerald-900/40 rounded-lg transition-colors text-xs font-bold border border-emerald-200 dark:border-emerald-800/50"
                                                                                >
                                                                                    Settle
                                                                                </button>
                                                                            )}
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </React.Fragment>
                        ))}
                        </tbody>
                    </table>
                    </div>
                )}
            </div>
            
             {customers.length > 0 && (
                <div className="mt-4 flex justify-end">
                    <div className="bg-white dark:bg-gray-900 px-8 py-5 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-[0_4px_12px_rgba(0,0,0,0.08)] flex flex-col items-end">
                        <span className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1">Total Outstanding Debt</span>
                        <span className="text-4xl font-black text-red-600 dark:text-red-400 tracking-tight">
                            {storeProfile.currency} {totalOutstandingDebt.toLocaleString()}
                        </span>
                    </div>
                </div>
            )}
        </div>
      )}

      {/* EXPENSES TAB */}
      {activeTab === 'expenses' && (
        <div className="animate-fade-in space-y-6">
            <div className="flex justify-between items-center">
                <h3 className="text-xl font-black text-gray-900 dark:text-white flex items-center gap-2">
                    <Banknote className="w-6 h-6 text-red-500" /> Expenses Management
                </h3>
                <button 
                    onClick={() => setIsAddExpenseOpen(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold transition-colors shadow-sm"
                >
                    <Plus className="w-4 h-4" /> Add Expense
                </button>
            </div>

            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-[0_4px_12px_rgba(0,0,0,0.08)] border border-gray-200 dark:border-gray-800 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider text-[10px]">
                            <tr>
                                <th className="p-4">Date</th>
                                <th className="p-4">Category</th>
                                <th className="p-4">Reason</th>
                                <th className="p-4">Source</th>
                                <th className="p-4 text-right">Amount</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                            {allShifts.flatMap(s => s.expenses).sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(exp => (
                                <tr key={exp.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                                    <td className="p-4 text-gray-600 dark:text-gray-400">
                                        <div className="font-medium">{new Date(exp.date).toLocaleDateString()}</div>
                                        <div className="text-xs">{new Date(exp.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                                    </td>
                                    <td className="p-4">
                                        <span className="px-2 py-1 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-md text-xs font-bold uppercase tracking-wider">
                                            {exp.category || 'Uncategorized'}
                                        </span>
                                    </td>
                                    <td className="p-4 font-medium text-gray-900 dark:text-white">{exp.reason}</td>
                                    <td className="p-4">
                                        <span className={`px-2 py-1 rounded-md text-xs font-bold uppercase tracking-wider ${exp.source === 'Cash' ? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'}`}>
                                            {exp.source || 'Cash'}
                                        </span>
                                    </td>
                                    <td className="p-4 text-right font-black text-red-600 dark:text-red-400">
                                        {storeProfile.currency} {exp.amount.toLocaleString()}
                                    </td>
                                </tr>
                            ))}
                            {allShifts.flatMap(s => s.expenses).length === 0 && (
                                <tr>
                                    <td colSpan={5} className="p-8 text-center text-gray-500 dark:text-gray-400 font-medium">
                                        No expenses recorded yet.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
      )}

      {activeTab === 'shiftHistory' && (
        <div className="animate-fade-in space-y-6">
            <div className="flex justify-between items-center">
                <h3 className="text-xl font-black text-gray-900 dark:text-white flex items-center gap-2">
                    <History className="w-6 h-6 text-primary-500" /> Shift History
                </h3>
            </div>

            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-[0_4px_12px_rgba(0,0,0,0.08)] border border-gray-200 dark:border-gray-800 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider text-[10px]">
                            <tr>
                                <th className="p-4">Date</th>
                                <th className="p-4">Opened At</th>
                                <th className="p-4">Closed At</th>
                                <th className="p-4 text-right">Expected Cash</th>
                                <th className="p-4 text-right">Actual Cash</th>
                                <th className="p-4 text-right">Expected M-Pesa</th>
                                <th className="p-4 text-right">Actual M-Pesa</th>
                                <th className="p-4 text-center">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                            {allShifts.sort((a,b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime()).map(s => (
                                <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                                    <td className="p-4 text-gray-900 dark:text-white font-medium">
                                        {new Date(s.date).toLocaleDateString()}
                                    </td>
                                    <td className="p-4 text-gray-600 dark:text-gray-400">
                                        {new Date(s.openedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                    </td>
                                    <td className="p-4 text-gray-600 dark:text-gray-400">
                                        {s.closedAt ? new Date(s.closedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '-'}
                                    </td>
                                    <td className="p-4 text-right font-medium text-gray-900 dark:text-white">
                                        {storeProfile.currency} {s.closingCashCalculated.toLocaleString()}
                                    </td>
                                    <td className="p-4 text-right font-bold text-gray-900 dark:text-white">
                                        {s.actualClosingCash !== undefined ? `${storeProfile.currency} ${s.actualClosingCash.toLocaleString()}` : '-'}
                                    </td>
                                    <td className="p-4 text-right font-medium text-gray-900 dark:text-white">
                                        {storeProfile.currency} {s.closingMpesaCalculated.toLocaleString()}
                                    </td>
                                    <td className="p-4 text-right font-bold text-gray-900 dark:text-white">
                                        {s.actualClosingMpesa !== undefined ? `${storeProfile.currency} ${s.actualClosingMpesa.toLocaleString()}` : '-'}
                                    </td>
                                    <td className="p-4 text-center">
                                        <span className={`px-2 py-1 rounded-md text-xs font-bold uppercase tracking-wider ${s.isOpen ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}>
                                            {s.isOpen ? 'Open' : 'Closed'}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                            {allShifts.length === 0 && (
                                <tr>
                                    <td colSpan={8} className="p-8 text-center text-gray-500 dark:text-gray-400 font-medium">
                                        No shifts recorded yet.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
      )}

      {/* Settle All Debt Modal */}
      {settleAllDebtModal.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
           <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border border-gray-200 dark:border-gray-800 transform scale-100 animate-fade-in">
             <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50 dark:bg-black/50">
              <h3 className="text-xl font-black text-gray-900 dark:text-white tracking-tight">Settle All Debt</h3>
              <button onClick={() => setSettleAllDebtModal({isOpen: false, customerId: null, totalDebt: 0})} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="p-6">
               <div className="mb-8 text-center">
                 <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mb-2">Total Amount Due</p>
                 <p className="text-4xl font-black text-gray-900 dark:text-white">
                    {storeProfile.currency} {settleAllDebtModal.totalDebt.toLocaleString()}
                 </p>
               </div>

               <p className="text-center text-sm font-bold text-gray-600 dark:text-gray-300 mb-4">Select Payment Method</p>
               <div className="space-y-3">
                 <button 
                   onClick={() => confirmSettleAllDebt('Cash')}
                   className="w-full py-4 px-6 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-2xl flex items-center justify-between group transition-all border border-transparent hover:border-gray-300 dark:hover:border-gray-600"
                 >
                   <div className="flex items-center gap-3">
                     <div className="bg-white dark:bg-gray-900 p-2 rounded-xl shadow-sm">
                       <Banknote className="w-6 h-6 text-gray-700 dark:text-gray-300" />
                     </div>
                     <span className="font-bold text-gray-900 dark:text-white">Cash</span>
                   </div>
                   <div className="w-5 h-5 rounded-full border-2 border-gray-300 dark:border-gray-600 group-hover:border-gray-500"></div>
                 </button>

                 <button 
                   onClick={() => confirmSettleAllDebt('M-Pesa')}
                   className="w-full py-4 px-6 bg-green-50 dark:bg-green-900/10 hover:bg-green-100 dark:hover:bg-green-900/30 rounded-2xl flex items-center justify-between group transition-all border border-transparent hover:border-green-300 dark:hover:border-green-800"
                 >
                   <div className="flex items-center gap-3">
                     <div className="bg-white dark:bg-gray-900 p-2 rounded-xl shadow-sm">
                       <CreditCard className="w-6 h-6 text-green-600" />
                     </div>
                     <span className="font-bold text-green-700 dark:text-green-400">M-Pesa</span>
                   </div>
                   <div className="w-5 h-5 rounded-full border-2 border-green-200 dark:border-green-800 group-hover:border-green-400"></div>
                 </button>
               </div>
            </div>
          </div>
        </div>
      )}

      {/* Pay Debt Modal */}
      {payDebtModal.isOpen && payDebtModal.transaction && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
           <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border border-gray-200 dark:border-gray-800 transform scale-100 animate-fade-in">
             <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50 dark:bg-black/50">
              <h3 className="text-xl font-black text-gray-900 dark:text-white tracking-tight">Settle Debt</h3>
              <button onClick={() => setPayDebtModal({isOpen: false, transaction: null})} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="p-6">
               <div className="mb-8 text-center">
                 <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mb-2">Amount Due</p>
                 <p className="text-4xl font-black text-gray-900 dark:text-white">
                    {storeProfile.currency} {(payDebtModal.transaction.total - (payDebtModal.transaction.amountPaid || 0)).toLocaleString()}
                 </p>
               </div>
               
               <div className="mb-6">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1 text-center">Payment Amount</label>
                    <input 
                        type="number" 
                        value={debtAmount} 
                        onChange={(e) => setDebtAmount(e.target.value)}
                        max={payDebtModal.transaction.total - (payDebtModal.transaction.amountPaid || 0)}
                        className="w-full p-4 text-center text-2xl font-black border border-gray-200 rounded-xl dark:bg-black dark:border-gray-700 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                    />
               </div>

               <p className="text-center text-sm font-bold text-gray-600 dark:text-gray-300 mb-4">Select Payment Method</p>
               <div className="space-y-3">
                 <button 
                   onClick={() => confirmPayDebt('Cash')}
                   className="w-full py-4 px-6 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-2xl flex items-center justify-between group transition-all border border-transparent hover:border-gray-300 dark:hover:border-gray-600"
                 >
                   <div className="flex items-center gap-3">
                     <div className="bg-white dark:bg-gray-900 p-2 rounded-xl shadow-sm">
                       <Banknote className="w-6 h-6 text-gray-700 dark:text-gray-300" />
                     </div>
                     <span className="font-bold text-gray-900 dark:text-white">Cash</span>
                   </div>
                   <div className="w-5 h-5 rounded-full border-2 border-gray-300 dark:border-gray-600 group-hover:border-gray-500"></div>
                 </button>

                 <button 
                   onClick={() => confirmPayDebt('M-Pesa')}
                   className="w-full py-4 px-6 bg-green-50 dark:bg-green-900/10 hover:bg-green-100 dark:hover:bg-green-900/30 rounded-2xl flex items-center justify-between group transition-all border border-transparent hover:border-green-300 dark:hover:border-green-800"
                 >
                   <div className="flex items-center gap-3">
                     <div className="bg-white dark:bg-gray-900 p-2 rounded-xl shadow-sm">
                       <CreditCard className="w-6 h-6 text-green-600" />
                     </div>
                     <span className="font-bold text-green-800 dark:text-green-300">M-Pesa</span>
                   </div>
                   <div className="w-5 h-5 rounded-full border-2 border-green-300 dark:border-green-700 group-hover:border-green-500"></div>
                 </button>
               </div>
            </div>
           </div>
        </div>
      )}

      {/* Edit Customer Modal */}
      {isEditCustomerOpen && editingCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
           <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-fade-in border border-gray-200 dark:border-gray-800 transform scale-100">
             <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50 dark:bg-black/50">
              <h3 className="text-xl font-black text-gray-900 dark:text-white tracking-tight">Edit Customer</h3>
              <button onClick={() => { setIsEditCustomerOpen(false); setEditingCustomer(null); }} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            <form onSubmit={(e) => {
                e.preventDefault();
                if (newCustomerName.trim()) {
                    onUpdateCustomer({
                        ...editingCustomer,
                        name: newCustomerName.trim(),
                        phone: newCustomerPhone.trim()
                    });
                    setIsEditCustomerOpen(false);
                    setEditingCustomer(null);
                    setNewCustomerName('');
                    setNewCustomerPhone('');
                }
            }} className="p-6 space-y-5">
              <div>
                <label htmlFor="edit-customer-name" className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Name</label>
                <input 
                  id="edit-customer-name"
                  name="name"
                  required
                  type="text"
                  value={newCustomerName}
                  onChange={e => setNewCustomerName(e.target.value)}
                  placeholder="e.g. Mama John"
                  className="w-full p-3 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-black dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium"
                />
              </div>
              <div>
                <label htmlFor="edit-customer-phone" className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Phone (Optional)</label>
                <input 
                  id="edit-customer-phone"
                  name="phone"
                  type="tel"
                  value={newCustomerPhone}
                  onChange={e => setNewCustomerPhone(e.target.value)}
                  placeholder="e.g. 0712345678"
                  className="w-full p-3 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-black dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium"
                />
              </div>
              <button 
                type="submit" 
                className="w-full py-3.5 bg-blue-600 text-white rounded-xl font-bold shadow-lg shadow-blue-900/20 hover:bg-blue-700 active:scale-95 transition-all"
              >
                Save Changes
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Add Customer Modal */}
      {isAddCustomerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
           <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-fade-in border border-gray-200 dark:border-gray-800 transform scale-100">
             <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50 dark:bg-black/50">
              <h3 className="text-xl font-black text-gray-900 dark:text-white tracking-tight">New Customer Account</h3>
              <button onClick={() => setIsAddCustomerOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            <form onSubmit={handleAddCustomerSubmit} className="p-6 space-y-5">
              <div>
                <label htmlFor="customer-name" className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Name</label>
                <input 
                  id="customer-name"
                  name="name"
                  required
                  type="text"
                  value={newCustomerName}
                  onChange={e => setNewCustomerName(e.target.value)}
                  placeholder="e.g. Mama John"
                  className="w-full p-3 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-black dark:text-white focus:ring-2 focus:ring-red-500 outline-none transition-all font-medium"
                />
              </div>
              <div>
                <label htmlFor="customer-phone" className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Phone (Optional)</label>
                <input 
                  id="customer-phone"
                  name="phone"
                  type="tel"
                  value={newCustomerPhone}
                  onChange={e => setNewCustomerPhone(e.target.value)}
                  placeholder="07..."
                  className="w-full p-3 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-black dark:text-white focus:ring-2 focus:ring-red-500 outline-none transition-all font-medium"
                />
              </div>
              <button type="submit" className="w-full bg-red-600 text-white py-3.5 rounded-xl hover:bg-red-700 font-bold shadow-lg shadow-red-900/20 transform active:scale-95 transition-all">
                Create Account
              </button>
            </form>
           </div>
        </div>
      )}

      {/* Receipt Viewer Modal (Thermal Design) */}
      {selectedReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={() => setSelectedReceipt(null)}>
            <div className="relative w-full max-w-[340px] animate-fade-in" onClick={e => e.stopPropagation()}>
                <div ref={receiptRef} className="bg-white text-black p-6 shadow-2xl rounded-sm">
                    {/* Header */}
                    <div className="text-center mb-4 border-b-2 border-dashed border-gray-300 pb-4">
                         {storeProfile.logoUrl && <img src={storeProfile.logoUrl} alt="Logo" className="w-16 h-16 mx-auto mb-2 object-contain grayscale" />}
                        <h2 className="font-bold text-lg uppercase tracking-wider mb-1">{storeProfile.name}</h2>
                        <p className="text-xs text-gray-600 mb-1">{storeProfile.location}</p>
                        <p className="text-xs text-gray-500">{new Date(selectedReceipt.date).toLocaleString()}</p>
                    </div>

                    {/* Receipt Body */}
                    <div className="mb-4 text-xs font-mono space-y-2">
                        {selectedReceipt.items.map((item, i) => (
                            <div key={i} className="flex justify-between items-start">
                                <div>
                                    <div className="font-bold">{item.name}</div>
                                    <div className="text-gray-500">{item.quantity} x {item.price}</div>
                                </div>
                                <div className="font-bold">{item.quantity * item.price}</div>
                            </div>
                        ))}
                    </div>

                    {/* Totals */}
                    <div className="border-t-2 border-dashed border-gray-300 pt-2 mb-4 font-mono">
                        {selectedReceipt.subtotal !== undefined && selectedReceipt.discount !== undefined && selectedReceipt.discount > 0 && (
                            <>
                                <div className="flex justify-between text-xs text-gray-600 mb-1">
                                    <span>Subtotal</span>
                                    <span>{storeProfile.currency} {selectedReceipt.subtotal.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between text-xs text-gray-600 mb-1">
                                    <span>Discount</span>
                                    <span>-{storeProfile.currency} {selectedReceipt.discount.toLocaleString()}</span>
                                </div>
                            </>
                        )}
                        <div className="flex justify-between text-sm font-bold mb-1">
                            <span>TOTAL</span>
                            <span>{storeProfile.currency} {selectedReceipt.total.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-xs text-gray-600">
                             <span>Payment:</span>
                             <span className="uppercase">{selectedReceipt.paymentMethod}</span>
                        </div>
                        {selectedReceipt.cashTendered !== undefined && (
                            <div className="flex justify-between text-xs text-gray-600">
                                <span>Cash Tendered:</span>
                                <span>{storeProfile.currency} {selectedReceipt.cashTendered.toLocaleString()}</span>
                            </div>
                        )}
                        {selectedReceipt.changeGiven !== undefined && selectedReceipt.changeGiven > 0 && (
                            <div className="flex justify-between text-xs text-gray-600">
                                <span>Change:</span>
                                <span>{storeProfile.currency} {selectedReceipt.changeGiven.toLocaleString()}</span>
                            </div>
                        )}
                        {selectedReceipt.mpesaCode && (
                            <div className="flex justify-between text-xs text-gray-600">
                                <span>Ref:</span>
                                <span>{selectedReceipt.mpesaCode}</span>
                            </div>
                        )}
                        <div className="mt-2 text-[10px] text-center text-gray-400">
                            Receipt ID: #{selectedReceipt.id.slice(-6).toUpperCase()}
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="text-center text-[10px] font-bold uppercase tracking-widest text-gray-400">
                        Thank You!
                    </div>
                </div>

                {/* Actions */}
                <div className="absolute -right-12 top-0 flex flex-col gap-2">
                    <button 
                        onClick={() => setSelectedReceipt(null)}
                        className="bg-white/10 hover:bg-white/20 text-white p-2 rounded-full backdrop-blur-md transition-colors"
                    >
                        <X className="w-6 h-6" />
                    </button>
                    <button 
                        onClick={handleDownloadReceipt}
                        className="bg-primary-600 hover:bg-primary-500 text-white p-2 rounded-full shadow-lg transition-colors"
                        title="Download Receipt"
                    >
                        <Printer className="w-6 h-6" />
                    </button>
                </div>
            </div>
        </div>
      )}
      {/* Deposit Modal */}
      {depositModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-sm overflow-hidden border border-gray-200 dark:border-gray-800">
            <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50 dark:bg-black/20">
              <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <Banknote className="w-5 h-5 text-green-500" /> Deposit Funds
              </h3>
              <button 
                onClick={() => setDepositModal({ isOpen: false, customerId: null })}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleDepositSubmit} className="p-6 space-y-4">
               {(() => {
                 const destCustomer = customers.find(c => c.id === depositModal.customerId);
                 if (destCustomer && destCustomer.totalDebt > 0) {
                   return (
                     <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 p-3 rounded-lg flex items-start gap-2 mb-2">
                       <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                       <p className="text-xs text-amber-800 dark:text-amber-400 leading-tight font-medium">
                         Customer currently owes <span className="font-bold">{storeProfile.currency} {destCustomer.totalDebt.toLocaleString()}</span>. Deposited funds will automatically pay off existing debt before adding to their credit balance.
                       </p>
                     </div>
                   );
                 }
                 return null;
               })()}
               <div>
                  <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Amount ({storeProfile.currency})</label>
                  <input 
                    type="number" 
                    required
                    min="1"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    className="w-full p-3 border border-gray-200 dark:border-gray-700 rounded-xl dark:bg-black dark:text-white font-bold text-lg outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="0.00"
                  />
               </div>
               <div>
                  <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Payment Method</label>
                  <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setDepositMethod('Cash')}
                        className={`p-3 rounded-xl border font-bold text-sm flex items-center justify-center gap-2 ${depositMethod === 'Cash' ? 'bg-gray-900 text-white border-gray-900 dark:bg-white dark:text-black' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700'}`}
                      >
                          <Banknote className="w-4 h-4" /> Cash
                      </button>
                      <button
                        type="button"
                        onClick={() => setDepositMethod('M-Pesa')}
                        className={`p-3 rounded-xl border font-bold text-sm flex items-center justify-center gap-2 ${depositMethod === 'M-Pesa' ? 'bg-green-600 text-white border-green-600' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700'}`}
                      >
                          <CreditCard className="w-4 h-4" /> M-Pesa
                      </button>
                  </div>
               </div>
               <button 
                 type="submit" 
                 className="w-full py-3.5 bg-green-600 text-white rounded-xl font-bold shadow-lg shadow-green-900/20 hover:bg-green-700 active:scale-95 transition-all"
               >
                 Confirm Deposit
               </button>
            </form>
          </div>
        </div>
      )}

      {/* Add Expense Modal */}
      {isAddExpenseOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
           <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-fade-in border border-gray-200 dark:border-gray-800 transform scale-100">
             <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50 dark:bg-black/50">
              <h3 className="text-xl font-black text-gray-900 dark:text-white tracking-tight">Record Expense</h3>
              <button onClick={() => setIsAddExpenseOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            <form onSubmit={handleAddExpenseSubmit} className="p-6 space-y-5">
              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Amount</label>
                <input 
                  required
                  type="number"
                  min="1"
                  value={expenseAmount}
                  onChange={e => setExpenseAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full p-3 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-black dark:text-white focus:ring-2 focus:ring-red-500 outline-none transition-all font-medium"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Category</label>
                <select 
                  value={expenseCategory}
                  onChange={e => setExpenseCategory(e.target.value)}
                  className="w-full p-3 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-black dark:text-white focus:ring-2 focus:ring-red-500 outline-none transition-all font-medium"
                >
                  {expenseCategories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Reason / Description</label>
                <input 
                  required
                  type="text"
                  value={expenseReason}
                  onChange={e => setExpenseReason(e.target.value)}
                  placeholder="e.g. Bought pens"
                  className="w-full p-3 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-black dark:text-white focus:ring-2 focus:ring-red-500 outline-none transition-all font-medium"
                />
              </div>
              <div>
                 <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Source of Funds</label>
                 <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={() => setExpenseSource('Cash')}
                        className={`flex-1 py-3 px-4 rounded-xl font-bold flex items-center justify-center gap-2 border transition-all ${expenseSource === 'Cash' ? 'bg-gray-800 text-white border-transparent' : 'bg-white dark:bg-black border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'}`}
                    >
                        <Banknote className="w-4 h-4" /> Cash
                    </button>
                    <button
                        type="button"
                        onClick={() => setExpenseSource('M-Pesa')}
                        className={`flex-1 py-3 px-4 rounded-xl font-bold flex items-center justify-center gap-2 border transition-all ${expenseSource === 'M-Pesa' ? 'bg-green-600 text-white border-transparent' : 'bg-white dark:bg-black border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'}`}
                    >
                        <CreditCard className="w-4 h-4" /> M-Pesa
                    </button>
                 </div>
              </div>
              <button type="submit" className="w-full bg-red-600 text-white py-3.5 rounded-xl hover:bg-red-700 font-bold shadow-lg shadow-red-900/20 transform active:scale-95 transition-all">
                Save Expense
              </button>
            </form>
           </div>
        </div>
      )}

      {/* LOYALTY TAB */}
      {activeTab === 'loyalty' && (
        <div className="flex-1 bg-white dark:bg-gray-900 rounded-2xl shadow-[0_4px_12px_rgba(0,0,0,0.08)] border border-gray-200 dark:border-gray-800 overflow-hidden animate-fade-in flex flex-col min-h-0">
            <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shrink-0">
                 <div className="flex flex-col gap-1">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <Target className="w-5 h-5 text-primary-600" /> Customer Loyalty Program
                    </h3>
                    <div className="text-sm text-gray-500 font-medium">
                        1 Point per {storeProfile.currency} 100 spent
                    </div>
                 </div>
                 
                 <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
                    <span className="text-xs font-bold text-gray-500 px-2 uppercase">Sort By:</span>
                    <select 
                        value={loyaltySortBy}
                        onChange={(e) => setLoyaltySortBy(e.target.value as any)}
                        className="bg-white dark:bg-gray-900 border-none text-sm font-medium rounded-md py-1.5 pl-3 pr-8 focus:ring-2 focus:ring-primary-500 cursor-pointer"
                    >
                        <option value="points">Points (High-Low)</option>
                        <option value="spent">Total Spent (High-Low)</option>
                        <option value="visit">Last Visit (Recent)</option>
                        <option value="name">Name (A-Z)</option>
                    </select>
                 </div>
            </div>
            <div className="flex-1 overflow-y-auto">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-gray-50 dark:bg-black text-gray-500 dark:text-gray-400 text-sm border-b border-gray-100 dark:border-gray-800 sticky top-0 z-10">
                        <tr>
                            <th className="p-4 font-bold">Customer</th>
                            <th className="p-4 font-bold">Phone</th>
                            <th className="p-4 font-bold text-right">Total Spent</th>
                            <th className="p-4 font-bold text-right">Loyalty Points</th>
                            <th className="p-4 font-bold text-right">Last Visit</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {customers.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="p-8 text-center text-gray-400">No customers found. Add customers at checkout to start tracking loyalty.</td>
                            </tr>
                        ) : (
                            customers.sort((a,b) => {
                                if (loyaltySortBy === 'points') return (b.loyaltyPoints || 0) - (a.loyaltyPoints || 0);
                                if (loyaltySortBy === 'spent') return (b.totalSpent || 0) - (a.totalSpent || 0);
                                if (loyaltySortBy === 'name') return a.name.localeCompare(b.name);
                                if (loyaltySortBy === 'visit') return new Date(b.lastTransactionDate || 0).getTime() - new Date(a.lastTransactionDate || 0).getTime();
                                return 0;
                            }).map(c => (
                                <tr 
                                    key={c.id} 
                                    onClick={() => setSelectedLoyaltyCustomer(c)}
                                    className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors cursor-pointer"
                                >
                                    <td className="p-4 font-bold text-gray-900 dark:text-white">
                                        <div className="flex items-center gap-2">
                                            <div className="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 flex items-center justify-center font-bold text-xs">
                                                {c.name.charAt(0).toUpperCase()}
                                            </div>
                                            {c.name}
                                        </div>
                                    </td>
                                    <td className="p-4 text-gray-600 dark:text-gray-400 font-mono text-sm">{c.phone || '-'}</td>
                                    <td className="p-4 text-right font-mono font-medium text-gray-900 dark:text-white">
                                        {storeProfile.currency} {(c.totalSpent || 0).toLocaleString()}
                                    </td>
                                    <td className="p-4 text-right">
                                        <span className={`px-2.5 py-1 rounded-lg font-bold text-xs ${
                                            (c.loyaltyPoints || 0) > 100 
                                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' 
                                            : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400'
                                        }`}>
                                            {(c.loyaltyPoints || 0).toLocaleString()} pts
                                        </span>
                                    </td>
                                    <td className="p-4 text-right text-sm text-gray-500">
                                        {c.lastTransactionDate ? new Date(c.lastTransactionDate).toLocaleDateString() : '-'}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
      )}

      {/* Customer Transaction History Modal */}
      {selectedLoyaltyCustomer && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in" onClick={() => setSelectedLoyaltyCustomer(null)}>
            <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50/50 dark:bg-black/20">
                    <div>
                        <h3 className="text-xl font-black text-gray-900 dark:text-white">{selectedLoyaltyCustomer.name}</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 font-medium flex items-center gap-2">
                            <span className="bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 px-2 py-0.5 rounded text-xs font-bold">
                                {selectedLoyaltyCustomer.loyaltyPoints || 0} Points
                            </span>
                            <span>•</span>
                            <span>{selectedLoyaltyCustomer.phone || 'No Phone'}</span>
                        </p>
                    </div>
                    <button onClick={() => setSelectedLoyaltyCustomer(null)} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-800 rounded-full transition-colors">
                        <X className="w-6 h-6 text-gray-500" />
                    </button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-0">
                    {transactions.filter(t => t.customerId === selectedLoyaltyCustomer.id).length === 0 ? (
                        <div className="p-12 text-center text-gray-400 flex flex-col items-center">
                            <History className="w-12 h-12 mb-3 opacity-50" />
                            <p>No transaction history found for this customer.</p>
                        </div>
                    ) : (
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-gray-50 dark:bg-black text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider border-b border-gray-100 dark:border-gray-800 sticky top-0">
                                <tr>
                                    <th className="p-4 font-bold">Date</th>
                                    <th className="p-4 font-bold">Items</th>
                                    <th className="p-4 font-bold text-right">Amount</th>
                                    <th className="p-4 font-bold text-right">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                {transactions
                                    .filter(t => t.customerId === selectedLoyaltyCustomer.id)
                                    .sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                                    .map(t => (
                                    <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                                        <td className="p-4 text-sm text-gray-600 dark:text-gray-400">
                                            <div className="font-bold text-gray-900 dark:text-white">{new Date(t.date).toLocaleDateString()}</div>
                                            <div className="text-xs">{new Date(t.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                                        </td>
                                        <td className="p-4 text-sm">
                                            <div className="line-clamp-1 max-w-[200px]" title={t.items.map(i => i.name).join(', ')}>
                                                {t.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}
                                            </div>
                                        </td>
                                        <td className="p-4 text-right font-mono font-bold text-gray-900 dark:text-white">
                                            {t.paymentMethod === 'Debt' && t.status !== 'Refunded' ? (
                                                <div className="flex flex-col items-end">
                                                    <span>{storeProfile.currency} {t.total.toLocaleString()}</span>
                                                    <span className="text-xs text-gray-500 font-medium">
                                                        Paid: {storeProfile.currency} {(t.amountPaid || 0).toLocaleString()}
                                                    </span>
                                                </div>
                                            ) : (
                                                `${storeProfile.currency} ${t.total.toLocaleString()}`
                                            )}
                                        </td>
                                        <td className="p-4 text-right">
                                            <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${
                                                t.status === 'Completed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                                                t.status === 'Refunded' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                                                'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                                            }`}>
                                                {t.status}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
      )}

      {/* CATEGORY MARGINS ANALYTICS TAB */}
      {activeTab === 'analytics' && (
         <div className="flex-1 bg-white dark:bg-gray-900 rounded-2xl shadow-[0_4px_12px_rgba(0,0,0,0.08)] border border-gray-200 dark:border-gray-800 overflow-hidden animate-fade-in flex flex-col min-h-0 text-sm">
             <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 shrink-0 bg-gray-50/50 dark:bg-black/10">
                  <div className="flex flex-col gap-1">
                     <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                         <Percent className="w-5 h-5 text-primary-600 dark:text-primary-400" /> Category Profit Margins
                     </h3>
                     <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                         Displays the margin of profit generated by each category, factoring in actual item cost vs selling price.
                     </span>
                  </div>
                  
                  {/* Local date selectors affecting the shared states! */}
                  <div className="flex flex-wrap items-center gap-3">
                     <div className="flex items-center gap-2">
                         <span className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest">Shift Link:</span>
                         <button 
                           onClick={() => setShowHistory(!showHistory)}
                           className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${showHistory ? 'bg-primary-50 dark:bg-primary-950/30 text-primary-700 dark:text-primary-400 border-primary-100 dark:border-primary-900/50' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-transparent hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                         >
                           {showHistory ? 'All History' : 'Current Shift Only'}
                         </button>
                     </div>
                     <span className="text-gray-300 dark:text-gray-700 font-bold hidden md:inline">|</span>
                     <div className="flex items-center gap-2">
                         <span className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest">Range:</span>
                         <input 
                           type="date" 
                           value={filterStartDate}
                           onChange={(e) => setFilterStartDate(e.target.value)}
                           className="px-2.5 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-black dark:text-white outline-none focus:ring-1 focus:ring-primary-500 font-medium font-sans"
                         />
                         <span className="text-gray-400 text-xs">-</span>
                         <input 
                           type="date" 
                           value={filterEndDate}
                           onChange={(e) => setFilterEndDate(e.target.value)}
                           className="px-2.5 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-black dark:text-white outline-none focus:ring-1 focus:ring-primary-500 font-medium font-sans"
                         />
                         {(filterStartDate || filterEndDate) && (
                             <button
                               onClick={() => { setFilterStartDate(''); setFilterEndDate(''); }}
                               className="text-xs text-red-500 font-bold hover:underline ml-1"
                             >
                               Clear
                             </button>
                         )}
                     </div>
                  </div>
             </div>

             <div className="flex-1 p-6 overflow-y-auto space-y-6">
                 {/* Logic for Profit Margins metrics calculation */}
                 {(() => {
                     // Let's filter the transactions according to selected constraints
                     const dataFiltered = transactions.filter(t => {
                         if (!showHistory && shift?.isOpen) {
                             if (new Date(t.date) < new Date(shift.openedAt)) return false;
                         }
                         if (t.status === 'Refunded') return false;
                         
                         if (filterStartDate) {
                             const txStr = new Date(t.date).toISOString().split('T')[0];
                             if (txStr < filterStartDate) return false;
                         }
                         if (filterEndDate) {
                             const txStr = new Date(t.date).toISOString().split('T')[0];
                             if (txStr > filterEndDate) return false;
                         }
                         return true;
                     });

                     // Let's aggregate sales & costs by product category
                     const categoryMetrics: Record<string, { revenue: number; cost: number; itemsSold: number }> = {};

                     dataFiltered.forEach(t => {
                         t.items.forEach(item => {
                             const product = products.find(p => p.id === item.productId);
                             const category = product?.category || 'Uncategorized';

                             if (!categoryMetrics[category]) {
                                 categoryMetrics[category] = { revenue: 0, cost: 0, itemsSold: 0 };
                             }

                             const itemRevenue = item.price * item.quantity;
                             const productBuyPrice = product?.buyPrice || 0;
                             const itemCost = (item.cost !== undefined && item.cost > 0) ? item.cost : productBuyPrice;
                             const itemTotalCost = itemCost * item.quantity;

                             categoryMetrics[category].revenue += itemRevenue;
                             categoryMetrics[category].cost += itemTotalCost;
                             categoryMetrics[category].itemsSold += item.quantity;
                         });
                     });

                     const rawChartData = Object.entries(categoryMetrics).map(([name, metrics]) => {
                         const profit = metrics.revenue - metrics.cost;
                         const margin = metrics.revenue > 0 ? (profit / metrics.revenue) * 100 : 0;
                         return {
                             name,
                             revenue: metrics.revenue,
                             cost: metrics.cost,
                             profit: Math.max(0, profit),
                             margin: parseFloat(margin.toFixed(1)),
                             itemsSold: metrics.itemsSold
                         };
                     }).sort((a, b) => b.margin - a.margin); // Sort by margin descending

                     const totalRevenue = rawChartData.reduce((sum, d) => sum + d.revenue, 0);
                     const totalCost = rawChartData.reduce((sum, d) => sum + d.cost, 0);
                     const totalProfit = Math.max(0, totalRevenue - totalCost);
                     const totalMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

                     if (rawChartData.length === 0) {
                         return (
                             <div className="flex flex-col items-center justify-center p-12 text-gray-400">
                                 <AlertTriangle className="w-12 h-12 mb-3 text-amber-500 opacity-60 animate-bounce" />
                                 <p className="font-bold text-sm text-gray-700 dark:text-gray-300">No transactions recorded for the selected period.</p>
                                 <p className="text-xs text-gray-500 mt-1">Try clearing date filters or switching shift view filters.</p>
                             </div>
                         );
                     }

                     return (
                         <div className="space-y-6 font-sans">
                             {/* Metric Badges */}
                             <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                 <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-gray-100 dark:border-gray-800">
                                     <p className="text-[10px] uppercase font-bold text-gray-400 dark:text-gray-500 tracking-wider font-sans">Total Sales (Revenue)</p>
                                     <p className="text-lg font-black text-gray-900 dark:text-white mt-1">
                                         {storeProfile.currency} {totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                     </p>
                                 </div>
                                 <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-gray-100 dark:border-gray-800">
                                     <p className="text-[10px] uppercase font-bold text-gray-400 dark:text-gray-500 tracking-wider font-sans">Total COGS (Cost of Goods)</p>
                                     <p className="text-lg font-black text-gray-900 dark:text-white mt-1">
                                         {storeProfile.currency} {totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                     </p>
                                 </div>
                                 <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-gray-100 dark:border-gray-800">
                                     <p className="text-[10px] uppercase font-bold text-gray-400 dark:text-gray-500 tracking-wider font-sans">Net Profit</p>
                                     <p className="text-lg font-black text-emerald-600 dark:text-emerald-400 mt-1">
                                         {storeProfile.currency} {totalProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                     </p>
                                 </div>
                                 <div className="p-4 bg-primary-50/50 dark:bg-primary-950/20 rounded-2xl border border-primary-100 dark:border-primary-900/40">
                                     <p className="text-[10px] uppercase font-bold text-primary-700 dark:text-primary-400 tracking-wider font-sans">Overall Margin</p>
                                     <p className="text-lg font-black text-primary-600 dark:text-primary-400 mt-1">
                                         {totalMargin.toFixed(1)}%
                                     </p>
                                 </div>
                             </div>

                             {/* PRODUCT HIGHEST/LOWEST PROFIT HEATMAP */}
                             {(() => {
                                 const uniqueCategories = Array.from(new Set(products.map(p => p.category))).filter(Boolean);

                                 const heatmapProductsData = products.map(p => {
                                     const profit = Math.max(0, p.sellPrice - p.buyPrice);
                                     const margin = p.sellPrice > 0 ? (profit / p.sellPrice) * 100 : 0;
                                     return {
                                         ...p,
                                         profit,
                                         margin: parseFloat(margin.toFixed(1))
                                     };
                                  }).filter(p => {
                                      const matchesSearch = p.name.toLowerCase().includes(heatmapSearch.toLowerCase()) || 
                                                            p.category.toLowerCase().includes(heatmapSearch.toLowerCase());
                                      const matchesCategory = heatmapCategory === 'All' || p.category === heatmapCategory;
                                      return matchesSearch && matchesCategory;
                                  });

                                  const sortedHeatmapData = [...heatmapProductsData].sort((a, b) => {
                                      if (heatmapSort === 'margin-desc') return b.margin - a.margin;
                                      if (heatmapSort === 'margin-asc') return a.margin - b.margin;
                                      if (heatmapSort === 'profit-desc') return b.profit - a.profit;
                                      if (heatmapSort === 'sell-desc') return b.sellPrice - a.sellPrice;
                                      return 0;
                                  });

                                  const getMarginStyle = (margin: number) => {
                                      if (margin < 12) {
                                          return {
                                              bg: 'bg-rose-50 hover:bg-rose-100/70 dark:bg-rose-950/20 dark:hover:bg-rose-950/30 border-rose-200 dark:border-rose-900/30',
                                              text: 'text-rose-700 dark:text-rose-300',
                                              badge: 'bg-rose-500/10 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300 border border-rose-200 dark:border-rose-800/40',
                                              desc: 'Low Margin'
                                          };
                                      } else if (margin < 25) {
                                          return {
                                              bg: 'bg-amber-50 hover:bg-amber-100/70 dark:bg-amber-950/40 dark:hover:bg-amber-950/30 border-amber-200 dark:border-amber-900/30',
                                              text: 'text-amber-700 dark:text-amber-300',
                                              badge: 'bg-amber-500/10 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300 border border-amber-200 dark:border-amber-800/40',
                                              desc: 'Fair Margin'
                                          };
                                      } else if (margin < 40) {
                                          return {
                                              bg: 'bg-blue-50 hover:bg-blue-100/70 dark:bg-blue-950/15 dark:hover:bg-blue-950/25 border-blue-200 dark:border-blue-900/20',
                                              text: 'text-blue-700 dark:text-blue-300',
                                              badge: 'bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300 border border-blue-200 dark:border-blue-800/40',
                                              desc: 'Good Margin'
                                          };
                                      } else {
                                          return {
                                              bg: 'bg-emerald-50 hover:bg-emerald-100/70 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/30 border-emerald-250 dark:border-emerald-900/30',
                                              text: 'text-emerald-700 dark:text-emerald-300',
                                              badge: 'bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/40',
                                              desc: 'Excellent Margin'
                                          };
                                      }
                                  };

                                  return (
                                      <div className="p-6 bg-white dark:bg-gray-800/60 rounded-3xl border border-gray-100 dark:border-gray-800/80 shadow-sm flex flex-col gap-4">
                                          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                                              <div>
                                                  <h4 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2 uppercase tracking-wider">
                                                      <Percent className="w-4 h-4 text-primary-500 animate-pulse" /> Catalog Profitability Heatmap
                                                  </h4>
                                                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                                                      Visual matrix scaling color intensity by margin. Perfect for pinpointing items that deliver your highest yields or require pricing review.
                                                  </p>
                                              </div>

                                              {/* HEATMAP CONTROLS */}
                                              <div className="flex flex-wrap items-center gap-3">
                                                  {/* Local Search */}
                                                  <div className="relative">
                                                      <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-gray-400" />
                                                      <input
                                                          type="text"
                                                          placeholder="Search items..."
                                                          value={heatmapSearch}
                                                          onChange={(e) => setHeatmapSearch(e.target.value)}
                                                          className="pl-8 pr-3 py-1.5 text-xs rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-black/20 text-gray-800 dark:text-white outline-none focus:ring-1 focus:ring-primary-500 w-36 md:w-44 transition-all"
                                                      />
                                                  </div>

                                                  {/* Local Category Filter */}
                                                  <select
                                                      value={heatmapCategory}
                                                      onChange={(e) => setHeatmapCategory(e.target.value)}
                                                      className="px-2.5 py-1.5 text-xs rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-black/20 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-500 font-medium"
                                                  >
                                                      <option value="All">All Categories</option>
                                                      {uniqueCategories.map(cat => (
                                                          <option key={cat} value={cat}>{cat}</option>
                                                      ))}
                                                  </select>

                                                  {/* Local Sort Selector */}
                                                  <select
                                                      value={heatmapSort}
                                                      onChange={(e) => setHeatmapSort(e.target.value as any)}
                                                      className="px-2.5 py-1.5 text-xs rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-black/20 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-500 font-medium whitespace-nowrap"
                                                  >
                                                      <option value="margin-desc">Margin: Highest First</option>
                                                      <option value="margin-asc">Margin: Lowest First</option>
                                                      <option value="profit-desc">Net Profit: Highest First</option>
                                                      <option value="sell-desc">Sell Price: Highest First</option>
                                                  </select>
                                              </div>
                                          </div>

                                          {/* LEGEND SPECIFIERS */}
                                          <div className="flex flex-wrap items-center gap-3 bg-gray-50/50 dark:bg-black/10 px-4 py-2.5 rounded-2xl border border-gray-100/50 dark:border-gray-800/40 text-[10px] font-bold">
                                              <span className="text-gray-400 uppercase tracking-widest text-[9px]">Legend / Margin Range:</span>
                                              <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400 border border-red-100 dark:border-red-900/30">
                                                  <span className="w-2 h-2 rounded-full bg-red-500"></span> Low (&lt;12%)
                                              </div>
                                              <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border border-amber-100 dark:border-amber-900/30">
                                                  <span className="w-2 h-2 rounded-full bg-amber-500"></span> Fair (12% - 25%)
                                              </div>
                                              <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 border border-blue-100 dark:border-blue-900/20">
                                                  <span className="w-2 h-2 rounded-full bg-blue-500"></span> Good (25% - 40%)
                                              </div>
                                              <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/30">
                                                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Excellent (&ge;40%)
                                              </div>
                                          </div>

                                          {sortedHeatmapData.length === 0 ? (
                                              <div className="text-center py-12 text-gray-400 text-xs">
                                                  No inventory products found matching search/category filters.
                                              </div>
                                          ) : (
                                              /* HEATMAP GRID */
                                              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5 max-h-[420px] overflow-y-auto pr-1">
                                                  {sortedHeatmapData.map(prod => {
                                                      const style = getMarginStyle(prod.margin);
                                                      return (
                                                          <div
                                                              key={prod.id}
                                                              className={`p-3.5 rounded-2xl border transition-all duration-300 flex flex-col justify-between h-[155px] ${style.bg} hover:shadow-sm`}
                                                          >
                                                              {/* First Row: name & tag */}
                                                              <div>
                                                                  <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider block truncate max-w-full">
                                                                      {prod.category || 'Standard'}
                                                                  </span>
                                                                  <h5 className="font-extrabold text-gray-800 dark:text-gray-100 text-xs line-clamp-2 leading-snug mt-1" title={prod.name}>
                                                                      {prod.name}
                                                                  </h5>
                                                              </div>

                                                              {/* Middle Row: Price and Margin values */}
                                                              <div className="mt-3">
                                                                  <div className="flex justify-between items-baseline text-[10px] text-gray-400 dark:text-gray-500 font-medium">
                                                                      <span>Cost: {storeProfile.currency}{prod.buyPrice}</span>
                                                                      <span>Sell: {storeProfile.currency}{prod.sellPrice}</span>
                                                                  </div>
                                                                  <div className="flex justify-between items-center mt-2">
                                                                      <span className="text-[10px] text-gray-500 font-bold font-mono">
                                                                          +{storeProfile.currency}{prod.profit.toFixed(1)} /pc
                                                                      </span>
                                                                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-black tracking-tight ${style.badge}`}>
                                                                          {prod.margin}%
                                                                      </span>
                                                                  </div>
                                                              </div>
                                                          </div>
                                                      );
                                                  })}
                                              </div>
                                          )}
                                      </div>
                                  );
                              })()}

                             {/* Chart Container */}
                             <div className="p-6 bg-gray-50 dark:bg-gray-800/50 rounded-3xl border border-gray-100 dark:border-gray-800">
                                 <h4 className="text-xs font-bold text-gray-900 dark:text-white mb-6 uppercase tracking-wider flex items-center gap-2">
                                     <TrendingUp className="w-4 h-4 text-primary-500 animate-pulse" /> Margin Analysis Chart (Percentage)
                                 </h4>
                                 <div className="h-[360px] w-full">
                                     <ResponsiveContainer width="100%" height="100%">
                                         <BarChart data={rawChartData} margin={{ top: 20, right: 30, left: 10, bottom: 5 }}>
                                             <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={document.documentElement.classList.contains('dark') ? '#374151' : '#e5e7eb'} />
                                             <XAxis dataKey="name" stroke={document.documentElement.classList.contains('dark') ? '#9ca3af' : '#4b5563'} fontSize={11} fontWeight={600} tickLine={false} />
                                             <YAxis domain={[0, 100]} unit="%" stroke={document.documentElement.classList.contains('dark') ? '#9ca3af' : '#4b5563'} fontSize={11} fontWeight={600} tickLine={false} />
                                             <Tooltip 
                                                 formatter={(value: any) => [`${value}%`, 'Profit Margin']}
                                                 contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', color: '#fff', borderRadius: '12px' }} 
                                                 itemStyle={{ color: '#fff' }} 
                                                 labelClassName="font-bold text-xs"
                                             />
                                             <Bar dataKey="margin" radius={[10, 10, 0, 0]} maxBarSize={50}>
                                                 {rawChartData.map((entry, index) => {
                                                     const colors = ['#3f51b5', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#f43f5e', '#84cc16'];
                                                     return <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />;
                                                 })}
                                             </Bar>
                                         </BarChart>
                                     </ResponsiveContainer>
                                 </div>
                             </div>

                             {/* Data Breakdown Table */}
                             <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-100 dark:border-gray-800 overflow-hidden shadow-sm">
                                 <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-black/20">
                                     <h4 className="text-xs font-bold text-gray-900 dark:text-white uppercase tracking-wider font-sans">Detailed Category Breakdown</h4>
                                 </div>
                                 <div className="overflow-x-auto">
                                     <table className="w-full text-left text-sm">
                                         <thead>
                                             <tr className="border-b border-gray-100 dark:border-gray-800 text-xs font-bold uppercase text-gray-400 dark:text-gray-500 bg-gray-50/50 dark:bg-black/10">
                                                 <th className="p-4">Category Name</th>
                                                 <th className="p-4 text-right">Items Sold</th>
                                                 <th className="p-4 text-right">Revenue</th>
                                                 <th className="p-4 text-right">Est. Cost (COGS)</th>
                                                 <th className="p-4 text-right">Net Profit</th>
                                                 <th className="p-4 text-right">Margin (%)</th>
                                             </tr>
                                         </thead>
                                         <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                             {rawChartData.map((category, idx) => (
                                                 <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
                                                     <td className="p-4 font-bold text-gray-700 dark:text-gray-200">{category.name}</td>
                                                     <td className="p-4 text-right font-medium text-gray-600 dark:text-gray-400">{category.itemsSold} units</td>
                                                     <td className="p-4 text-right font-medium text-[#4f46e5] dark:text-[#818cf8]">{storeProfile.currency} {category.revenue.toLocaleString()}</td>
                                                     <td className="p-4 text-right font-medium text-gray-600 dark:text-gray-400">{storeProfile.currency} {category.cost.toLocaleString()}</td>
                                                     <td className="p-4 text-right font-extrabold text-[#10b981] dark:text-[#34d399]">{storeProfile.currency} {category.profit.toLocaleString()}</td>
                                                     <td className="p-4 text-right">
                                                         <span className={`px-2.5 py-1 rounded-lg text-xs font-extrabold ${
                                                             category.margin >= 40 ? 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400 font-bold' :
                                                             category.margin >= 20 ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 font-bold' :
                                                             'bg-orange-105 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400 font-bold'
                                                         }`}>
                                                             {category.margin}%
                                                         </span>
                                                     </td>
                                                 </tr>
                                             ))}
                                         </tbody>
                                     </table>
                                 </div>
                             </div>
                         </div>
                     );
                 })()}
             </div>
         </div>
      )}
    </div>
  );
};