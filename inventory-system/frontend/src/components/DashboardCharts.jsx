import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';

/**
 * Chart panels for the dashboard.
 *
 * Kept in its own module and loaded lazily: recharts is by far the largest
 * dependency in the app, and the KPI cards above it are far more important on
 * a slow device. Splitting it keeps the initial bundle small.
 */
export default function DashboardCharts({ salesChart = [], purchaseChart = [], formatMoney, theme = 'light', t }) {
  const isDark = theme === 'dark';
  const tooltipStyle = {
    background: isDark ? '#1a1d27' : '#ffffff',
    border: `1px solid ${isDark ? '#2d3348' : '#e5e7eb'}`,
    borderRadius: 8,
    color: isDark ? '#e8eaed' : '#1a1a2e',
    boxShadow: isDark ? '0 10px 15px rgba(0,0,0,.5)' : '0 10px 15px rgba(0,0,0,.1)',
  };
  const tick = { fontSize: 11, fill: isDark ? '#9aa0a6' : '#6b7280' };
  const grid = isDark ? '#2d3348' : '#e5e7eb';

  return (
    <>
      <div className="card">
        <div className="card-header"><div className="card-title">{t('Sales (Last 7 Days)')}</div></div>
        <div className="card-body">
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={salesChart}>
                <defs>
                  <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#1976d2" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#1976d2" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={grid} />
                <XAxis dataKey="date" tick={tick} tickFormatter={(v) => v?.slice(5)} />
                <YAxis tick={tick} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: tooltipStyle.color }} formatter={(v) => formatMoney(v)} />
                <Area type="monotone" dataKey="total" stroke="#1976d2" fill="url(#salesGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><div className="card-title">{t('Purchases (Last 7 Days)')}</div></div>
        <div className="card-body">
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={purchaseChart}>
                <CartesianGrid strokeDasharray="3 3" stroke={grid} />
                <XAxis dataKey="date" tick={tick} tickFormatter={(v) => v?.slice(5)} />
                <YAxis tick={tick} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: tooltipStyle.color }} formatter={(v) => formatMoney(v)} />
                <Bar dataKey="total" fill="#ed6c02" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </>
  );
}
