export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function calcLineTotal(item) {
  const quantity = Number(item.quantity) || 0;
  const unitPrice = Number(item.unit_price) || 0;
  const rate = Number(item.tax_rate) || 0;
  const taxType = item.tax_type || 'exclusive';
  const gross = quantity * unitPrice;
  const lineDiscount = item.discount_type === 'percent'
    ? round2(gross * (Number(item.discount_value) || 0) / 100)
    : round2(Number(item.discount_value) || 0);
  const afterDiscount = round2(gross - lineDiscount);

  if (taxType === 'none' || rate === 0) {
    return { gross: round2(gross), discount: lineDiscount, taxable: afterDiscount, tax: 0, total: afterDiscount };
  }
  if (taxType === 'inclusive') {
    const taxable = round2(afterDiscount / (1 + rate / 100));
    return { gross: round2(gross), discount: lineDiscount, taxable, tax: round2(afterDiscount - taxable), total: afterDiscount };
  }
  const taxable = afterDiscount;
  const tax = round2(taxable * rate / 100);
  return { gross: round2(gross), discount: lineDiscount, taxable, tax, total: round2(taxable + tax) };
}

function discountBase(line, calc) {
  return (line.tax_type || 'exclusive') === 'inclusive' ? calc.total : calc.taxable;
}

export function calcInvoiceTotals(items, form = {}) {
  const lines = items.map((item) => ({ item, calc: calcLineTotal(item) }));
  const subtotal = round2(lines.reduce((sum, l) => sum + l.calc.gross, 0));
  const lineDiscount = round2(lines.reduce((sum, l) => sum + l.calc.discount, 0));
  const base = round2(lines.reduce((sum, l) => sum + discountBase(l.item, l.calc), 0));
  const invoiceDiscount = form.discount_type === 'percent'
    ? round2(base * (Number(form.discount_value) || 0) / 100)
    : round2(Number(form.discount_value) || 0);

  let allocated = 0;
  let taxAmount = 0;
  let lineTotals = 0;
  const lastIndex = lines.map((l, i) => (discountBase(l.item, l.calc) > 0 ? i : -1)).filter((i) => i >= 0).pop();

  lines.forEach((line, index) => {
    const b = discountBase(line.item, line.calc);
    const alloc = base > 0 && b > 0
      ? (index === lastIndex ? round2(invoiceDiscount - allocated) : round2(invoiceDiscount * b / base))
      : 0;
    allocated = round2(allocated + alloc);
    const rate = Number(line.item.tax_rate) || 0;
    const taxType = line.item.tax_type || 'exclusive';
    let tax = 0;
    let total = 0;
    if (taxType === 'inclusive' && rate > 0) {
      total = round2(Math.max(0, line.calc.total - alloc));
      const taxable = round2(total / (1 + rate / 100));
      tax = round2(total - taxable);
    } else if (taxType === 'none' || rate === 0) {
      total = round2(Math.max(0, line.calc.taxable - alloc));
    } else {
      const taxable = round2(Math.max(0, line.calc.taxable - alloc));
      tax = round2(taxable * rate / 100);
      total = round2(taxable + tax);
    }
    taxAmount = round2(taxAmount + tax);
    lineTotals = round2(lineTotals + total);
  });

  const grand = round2(
    lineTotals + (Number(form.shipping_charges) || 0)
    + (Number(form.other_charges) || 0) + (Number(form.round_off) || 0)
  );
  return { subtotal, taxAmount, discount: round2(lineDiscount + invoiceDiscount), grand };
}
