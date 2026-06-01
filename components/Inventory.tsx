
import React, { useState, useRef, useEffect } from 'react';
import { Plus, Edit2, Trash2, Search, Package, Save, X, Download, Upload, Layers, LayoutGrid, List, MoreVertical, ArrowDownUp, GripVertical, FileSpreadsheet, ChevronDown, ChevronRight, ClipboardList, Calendar, AlertTriangle } from 'lucide-react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Product, StoreProfile } from '../types';
import { getStockLogs } from '../utils/db';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

// Utility Safe ID (Duplicate for safety/isolation)
const generateId = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 9);

interface InventoryProps {
  products: Product[];
  onAddProduct: (product: Product) => void;
  onUpdateProduct: (product: Product) => void;
  onDeleteProduct: (id: string) => void;
  onReorderProducts: (products: Product[]) => void;
  onBulkAddProducts: (products: Product[]) => void;
  onRestock: (productId: string, quantity: number, reason: string, expiryDate?: string) => void;
  storeProfile: StoreProfile;
}

export const Inventory: React.FC<InventoryProps> = ({ products, onAddProduct, onUpdateProduct, onDeleteProduct, onReorderProducts, onBulkAddProducts, onRestock, storeProfile }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isStockModalOpen, setIsStockModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  // Sort by name or price within categories.
  const [sortBy, setSortBy] = useState<'custom' | 'name' | 'stock_asc' | 'stock_desc' | 'price_high' | 'price_low' | 'expiry_soon'>('custom');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  
  // Category Collapsed State
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});

  // Initialize collapsed state for new categories
  useEffect(() => {
    const uniqueCategories = Array.from(new Set(products.map(p => p.category)));
    setCollapsedCategories(prev => {
      const newState = { ...prev };
      let hasChanges = false;
      uniqueCategories.forEach(cat => {
        if (newState[cat] === undefined) {
          newState[cat] = true; // Default to collapsed
          hasChanges = true;
        }
      });
      return hasChanges ? newState : prev;
    });
  }, [products]);

  // State for Quick Stock Add
  const [selectedStockProduct, setSelectedStockProduct] = useState<string>('');
  const [stockToAdd, setStockToAdd] = useState<string>('0');
  const [stockReason, setStockReason] = useState<string>('Restock');
  const [stockExpiry, setStockExpiry] = useState<string>('');

  const initialForm = {
    name: '',
    category: '',
    buyPrice: '',
    sellPrice: '',
    stock: '',
    image: '',
    measurementUnit: 'pcs',
    expiryDate: '',
    reorderPoint: ''
  };
  const [form, setForm] = useState(initialForm);

  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setIsExportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Basic size check (500KB limit for localStorage safety)
      if (file.size > 500000) {
        alert("Image is too large! Please pick an image under 500KB to prevent storage issues.");
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setForm(prev => ({ ...prev, image: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCSVImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split('\n');
      if (lines.length < 2) {
        alert("CSV file seems empty or missing headers.");
        return;
      }

      // Detect headers
      const headers = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/^"|"$/g, ''));
      const colMap = {
        name: headers.findIndex(h => h.includes('name') || h.includes('product') || h.includes('item')),
        category: headers.findIndex(h => h.includes('category') || h.includes('cat')),
        buy: headers.findIndex(h => h.includes('buy') || h.includes('cost')),
        // Fix: Explicitly exclude 'buy' and 'cost' when searching for 'price' to prevent matching 'Buying Price'
        sell: headers.findIndex(h => h.includes('sell') || (h.includes('price') && !h.includes('buy') && !h.includes('cost'))),
        stock: headers.findIndex(h => h.includes('stock') || h.includes('qty') || h.includes('quantity')),
        unit: headers.findIndex(h => h.includes('unit') || h.includes('measure')),
        expiry: headers.findIndex(h => h.includes('expiry') || h.includes('expire') || h.includes('date'))
      };

      if (colMap.name === -1) {
        alert("Could not find a 'Name' column in the CSV.");
        return;
      }

      const newProducts: Product[] = [];
      let skipped = 0;

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        // Handle commas inside quotes properly or use simple split
        // For simplicity, assuming simple CSV. A regex split is better but complex to implement inline.
        const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
        
        const name = cols[colMap.name];
        if (!name) {
          skipped++;
          continue;
        }

        const product: Product = {
          id: generateId() + i, // Unique ID
          name: name,
          category: colMap.category > -1 ? cols[colMap.category] || 'General' : 'General',
          buyPrice: colMap.buy > -1 ? Number(cols[colMap.buy]) || 0 : 0,
          sellPrice: colMap.sell > -1 ? Number(cols[colMap.sell]) || 0 : 0,
          stock: colMap.stock > -1 ? Number(cols[colMap.stock]) || 0 : 0,
          measurementUnit: colMap.unit > -1 ? cols[colMap.unit] || 'pcs' : 'pcs',
          expiryDate: colMap.expiry > -1 ? cols[colMap.expiry] : undefined,
          image: `https://via.placeholder.com/400?text=${name.charAt(0).toUpperCase()}`
        };
        newProducts.push(product);
      }

      if (newProducts.length > 0) {
        if(confirm(`Ready to import ${newProducts.length} products?`)) {
          onBulkAddProducts(newProducts);
          alert(`Successfully imported ${newProducts.length} products.`);
        }
      } else {
        alert("No valid products found to import.");
      }
      
      // Reset input
      if(csvInputRef.current) csvInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const productData: Product = {
      id: editingId || generateId(),
      name: form.name,
      category: form.category || 'General',
      buyPrice: Number(form.buyPrice),
      sellPrice: Number(form.sellPrice),
      stock: Number(form.stock),
      image: form.image || `https://via.placeholder.com/400?text=${form.name.charAt(0)}`,
      measurementUnit: form.measurementUnit || 'pcs',
      expiryDate: form.expiryDate || undefined,
      reorderPoint: form.reorderPoint !== '' ? Number(form.reorderPoint) : undefined
    };

    if (editingId) {
      onUpdateProduct(productData);
    } else {
      onAddProduct(productData);
    }
    closeModal();
  };

  const handleQuickStockSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const product = products.find(p => p.id === selectedStockProduct);
    const qty = Number(stockToAdd);
    if (product && qty !== 0) {
      onRestock(selectedStockProduct, qty, stockReason, stockExpiry || undefined);
      setIsStockModalOpen(false);
      setSelectedStockProduct('');
      setStockToAdd('0');
      setStockReason('Restock');
      setStockExpiry('');
      alert(`Updated stock for ${product.name}. Added: ${qty}`);
    }
  };

  const handleEdit = (product: Product) => {
    setForm({
      name: product.name,
      category: product.category,
      buyPrice: product.buyPrice.toString(),
      sellPrice: product.sellPrice.toString(),
      stock: product.stock.toString(),
      image: product.image,
      measurementUnit: product.measurementUnit || 'pcs',
      expiryDate: product.expiryDate || '',
      reorderPoint: product.reorderPoint !== undefined ? product.reorderPoint.toString() : ''
    });
    setEditingId(product.id);
    setIsModalOpen(true);
  };

  const openQuickStock = (productId: string) => {
    setSelectedStockProduct(productId);
    setStockToAdd('0');
    setStockReason('Restock');
    setStockExpiry(''); // Reset expiry
    setIsStockModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
    setForm(initialForm);
  };

  const exportToCSV = (filterType: 'all' | 'out-of-stock' | 'low-stock' = 'all') => {
    let filteredProducts = products;
    if (filterType === 'out-of-stock') {
      filteredProducts = products.filter(p => p.stock === 0);
    } else if (filterType === 'low-stock') {
      filteredProducts = products.filter(p => p.stock > 0 && (p.reorderPoint !== undefined ? p.stock <= p.reorderPoint : p.stock <= 5));
    }
    
    if (filteredProducts.length === 0) {
      alert(`No products found for ${filterType} export.`);
      setIsExportMenuOpen(false);
      return;
    }

    const headers = ["Name", "Category", "Buying Price", "Selling Price", "Stock", "Unit", "Expiry Date"];
    const rows = filteredProducts.map(p => [
      `"${p.name.replace(/"/g, '""')}"`,
      `"${p.category.replace(/"/g, '""')}"`,
      p.buyPrice,
      p.sellPrice,
      p.stock,
      p.measurementUnit || 'pcs',
      p.expiryDate || ''
    ]);

    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    let fileName = `inventory_${new Date().toISOString().split('T')[0]}.csv`;
    if (filterType === 'out-of-stock') fileName = `out_of_stock_${new Date().toISOString().split('T')[0]}.csv`;
    if (filterType === 'low-stock') fileName = `low_stock_${new Date().toISOString().split('T')[0]}.csv`;
    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setIsExportMenuOpen(false);
  };
  
  const handleGenerateMasterReport = async () => {
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
            log.reason,
            log.expiryDate ? new Date(log.expiryDate).toLocaleDateString() : '-'
        ]);

        autoTable(doc, {
            startY: 35,
            head: [['Date/Time', 'Product', 'Change', 'Level', 'Reason', 'Batch Expiry']],
            body: tableData,
            theme: 'striped',
            headStyles: { fillColor: [41, 128, 185], textColor: 255 },
            styles: { fontSize: 8 },
            columnStyles: {
                0: { cellWidth: 35 },
                1: { cellWidth: 40 },
                2: { cellWidth: 20, halign: 'right' },
                3: { cellWidth: 20, halign: 'right' },
                4: { cellWidth: 'auto' },
                5: { cellWidth: 25 }
            }
        });

        doc.save(`stock_master_report_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (error) {
        console.error("Failed to generate report", error);
        alert("Could not generate stock report.");
    }
  }

  const toggleCategory = (cat: string) => {
      setCollapsedCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
  }

  // Processing logic
  const getProcessedProducts = () => {
    // 1. Filter
    let filtered = products.filter(p => 
      p.name.toLowerCase().includes(search.toLowerCase()) || 
      p.category.toLowerCase().includes(search.toLowerCase())
    );

    // 2. Sort within categories will be handled during render map
    return filtered;
  };

  const processedProducts = getProcessedProducts();
  let categories: string[] = Array.from(new Set(processedProducts.map(p => p.category)));
  if (sortBy !== 'custom') {
      categories.sort();
  }

  const sortProducts = (list: Product[]) => {
      if (sortBy === 'custom') return list;
      return [...list].sort((a, b) => {
          if (sortBy === 'name') return a.name.localeCompare(b.name);
          if (sortBy === 'stock_asc') return a.stock - b.stock;
          if (sortBy === 'stock_desc') return b.stock - a.stock;
          if (sortBy === 'price_high') return b.sellPrice - a.sellPrice;
          if (sortBy === 'price_low') return a.sellPrice - b.sellPrice;
          if (sortBy === 'expiry_soon') {
             if (!a.expiryDate) return 1;
             if (!b.expiryDate) return -1;
             return new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime();
          }
          return 0;
      });
  }

  // Helper to determine expiry status visuals
  const getExpiryStatus = (expiryDate?: string) => {
    if (!expiryDate) return null;
    const daysToExpiry = Math.ceil((new Date(expiryDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysToExpiry <= 0) return { color: 'bg-red-500', text: 'Expired', days: daysToExpiry, urgent: true };
    if (daysToExpiry <= 2) return { color: 'bg-amber-500', text: `Exp: ${daysToExpiry} days`, days: daysToExpiry, urgent: true };
    return { color: 'bg-black/60', text: `Exp: ${new Date(expiryDate).toLocaleDateString()}`, days: daysToExpiry, urgent: false };
  }

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const { source, destination, type } = result;
    
    setSortBy('custom');

    if (type === 'category') {
      const newCategories = Array.from(categories);
      const [removed] = newCategories.splice(source.index, 1);
      newCategories.splice(destination.index, 0, removed);

      const newProducts: Product[] = [];
      newCategories.forEach(cat => {
        newProducts.push(...products.filter(p => p.category === cat));
      });
      // Add any products that might not have a category in newCategories (e.g. when searching)
      const remainingProducts = products.filter(p => !newCategories.includes(p.category));
      newProducts.push(...remainingProducts);
      onReorderProducts(newProducts);
    } else if (type === 'product') {
      const sourceCategory = source.droppableId;
      const destCategory = destination.droppableId;

      // Use processedProducts to get the correct dragged product based on the rendered list
      const renderedSourceProducts = sortProducts(processedProducts.filter(p => p.category === sourceCategory));
      const draggedProduct = renderedSourceProducts[source.index];
      
      if (!draggedProduct) return;

      if (sourceCategory === destCategory) {
        const categoryProducts = products.filter(p => p.category === sourceCategory);
        
        // Find the actual index of the dragged product in the full category products list
        const actualSourceIndex = categoryProducts.findIndex(p => p.id === draggedProduct.id);
        if (actualSourceIndex === -1) return;

        categoryProducts.splice(actualSourceIndex, 1);
        
        // Find the actual destination index. If dropping at the end of the filtered list, put it at the end of the full list.
        // Otherwise, put it before the item that is currently at the destination index in the filtered list.
        const renderedDestProducts = sortProducts(processedProducts.filter(p => p.category === destCategory));
        let actualDestIndex = categoryProducts.length; // Default to end
        
        if (destination.index < renderedDestProducts.length) {
            const targetProduct = renderedDestProducts[destination.index];
            if (targetProduct && targetProduct.id !== draggedProduct.id) {
                const targetActualIndex = categoryProducts.findIndex(p => p.id === targetProduct.id);
                if (targetActualIndex !== -1) {
                    actualDestIndex = targetActualIndex;
                }
            }
        }

        categoryProducts.splice(actualDestIndex, 0, draggedProduct);

        const finalProducts: Product[] = [];
        categories.forEach(cat => {
          if (cat === sourceCategory) {
            finalProducts.push(...categoryProducts);
          } else {
            finalProducts.push(...products.filter(p => p.category === cat));
          }
        });
        const remainingProducts = products.filter(p => !categories.includes(p.category));
        finalProducts.push(...remainingProducts);
        onReorderProducts(finalProducts);
      } else {
        const updatedProduct = { ...draggedProduct, category: destCategory };
        
        const sourceCatProducts = products.filter(p => p.category === sourceCategory);
        const actualSourceIndex = sourceCatProducts.findIndex(p => p.id === draggedProduct.id);
        if (actualSourceIndex !== -1) {
            sourceCatProducts.splice(actualSourceIndex, 1);
        }

        const destCatProducts = products.filter(p => p.category === destCategory);
        
        const renderedDestProducts = sortProducts(processedProducts.filter(p => p.category === destCategory));
        let actualDestIndex = destCatProducts.length;
        
        if (destination.index < renderedDestProducts.length) {
            const targetProduct = renderedDestProducts[destination.index];
            if (targetProduct) {
                const targetActualIndex = destCatProducts.findIndex(p => p.id === targetProduct.id);
                if (targetActualIndex !== -1) {
                    actualDestIndex = targetActualIndex;
                }
            }
        }
        
        destCatProducts.splice(actualDestIndex, 0, updatedProduct);

        const finalProducts: Product[] = [];
        categories.forEach(cat => {
          if (cat === sourceCategory) {
            finalProducts.push(...sourceCatProducts);
          } else if (cat === destCategory) {
            finalProducts.push(...destCatProducts);
          } else {
            finalProducts.push(...products.filter(p => p.category === cat));
          }
        });
        const remainingProducts = products.filter(p => !categories.includes(p.category));
        finalProducts.push(...remainingProducts);
        onReorderProducts(finalProducts);
      }
    }
  };

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 bg-white dark:bg-gray-900 p-4 rounded-3xl shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)] transition-all border border-gray-100 dark:border-gray-800">
        <div>
          <h2 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">Inventory</h2>
          <p className="text-gray-500 text-sm">Manage your products, stock levels, and pricing.</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto">
           <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder="Search products..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-black border border-gray-200 dark:border-gray-800 rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-white transition-all shadow-sm"
            />
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <select 
                value={sortBy} 
                onChange={(e) => setSortBy(e.target.value as any)}
                className="appearance-none pl-9 pr-8 py-2.5 bg-gray-50 dark:bg-black border border-gray-200 dark:border-gray-800 rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm font-medium dark:text-white cursor-pointer"
              >
                <option value="custom">Custom Order</option>
                <option value="name">Name (A-Z)</option>
                <option value="stock_asc">Stock (Low to High)</option>
                <option value="stock_desc">Stock (High to Low)</option>
                <option value="price_high">Price (High to Low)</option>
                <option value="price_low">Price (Low to High)</option>
                <option value="expiry_soon">Expiry (Soonest)</option>
              </select>
              <ArrowDownUp className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          </div>

          <div className="flex bg-gray-100 dark:bg-gray-800 rounded-xl p-1 border border-gray-100 dark:border-gray-800">
            <button 
              onClick={() => setViewMode('grid')}
              className={`p-2 rounded-md transition-all ${viewMode === 'grid' ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
            >
              <LayoutGrid className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setViewMode('list')}
              className={`p-2 rounded-md transition-all ${viewMode === 'list' ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
            >
              <List className="w-5 h-5" />
            </button>
          </div>

          <button
            onClick={() => setIsStockModalOpen(true)}
            className="flex items-center gap-2 bg-emerald-600 text-white px-3 py-2.5 rounded-2xl hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-900/20 font-semibold"
            title="Quick Add Stock"
          >
            <Layers className="w-4 h-4" />
          </button>

          {/* Master Report Button */}
          <button
            onClick={handleGenerateMasterReport}
            className="flex items-center gap-2 bg-purple-600 text-white px-3 py-2.5 rounded-2xl hover:bg-purple-700 transition-all shadow-lg shadow-purple-900/20 font-semibold"
            title="Master Stock Report"
          >
            <ClipboardList className="w-4 h-4" />
          </button>
          
           {/* Export Button */}
          <div className="relative" ref={exportMenuRef}>
            <button
              onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
              className="flex items-center gap-2 bg-gray-800 dark:bg-gray-700 text-white px-3 py-2.5 rounded-2xl hover:bg-gray-900 dark:hover:bg-gray-600 transition-all shadow-lg shadow-gray-900/20 font-semibold"
              title="Export CSV Options"
            >
              <Download className="w-4 h-4" />
              <ChevronDown className="w-4 h-4 hidden sm:block opacity-70" />
            </button>
            {isExportMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-gray-800 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-gray-100 dark:border-gray-700 py-2 z-50 animate-fade-in origin-top-right">
                <button 
                  onClick={() => exportToCSV('all')}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 font-bold transition-colors"
                >
                  Export All Inventory
                </button>
                <div className="h-px bg-gray-100 dark:bg-gray-700 my-1"></div>
                <button 
                  onClick={() => exportToCSV('out-of-stock')}
                  className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 font-bold transition-colors flex items-center justify-between"
                >
                  Export Out of Stock
                </button>
                <button 
                  onClick={() => exportToCSV('low-stock')}
                  className="w-full text-left px-4 py-2 text-sm text-yellow-600 dark:text-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 font-bold transition-colors flex items-center justify-between"
                >
                  Export Low Stock
                </button>
              </div>
            )}
          </div>
          
          {/* Import Button */}
          <label 
             className="flex items-center gap-2 bg-blue-600 text-white px-3 py-2.5 rounded-2xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-900/20 font-semibold cursor-pointer"
             title="Import from CSV"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <input 
              type="file" 
              accept=".csv"
              ref={csvInputRef}
              className="hidden" 
              onChange={handleCSVImport} 
            />
          </label>

          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2.5 rounded-2xl hover:bg-primary-700 transition-all shadow-lg shadow-primary-900/20 font-semibold"
          >
            <Plus className="w-5 h-5" /> <span className="hidden sm:inline">Add Product</span>
          </button>
        </div>
      </div>

      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="categories" type="category">
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps} className="flex-1 overflow-y-auto space-y-8 pb-10">
              {processedProducts.length === 0 && (
                <div className="p-12 text-center text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-900 rounded-3xl border border-dashed border-gray-300 dark:border-gray-700 mt-4">
                  <Package className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <h3 className="text-lg font-bold mb-1">No products found</h3>
                  <p>Try adjusting your search, add a new product, or import a CSV file.</p>
                </div>
              )}

              {categories.map((category, index) => {
                  const categoryProducts = sortProducts(processedProducts.filter(p => p.category === category));
                  if (categoryProducts.length === 0) return null;
                  const isCollapsed = collapsedCategories[category];

                  return (
                    <Draggable key={category} draggableId={category} index={index} isDragDisabled={sortBy !== 'custom'}>
                      {(provided) => (
                        <div ref={provided.innerRef} {...provided.draggableProps} className="space-y-4">
                            <div 
                                className="flex items-center gap-2 group select-none"
                            >
                                <div {...provided.dragHandleProps} className={`p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors ${sortBy !== 'custom' ? 'opacity-50 cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'}`}>
                                  <GripVertical className="w-4 h-4" />
                                </div>
                                <div 
                                  onClick={() => toggleCategory(category)}
                                  className="p-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-500 group-hover:text-primary-600 transition-colors cursor-pointer"
                                >
                                    {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                </div>
                                <h3 className="text-lg font-bold text-gray-800 dark:text-white group-hover:text-primary-600 transition-colors flex items-center gap-2 cursor-pointer" onClick={() => toggleCategory(category)}>
                                    {category}
                                    <span className="text-xs font-normal bg-gray-100 dark:bg-gray-800 text-gray-500 px-2 py-0.5 rounded-full">{categoryProducts.length}</span>
                                </h3>
                                <div className="h-px flex-1 bg-gray-200 dark:bg-gray-800 group-hover:bg-primary-100 transition-colors"></div>
                            </div>

                            {!isCollapsed && (
                                <Droppable droppableId={category} type="product" direction={viewMode === 'grid' ? 'horizontal' : 'vertical'}>
                                  {(provided) => (
                                    <div ref={provided.innerRef} {...provided.droppableProps}>
                                    {viewMode === 'grid' ? (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6 p-1 animate-fade-in">
                                        {categoryProducts.map((p, pIndex) => {
                                        const margin = p.sellPrice > 0 ? ((p.sellPrice - p.buyPrice) / p.sellPrice * 100).toFixed(0) : '0';
                                        const isLowStock = p.reorderPoint !== undefined ? p.stock <= p.reorderPoint : p.stock <= 5;
                                        const expiryStatus = getExpiryStatus(p.expiryDate);

                                        return (
                                          <Draggable key={p.id} draggableId={p.id} index={pIndex} isDragDisabled={sortBy !== 'custom'}>
                                            {(provided) => (
                                              <div 
                                              ref={provided.innerRef}
                                              {...provided.draggableProps}
                                              className={`group bg-white dark:bg-gray-900 rounded-3xl border border-gray-100 dark:border-gray-800 shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)] hover:-translate-y-1 transition-all duration-300 overflow-hidden flex flex-col`}
                                              >
                                              <div className="relative aspect-[4/3] overflow-hidden bg-gray-50 dark:bg-gray-800">
                                                  <div {...provided.dragHandleProps} className={`absolute top-3 left-3 z-10 p-1.5 rounded-xl bg-white/80 dark:bg-black/50 backdrop-blur-md text-gray-600 dark:text-gray-300 shadow-sm ${sortBy !== 'custom' ? 'opacity-0' : 'opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing'} transition-opacity`}>
                                                    <GripVertical className="w-4 h-4" />
                                                  </div>
                                                  <img src={p.image} alt={p.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                                                  
                                                  <div className="absolute top-3 right-3 flex flex-col gap-2 items-end">
                                                      <span className={`px-2.5 py-1 rounded-xl text-xs font-bold backdrop-blur-md shadow-sm ${isLowStock ? 'bg-red-500/90 text-white' : 'bg-white/90 text-gray-800 dark:bg-black/70 dark:text-white'}`}>
                                                          {p.stock} {p.measurementUnit || 'pcs'}
                                                      </span>
                                                  </div>
                                                  
                                                  {expiryStatus && (
                                                      <div className={`absolute top-3 left-12 px-2 py-1 rounded-xl text-xs font-bold backdrop-blur-md shadow-sm flex items-center gap-1 ${expiryStatus.color} text-white`}>
                                                          {expiryStatus.urgent && <AlertTriangle className="w-3 h-3" />}
                                                          {expiryStatus.text}
                                                      </div>
                                                  )}

                                                  <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/80 to-transparent">
                                                  <p className="text-white text-xs font-medium opacity-90">{p.category}</p>
                                                  </div>
                                              </div>
                                              
                                              <div className="p-5 flex flex-col flex-1">
                                                  <h3 className="font-bold text-gray-900 dark:text-white text-lg mb-1 leading-tight">{p.name}</h3>
                                                  <div className="flex items-center gap-2 mb-4">
                                                  <span className="text-2xl font-black text-primary-600 dark:text-primary-400">
                                                      <span className="text-sm font-normal text-gray-500 dark:text-gray-400 mr-1">{storeProfile.currency}</span>{p.sellPrice}
                                                      <span className="text-xs text-gray-400 font-normal ml-1">/ {p.measurementUnit || 'pc'}</span>
                                                  </span>
                                                  </div>

                                                  <div className="mt-auto grid grid-cols-2 gap-3 text-sm border-t border-gray-100 dark:border-gray-800 pt-4">
                                                  <div>
                                                      <p className="text-gray-500 text-xs">Buying Price</p>
                                                      <p className="font-semibold dark:text-gray-300">{p.buyPrice}</p>
                                                  </div>
                                                  <div className="text-right">
                                                      <p className="text-gray-500 text-xs">Margin</p>
                                                      <p className="font-semibold text-green-600">{margin}%</p>
                                                  </div>
                                                  </div>

                                                  <div className="flex gap-2 mt-4 pt-2">
                                                  <button onClick={() => openQuickStock(p.id)} className="px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors" title="Add Stock">
                                                      <Layers className="w-4 h-4" />
                                                  </button>
                                                  <button onClick={() => handleEdit(p)} className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors font-medium text-sm">
                                                      <Edit2 className="w-4 h-4" /> Edit
                                                  </button>
                                                  <button onClick={() => onDeleteProduct(p.id)} className="flex items-center justify-center px-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors">
                                                      <Trash2 className="w-4 h-4" />
                                                  </button>
                                                  </div>
                                              </div>
                                              </div>
                                            )}
                                          </Draggable>
                                        );
                                        })}
                                        {provided.placeholder}
                                    </div>
                                    ) : (
                                    <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)] transition-all border border-gray-100 dark:border-gray-800 overflow-hidden animate-fade-in">
                                        <div className="overflow-x-auto">
                                        <table className="w-full text-left border-collapse">
                                            <thead className="bg-gray-50 dark:bg-black text-gray-500 dark:text-gray-400 text-sm">
                                            <tr>
                                                <th className="p-4 w-10"></th>
                                                <th className="p-4">Product</th>
                                                <th className="p-4">Category</th>
                                                <th className="p-4">Stock</th>
                                                <th className="p-4">Expiry</th>
                                                <th className="p-4">Cost</th>
                                                <th className="p-4">Price / Unit</th>
                                                <th className="p-4 text-right">Actions</th>
                                            </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                            {categoryProducts.map((p, pIndex) => {
                                                const expiryStatus = getExpiryStatus(p.expiryDate);
                                                return (
                                                  <Draggable key={p.id} draggableId={p.id} index={pIndex} isDragDisabled={sortBy !== 'custom'}>
                                                    {(provided) => (
                                                      <tr 
                                                          ref={provided.innerRef}
                                                          {...provided.draggableProps}
                                                          className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors bg-white dark:bg-gray-900"
                                                      >
                                                          <td className="p-4">
                                                              <div {...provided.dragHandleProps} className={`text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors ${sortBy !== 'custom' ? 'opacity-50 cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'}`}>
                                                                  <GripVertical className="w-4 h-4" />
                                                              </div>
                                                          </td>
                                                          <td className="p-4 flex items-center gap-4">
                                                          <img src={p.image} alt="" className="w-12 h-12 rounded-xl object-cover bg-gray-100 dark:bg-gray-800 shadow-sm" />
                                                          <span className="font-bold text-gray-900 dark:text-white">{p.name}</span>
                                                          </td>
                                                          <td className="p-4 text-gray-600 dark:text-gray-400 font-medium">{p.category}</td>
                                                          <td className="p-4">
                                                          <span className={`px-2.5 py-1 rounded-md text-xs font-bold ${(p.reorderPoint !== undefined ? p.stock <= p.reorderPoint : p.stock <= 5) ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'}`}>
                                                              {p.stock} {p.measurementUnit || 'pcs'}
                                                          </span>
                                                          </td>
                                                          <td className="p-4">
                                                              {expiryStatus ? (
                                                                  <span className={`px-2.5 py-1 rounded-md text-xs font-bold ${expiryStatus.urgent ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 'text-gray-600 dark:text-gray-400'}`}>
                                                                      {expiryStatus.text}
                                                                  </span>
                                                              ) : (
                                                                  <span className="text-gray-400">-</span>
                                                              )}
                                                          </td>
                                                          <td className="p-4 text-gray-600 dark:text-gray-400">{storeProfile.currency} {p.buyPrice}</td>
                                                          <td className="p-4 font-bold text-gray-900 dark:text-white">{storeProfile.currency} {p.sellPrice} <span className="text-xs font-normal text-gray-500">/{p.measurementUnit || 'pc'}</span></td>
                                                          <td className="p-4 text-right">
                                                          <div className="flex justify-end gap-2">
                                                              <button onClick={() => openQuickStock(p.id)} className="p-2 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded-xl transition-colors" title="Add Stock">
                                                                  <Layers className="w-4 h-4" />
                                                              </button>
                                                              <button onClick={() => handleEdit(p)} className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-xl transition-colors">
                                                              <Edit2 className="w-4 h-4" />
                                                              </button>
                                                              <button onClick={() => onDeleteProduct(p.id)} className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-xl transition-colors">
                                                              <Trash2 className="w-4 h-4" />
                                                              </button>
                                                          </div>
                                                          </td>
                                                      </tr>
                                                    )}
                                                  </Draggable>
                                                );
                                            })}
                                            {provided.placeholder}
                                            </tbody>
                                        </table>
                                        </div>
                                    </div>
                                    )}
                                    </div>
                                  )}
                                </Droppable>
                            )}
                        </div>
                      )}
                    </Draggable>
                  );
              })}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>

      {/* Quick Add Stock Modal */}
      {isStockModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
          <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)] transition-all w-full max-w-sm overflow-hidden animate-fade-in border border-gray-100 dark:border-gray-700 transform scale-100">
             <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50 dark:bg-black/50">
              <h3 className="text-xl font-black text-gray-900 dark:text-white tracking-tight">Quick Restock</h3>
              <button onClick={() => setIsStockModalOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            <form onSubmit={handleQuickStockSubmit} className="p-6 space-y-5">
              <div>
                <label htmlFor="quick-stock-product" className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Select Product</label>
                <select 
                  id="quick-stock-product"
                  name="product"
                  required
                  value={selectedStockProduct}
                  onChange={e => setSelectedStockProduct(e.target.value)}
                  className="w-full p-3 border border-gray-100 dark:border-gray-800 rounded-2xl bg-white dark:bg-gray-950 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                >
                  <option value="">-- Choose Product --</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>{p.name} (Current: {p.stock} {p.measurementUnit || 'pcs'})</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 gap-4">
                  <div>
                    <label htmlFor="quick-stock-qty" className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Quantity to Add</label>
                    <input 
                      id="quick-stock-qty"
                      name="quantity"
                      type="number" 
                      step="any"
                      required
                      value={stockToAdd}
                      onChange={e => setStockToAdd(e.target.value)}
                      className="w-full p-3 border border-gray-100 dark:border-gray-800 rounded-2xl bg-white dark:bg-gray-950 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-bold"
                    />
                    <p className="text-[10px] text-gray-400 mt-1">Use negative values to reduce stock</p>
                  </div>
                   <div>
                    <label htmlFor="quick-stock-expiry" className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">New Expiry Date (Optional)</label>
                    <input 
                      id="quick-stock-expiry"
                      name="expiryDate"
                      type="date"
                      value={stockExpiry}
                      onChange={e => setStockExpiry(e.target.value)}
                      className="w-full p-3 border border-gray-100 dark:border-gray-800 rounded-2xl bg-white dark:bg-gray-950 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                    />
                    <p className="text-[10px] text-gray-400 mt-1">This will update the product's expiry date</p>
                  </div>
                  <div>
                    <label htmlFor="quick-stock-reason" className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Reason</label>
                    <input 
                      id="quick-stock-reason"
                      name="reason"
                      type="text" 
                      required
                      placeholder="e.g. Purchase, Return, Correction"
                      value={stockReason}
                      onChange={e => setStockReason(e.target.value)}
                      className="w-full p-3 border border-gray-100 dark:border-gray-800 rounded-2xl bg-white dark:bg-gray-950 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                    />
                  </div>
              </div>
              <button type="submit" className="w-full bg-emerald-600 text-white py-3.5 rounded-2xl hover:bg-emerald-700 font-bold shadow-lg shadow-emerald-900/20 transform active:scale-95 transition-all">
                Update Stock
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Add/Edit Product Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
          <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)] transition-all w-full max-w-lg overflow-hidden animate-fade-in border border-gray-100 dark:border-gray-700">
            <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50 dark:bg-black/50">
              <h3 className="text-xl font-black text-gray-900 dark:text-white tracking-tight">{editingId ? 'Edit Product' : 'Add New Product'}</h3>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label htmlFor="prod-name" className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Product Name</label>
                <input
                  id="prod-name"
                  name="name"
                  required
                  type="text"
                  value={form.name}
                  onChange={e => setForm({...form, name: e.target.value})}
                  className="w-full p-3 border border-gray-100 dark:border-gray-800 rounded-2xl bg-transparent dark:text-white focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="prod-category" className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Category</label>
                  <input
                    id="prod-category"
                    name="category"
                    required
                    type="text"
                    list="categories"
                    value={form.category}
                    onChange={e => setForm({...form, category: e.target.value})}
                    className="w-full p-3 border border-gray-100 dark:border-gray-800 rounded-2xl bg-transparent dark:text-white focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                  />
                  <datalist id="categories">
                    <option value="Drinks" />
                    <option value="Snacks" />
                    <option value="Household" />
                    <option value="Electronics" />
                  </datalist>
                </div>
                <div>
                  <label htmlFor="prod-stock" className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Stock Quantity</label>
                  <input
                    id="prod-stock"
                    name="stock"
                    required
                    type="number"
                    step="any"
                    value={form.stock}
                    onChange={e => setForm({...form, stock: e.target.value})}
                    className="w-full p-3 border border-gray-100 dark:border-gray-800 rounded-2xl bg-transparent dark:text-white focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
               <div>
                  <label htmlFor="prod-unit" className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Unit of Measure</label>
                  <select
                    id="prod-unit"
                    name="measurementUnit"
                    value={form.measurementUnit}
                    onChange={e => setForm({...form, measurementUnit: e.target.value})}
                    className="w-full p-3 border border-gray-100 dark:border-gray-800 rounded-2xl bg-transparent dark:text-white focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                  >
                    <option value="pcs">Pieces (pcs)</option>
                    <option value="L">Liters (L)</option>
                    <option value="kg">Kilograms (kg)</option>
                    <option value="m">Meters (m)</option>
                    <option value="pkt">Packets (pkt)</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="prod-expiry" className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Expiry Date (Optional)</label>
                  <input
                    id="prod-expiry"
                    name="expiryDate"
                    type="date"
                    value={form.expiryDate}
                    onChange={e => setForm({...form, expiryDate: e.target.value})}
                    className="w-full p-3 border border-gray-100 dark:border-gray-800 rounded-2xl bg-transparent dark:text-white focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                  />
                </div>
               </div>
               <div>
                  <label htmlFor="prod-reorder" className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Reorder Point (Optional)</label>
                  <input
                    id="prod-reorder"
                    name="reorderPoint"
                    type="number"
                    min="0"
                    placeholder="Alert when stock falls below..."
                    value={form.reorderPoint}
                    onChange={e => setForm({...form, reorderPoint: e.target.value})}
                    className="w-full p-3 border border-gray-100 dark:border-gray-800 rounded-2xl bg-transparent dark:text-white focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                  />
               </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="prod-buy" className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Buying Price (Per Unit)</label>
                  <input
                    id="prod-buy"
                    name="buyPrice"
                    required
                    type="number"
                    step="any"
                    value={form.buyPrice}
                    onChange={e => setForm({...form, buyPrice: e.target.value})}
                    className="w-full p-3 border border-gray-100 dark:border-gray-800 rounded-2xl bg-transparent dark:text-white focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                  />
                </div>
                <div>
                  <label htmlFor="prod-sell" className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Selling Price (Per Unit)</label>
                  <input
                    id="prod-sell"
                    name="sellPrice"
                    required
                    type="number"
                    step="any"
                    value={form.sellPrice}
                    onChange={e => setForm({...form, sellPrice: e.target.value})}
                    className="w-full p-3 border border-gray-100 dark:border-gray-800 rounded-2xl bg-transparent dark:text-white focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Product Image</label>
                <div className="flex gap-4 items-center p-3 border border-dashed border-gray-300 dark:border-gray-700 rounded-2xl bg-gray-50 dark:bg-black/30">
                   {form.image ? (
                     <div className="relative group">
                        <img src={form.image} alt="Preview" className="w-20 h-20 rounded-xl object-cover shadow-sm" />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl flex items-center justify-center text-white text-xs cursor-pointer" onClick={() => fileInputRef.current?.click()}>Change</div>
                     </div>
                   ) : (
                     <div className="w-20 h-20 rounded-xl bg-gray-200 dark:bg-gray-800 flex items-center justify-center">
                        <Package className="w-8 h-8 text-gray-400" />
                     </div>
                   )}
                   <div className="flex-1">
                     <label className="cursor-pointer">
                       <div className="inline-flex items-center px-4 py-2 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-800 rounded-xl text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-sm">
                         <Upload className="w-4 h-4 mr-2" />
                         Upload Photo
                       </div>
                       <input 
                        type="file" 
                        accept="image/*"
                        ref={fileInputRef}
                        className="hidden" 
                        onChange={handleImageUpload} 
                       />
                     </label>
                     <p className="text-xs text-gray-500 mt-2">PNG, JPG up to 500KB</p>
                   </div>
                </div>
              </div>
              <div className="pt-6 flex justify-end gap-3 border-t border-gray-100 dark:border-gray-800 mt-4">
                <button type="button" onClick={closeModal} className="px-6 py-2.5 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-2xl font-medium transition-colors">Cancel</button>
                <button type="submit" className="px-6 py-2.5 bg-primary-600 text-white rounded-2xl hover:bg-primary-700 flex items-center gap-2 shadow-lg shadow-primary-900/20 font-bold transform active:scale-95 transition-all">
                  <Save className="w-4 h-4" /> Save Product
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
