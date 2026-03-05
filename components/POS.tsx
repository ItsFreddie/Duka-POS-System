
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Search, ShoppingCart, Trash2, Plus, Minus, CreditCard, Banknote, User, Coins, X, Split, AlertCircle, RefreshCw, Box, ArrowRight, Receipt, ChevronRight, UserPlus, Target, Calendar, AlertTriangle, ChevronUp, Wallet, Printer, Mail, ChevronDown } from 'lucide-react';
import { Product, CartItem, Transaction, StoreProfile, Customer } from '../types';
import confetti from 'canvas-confetti';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

// Utility Safe ID (Duplicate for safety/isolation)
const generateId = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 9);

interface POSProps {
  products: Product[];
  customers?: Customer[];
  transactions?: Transaction[];
  onAddCustomer?: (customer: Customer) => void;
  onCompleteSale: (transaction: Transaction) => void;
  onRecordExpense: (amount: number, reason: string, source: 'Cash' | 'M-Pesa') => void;
  storeProfile: StoreProfile;
}

export const POS: React.FC<POSProps> = ({ products, customers = [], transactions = [], onAddCustomer, onCompleteSale, onRecordExpense, storeProfile }) => {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'M-Pesa' | 'Debt' | 'Split'>('Cash');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  
  // Clock State
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  
  // Mobile Cart State
  const [isMobileCartOpen, setIsMobileCartOpen] = useState(false);
  
  // Payment Details
  const [cashTendered, setCashTendered] = useState<string>('');
  const [mpesaTendered, setMpesaTendered] = useState<string>('');
  const [splitCash, setSplitCash] = useState<string>('');
  const [splitMpesa, setSplitMpesa] = useState<string>('');

  // Debt Payment Details
  const [debtUpfront, setDebtUpfront] = useState<string>('');
  const [debtUpfrontMethod, setDebtUpfrontMethod] = useState<'Cash' | 'M-Pesa'>('Cash');

  // Petty Cash State
  const [isPettyCashOpen, setIsPettyCashOpen] = useState(false);
  const [pettyCashAmount, setPettyCashAmount] = useState('');
  const [pettyCashReason, setPettyCashReason] = useState('');
  const [pettyCashSource, setPettyCashSource] = useState<'Cash' | 'M-Pesa'>('Cash');

  // New Customer State
  const [isNewCustomerOpen, setIsNewCustomerOpen] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');

  const [discount, setDiscount] = useState<number>(0);
  const [receiptTransaction, setReceiptTransaction] = useState<Transaction | null>(null);

  const categories = ['All', ...Array.from(new Set(products.map(p => p.category)))];

  // Daily Sales Calculation (Kept for Confetti Logic only)
  const today = new Date().toISOString().split('T')[0];
  const todaySales = useMemo(() => transactions
    .filter(t => t.date.startsWith(today) && t.status !== 'Refunded')
    .reduce((acc, t) => acc + t.total, 0), [transactions, today]);

  const target = storeProfile.dailySalesTarget || 0;

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase());
      const matchesCategory = categoryFilter === 'All' || p.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [products, search, categoryFilter]);

  const subtotal = useMemo(() => cart.reduce((acc, item) => acc + (item.sellPrice * item.quantity), 0), [cart]);
  const total = useMemo(() => Math.max(0, subtotal - discount), [subtotal, discount]);

  // Calculate Change
  const changeDue = useMemo(() => {
    if (paymentMethod === 'Cash') {
      const tendered = Number(cashTendered);
      return Math.max(0, tendered - total);
    } else if (paymentMethod === 'M-Pesa') {
      const tendered = Number(mpesaTendered);
      return Math.max(0, tendered - total);
    } else if (paymentMethod === 'Split') {
      const tenderedTotal = Number(splitCash) + Number(splitMpesa);
      return Math.max(0, tenderedTotal - total);
    }
    return 0;
  }, [paymentMethod, cashTendered, mpesaTendered, splitCash, splitMpesa, total]);

  const addToCart = (product: Product) => {
    if (product.stock <= 0) {
        return; // Prevent adding out of stock items
    }
    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) {
        // Optional: Check if adding 1 more exceeds stock
        if (existing.quantity + 1 > product.stock) {
            // alert("Cannot add more than available stock!"); // Removing alert for smoother UI
            return prev;
        }
        return prev.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const removeFromCart = (id: string) => {
    setCart(prev => prev.filter(item => item.id !== id));
  };

  const clearCart = () => {
    if(confirm("Are you sure you want to clear the cart?")) {
      setCart([]);
      resetPaymentFields();
      setIsMobileCartOpen(false);
    }
  }

  const updateQuantity = (id: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        // If it's a fractional unit (L, kg), allow small steps. If pieces, keep integers.
        const isFractional = item.measurementUnit && item.measurementUnit !== 'pcs';
        const step = isFractional ? 0.1 : 1; 
        
        let newQty = item.quantity + (delta * step);
        newQty = Math.max(isFractional ? 0.01 : 1, Number(newQty.toFixed(2))); // Prevent negative or zero
        
        // Stock check (Soft check, allow but maybe show warning in UI)
        // keeping strict check for buttons
        if (delta > 0 && newQty > item.stock) {
             return item; 
        }

        return { ...item, quantity: newQty };
      }
      return item;
    }).filter(item => item.quantity > 0));
  };

  const setDirectQuantity = (id: string, qty: string) => {
      setCart(prev => prev.map(item => {
          if (item.id === id) {
              const newQty = Number(qty);
              if (newQty < 0) return item;
              return { ...item, quantity: newQty };
          }
          return item;
      }));
  }

  const updateLineTotal = (id: string, totalStr: string) => {
    if (totalStr === '') {
       // Optional: set quantity to 0 to clear input visually if needed, or keep previous. 
       // Setting to 0 effectively removes it if filtered later, but for now let's allow temporary 0
       setCart(prev => prev.map(item => item.id === id ? { ...item, quantity: 0 } : item));
       return;
    }
    const amount = parseFloat(totalStr);
    if (isNaN(amount) || amount < 0) return;
    
    setCart(prev => prev.map(item => {
        if (item.id === id) {
            if (item.sellPrice <= 0) return item;
            const newQty = Number((amount / item.sellPrice).toFixed(4));
            return { ...item, quantity: newQty };
        }
        return item;
    }));
  };

  const resetPaymentFields = () => {
    setCashTendered('');
    setMpesaTendered('');
    setSplitCash('');
    setSplitMpesa('');
    setDebtUpfront('');
    setDebtUpfrontMethod('Cash');
    setSelectedCustomerId('');
    setPaymentMethod('Cash');
    setDiscount(0);
  };

  const handleCheckout = () => {
    if (cart.length === 0) return;

    // Trigger Confetti if target met
    const newTotal = todaySales + total;
    if (target > 0 && todaySales < target && newTotal >= target) {
        confetti({
          particleCount: 150,
          spread: 60,
          origin: { y: 0.6 },
          zIndex: 2000, // Ensure it's on top of modals if any
          colors: ['#10b981', '#3b82f6', '#f59e0b']
        });
    }

    let transactionDetails: Partial<Transaction> = {
      amountPaid: total,
      status: 'Completed',
      customerId: selectedCustomerId || undefined,
      customerName: selectedCustomerId ? customers.find(c => c.id === selectedCustomerId)?.name : undefined,
      customerPhone: selectedCustomerId ? customers.find(c => c.id === selectedCustomerId)?.phone : undefined,
    };

    if (paymentMethod === 'Cash') {
      if (Number(cashTendered) < total && Number(cashTendered) !== 0) {
        alert("Cash tendered is less than total!");
        return;
      }
      transactionDetails.amountPaid = Number(cashTendered) || total;
    } 
    else if (paymentMethod === 'M-Pesa') {
      if (Number(mpesaTendered) < total && Number(mpesaTendered) !== 0) {
        alert("M-Pesa amount is less than total!");
        return;
      }
      transactionDetails.amountPaid = Number(mpesaTendered) || total;
    }
    else if (paymentMethod === 'Split') {
      const paid = Number(splitCash) + Number(splitMpesa);
      if (paid < total) {
        alert("Total split payment is less than bill total!");
        return;
      }
      transactionDetails.amountPaid = paid;
      transactionDetails.splitDetails = {
        cash: Number(splitCash),
        mpesa: Number(splitMpesa)
      };
    }
    else if (paymentMethod === 'Debt') {
       if (!selectedCustomerId) {
         alert("Please select a customer account for this debt!");
         return;
       }
       const upfront = Number(debtUpfront);
       if (upfront >= total) {
           alert("Upfront payment covers the entire bill. Please use Cash or M-Pesa payment method instead.");
           return;
       }

       const customer = customers.find(c => c.id === selectedCustomerId);
       transactionDetails.amountPaid = upfront;
       transactionDetails.status = 'Pending Debt';
       transactionDetails.customerId = selectedCustomerId;
       transactionDetails.customerName = customer?.name || 'Unknown';
       transactionDetails.customerPhone = customer?.phone || '';
       
       if (upfront > 0) {
           transactionDetails.splitDetails = {
               cash: debtUpfrontMethod === 'Cash' ? upfront : 0,
               mpesa: debtUpfrontMethod === 'M-Pesa' ? upfront : 0
           };
           transactionDetails.payments = [{
               id: generateId(),
               date: new Date().toISOString(),
               amount: upfront,
               method: debtUpfrontMethod
           }];
       }
    }
    else if (paymentMethod === 'Credit') {
        if (!selectedCustomerId) {
            alert("Please select a customer account to use credit!");
            return;
        }
        const customer = customers.find(c => c.id === selectedCustomerId);
        if (!customer) return;

        if ((customer.creditBalance || 0) < total) {
            alert(`Insufficient credit balance! Available: ${storeProfile.currency} ${customer.creditBalance || 0}`);
            return;
        }

        transactionDetails.amountPaid = total;
        transactionDetails.status = 'Completed';
        transactionDetails.customerId = selectedCustomerId;
        transactionDetails.customerName = customer.name;
        transactionDetails.customerPhone = customer.phone || '';
    }

    const transaction: Transaction = {
      id: generateId(),
      date: new Date().toISOString(),
      items: cart.map(item => ({
        productId: item.id,
        name: item.name,
        quantity: item.quantity,
        price: item.sellPrice,
        cost: item.buyPrice 
      })),
      subtotal,
      discount,
      total,
      paymentMethod,
      ...transactionDetails
    } as Transaction;

    onCompleteSale(transaction);
    setReceiptTransaction(transaction);
    setCart([]);
    resetPaymentFields();
    setIsMobileCartOpen(false);
  };

  const handlePettyCashSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pettyCashAmount || !pettyCashReason) return;
    onRecordExpense(Number(pettyCashAmount), pettyCashReason, pettyCashSource);
    setPettyCashAmount('');
    setPettyCashReason('');
    setPettyCashSource('Cash');
    setIsPettyCashOpen(false);
    alert('Petty cash recorded.');
  };

  const handleAddCustomerSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (!newCustomerName) return;
      
      const newCustomer: Customer = {
          id: generateId(),
          name: newCustomerName,
          phone: newCustomerPhone,
          totalDebt: 0
      };
      
      if (onAddCustomer) {
          onAddCustomer(newCustomer);
          setSelectedCustomerId(newCustomer.id); // Auto select
          setIsNewCustomerOpen(false);
          setNewCustomerName('');
          setNewCustomerPhone('');
      }
  }

  const printReceipt = (transaction: Transaction) => {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: [80, 200] // Typical thermal receipt width
    });

    let y = 10;

    // Add Logo if available
    if (storeProfile.logoUrl) {
      try {
        // Assuming logoUrl is a base64 string
        doc.addImage(storeProfile.logoUrl, 'JPEG', 30, y, 20, 20);
        y += 25;
      } catch (e) {
        console.error("Failed to add logo to PDF", e);
      }
    }

    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(storeProfile.name, 40, y, { align: 'center' });
    y += 5;
    
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    if (storeProfile.location) {
        doc.text(storeProfile.location, 40, y, { align: 'center' });
        y += 5;
    }
    
    doc.text(`Date: ${new Date(transaction.date).toLocaleString()}`, 40, y, { align: 'center' });
    y += 5;
    doc.text(`Receipt #: ${transaction.id.substring(0, 8).toUpperCase()}`, 40, y, { align: 'center' });
    y += 8;

    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text('Item', 5, y);
    doc.text('Qty', 45, y);
    doc.text('Total', 75, y, { align: 'right' });
    y += 2;
    doc.setLineWidth(0.5);
    doc.setLineDashPattern([1, 1], 0);
    doc.line(5, y, 75, y);
    doc.setLineDashPattern([], 0);
    y += 4;

    doc.setFont("helvetica", "normal");
    transaction.items.forEach(item => {
      doc.setFontSize(8);
      // Truncate name if too long
      const name = item.name.length > 20 ? item.name.substring(0, 20) + '...' : item.name;
      doc.text(name, 5, y);
      doc.text(item.quantity.toString(), 45, y);
      doc.text((item.price * item.quantity).toFixed(2), 75, y, { align: 'right' });
      y += 5;
    });

    doc.setLineDashPattern([1, 1], 0);
    doc.line(5, y, 75, y);
    doc.setLineDashPattern([], 0);
    y += 5;

    doc.setFontSize(9);
    if (transaction.subtotal) {
      doc.text('Subtotal:', 45, y);
      doc.text(transaction.subtotal.toFixed(2), 75, y, { align: 'right' });
      y += 5;
    }
    
    if (transaction.discount) {
      doc.text('Discount:', 45, y);
      doc.text(`-${transaction.discount.toFixed(2)}`, 75, y, { align: 'right' });
      y += 5;
    }

    doc.text('Tax (0%):', 45, y);
    doc.text((transaction.tax || 0).toFixed(2), 75, y, { align: 'right' });
    y += 5;

    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text('Total:', 45, y);
    doc.text(`${storeProfile.currency} ${transaction.total.toFixed(2)}`, 75, y, { align: 'right' });
    y += 8;

    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(`Paid via: ${transaction.paymentMethod}`, 40, y, { align: 'center' });
    y += 5;
    doc.text('Thank you for your business!', 40, y, { align: 'center' });
    y += 4;
    doc.text('Please come again', 40, y, { align: 'center' });

    doc.autoPrint();
    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  const emailReceipt = (transaction: Transaction) => {
    const subject = `Receipt from ${storeProfile.name}`;
    let body = `Thank you for your purchase!\n\n`;
    body += `Receipt #: ${transaction.id.substring(0, 8).toUpperCase()}\n`;
    body += `Date: ${new Date(transaction.date).toLocaleString()}\n\n`;
    body += `Items:\n`;
    transaction.items.forEach(item => {
      body += `- ${item.name} x${item.quantity} = ${storeProfile.currency} ${(item.price * item.quantity).toFixed(2)}\n`;
    });
    body += `\n`;
    if (transaction.subtotal && transaction.discount) {
      body += `Subtotal: ${storeProfile.currency} ${transaction.subtotal.toFixed(2)}\n`;
      body += `Discount: -${storeProfile.currency} ${transaction.discount.toFixed(2)}\n`;
    }
    body += `Total: ${storeProfile.currency} ${transaction.total.toFixed(2)}\n`;
    body += `Payment Method: ${transaction.paymentMethod}\n`;

    const mailtoLink = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailtoLink;
  };

  // Preset quick cash amounts for faster checkout
  const quickCashAmounts = [100, 200, 500, 1000];

  return (
    <div className="flex flex-col lg:flex-row h-full gap-3 lg:gap-4">
      
      {/* LEFT: Product Grid Panel */}
      <div className="flex-1 flex flex-col bg-white dark:bg-gray-900 rounded-3xl shadow-[0_4px_12px_rgba(0,0,0,0.08)] border border-gray-200 dark:border-gray-800 overflow-hidden relative">
        {/* Header/Filters */}
        <div className="p-3 md:p-4 space-y-3 md:space-y-4 bg-white/80 dark:bg-gray-900/90 backdrop-blur-xl sticky top-0 z-20 border-b border-gray-100 dark:border-gray-800">
          <div className="flex justify-between items-center gap-3">
            <div className="relative flex-1 group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-primary-500 transition-colors w-5 h-5" />
              <input
                type="text"
                placeholder="Search products..."
                className="w-full pl-11 pr-4 py-3 md:py-3.5 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-full focus:outline-none focus:ring-2 focus:ring-primary-500 text-gray-900 dark:text-gray-100 text-sm font-medium transition-all shadow-sm group-hover:bg-white dark:group-hover:bg-black"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            
            <div className="flex items-center gap-2">
                {/* Clock Display */}
                <div className="hidden lg:flex flex-col items-end px-3 py-1.5 bg-gray-100 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 min-w-[80px]">
                   <span className="text-[10px] font-bold text-gray-500 uppercase leading-none mb-0.5">{currentTime.toLocaleDateString([], {weekday: 'short', day: 'numeric'})}</span>
                   <span className="text-sm font-black text-gray-900 dark:text-white leading-none font-mono">
                      {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                   </span>
                </div>

                <button 
                  onClick={() => setIsPettyCashOpen(true)}
                  className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-3 md:px-5 md:py-3.5 rounded-2xl text-sm font-bold flex items-center gap-2 hover:bg-red-100 dark:hover:bg-red-900/40 transition-all border border-red-100 dark:border-red-900/30 shadow-sm active:scale-95"
                >
                  <Coins className="w-5 h-5 md:w-4 md:h-4" /> <span className="hidden md:inline">Withdraw</span>
                </button>
            </div>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`px-4 py-2 md:px-5 md:py-2.5 rounded-full text-xs md:text-sm font-bold whitespace-nowrap transition-all border ${
                  categoryFilter === cat
                    ? 'bg-gray-900 dark:bg-white text-white dark:text-black border-gray-900 dark:border-white shadow-md'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-transparent hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-2 md:p-4 bg-gray-50/30 dark:bg-black/20 pb-24 md:pb-4 custom-scrollbar">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2 md:gap-3">
            {filteredProducts.map(product => {
              const isOutOfStock = product.stock <= 0;
              const isLowStock = product.stock <= 5 && !isOutOfStock;
              const expiryDate = product.expiryDate ? new Date(product.expiryDate) : null;
              const daysToExpiry = expiryDate ? Math.ceil((expiryDate.getTime() - new Date().getTime()) / (1000 * 3600 * 24)) : null;
              
              const isExpired = daysToExpiry !== null && daysToExpiry <= 0;
              const isCritical = daysToExpiry !== null && daysToExpiry > 0 && daysToExpiry <= 2;
              const isExpiringSoon = daysToExpiry !== null && daysToExpiry > 2 && daysToExpiry <= 3;

              return (
                <div
                  key={product.id}
                  onClick={() => !isOutOfStock && addToCart(product)}
                  className={`group relative bg-white dark:bg-gray-800/50 border rounded-2xl p-2.5 transition-all duration-300 hover:shadow-lg flex flex-col hover:-translate-y-1
                    ${isOutOfStock 
                        ? 'opacity-60 cursor-not-allowed border-gray-200 dark:border-gray-800 grayscale' 
                        : 'cursor-pointer border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }
                    ${isCritical ? 'border-red-500 ring-1 ring-red-500' : isLowStock ? 'border-red-200 dark:border-red-900/50' : ''}
                  `}
                >
                  <div className="aspect-[4/3] rounded-xl overflow-hidden bg-gray-50 dark:bg-gray-900 mb-2 relative shadow-inner border border-gray-100 dark:border-gray-800/50">
                    <img src={product.image} alt={product.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                    
                    {/* Stock Badge */}
                    <div className={`absolute top-2 right-2 text-white text-[10px] px-2 py-0.5 rounded-full font-bold shadow-sm backdrop-blur-md ${isOutOfStock ? 'bg-gray-500' : isLowStock ? 'bg-red-500/90' : 'bg-black/60'}`}>
                      {product.stock} {product.measurementUnit || 'pcs'}
                    </div>

                    {(isExpired || isCritical || isExpiringSoon) && (
                         <div className={`absolute top-2 left-2 text-[9px] px-1.5 py-0.5 rounded-md font-bold shadow-sm text-white flex items-center gap-0.5 ${isExpired ? 'bg-red-800' : isCritical ? 'bg-red-500' : 'bg-orange-500'}`}>
                            {isExpired ? 'EXPIRED' : isCritical ? <><AlertTriangle className="w-2.5 h-2.5" /> CRIT</> : 'EXP'}
                         </div>
                    )}

                    {isOutOfStock && (
                        <div className="absolute inset-0 bg-white/50 dark:bg-black/50 flex items-center justify-center">
                            <span className="bg-red-600 text-white text-[10px] font-bold px-2.5 py-1 rounded-md transform -rotate-12 shadow-sm">OUT</span>
                        </div>
                    )}
                  </div>
                  
                  <div className="flex-1 flex flex-col justify-between px-1">
                      <h4 className="font-bold text-sm text-gray-800 dark:text-gray-100 line-clamp-2 mb-1 leading-tight tracking-tight">{product.name}</h4>
                      <div>
                        <p className="text-gray-900 dark:text-white font-black text-base">{storeProfile.currency} {product.sellPrice}</p>
                        
                        {product.expiryDate && (
                            <p className={`text-[10px] mt-1 flex items-center gap-1 font-bold ${isExpired ? 'text-red-700' : isCritical ? 'text-red-500' : isExpiringSoon ? 'text-orange-500' : 'text-gray-400'}`}>
                                <Calendar className="w-3 h-3" /> 
                                {new Date(product.expiryDate).toLocaleDateString()}
                            </p>
                        )}
                      </div>
                  </div>
                  
                  {!isOutOfStock && <div className="absolute inset-0 bg-gray-900/5 dark:bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl pointer-events-none"></div>}
                </div>
              );
            })}
          </div>
          {filteredProducts.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-gray-400 opacity-60">
              <Box className="w-20 h-20 mb-4 stroke-1" />
              <p className="text-lg font-medium">No products found</p>
            </div>
          )}
        </div>
      </div>

      {/* Floating Mobile Cart Summary */}
      {!isMobileCartOpen && cart.length > 0 && (
         <div className="md:hidden fixed bottom-4 left-4 right-4 z-40 animate-slide-up">
            <button 
              onClick={() => setIsMobileCartOpen(true)}
              className="w-full bg-gray-900/95 dark:bg-white/95 backdrop-blur-xl text-white dark:text-black p-4 rounded-2xl shadow-2xl border border-white/10 dark:border-black/10 flex items-center justify-between group active:scale-95 transition-all"
            >
               <div className="flex items-center gap-3">
                  <div className="bg-white/20 dark:bg-black/10 w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm">
                     {cart.length}
                  </div>
                  <div className="text-left">
                     <p className="text-[10px] text-gray-300 dark:text-gray-600 font-bold uppercase tracking-widest leading-tight">Total</p>
                     <p className="font-black text-xl leading-none">{storeProfile.currency} {total.toLocaleString()}</p>
                  </div>
               </div>
               <div className="flex items-center gap-2 pr-1">
                  <span className="text-sm font-bold">View Cart</span>
                  <ChevronUp className="w-5 h-5 animate-bounce" />
               </div>
            </button>
         </div>
      )}

      {/* Mobile Overlay Backdrop */}
      {isMobileCartOpen && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden animate-fade-in"
          onClick={() => setIsMobileCartOpen(false)}
        />
      )}

      {/* RIGHT: Cart Sidebar / Mobile Bottom Sheet */}
      <div className={`
        flex flex-col 
        bg-white dark:bg-gray-900 
        overflow-hidden 
        transition-all duration-300
        
        // Desktop Styles (Sidebar)
        md:w-[400px] md:rounded-3xl md:border md:border-gray-200 md:dark:border-gray-800 md:shadow-[0_4px_12px_rgba(0,0,0,0.08)] md:relative md:z-10 md:h-full md:flex

        // Mobile Styles (Bottom Sheet)
        ${isMobileCartOpen ? 
          'fixed bottom-0 left-0 right-0 h-[85vh] z-50 rounded-t-3xl shadow-[0_-10px_40px_-10px_rgba(0,0,0,0.3)] border-t border-white/20 animate-slide-up' : 
          'hidden'
        }
        // Glass effect on mobile
        ${isMobileCartOpen ? 'bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl' : ''}
      `}>
        
        {/* Mobile Drag Handle */}
        <div className="md:hidden w-full flex justify-center pt-3 pb-1 shrink-0" onClick={() => setIsMobileCartOpen(false)}>
            <div className="w-12 h-1.5 bg-gray-300 dark:bg-gray-600 rounded-full" />
        </div>

        {/* Cart Header */}
        <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-transparent">
          <div className="flex items-center gap-3">
             <div className="w-10 h-10 rounded-2xl bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center text-primary-600 dark:text-primary-400 shadow-inner">
               <Receipt className="w-5 h-5" />
             </div>
             <div>
                <h2 className="font-black text-lg text-gray-900 dark:text-white leading-none mb-1">Current Sale</h2>
                <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wide">{cart.length} Items</p>
             </div>
          </div>
          <div className="flex gap-2">
             {cart.length > 0 && (
                <button onClick={clearCart} className="w-9 h-9 flex items-center justify-center rounded-xl bg-red-50 dark:bg-red-900/20 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
             )}
             {/* Mobile Close Button */}
             <button onClick={() => setIsMobileCartOpen(false)} className="md:hidden w-9 h-9 flex items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-500">
                <ChevronRight className="w-5 h-5 rotate-90" />
             </button>
           </div>
        </div>

        {/* Customer Selection */}
        <div className="px-4 py-3 bg-gray-50/50 dark:bg-gray-900/50 border-b border-gray-100 dark:border-gray-800">
            <div className="flex gap-2">
                <div className="relative flex-1">
                    <select 
                        value={selectedCustomerId} 
                        onChange={(e) => setSelectedCustomerId(e.target.value)}
                        className="w-full appearance-none bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-primary-500 outline-none text-gray-900 dark:text-white font-medium transition-all"
                    >
                        <option value="">Walk-in Customer</option>
                        {customers.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                        <ChevronDown className="w-4 h-4" />
                    </div>
                </div>
                <button 
                    onClick={() => setIsNewCustomerOpen(true)}
                    className="bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 px-3 rounded-xl hover:bg-primary-100 dark:hover:bg-primary-900/40 transition-colors flex items-center justify-center border border-primary-100 dark:border-primary-900/30"
                    title="Add New Customer"
                >
                    <UserPlus className="w-5 h-5" />
                </button>
            </div>
            {selectedCustomerId && (
                <div className="mt-2 flex items-center justify-between text-xs px-1">
                    <div className="text-primary-600 dark:text-primary-400 font-bold flex items-center gap-1.5 bg-primary-50 dark:bg-primary-900/20 px-2 py-1 rounded-lg">
                        <Target className="w-3.5 h-3.5" />
                        {customers.find(c => c.id === selectedCustomerId)?.loyaltyPoints || 0} Points
                    </div>
                    <div className="text-gray-500 font-medium">
                        Debt: {storeProfile.currency} {customers.find(c => c.id === selectedCustomerId)?.totalDebt.toLocaleString()}
                    </div>
                </div>
            )}
        </div>

        {/* Cart Items List - Expanded space */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50/50 dark:bg-black/20">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400 dark:text-gray-600 space-y-4 opacity-70">
              <div className="w-24 h-24 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                <ShoppingCart className="w-10 h-10" />
              </div>
              <p className="font-bold text-lg text-gray-600 dark:text-gray-400">Cart is empty</p>
              <p className="text-xs text-gray-400 dark:text-gray-500">Select products to start a sale</p>
            </div>
          ) : (
            cart.map(item => {
              const isFractional = item.measurementUnit && item.measurementUnit !== 'pcs';
              const lineTotal = item.sellPrice * item.quantity;
              const isOverStock = item.quantity > item.stock;

              return (
              <div key={item.id} className="flex flex-col p-2.5 bg-white dark:bg-gray-800/80 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm group hover:shadow-md transition-all duration-300 mb-2">
                <div className="flex justify-between items-start mb-2">
                    <div className="flex-1 min-w-0 mr-3">
                        <h4 className="font-bold truncate text-sm text-gray-900 dark:text-white mb-0.5">{item.name}</h4>
                        <div className="text-[10px] text-gray-500 dark:text-gray-400 font-medium">
                           {storeProfile.currency} {item.sellPrice} / {item.measurementUnit || 'pc'}
                        </div>
                    </div>
                    
                    {/* Amount Input for fractional items */}
                    <div className="flex flex-col items-end">
                        <span className="text-[9px] font-bold text-gray-400 uppercase mb-0.5 tracking-wider">Amount</span>
                        {isFractional ? (
                            <div className="flex items-center border-b-2 border-primary-100 focus-within:border-primary-500 dark:border-gray-700 dark:focus-within:border-primary-500 transition-colors">
                                <span className="text-[10px] font-bold text-gray-400 mr-1">{storeProfile.currency}</span>
                                <input 
                                    type="number"
                                    min="0"
                                    step="any"
                                    className="w-16 text-right font-bold text-sm bg-transparent outline-none text-gray-900 dark:text-white"
                                    value={lineTotal === 0 ? '' : Number(lineTotal.toFixed(2))} 
                                    onChange={(e) => updateLineTotal(item.id, e.target.value)}
                                    placeholder="0"
                                />
                            </div>
                        ) : (
                            <div className="font-bold text-sm text-gray-900 dark:text-white">
                                {storeProfile.currency} {lineTotal.toLocaleString()}
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex justify-between items-center">
                    {/* Quantity Controls */}
                    <div className="flex items-center gap-1 bg-gray-50 dark:bg-gray-900/50 rounded-xl p-1 border border-gray-100 dark:border-gray-800">
                        <button onClick={() => updateQuantity(item.id, -1)} className="w-7 h-7 flex items-center justify-center hover:bg-white dark:hover:bg-gray-800 rounded-lg text-gray-500 hover:text-red-500 dark:text-gray-400 transition-all shadow-sm">
                            <Minus className="w-3 h-3" />
                        </button>
                        
                        {isFractional ? (
                            <input 
                                type="number" 
                                step="0.001"
                                min="0.001"
                                value={item.quantity === 0 ? '' : item.quantity}
                                onChange={(e) => setDirectQuantity(item.id, e.target.value)}
                                className="w-14 text-center text-xs font-bold bg-transparent focus:border-b-2 focus:border-primary-500 outline-none p-0 text-gray-900 dark:text-white"
                            />
                        ) : (
                            <span className="w-8 text-center font-bold text-xs text-gray-900 dark:text-white tabular-nums">{item.quantity}</span>
                        )}
                        <span className="text-[10px] text-gray-400 font-medium pr-1">{item.measurementUnit || 'pcs'}</span>
                        
                        <button onClick={() => updateQuantity(item.id, 1)} className="w-7 h-7 flex items-center justify-center hover:bg-white dark:hover:bg-gray-800 rounded-lg text-gray-500 hover:text-green-500 dark:text-gray-400 transition-all shadow-sm">
                            <Plus className="w-3 h-3" />
                        </button>
                    </div>

                    {isOverStock ? (
                        <div className="flex items-center gap-1 text-[9px] text-red-500 font-bold bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded-full animate-pulse">
                            <AlertCircle className="w-3 h-3" /> Low Stock
                        </div>
                    ) : (
                        <button onClick={() => removeFromCart(item.id)} className="text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 p-1.5 rounded-lg transition-colors">
                            <Trash2 className="w-4 h-4" />
                        </button>
                    )}
                </div>
              </div>
            )})
          )}
        </div>

        {/* Footer / Payment - Compacted */}
        <div className="p-4 bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800 shadow-[0_-20px_40px_-15px_rgba(0,0,0,0.05)] z-20">
          
          {/* Subtotal & Discount */}
          {cart.length > 0 && (
            <div className="flex justify-between items-center mb-2 text-sm">
              <span className="text-gray-500 font-medium">Subtotal</span>
              <span className="font-bold text-gray-900 dark:text-white">{storeProfile.currency} {subtotal.toLocaleString()}</span>
            </div>
          )}
          {cart.length > 0 && (
            <div className="flex justify-between items-center mb-4 text-sm">
              <span className="text-gray-500 font-medium">Discount</span>
              <div className="flex items-center border-b border-gray-300 dark:border-gray-700 focus-within:border-primary-500 transition-colors">
                <span className="text-gray-400 mr-1">{storeProfile.currency}</span>
                <input 
                  type="number"
                  min="0"
                  step="any"
                  className="w-16 text-right font-bold bg-transparent outline-none text-red-500 dark:text-red-400"
                  value={discount === 0 ? '' : discount}
                  onChange={(e) => setDiscount(Number(e.target.value) || 0)}
                  placeholder="0"
                />
              </div>
            </div>
          )}

          {/* Total Display */}
           <div className="flex justify-between items-end mb-4 pt-2 border-t border-gray-100 dark:border-gray-800 border-dashed">
            <div className="flex flex-col">
               <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-0.5">Total Payable</span>
               <span className="text-3xl font-black text-gray-900 dark:text-white tracking-tight leading-none">{storeProfile.currency} {total.toLocaleString()}</span>
            </div>
            {changeDue > 0 && (
                <div className="text-right flex flex-col animate-fade-in">
                    <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest mb-0.5">Change Due</span>
                    <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400 leading-none">{storeProfile.currency} {changeDue.toLocaleString()}</span>
                </div>
            )}
          </div>

          {/* Payment Method Selector */}
          <div className="grid grid-cols-5 gap-1 mb-4 bg-gray-100 dark:bg-gray-800/50 p-1 rounded-2xl">
            {[
              { id: 'Cash', icon: Banknote, label: 'Cash' },
              { id: 'M-Pesa', icon: CreditCard, label: 'M-Pesa' },
              { id: 'Split', icon: Split, label: 'Split' },
              { id: 'Debt', icon: User, label: 'Debt' },
              { id: 'Credit', icon: Wallet, label: 'Credit' },
            ].map(pm => {
                const isSelected = paymentMethod === pm.id;
                return (
                  <button
                    key={pm.id}
                    onClick={() => setPaymentMethod(pm.id as any)}
                    className={`relative flex flex-col items-center justify-center py-2 rounded-xl transition-all duration-300 ${
                      isSelected
                        ? `bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm scale-100` 
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 scale-95 hover:scale-100'
                    }`}
                  >
                    <pm.icon className={`w-4 h-4 mb-0.5 ${isSelected ? 'animate-bounce text-primary-500' : ''}`} />
                    <span className="text-[8px] font-bold uppercase tracking-wider">{pm.label}</span>
                  </button>
                )
            })}
          </div>

          {/* Dynamic Payment Inputs - Reduced height */}
          <div className="space-y-3 mb-3 min-h-[70px]">
            {paymentMethod === 'Cash' && (
              <div className="space-y-2 animate-fade-in">
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-base">{storeProfile.currency}</span>
                  <input
                    name="cashTendered"
                    type="number"
                    placeholder="Enter Cash Received"
                    className="w-full pl-12 pr-4 py-3 text-lg font-bold bg-gray-50 dark:bg-black border border-gray-200 dark:border-gray-800 rounded-xl focus:ring-2 focus:ring-gray-900 dark:focus:ring-white outline-none transition-all placeholder:text-gray-400 dark:placeholder:text-gray-700 text-gray-900 dark:text-white"
                    value={cashTendered}
                    onChange={e => setCashTendered(e.target.value)}
                  />
                </div>
                <div className="flex gap-2 justify-between">
                   {quickCashAmounts.map(amt => (
                     <button 
                       key={amt}
                       onClick={() => setCashTendered(amt.toString())}
                       className="flex-1 py-1.5 text-[10px] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 font-bold text-gray-600 dark:text-gray-300 shadow-sm transition-transform active:scale-95"
                     >
                       {amt}
                     </button>
                   ))}
                </div>
              </div>
            )}

            {paymentMethod === 'M-Pesa' && (
              <div className="space-y-2 animate-fade-in">
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-base">{storeProfile.currency}</span>
                  <input
                    name="mpesaTendered"
                    type="number"
                    placeholder="Enter M-Pesa Amount"
                    className="w-full pl-12 pr-4 py-3 text-lg font-bold bg-green-50/50 dark:bg-green-900/10 border border-green-200 dark:border-green-900/30 rounded-xl focus:ring-2 focus:ring-green-500 outline-none transition-all placeholder:text-green-300 text-gray-900 dark:text-white"
                    value={mpesaTendered}
                    onChange={e => setMpesaTendered(e.target.value)}
                  />
                </div>
                 <div className="flex gap-2 justify-between">
                     <button 
                       onClick={() => setMpesaTendered(total.toString())}
                       className="w-full py-2 text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-lg hover:bg-green-200 dark:hover:bg-green-900/50 font-bold transition-transform active:scale-95"
                     >
                       Full Payment ({total})
                     </button>
                </div>
              </div>
            )}

            {paymentMethod === 'Split' && (
              <div className="space-y-2 animate-fade-in p-3 bg-blue-50 dark:bg-blue-900/10 rounded-xl border border-blue-100 dark:border-blue-900/20">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="split-cash" className="text-[9px] font-bold text-blue-600 dark:text-blue-400 uppercase block mb-1 ml-1">Cash Part</label>
                    <input
                      id="split-cash"
                      name="splitCash"
                      type="number"
                      placeholder="0"
                      className="w-full p-2 border border-blue-200 dark:border-blue-800 rounded-lg dark:bg-black text-gray-900 dark:text-white font-bold focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                      value={splitCash}
                      onChange={e => setSplitCash(e.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor="split-mpesa" className="text-[9px] font-bold text-blue-600 dark:text-blue-400 uppercase block mb-1 ml-1">M-Pesa Part</label>
                    <input
                      id="split-mpesa"
                      name="splitMpesa"
                      type="number"
                      placeholder="0"
                      className="w-full p-2 border border-blue-200 dark:border-blue-800 rounded-lg dark:bg-black text-gray-900 dark:text-white font-bold focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                      value={splitMpesa}
                      onChange={e => setSplitMpesa(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex justify-between text-[10px] font-bold pt-1 border-t border-blue-200 dark:border-blue-800 mt-1 pt-1">
                   <span className={Number(splitCash) + Number(splitMpesa) >= total ? "text-emerald-600" : "text-red-500"}>
                     Paid: {(Number(splitCash) + Number(splitMpesa)).toLocaleString()}
                   </span>
                </div>
              </div>
            )}

            {paymentMethod === 'Debt' && (
               <div className="space-y-2 animate-fade-in p-3 bg-red-50 dark:bg-red-900/10 rounded-xl border border-red-100 dark:border-red-900/20">
                  <div className="flex gap-2 mb-2 items-center">
                      <select 
                        value={selectedCustomerId}
                        onChange={(e) => setSelectedCustomerId(e.target.value)}
                        className="flex-1 w-full min-w-0 p-2.5 text-sm border border-red-200 dark:border-red-800 rounded-lg dark:bg-black text-gray-900 dark:text-white font-medium focus:ring-2 focus:ring-red-500 outline-none"
                      >
                          <option value="">-- Select Account --</option>
                          {customers.map(c => (
                              <option key={c.id} value={c.id}>
                                  {c.name} {c.phone ? `(${c.phone})` : ''} - Debt: {storeProfile.currency} {c.totalDebt}
                              </option>
                          ))}
                      </select>
                      <button 
                        onClick={() => setIsNewCustomerOpen(true)}
                        className="shrink-0 bg-red-600 text-white p-2.5 rounded-lg hover:bg-red-700 transition-colors shadow-md flex items-center gap-1.5"
                        title="Add New Customer"
                      >
                          <UserPlus className="w-4 h-4" />
                          <span className="text-xs font-bold">New</span>
                      </button>
                  </div>
                  
                  {/* Upfront Payment Section */}
                  <div className="mt-2">
                      <div className="flex justify-between items-center mb-1">
                        <label htmlFor="debt-upfront" className="text-[9px] font-bold text-red-600 dark:text-red-400 uppercase ml-1">Upfront Payment (Optional)</label>
                      </div>
                      
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs font-bold">{storeProfile.currency}</span>
                            <input
                                id="debt-upfront"
                                type="number"
                                placeholder="0.00"
                                value={debtUpfront}
                                onChange={(e) => setDebtUpfront(e.target.value)}
                                className="w-full pl-9 p-2 border border-red-200 dark:border-red-800 rounded-lg dark:bg-black text-gray-900 dark:text-white font-bold focus:ring-2 focus:ring-red-500 outline-none text-sm"
                            />
                        </div>
                        {/* Method Selector */}
                        <div className="flex bg-white dark:bg-black rounded-lg border border-red-200 dark:border-red-800 p-1">
                            <button 
                                onClick={() => setDebtUpfrontMethod('Cash')}
                                className={`px-4 py-1.5 rounded-md text-[10px] font-bold transition-all flex items-center gap-1 ${debtUpfrontMethod === 'Cash' ? 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                            >
                                <Banknote className="w-3 h-3" /> Cash
                            </button>
                            <button 
                                onClick={() => setDebtUpfrontMethod('M-Pesa')}
                                className={`px-4 py-1.5 rounded-md text-[10px] font-bold transition-all flex items-center gap-1 ${debtUpfrontMethod === 'M-Pesa' ? 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                            >
                                <CreditCard className="w-3 h-3" /> M-Pesa
                            </button>
                        </div>
                      </div>
                  </div>

                  {selectedCustomerId && (() => {
                      const c = customers.find(cus => cus.id === selectedCustomerId);
                      const upfront = Number(debtUpfront) || 0;
                      const debtToAdd = Math.max(0, total - upfront);
                      
                      return c ? (
                          <div className="text-xs text-red-600 dark:text-red-400 font-medium px-1 mt-2 border-t border-red-100 dark:border-red-800/50 pt-2">
                              <div className="flex justify-between">
                                  <span>Current Debt:</span>
                                  <span>{storeProfile.currency} {c.totalDebt.toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between">
                                  <span>Adding Debt:</span>
                                  <span>+ {storeProfile.currency} {debtToAdd.toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between font-bold border-t border-red-200 dark:border-red-800/50 mt-1 pt-1">
                                  <span>New Total:</span>
                                  <span>{storeProfile.currency} {(c.totalDebt + debtToAdd).toLocaleString()}</span>
                              </div>
                          </div>
                      ) : null;
                  })()}
                </div>
            )}
            {paymentMethod === 'Credit' && (
               <div className="space-y-2 animate-fade-in p-3 bg-purple-50 dark:bg-purple-900/10 rounded-xl border border-purple-100 dark:border-purple-900/20">
                  <div className="flex gap-2 mb-2 items-center">
                      <select 
                        value={selectedCustomerId}
                        onChange={(e) => setSelectedCustomerId(e.target.value)}
                        className="flex-1 w-full min-w-0 p-2.5 text-sm border border-purple-200 dark:border-purple-800 rounded-lg dark:bg-black text-gray-900 dark:text-white font-medium focus:ring-2 focus:ring-purple-500 outline-none"
                      >
                          <option value="">-- Select Account --</option>
                          {customers.map(c => (
                              <option key={c.id} value={c.id}>
                                  {c.name} {c.phone ? `(${c.phone})` : ''} - Bal: {storeProfile.currency} {c.creditBalance || 0}
                              </option>
                          ))}
                      </select>
                  </div>
                  
                  {selectedCustomerId && (() => {
                      const customer = customers.find(c => c.id === selectedCustomerId);
                      const balance = customer?.creditBalance || 0;
                      const isSufficient = balance >= total;
                      return (
                          <div className={`p-3 rounded-lg border text-sm font-bold flex justify-between items-center ${isSufficient ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                              <span>Available Credit: {storeProfile.currency} {balance.toLocaleString()}</span>
                              {!isSufficient && <span className="text-xs uppercase bg-red-200 px-2 py-1 rounded">Insufficient</span>}
                          </div>
                      );
                  })()}
               </div>
            )}
          </div>

          <button
            onClick={handleCheckout}
            disabled={cart.length === 0 || ((paymentMethod === 'Debt' || paymentMethod === 'Credit') && !selectedCustomerId)}
            className={`w-full font-black py-3.5 rounded-xl shadow-xl transition-all transform active:scale-[0.98] flex items-center justify-center gap-3 text-base ${
               cart.length === 0 || ((paymentMethod === 'Debt' || paymentMethod === 'Credit') && !selectedCustomerId)
               ? 'bg-gray-300 text-gray-500 cursor-not-allowed shadow-none'
               : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-900/20'
            }`}
          >
            {paymentMethod === 'Debt' ? 'Record Transaction' : 'Complete Sale'}
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Petty Cash Modal */}
      {isPettyCashOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
           <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-[0_4px_12px_rgba(0,0,0,0.08)] w-full max-w-sm overflow-hidden animate-fade-in border border-gray-100 dark:border-gray-800 transform scale-100">
             <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50 dark:bg-black/50">
              <h3 className="text-xl font-black text-gray-900 dark:text-white tracking-tight">Withrawal</h3>
              <button onClick={() => setIsPettyCashOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            <form onSubmit={handlePettyCashSubmit} className="p-6 space-y-5">
              <div>
                <label htmlFor="petty-amount" className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Amount</label>
                <input 
                  id="petty-amount"
                  name="amount"
                  required
                  type="number"
                  value={pettyCashAmount}
                  onChange={e => setPettyCashAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full p-3 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-black dark:text-white focus:ring-2 focus:ring-red-500 outline-none font-bold"
                />
              </div>
              <div>
                <label htmlFor="petty-reason" className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Reason</label>
                <input 
                  id="petty-reason"
                  name="reason"
                  required
                  type="text"
                  value={pettyCashReason}
                  onChange={e => setPettyCashReason(e.target.value)}
                  placeholder="e.g. Lunch, Transport, Restocking"
                  className="w-full p-3 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-black dark:text-white focus:ring-2 focus:ring-red-500 outline-none"
                />
              </div>
              <div>
                 <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Source</label>
                 <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={() => setPettyCashSource('Cash')}
                        className={`flex-1 py-3 px-4 rounded-xl font-bold flex items-center justify-center gap-2 border transition-all ${pettyCashSource === 'Cash' ? 'bg-gray-800 text-white border-transparent' : 'bg-white dark:bg-black border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'}`}
                    >
                        <Banknote className="w-4 h-4" /> Cash
                    </button>
                    <button
                        type="button"
                        onClick={() => setPettyCashSource('M-Pesa')}
                        className={`flex-1 py-3 px-4 rounded-xl font-bold flex items-center justify-center gap-2 border transition-all ${pettyCashSource === 'M-Pesa' ? 'bg-green-600 text-white border-transparent' : 'bg-white dark:bg-black border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'}`}
                    >
                        <CreditCard className="w-4 h-4" /> M-Pesa
                    </button>
                 </div>
              </div>
              <button type="submit" className="w-full bg-red-600 text-white py-3.5 rounded-xl hover:bg-red-700 font-bold shadow-lg shadow-red-900/20 transform active:scale-95 transition-all">
                Withdraw
              </button>
            </form>
           </div>
        </div>
      )}

      {/* New Customer Modal */}
      {isNewCustomerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
           <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-[0_4px_12px_rgba(0,0,0,0.08)] w-full max-w-sm overflow-hidden animate-fade-in border border-gray-100 dark:border-gray-800 transform scale-100">
             <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50 dark:bg-black/50">
              <h3 className="text-xl font-black text-gray-900 dark:text-white tracking-tight">New Customer</h3>
              <button onClick={() => setIsNewCustomerOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
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
                  className="w-full p-3 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-black dark:text-white focus:ring-2 focus:ring-red-500 outline-none"
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
                  className="w-full p-3 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-black dark:text-white focus:ring-2 focus:ring-red-500 outline-none"
                />
              </div>
              <button type="submit" className="w-full bg-red-600 text-white py-3.5 rounded-xl hover:bg-red-700 font-bold shadow-lg shadow-red-900/20 transform active:scale-95 transition-all">
                Create Customer
              </button>
            </form>
           </div>
        </div>
      )}
      {/* Receipt Modal */}
      {receiptTransaction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
           <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-[0_4px_12px_rgba(0,0,0,0.08)] w-full max-w-md overflow-hidden animate-fade-in border border-gray-100 dark:border-gray-800 transform scale-100 flex flex-col max-h-[90vh]">
             <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50 dark:bg-black/50">
              <h3 className="text-xl font-black text-gray-900 dark:text-white tracking-tight">Sale Complete</h3>
              <button onClick={() => setReceiptTransaction(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 bg-gray-50 dark:bg-gray-900/50">
                <div className="bg-white dark:bg-black p-8 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm font-mono text-sm text-gray-800 dark:text-gray-300 relative overflow-hidden">
                    {/* Decorative top edge */}
                    <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-primary-500 to-primary-600"></div>

                    <div className="text-center mb-8 pt-2">
                        {storeProfile.logoUrl ? (
                            <img src={storeProfile.logoUrl} alt="Logo" className="h-16 mx-auto mb-4 object-contain" referrerPolicy="no-referrer" />
                        ) : (
                            <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
                                <Box className="w-8 h-8 text-gray-400" />
                            </div>
                        )}
                        <h2 className="text-2xl font-black text-gray-900 dark:text-white mb-1 tracking-tight">{storeProfile.name}</h2>
                        <p className="text-gray-500 text-xs uppercase tracking-widest">{storeProfile.location}</p>
                        
                        <div className="mt-6 flex flex-col items-center justify-center space-y-1 text-xs text-gray-500">
                            <p>Receipt #: <span className="font-bold text-gray-700 dark:text-gray-300">{receiptTransaction.id.substring(0, 8).toUpperCase()}</span></p>
                            <p>{new Date(receiptTransaction.date).toLocaleString()}</p>
                        </div>
                    </div>

                    <div className="border-t-2 border-dashed border-gray-200 dark:border-gray-800 pt-6 pb-2 mb-4">
                        <div className="flex justify-between font-bold text-gray-400 dark:text-gray-500 text-xs uppercase tracking-wider mb-4">
                            <span>Item</span>
                            <div className="flex gap-6 text-right">
                                <span className="w-8">Qty</span>
                                <span className="w-16">Total</span>
                            </div>
                        </div>
                        <div className="space-y-4">
                            {receiptTransaction.items.map((item, idx) => (
                                <div key={idx} className="flex justify-between items-start group">
                                    <div className="flex-1 pr-4">
                                        <p className="font-bold text-gray-900 dark:text-white">{item.name}</p>
                                        <p className="text-xs text-gray-500">@{storeProfile.currency} {item.price.toFixed(2)}</p>
                                    </div>
                                    <div className="flex gap-6 text-right items-center mt-1">
                                        <span className="w-8 text-gray-600 dark:text-gray-400 font-medium">x{item.quantity}</span>
                                        <span className="w-16 font-bold text-gray-900 dark:text-white">{(item.price * item.quantity).toFixed(2)}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="border-t-2 border-dashed border-gray-200 dark:border-gray-800 pt-4 mb-6 space-y-3">
                        <div className="flex justify-between text-gray-600 dark:text-gray-400">
                            <span>Subtotal</span>
                            <span className="font-medium">{storeProfile.currency} {(receiptTransaction.subtotal || receiptTransaction.total).toFixed(2)}</span>
                        </div>
                        
                        {/* Dedicated Discount & Tax Section */}
                        <div className="bg-gray-50 dark:bg-gray-800/50 p-3 rounded-lg space-y-2">
                            <div className="flex justify-between text-gray-600 dark:text-gray-400 text-sm">
                                <span>Discount</span>
                                <span className="text-red-500 font-medium">
                                    {receiptTransaction.discount ? `-${storeProfile.currency} ${receiptTransaction.discount.toFixed(2)}` : `${storeProfile.currency} 0.00`}
                                </span>
                            </div>
                            <div className="flex justify-between text-gray-600 dark:text-gray-400 text-sm">
                                <span>Tax (0%)</span>
                                <span className="font-medium">{storeProfile.currency} {(receiptTransaction.tax || 0).toFixed(2)}</span>
                            </div>
                        </div>

                        <div className="flex justify-between items-end pt-4">
                            <span className="text-lg font-bold text-gray-900 dark:text-white">Total</span>
                            <span className="text-3xl font-black text-gray-900 dark:text-white tracking-tight">{storeProfile.currency} {receiptTransaction.total.toFixed(2)}</span>
                        </div>
                    </div>

                    <div className="border-t-2 border-dashed border-gray-200 dark:border-gray-800 pt-6 text-center">
                        <div className="inline-block bg-gray-100 dark:bg-gray-800 px-4 py-2 rounded-lg mb-6">
                            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Payment Method</p>
                            <p className="font-bold text-gray-900 dark:text-white">{receiptTransaction.paymentMethod}</p>
                        </div>
                        <p className="text-gray-500 font-medium">Thank you for your business!</p>
                        <p className="text-xs text-gray-400 mt-1">Please come again</p>
                    </div>
                </div>
            </div>

            <div className="p-6 border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-black/50 flex gap-3">
                <button 
                    onClick={() => printReceipt(receiptTransaction)}
                    className="flex-1 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 py-3 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 font-bold transition-all flex items-center justify-center gap-2"
                >
                    <Printer className="w-5 h-5" /> Print
                </button>
                <button 
                    onClick={() => emailReceipt(receiptTransaction)}
                    className="flex-1 bg-primary-600 text-white py-3 rounded-xl hover:bg-primary-700 font-bold shadow-lg shadow-primary-900/20 transition-all flex items-center justify-center gap-2"
                >
                    <Mail className="w-5 h-5" /> Email
                </button>
            </div>
           </div>
        </div>
      )}
    </div>
  );
};
