import { Package } from 'lucide-react';

export default function EmptyState({ icon: Icon = Package, title = 'No data found', message = 'Get started by adding your first record', action }) {
  return (
    <div className="empty-state">
      <Icon size={64} />
      <h3>{title}</h3>
      <p>{message}</p>
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}
