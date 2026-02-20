import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Transaction, ShiftRecord, StoreProfile, Expense, Customer } from '../types';
import { Clock, CheckCircle, XCircle, AlertTriangle, FileText, Banknote, CreditCard, ChevronDown, ChevronUp, User, ArrowRight, RotateCcw, Search, Filter, FileDown, History, Plus, X, Phone, LogOut, Printer, Trash2, ClipboardList, Edit3, Target } from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';
import { getStockLogs } from '../utils/db';

// Utility Safe ID (Duplicate for safety/isolation)
const generateId = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 9);

interface FinanceProps {
  transactions: Transaction[];
  shift: ShiftRecord | null;
  customers: Customer[];
  onAddCustomer: (customer: Customer) => void;
  onDeleteCustomer: (id: string) => void;
  onCustomerDeposit: (customerId: string, amount: number, method: 'Cash' | 'M-Pesa') => void;
  onOpenShift: (cash: number, mpesa: number) => void;
  onCloseShift: (cash: number, mpesa: number) => void;
  onUpdateShift: (cash: number, mpesa: number) => void;
  onPayDebt: (transactionId: string, method: 'Cash' | 'M-Pesa') => void;
  onRefund: (transaction: Transaction) => void;
  storeProfile: StoreProfile;
}

export const Finance: React.FC<FinanceProps> = ({ transactions, shift, customers, onAddCustomer, onDeleteCustomer, onCustomerDeposit, onOpenShift, onCloseShift, onUpdateShift, onPayDebt, onRefund, storeProfile }) => {
  const [activeTab, setActiveTab] = useState<'shift' | 'receipts' | 'debts'>('shift');
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
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [expandedCustomerId, setExpandedCustomerId] = useState<string | null>(null);

  // Deposit State
  const [depositModal, setDepositModal] = useState<{ isOpen: boolean; customerId: string | null }>({ isOpen: false, customerId: null });
  const [depositAmount, setDepositAmount] = useState('');
  const [depositMethod, setDepositMethod] = useState<'Cash' | 'M-Pesa'>('Cash');

  // Debt Payment State
  const [payDebtModal, setPayDebtModal] = useState<{ isOpen: boolean; transaction: Transaction | null }>({ isOpen: false, transaction: null });

  // Receipt Viewer State
  const [selectedReceipt, setSelectedReceipt] = useState<Transaction | null>(null);
  const receiptRef = useRef<HTMLDivElement>(null);

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
  };

  const confirmPayDebt = (method: 'Cash' | 'M-Pesa') => {
    if (payDebtModal.transaction) {
      onPayDebt(payDebtModal.transaction.id, method);
      setPayDebtModal({ isOpen: false, transaction: null });
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
    doc.text(`Report: ${activeTab === 'shift' ? 'Shift Reconciliation' : activeTab === 'receipts' ? 'Sales Receipts' : 'Customer Debt Accounts'}`, 14, 35);

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
            body: customers.map(c => [
                c.name,
                c.phone || 'N/A',
                `${storeProfile.currency} ${c.totalDebt}`
            ]),
            theme: 'striped',
            headStyles: { fillColor: [231, 76, 60], textColor: 255 }
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
                      <td className="p-4 font-black dark:text-white">{storeProfile.currency} {t.total.toLocaleString()}</td>
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
                        <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${t.status === 'Completed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                          {t.status}
                        </span>
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
                            <th className="p-4 font-bold">Customer Name</th>
                            <th className="p-4 font-bold">Phone</th>
                            <th className="p-4 font-bold">Total Debt</th>
                            <th className="p-4 font-bold">Credit Balance</th>
                            <th className="p-4 font-bold">Last Activity</th>
                            <th className="p-4 text-right font-bold">Actions</th>
                        </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {customers.map(c => (
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
                                                onClick={(e) => handleDepositClick(e, c.id)}
                                                className="px-3 py-1.5 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/40 rounded-lg text-xs font-bold transition-colors border border-green-100 dark:border-green-900/30"
                                            >
                                                Deposit
                                            </button>
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
                                        <td colSpan={5} className="p-6">
                                            <div className="pl-2">
                                                <h4 className="text-xs font-black uppercase text-gray-400 mb-4 tracking-widest flex items-center gap-2">
                                                    <FileText className="w-4 h-4" /> Unpaid Transactions
                                                </h4>
                                                {transactions.filter(t => t.customerId === c.id && t.status === 'Pending Debt').length === 0 ? (
                                                    <div className="text-sm text-gray-400 italic flex items-center gap-2">
                                                        <CheckCircle className="w-4 h-4" /> No pending transactions for this customer.
                                                    </div>
                                                ) : (
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                        {transactions.filter(t => t.customerId === c.id && t.status === 'Pending Debt').map(t => (
                                                            <div key={t.id} className="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-[0_4px_12px_rgba(0,0,0,0.08)] hover:-translate-y-1 transition-all duration-300">
                                                                <div className="flex justify-between items-start mb-3 border-b border-gray-100 dark:border-gray-700 pb-3">
                                                                    <div>
                                                                        <p className="font-bold text-gray-900 dark:text-white">{new Date(t.date).toLocaleDateString()}</p>
                                                                        <p className="text-xs text-gray-500 font-medium">{new Date(t.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                                                                    </div>
                                                                    <div className="text-right">
                                                                        <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Due Amount</p>
                                                                        <p className="text-xl font-black text-red-600 dark:text-red-400">{storeProfile.currency} {(t.total - (t.amountPaid || 0)).toLocaleString()}</p>
                                                                    </div>
                                                                </div>
                                                                
                                                                <div className="mb-4">
                                                                    <div className="flex justify-between items-center mb-2">
                                                                       <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Items ({t.items.length})</p>
                                                                    </div>
                                                                    <div className="text-sm text-gray-700 dark:text-gray-300 space-y-1.5 max-h-32 overflow-y-auto pr-2 custom-scrollbar">
                                                                        {t.items.map((item, idx) => (
                                                                            <div key={idx} className="flex justify-between border-b border-dashed border-gray-100 dark:border-gray-700 pb-1 last:border-0 last:pb-0">
                                                                                <span className="truncate pr-2 font-medium">{item.quantity} x {item.name}</span>
                                                                                <span className="text-gray-500 font-medium whitespace-nowrap">{item.price * item.quantity}</span>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>

                                                                <div className="flex items-center justify-between pt-4 border-t border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-black/20 -mx-5 -mb-5 px-5 py-4 rounded-b-2xl">
                                                                    <div className="text-xs text-gray-500 font-medium flex flex-col gap-0.5">
                                                                        <span>Total Bill: {t.total.toLocaleString()}</span>
                                                                        <span className="text-green-600 dark:text-green-400 font-bold">Paid: {t.amountPaid.toLocaleString()}</span>
                                                                    </div>
                                                                    <button 
                                                                        onClick={(e) => { e.stopPropagation(); handlePayDebtClick(t); }}
                                                                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition-all text-xs font-bold shadow-lg shadow-emerald-900/20 flex items-center gap-1.5 transform active:scale-95"
                                                                    >
                                                                        <CheckCircle className="w-3.5 h-3.5" /> Settle Debt
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        ))}
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
                        <div className="flex justify-between text-sm font-bold mb-1">
                            <span>TOTAL</span>
                            <span>{storeProfile.currency} {selectedReceipt.total.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-xs text-gray-600">
                             <span>Payment:</span>
                             <span className="uppercase">{selectedReceipt.paymentMethod}</span>
                        </div>
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

    </div>
  );
};