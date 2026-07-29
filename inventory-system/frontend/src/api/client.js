import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// No auth interceptors — offline open access

export const authAPI = {
  login: () => Promise.resolve({ data: { success: true, data: { token: null, user: { role: 'admin' } } } }),
  me: () => Promise.resolve({ data: { success: true, data: { id: 1, username: 'local', full_name: 'Local User', role: 'admin' } } }),
  changePassword: () => Promise.resolve({ data: { success: true } }),
  logout: () => Promise.resolve({ data: { success: true } }),
};

export const dashboardAPI = {
  get: () => api.get('/dashboard'),
};

/**
 * Products accept an optional photo, so the payload is sent as multipart
 * whenever a File is present and as plain JSON otherwise (keeps the simple
 * JSON path — and its tests — unchanged).
 */
function toProductPayload(data) {
  if (!data || !(data.image instanceof File)) return { data, config: undefined };
  const fd = new FormData();
  Object.entries(data).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    fd.append(key, value instanceof File ? value : String(value));
  });
  return { data: fd, config: { headers: { 'Content-Type': 'multipart/form-data' } } };
}

export const productsAPI = {
  list: (params) => api.get('/products', { params }),
  get: (id) => api.get(`/products/${id}`),
  create: (data) => {
    const { data: body, config } = toProductPayload(data);
    return api.post('/products', body, config);
  },
  update: (id, data) => {
    const { data: body, config } = toProductPayload(data);
    return api.put(`/products/${id}`, body, config);
  },
  remove: (id) => api.delete(`/products/${id}`),
  barcode: (code) => api.get(`/products/barcode/${code}`),
  generateBarcode: (id) => api.get(`/products/${id}/barcode`),
  allBarcodes: () => api.get('/products/barcodes/all'),
  lowStock: () => api.get('/products/low-stock'),
};

export const salesAPI = {
  list: (params) => api.get('/sales', { params }),
  get: (id) => api.get(`/sales/${id}`),
  create: (data) => api.post('/sales', data),
  update: (id, data) => api.put(`/sales/${id}`, data),
  cancel: (id) => api.post(`/sales/${id}/cancel`),
  convert: (id, data) => api.post(`/sales/${id}/convert`, data),
  createPartialChallan: (id, data) => api.post(`/sales/${id}/delivery-challan`, data),
  pdf: (id) => `/api/sales/${id}/pdf`,
  whatsapp: (id) => api.get(`/sales/${id}/whatsapp`),
  estimates: (params) => api.get('/estimates', { params }),
  saleOrders: (params) => api.get('/sale-orders', { params }),
  challans: (params) => api.get('/delivery-challans', { params }),
  returns: (params) => api.get('/sale-returns', { params }),
};

export const purchasesAPI = {
  list: (params) => api.get('/purchases', { params }),
  get: (id) => api.get(`/purchases/${id}`),
  pdf: (id) => `/api/purchases/${id}/pdf`,
  create: (data) => api.post('/purchases', data),
  cancel: (id) => api.post(`/purchases/${id}/cancel`),
  orders: (params) => api.get('/purchase-orders', { params }),
  returns: (params) => api.get('/purchase-returns', { params }),
};

export const paymentsAPI = {
  list: (params) => api.get('/payments', { params }),
  get: (id) => api.get(`/payments/${id}`),
  pdf: (id) => api.post(`/payments/${id}/pdf`),
  create: (data) => api.post('/payments', data),
  remove: (id) => api.delete(`/payments/${id}`),
};

export const customersAPI = {
  list: (params) => api.get('/customers', { params }),
  get: (id) => api.get(`/customers/${id}`),
  create: (data) => api.post('/customers', data),
  update: (id, data) => api.put(`/customers/${id}`, data),
  remove: (id) => api.delete(`/customers/${id}`),
  ledger: (id, params) => api.get(`/customers/${id}/ledger`, { params }),
  ledgerPdf: (id, params) => api.post(`/customers/${id}/ledger/pdf`, null, { params }),
  outstanding: () => api.get('/customers/outstanding'),
};

export const suppliersAPI = {
  list: (params) => api.get('/suppliers', { params }),
  get: (id) => api.get(`/suppliers/${id}`),
  create: (data) => api.post('/suppliers', data),
  update: (id, data) => api.put(`/suppliers/${id}`, data),
  remove: (id) => api.delete(`/suppliers/${id}`),
  ledger: (id, params) => api.get(`/suppliers/${id}/ledger`, { params }),
  ledgerPdf: (id, params) => api.post(`/suppliers/${id}/ledger/pdf`, null, { params }),
  outstanding: () => api.get('/suppliers/outstanding'),
};

export const inventoryAPI = {
  categories: () => api.get('/categories'),
  createCategory: (data) => api.post('/categories', data),
  updateCategory: (id, data) => api.put(`/categories/${id}`, data),
  deleteCategory: (id) => api.delete(`/categories/${id}`),
  brands: () => api.get('/brands'),
  createBrand: (data) => api.post('/brands', data),
  updateBrand: (id, data) => api.put(`/brands/${id}`, data),
  deleteBrand: (id) => api.delete(`/brands/${id}`),
  units: () => api.get('/units'),
  createUnit: (data) => api.post('/units', data),
  deleteUnit: (id) => api.delete(`/units/${id}`),
  warehouses: () => api.get('/warehouses'),
  createWarehouse: (data) => api.post('/warehouses', data),
  updateWarehouse: (id, data) => api.put(`/warehouses/${id}`, data),
  deleteWarehouse: (id) => api.delete(`/warehouses/${id}`),
  transfers: () => api.get('/stock/transfers'),
  createTransfer: (data) => api.post('/stock/transfers', data),
  adjustments: () => api.get('/stock/adjustments'),
  createAdjustment: (data) => api.post('/stock/adjustments', data),
  stockReport: (params) => api.get('/stock/report', { params }),
};

export const accountingAPI = {
  banks: () => api.get('/banks'),
  createBank: (data) => api.post('/banks', data),
  updateBank: (id, data) => api.put(`/banks/${id}`, data),
  expenses: (params) => api.get('/expenses', { params }),
  createExpense: (data) => api.post('/expenses', data),
  deleteExpense: (id) => api.delete(`/expenses/${id}`),
  expensePdf: (id) => api.post(`/expenses/${id}/pdf`),
  incomes: (params) => api.get('/incomes', { params }),
  createIncome: (data) => api.post('/incomes', data),
  journals: () => api.get('/journals'),
  getJournal: (id) => api.get(`/journals/${id}`),
  createJournal: (data) => api.post('/journals', data),
  cashBook: (params) => api.get('/cash-book', { params }),
  cashBookPdf: (params) => api.post('/cash-book/pdf', null, { params }),
};

export const reportsAPI = {
  profitLoss: (params) => api.get('/reports/profit-loss', { params }),
  balanceSheet: (params) => api.get('/reports/balance-sheet', { params }),
  gst: (params) => api.get('/reports/gst', { params }),
  sales: (params) => api.get('/reports/sales', { params }),
  purchases: (params) => api.get('/reports/purchases', { params }),
  expenses: (params) => api.get('/reports/expenses', { params }),
  customers: () => api.get('/reports/customers'),
  suppliers: () => api.get('/reports/suppliers'),
  outstanding: () => api.get('/reports/outstanding'),
  productProfit: (params) => api.get('/reports/product-profit', { params }),
  customerProfit: (params) => api.get('/reports/customer-profit', { params }),
  pdf: (name, params) => api.post(`/reports/${name}/pdf`, null, { params }),
  stock: (params) => api.get('/reports/stock', { params }),
  expiry: (params) => api.get('/reports/expiry', { params }),
  warehouseStock: () => api.get('/reports/warehouse-stock'),
};

export const settingsAPI = {
  get: () => api.get('/settings'),
  update: (data) => api.put('/settings', data),
  uploadLogo: (formData) => api.post('/settings/logo', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  taxRates: () => api.get('/tax-rates'),
  createTaxRate: (data) => api.post('/tax-rates', data),
  deleteTaxRate: (id) => api.delete(`/tax-rates/${id}`),
  backup: () => api.post('/backup'),
  backups: () => api.get('/backups'),
  restore: (data) => api.post('/restore', data),
  export: (params) => api.get('/export', { params, responseType: params?.format === 'json' ? 'json' : 'blob' }),
  exportPdf: (type) => api.post(`/exports/${type}/pdf`),
  exports: () => api.get('/exports'),
  import: (formData) => api.post('/import', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
};

export const usersAPI = {
  list: (params) => api.get('/users', { params }),
  get: (id) => api.get(`/users/${id}`),
  create: (data) => api.post('/users', data),
  update: (id, data) => api.put(`/users/${id}`, data),
  remove: (id) => api.delete(`/users/${id}`),
  permissions: () => api.get('/users/permissions'),
  auditLogs: (params) => api.get('/audit-logs', { params }),
};

export const searchAPI = {
  global: (q) => api.get('/search', { params: { q } }),
};

export const notificationsAPI = {
  list: () => api.get('/notifications'),
  markRead: (id) => api.put(`/notifications/${id}/read`),
  check: () => api.post('/notifications/check'),
};

export default api;
