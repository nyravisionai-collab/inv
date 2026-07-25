import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function Pagination({ page, pages, total, limit, onChange }) {
  if (!total) return null;
  return (
    <div className="pagination">
      <div className="pagination-info">
        Showing {Math.min((page - 1) * limit + 1, total)}–{Math.min(page * limit, total)} of {total}
      </div>
      <div className="pagination-btns">
        <button className="btn btn-sm btn-secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          <ChevronLeft size={16} />
        </button>
        <span style={{ padding: '0 12px', fontSize: 13, lineHeight: '32px' }}>{page} / {pages || 1}</span>
        <button className="btn btn-sm btn-secondary" disabled={page >= pages} onClick={() => onChange(page + 1)}>
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
