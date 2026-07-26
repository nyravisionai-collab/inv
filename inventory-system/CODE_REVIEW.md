# કોડ રિવ્યુ અને સુધારા સૂચનો (Inventory System)

તારીખ: 2026-07-26 · શાખા: `arena/019f9ded-inv`
ચકાસણી પદ્ધતિ: આખો સોર્સ વાંચ્યો + `npm test` + `vite build` + લાઇવ API પ્રોબ (અસલી બગ્સ ચકાસવા માટે ટેમ્પ DB પર).

> **સ્થિતિ: બધા મુદ્દા ઠીક કરાયા.** આ દસ્તાવેજ મૂળ ઓડિટનો રેકોર્ડ છે.
> દરેક ફિક્સનું વર્ણન અને ચકાસણી માટે `FIXES.md` જુઓ.
> ટેસ્ટ: 10 → **54 પાસ** · મુખ્ય bundle: 852 KB → **332 KB** ·
> production vulnerabilities: 1 high → **0**

---

## એકંદરે

આ એક ઘણી સારી રીતે બનેલી, ફીચર-સમૃદ્ધ Vyapar-જેવી સિસ્ટમ છે — ~10,700 લાઇન, POS, GST, મલ્ટિ-વેરહાઉસ, લેજર, રિપોર્ટ્સ, બેકઅપ, PWA, દ્વિભાષી UI. આર્કિટેક્ચર સાફ છે (controllers / services / middleware / utils), sql.js નો better-sqlite3-કમ્પેટિબલ રેપર ચતુરાઈભર્યો છે, અને Termux પર ચાલે એ રીતે વિચારીને લખાયું છે.

નીચેના મુદ્દા ગંભીરતા પ્રમાણે ગોઠવ્યા છે. 🔴 = પહેલા ઠીક કરો, 🟠 = ટૂંક સમયમાં, 🟡 = સુધારો.

---

## 🔴 P0 — તાત્કાલિક (ડેટા/સુરક્ષા જોખમ)

### 1. `.env`, `inventory.db` અને બેકઅપ ફાઇલો Git માં કમિટ થયેલી છે
```
inventory-system/backend/.env
inventory-system/backend/data/inventory.db
inventory-system/backend/backups/backup-2026-07-20...db / .json
```
`.gitignore` માં આ બધું લખેલું છે, પણ ફાઇલો પહેલેથી ટ્રેક થયેલી હોવાથી ignore લાગુ પડતું નથી. `.env` માં `JWT_SECRET` પણ છે, અને બેકઅપ JSON માં અસલી બિઝનેસ ડેટા ("Fresh Co") છે.

**ઉપાય:**
```bash
git rm --cached backend/.env backend/data/inventory.db backend/backups/*
git commit -m "chore: untrack env, db and backup artifacts"
```
અને `JWT_SECRET` બદલી નાખો (જોકે હાલ auth બંધ છે, પણ ભવિષ્યમાં ચાલુ કરશો ત્યારે આ સિક્રેટ public history માં હશે).

### 2. સ્ટોક નેગેટિવ થઈ જાય છે — કોઈ વેલિડેશન નથી
પ્રોબમાં: 2 નંગ સ્ટોકવાળી પ્રોડક્ટના 50 નંગ વેચ્યા → **સેલ 201 સફળ, સ્ટોક `-48`**.
`salesController.create()` માં `stockService.reduceStock()` પહેલાં ઉપલબ્ધ સ્ટોક ચેક થતો નથી.

**ઉપાય:** સેલ/POS બનાવતાં પહેલાં દરેક આઇટમ માટે `warehouse_stock` ચેક કરો, અને `company_settings` માં `allow_negative_stock` ફ્લેગ ઉમેરો (કેટલાક વેપારીઓને ઓવરસેલ જોઈતું હોય છે, પણ એ સભાન પસંદગી હોવી જોઈએ).

### 3. નેગેટિવ quantity / price સ્વીકારાય છે
પ્રોબમાં: `quantity: -5, unit_price: -100` → સેલ 201 સફળ, `grand_total: 500`. આનાથી ખોટા નફા-નુકસાનના રિપોર્ટ અને ખોટા સ્ટોક બની શકે.

**ઉપાય:** કેન્દ્રીય વેલિડેશન લેયર ઉમેરો — `quantity > 0`, `unit_price >= 0`, `discount_value >= 0`, `paid_amount >= 0`, `discount_amount <= subtotal`. હાલ કોઈપણ કંટ્રોલરમાં સ્કીમા-વેલિડેશન નથી (zod/joi કે નાનું custom validator).

### 4. ઓડિટ લોગમાં પ્લેન-ટેક્સ્ટ પાસવર્ડ સ્ટોર થાય છે
પ્રોબનું આઉટપુટ:
```json
new_values: "{\"username\":\"u1\",...,\"password\":\"SuperSecret123\",...}"
```
`middleware/audit.js` આખો `req.body` JSON તરીકે લખે છે.

**ઉપાય:** રિડેક્શન લિસ્ટ ઉમેરો — `password`, `current_password`, `new_password`, `token`, `password_hash` કાઢી નાખો.

### 5. XSS સેનિટાઇઝર એરેની અંદર જોતું નથી
`server.js` નું sanitize ફંક્શન `!Array.isArray(obj[key])` ચેક કરે છે, એટલે `items[]` ની અંદરના સ્ટ્રિંગ સાફ થતા નથી:
```
xss scalar:            "Bob"                                ✅ સાફ થયું
xss inside array item: "<script>bad</script>Item"            ❌ સાફ ન થયું
```
વળી regex-આધારિત સ્ટ્રિપિંગ મૂળભૂત રીતે નબળું છે (`<img onerror=...>` પસાર થઈ જશે).

**ઉપાય:** એરેમાં પણ recurse કરો, અને ખરી સુરક્ષા માટે **આઉટપુટ પર** escape કરો (React by default કરે છે) + PDF/CSV એક્સપોર્ટમાં CSV-injection (`=`, `+`, `-`, `@` થી શરૂ થતા સેલ) સામે રક્ષણ.

---

## 🟠 P1 — ટૂંક સમયમાં

### 6. `xlsx` પેકેજમાં high-severity વલ્નરેબિલિટી (ફિક્સ ઉપલબ્ધ નથી)
```
xlsx * — Prototype Pollution + ReDoS — No fix available
```
**ઉપાય:** `exceljs` પર માઇગ્રેટ કરો, અથવા SheetJS ની અધિકૃત CDN બિલ્ડ (`https://cdn.sheetjs.com/xlsx-0.20.x/...`) વાપરો જે પેચ થયેલી છે.

### 7. LIKE સર્ચમાં `ESCAPE` ક્લોઝ ખૂટે છે
`sanitizeLike()` બરાબર `%`, `_`, `\` ને escape કરે છે, પણ SQL માં `ESCAPE '\'` લખાયું નથી — તેથી escape ખરેખર કામ કરતું નથી. પ્રોબ:
```
"Rice_50kg" અને "Rice X 50kg" હાજર; search="Rice_" → []   (2 મળવા જોઈતા હતા... ખરેખર 1)
```
**ઉપાય:** દરેક `LIKE ?` ને `LIKE ? ESCAPE '\'` બનાવો. આ ~8 કંટ્રોલરમાં છે — હેલ્પર ફંક્શન બનાવવું સારું.

### 8. ઇન્વોઇસ નંબર જનરેશનમાં રેસ કન્ડિશન
`numberService.nextNumber()` read-then-update કરે છે, પણ ટ્રાન્ઝેક્શન વગર. હાલ Node સિંગલ-થ્રેડ + sql.js સિંક્રનસ હોવાથી બચી જવાય છે (પ્રોબમાં 5 સમાંતર સેલ → INV-00004..00008, ડુપ્લિકેટ નહીં), પણ આ આકસ્મિક છે. જો ક્યારેય async DB પર ગયા તો ડુપ્લિકેટ `invoice_number` UNIQUE constraint તોડશે.
**ઉપાય:** `UPDATE ... SET n = n + 1` atomic કરો અને પરિણામ પાછું વાંચો, બધું જ એક ટ્રાન્ઝેક્શનમાં.

### 9. Nested transaction — convert/create ડબલ BEGIN
`sales.convert()` બહાર `UPDATE` કરીને પછી `create()` કૉલ કરે છે જે પોતાનું `BEGIN` શરૂ કરે છે. SQLite માં nested `BEGIN` સપોર્ટેડ નથી. હાલ convert 201 આપે છે કારણ કે બહારનું UPDATE ટ્રાન્ઝેક્શન બહાર છે — પણ જો convert નિષ્ફળ જાય તો સ્રોત ડોક્યુમેન્ટ 'converted' રહી જશે અને નવો બિલ નહીં બને. **અડધો-લખાયેલો ડેટા.**
**ઉપાય:** convert ને એક જ ટ્રાન્ઝેક્શનમાં લપેટો — `create()` માંથી કોર લોજિક અલગ ફંક્શન (`createSaleCore(payload, userId)`) તરીકે કાઢો, અને HTTP હેન્ડલર માત્ર wrapper રહે. આ પેટર્ન purchases માટે પણ લાગુ કરો.

### 10. `express-rate-limit` + `app.set('trust proxy', 1)` — ખોટું IP
`trust proxy: 1` બિનશરતી સેટ છે. જો રિવર્સ પ્રોક્સી ન હોય (સામાન્ય કેસ, Termux/LAN), તો ક્લાયન્ટ `X-Forwarded-For` હેડર મોકલીને રેટ લિમિટ ચકમો આપી શકે.
**ઉપાય:** `trust proxy` ને env-controlled કરો (`TRUST_PROXY=1` હોય ત્યારે જ).

### 11. `restore` પછી સર્વર જાતે રિ-ઇનિટ થતું નથી
`settingsController.restore()` DB ફાઇલ કૉપી કરે છે, `db.close()` કરે છે, અને પછી "Please restart the server" કહે છે — પણ સર્વર હજી ચાલુ છે અને DB ક્લોઝ્ડ છે, એટલે **પછીની બધી API રિક્વેસ્ટ 500 આપશે**. વળી ટિપ્પણીમાં લખેલું છે "Reset module state by re-requiring is unsafe" — એટલે જાણીતું છે.
**ઉપાય:** `database.js` માં `reload(newPath)` ફંક્શન ઉમેરો જે `ready=false` કરી, ફાઇલ ફરી વાંચી, `rawDb` બદલી નાખે. પછી restore એ જ કૉલ કરે — રિસ્ટાર્ટની જરૂર ન રહે.
પણ path-traversal સામે રક્ષણ **હાજર છે** (`path.basename`) ✅.

### 12. `pagination.page` વેલિડેટ થતું નથી
`?page=-5` → response માં `page: -5` પાછું આવે છે (offset તો `Math.max(1,...)` થી બચી જાય છે, પણ ક્લાયન્ટને ખોટો મેટાડેટા મળે છે). નાની વાત, પણ `helpers.paginate()` પહેલેથી લખાયેલું છે — કંટ્રોલર્સ એ વાપરતા જ નથી, દરેક જગ્યાએ કોડ ડુપ્લિકેટ છે.

### 13. કોઈ React ErrorBoundary નથી
કોઈપણ પેજમાં રેન્ડર એરર આવે તો આખું એપ સફેદ સ્ક્રીન થઈ જશે. ઓફલાઇન દુકાનદાર માટે આ ખરાબ છે.
**ઉપાય:** `<ErrorBoundary>` થી `<AppRoutes>` લપેટો, "ફરી પ્રયાસ કરો" બટન સાથે.

---

## 🟡 P2 — ગુણવત્તા સુધારા

### 14. અનુવાદ અધૂરો છે
- અંગ્રેજી ડિક્શનરીમાં ~66 કી છે.
- પેજમાં `t()` નો ઉપયોગ ફક્ત **129 વાર**, જ્યારે hardcoded અંગ્રેજી સ્ટ્રિંગ્સ **~175+** છે.
- `Users.jsx` માં માત્ર 3 વાર, `Payments.jsx` માં 5 વાર, `EmptyState.jsx`/`Pagination.jsx` માં શૂન્ય.
- બધા `confirm('Delete category?')` જેવા સંવાદ ફક્ત અંગ્રેજીમાં.
- ટોસ્ટ મેસેજ અને **બેકએન્ડના error મેસેજ** પણ ફક્ત અંગ્રેજીમાં — યુઝરને `"At least one item is required"` દેખાય.

**ઉપાય:** (a) બાકીના સ્ટ્રિંગ્સ `t()` માં લપેટો, (b) બેકએન્ડ એરર માટે `code` ફીલ્ડ (`ERR_NO_ITEMS`) મોકલો અને ફ્રન્ટએન્ડ એનો અનુવાદ કરે, (c) `npm run i18n:check` સ્ક્રિપ્ટ જે ખૂટતી કી પકડે.

### 15. `window.confirm()` — 8 જગ્યાએ
બ્રાઉઝર-નેટિવ ડાયલોગ થીમ સાથે મેળ ખાતું નથી, અનુવાદ થતું નથી, અને કેટલાક WebView માં બ્લોક થાય છે. `Modal.jsx` પહેલેથી છે — એનાથી `ConfirmDialog` બનાવો.

### 16. Bundle 852 KB (gzip 235 KB)
```
dist/assets/index-BfVYrlPk.js   852.68 kB
```
Termux/જૂના Android ફોન માટે ભારે. `recharts` સૌથી મોટો ફાળો આપે છે.
**ઉપાય:** `React.lazy()` + `Suspense` થી રૂટ-લેવલ કોડ સ્પ્લિટિંગ; ખાસ કરીને `Reports`, `Accounting`, `Dashboard` (charts) અલગ ચંક્સમાં.

### 17. Service Worker API રિસ્પોન્સ કેશ કરે છે — વાસી ડેટા
`sw.js` બધા સફળ `/api/` GET કેશ કરે છે અને નેટવર્ક ફેલ થાય ત્યારે પાછા આપે છે. POS માં આનો અર્થ **જૂનો સ્ટોક/ભાવ દેખાવો**. વળી કોઈ `manifest.json` નથી, એટલે PWA ખરેખર ઇન્સ્ટોલ થતું નથી.
**ઉપાય:** ફક્ત static assets કેશ કરો; `/api/` માટે network-only (કે network-first with short TTL + "જૂનો ડેટા" બેનર). અને `manifest.json` + આઇકોન ઉમેરો.

### 18. `tax_type: 'inclusive'` સ્કીમામાં છે પણ ક્યાંય અમલમાં નથી
`grep inclusive` → ફક્ત `schema.sql` માં. `calcLineTotal()` હંમેશા exclusive ગણે છે. ભારતમાં MRP-inclusive ભાવ ખૂબ સામાન્ય છે — આ ખરેખરો કાર્યાત્મક ગેપ છે.

### 19. GST રિપોર્ટમાં CGST/SGST/IGST બ્રેકડાઉન નથી
`tax_rates` ટેબલમાં cgst/sgst/igst કૉલમ છે, `gstReport` માં `supply_type` (intra/inter) ગણાય પણ છે — પણ આઉટપુટમાં ફક્ત કુલ `tax_amount`. GSTR-1/GSTR-3B ફાઇલિંગ માટે rate-wise અને CGST/SGST/IGST-wise ટોટલ જોઈએ. HSN-wise સમરી પણ ખૂટે છે.

### 20. COGS હાલના `purchase_price` થી ગણાય છે, ઐતિહાસિક નહીં
`reportController.profitLoss()` અને dashboard બંને `p.purchase_price` (પ્રોડક્ટનો *આજનો* ભાવ) વાપરે છે. જો ખરીદભાવ બદલાય તો **જૂના મહિનાનો નફો બદલાઈ જશે**. હિસાબી દૃષ્ટિએ ખોટું.
**ઉપાય:** વેચાણ સમયે `sale_items` માં `cost_price` સ્નેપશોટ સ્ટોર કરો (અથવા FIFO/moving-average લેયર).

### 21. તારીખ/ટાઇમઝોન હાર્ડકોડેડ +5:30
`helpers.js` માં `const offset = 5.5 * 60` — `TIMEZONE` env વેરીએબલ હાજર છે પણ વપરાતું નથી. ભારત બહાર (કે DST વાળા દેશમાં) ખોટી તારીખો.
**ઉપાય:** `Intl.DateTimeFormat` + `timeZone: config.timezone` વાપરો.

### 22. ટેસ્ટ કવરેજ પાતળું — 10 ટેસ્ટ, ~10,700 લાઇન
હાલના ટેસ્ટ ફક્ત happy path છે. ઉપર P0 માં મળેલી બધી બગ્સ (નેગેટિવ સ્ટોક, નેગેટિવ qty, LIKE escape) ટેસ્ટમાં પકડાઈ નથી.
**ઉપાય:** `helpers.js` ના શુદ્ધ ફંક્શન્સ (`calcLineTotal`, `calcInvoiceTotals`, `round2`) માટે યુનિટ ટેસ્ટ — આ સૌથી વધુ ROI આપશે. પછી edge-case API ટેસ્ટ.

### 23. લિન્ટિંગ ખરેખર નથી
`backend: "lint": "node -c ... && echo 'Syntax OK'"`, `frontend: "lint": "echo 'Lint OK'"`. કોઈ ESLint કૉન્ફિગ ફાઇલ નથી.
**ઉપાય:** ESLint (flat config) + `eslint-plugin-react-hooks` ઉમેરો — hooks ની ભૂલો શાંતિથી બગ્સ બનાવે છે.

### 24. CI પાઇપલાઇન નથી
`.github/workflows/` ખાલી. એક નાનું workflow (`npm ci` → `npm test` → `vite build` → `npm audit`) દરેક PR પર ચલાવો.

---

## 🟢 નાની વાતો

- `authController.js` આખું લખાયેલું છે (login/register/changePassword/JWT) પણ કોઈ રૂટ એને વાપરતું નથી — dead code. કાં તો દૂર કરો, કાં તો `AUTH_ENABLED=1` ફ્લેગથી પાછું ચાલુ કરવાનો રસ્તો બનાવો. હાલ **કોઈપણ LAN યુઝર બધો ડેટા વાંચી/બદલી શકે છે** (`CORS_ORIGIN=*` + `HOST=0.0.0.0`) — દુકાનમાં ઠીક છે, પણ README માં સ્પષ્ટ ચેતવણી હોવી જોઈએ.
- `server.js` માં 404 હેન્ડલર **error હેન્ડલર પછી** રજિસ્ટર થયો છે — Express માં ક્રમ ખોટો છે. (કામ કરે છે કારણ કે error handler માત્ર `next(err)` પર ટ્રિગર થાય, પણ ક્રમ સુધારો.)
- `server.js` અને `START.sh` બંને `.env` બનાવે છે, અને બંનેની સામગ્રી અલગ છે (`RATE_LIMIT_MAX` 500 vs 2000, START.sh માં `JWT_SECRET` નથી). એક જ સ્રોત રાખો.
- `db.persist()` દરેક write પછી 80ms ડિબાઉન્સ સાથે **આખો DB** ડિસ્ક પર લખે છે. હાલ 300 KB પર ઠીક, પણ 50 MB DB પર દરેક બિલ = 50 MB લખાણ. મોટા ડેટા માટે better-sqlite3 (જ્યાં શક્ય) કે periodic checkpoint વિચારો.
- `helpers.paginate()` લખાયું છે પણ કોઈ કંટ્રોલર વાપરતું નથી — 15+ જગ્યાએ એ જ pagination કોડ કૉપી-પેસ્ટ થયો છે.
- `frontend/package.json` version `1.0.0`, બાકી બધું `1.1.0` — સિંક કરો.
- `viewport` માં `maximum-scale=1.0, user-scalable=no` છે — એક્સેસિબિલિટી માટે ખરાબ (વૃદ્ધ દુકાનદારો ઝૂમ ન કરી શકે).
- `index.css` 658 લાઇન સિંગલ ફાઇલ — CSS modules કે ઓછામાં ઓછું ફાઇલ-વિભાજન વિચારો.
- PDF ઇન્વોઇસ Helvetica વાપરે છે → **ગુજરાતી લખાણ PDF માં નહીં દેખાય**. Noto Sans Gujarati font એમ્બેડ કરો, નહીંતર દ્વિભાષી ફીચર બિલ સુધી પહોંચતું નથી.

---

## ભલામણ કરેલો ક્રમ

| ક્રમ | કામ | અંદાજિત મહેનત |
|---|---|---|
| 1 | `.env` / `.db` / બેકઅપ untrack + secret rotate | 15 મિનિટ |
| 2 | ઓડિટ લોગમાં પાસવર્ડ રિડેક્શન | 15 મિનિટ |
| 3 | ઇનપુટ વેલિડેશન લેયર (qty/price/negative stock) | 3-4 કલાક |
| 4 | `LIKE ... ESCAPE '\'` બધે | 1 કલાક |
| 5 | XSS સેનિટાઇઝર એરે ફિક્સ | 30 મિનિટ |
| 6 | ErrorBoundary + ConfirmDialog | 2 કલાક |
| 7 | `xlsx` બદલો | 2-3 કલાક |
| 8 | convert/create ટ્રાન્ઝેક્શન રિફેક્ટર | 3 કલાક |
| 9 | અનુવાદ પૂરો કરો + PDF ગુજરાતી ફોન્ટ | 1 દિવસ |
| 10 | કોડ સ્પ્લિટિંગ + SW ફિક્સ + manifest | 3 કલાક |
| 11 | ESLint + CI + યુનિટ ટેસ્ટ | 4 કલાક |
| 12 | inclusive tax + GST બ્રેકડાઉન + COGS સ્નેપશોટ | 2-3 દિવસ |

---

## શું સારું છે (બદલશો નહીં)

- sql.js રેપરનું better-sqlite3-કમ્પેટિબલ API — સ્માર્ટ ડિઝાઇન, ભવિષ્યમાં સ્વેપ સહેલો.
- સોફ્ટ-ડિલીટ + UNIQUE કૉલમ ફ્રી કરવાની ટ્રિક (`sku__del__12`) — વિચારપૂર્વકનું.
- ડિલીટ થયેલા રેકોર્ડને એ જ નામે ફરી બનાવતાં "restore" કરવાની પેટર્ન.
- `parameterized queries` બધે વપરાયા છે — SQL injection મળ્યું નથી ✅
- `restore` માં `path.basename()` — path traversal બ્લોક થાય છે ✅
- `export?type=` allowlist આધારિત — injection બ્લોક ✅
- સ્ટોક કેન્સલ પર બરાબર રિવર્સ થાય છે (પ્રોબમાં ચકાસ્યું: 10 → 7 → 10) ✅
- START.sh નું LAN-IP ડિટેક્શન અને PID મેનેજમેન્ટ — વ્યવહારુ.
