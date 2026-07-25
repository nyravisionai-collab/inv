#!/data/data/com.termux/files/usr/bin/bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "═══════════════════════════════════════════"
echo "  Inventory System — Installer"
echo "  No login · sql.js · Termux ready"
echo "═══════════════════════════════════════════"

if [ -n "$PREFIX" ] && echo "$PREFIX" | grep -q termux; then
  echo "→ Termux detected"
  command -v node >/dev/null 2>&1 || pkg install -y nodejs
  command -v curl >/dev/null 2>&1 || pkg install -y curl
fi

mkdir -p backend/data backend/uploads backend/backups backend/logs
mkdir -p backend/uploads/logos backend/uploads/products backend/uploads/avatars backend/uploads/imports backend/uploads/misc

cat > backend/.env << 'EOF'
PORT=5000
HOST=0.0.0.0
DB_PATH=./data/inventory.db
UPLOAD_DIR=./uploads
BACKUP_DIR=./backups
NODE_ENV=production
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=2000
CORS_ORIGIN=*
COMPANY_NAME=My Business
CURRENCY=INR
CURRENCY_SYMBOL=₹
TIMEZONE=Asia/Kolkata
EOF

echo ""
echo "→ Backend dependencies..."
cd "$ROOT/backend"
rm -rf node_modules/better-sqlite3 2>/dev/null || true
npm install --no-optional --omit=optional
echo "✓ Backend OK"

echo ""
echo "→ Fresh empty database..."
rm -f data/inventory.db data/*.tmp data/*-wal data/*-shm 2>/dev/null || true
node -e '
const fs=require("fs");const path=require("path");
process.env.DB_PATH=path.join(__dirname,"data/inventory.db");
const db=require("./src/db/database");
(async()=>{
  await db.init();
  db.exec(fs.readFileSync("./src/db/schema.sql","utf8"));
  db.prepare("INSERT INTO company_settings (id, company_name) VALUES (1, ?)").run("My Business");
  db.prepare("INSERT INTO users (username,email,password_hash,full_name,role,permissions,is_active) VALUES (?,?,?,?,?,?,1)")
    .run("local","local@localhost","no-auth","Local User","admin",JSON.stringify({all:true}));
  db.prepare("INSERT INTO bank_accounts (account_name,account_type,opening_balance,current_balance,is_default,is_active) VALUES (?,?,?,?,?,?)")
    .run("Cash in Hand","cash",0,0,1,1);
  db.prepare("INSERT INTO warehouses (name,code,is_default,is_active) VALUES (?,?,?,?)").run("Main Store","MAIN",1,1);
  const iu=db.prepare("INSERT INTO units (name,short_name,allow_fractional) VALUES (?,?,?)");
  [["Piece","pcs",0],["Kilogram","kg",1],["Litre","ltr",1],["Meter","mtr",1],["Box","box",0]].forEach(u=>iu.run(...u));
  const it=db.prepare("INSERT INTO tax_rates (name,rate,cgst,sgst,igst) VALUES (?,?,?,?,?)");
  [["GST 0%",0,0,0,0],["GST 5%",5,2.5,2.5,5],["GST 12%",12,6,6,12],["GST 18%",18,9,9,18],["GST 28%",28,14,14,28]].forEach(t=>it.run(...t));
  db.persist();
  console.log("products", db.prepare("SELECT COUNT(*) c FROM products").get().c);
  console.log("sales", db.prepare("SELECT COUNT(*) c FROM sales").get().c);
  db.close();
  console.log("✓ Fresh DB");
})().catch(e=>{console.error(e);process.exit(1)});
'

echo ""
echo "→ Frontend dependencies..."
cd "$ROOT/frontend"
npm install
echo "✓ Frontend OK"

echo ""
echo "→ Building frontend..."
npx vite build || echo "(dev server will be used if build optional)"
echo "✓ Build done"

chmod +x "$ROOT/START.sh" "$ROOT/STOP.sh" "$ROOT/RUN.sh" 2>/dev/null || true

echo ""
echo "═══════════════════════════════════════════"
echo "  Install complete!"
echo "  Start:  bash START.sh"
echo "  Stop:   bash STOP.sh"
echo "  UI:     http://localhost:5173  (no login)"
echo "  API:    http://localhost:5000"
echo "═══════════════════════════════════════════"
