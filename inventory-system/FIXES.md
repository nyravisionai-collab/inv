# ફિક્સ રિપોર્ટ — કોડ રિવ્યુના બધા મુદ્દા

`CODE_REVIEW.md` માં નોંધાયેલા **24 મુદ્દા + નાની વાતો** — બધા ઠીક કરાયા અને ચકાસાયા.

| માપદંડ | પહેલાં | પછી |
|---|---|---|
| ટેસ્ટ | 10 પાસ | **48 પાસ** (26 unit + 22 API) |
| મુખ્ય JS bundle | 852 KB (gzip 235) | **332 KB** (gzip 106) |
| Production vulnerabilities | 1 high | **0** |
| ESLint | કૉન્ફિગ જ નહોતું | **0 errors** (backend + frontend) |
| અનુવાદ કી | 66 | **352** (en + gu પૂર્ણ) |
| `t()` વપરાશ | 129 | **642** |

---

## 🔴 P0 — ગંભીર

### 1. `.env`, `inventory.db`, બેકઅપ Git માંથી કાઢ્યાં
`git rm --cached` થી untrack કર્યાં; `.gitignore` માં `backend/data/`, `backend/backups/`, `.pids` ઉમેર્યાં. ડિસ્ક પરની ફાઇલો અકબંધ છે.
CI માં `secrets` job ઉમેર્યું જે આવી ફાઇલ ફરી કમિટ થાય તો બિલ્ડ તોડે.

### 2. નેગેટિવ સ્ટોક અટકાવ્યો
`stockService.assertItemsAvailable()` — સેલ/POS/purchase-return લખાય **તે પહેલાં** આખું બાસ્કેટ ચકાસે છે (એક જ પ્રોડક્ટની બહુવિધ લાઇન એકસાથે ગણીને).
`company_settings.allow_negative_stock` ફ્લેગથી વેપારી સભાનપણે ઓવરસેલ ચાલુ કરી શકે.

```
પહેલાં:  2 નંગ સ્ટોક, 50 વેચ્યા → 201 OK, સ્ટોક -48
પછી:     400 ERR_INSUFFICIENT_STOCK, સ્ટોક 2 જ રહ્યો ✅
```

### 3. નેગેટિવ quantity/price અટકાવ્યાં
નવું `backend/src/utils/validate.js` — `quantity > 0`, `price >= 0`, `discount <= line total`, `tax 0–100`, તારીખ ખરી કેલેન્ડર તારીખ છે કે નહીં, વગેરે. દરેક ભૂલ `ValidationError` ફેંકે છે જેમાં HTTP status અને સ્થિર `code` હોય છે.

```
પહેલાં:  qty -5 × price -100 → 201 OK, grand_total 500
પછી:     400 ERR_TOO_SMALL ✅
```

### 4. ઓડિટ લોગમાં પાસવર્ડ રિડેક્ટ કર્યા
`utils/sanitize.js` નું `redact()` — `password`, `new_password`, `token`, `api_key` વગેરે કોઈપણ ઊંડાઈએ (nested objects અને arrays સહિત) `[REDACTED]` થાય છે.

### 5. XSS સેનિટાઇઝર એરેની અંદર પણ
`sanitizeDeep()` હવે arrays માં recurse કરે છે, અને tags ઉપરાંત `onerror=` જેવા event handlers અને `javascript:` URLs પણ કાઢે છે.

```
પહેલાં:  items[0].product_name = "<script>bad</script>Item"
પછી:     "badItem" ✅
```

**બોનસ:** CSV/XLSX એક્સપોર્ટમાં formula injection (`=`, `+`, `-`, `@`) સામે `csvSafeRows()` ઉમેર્યું.

---

## 🟠 P1

### 6. `xlsx` CVE દૂર — dependency જ કાઢી નાખી
`exceljs` અજમાવ્યું પણ એ 10 નવી vulnerabilities લાવ્યું. તેના બદલે **`backend/src/utils/xlsx.js`** લખ્યું — Node ના built-in `zlib` પર આધારિત minimal XLSX reader/writer (એક .xlsx એ XML નું ZIP જ છે).

ચકાસણી: openpyxl (Excel-compatible parser) એ આપણી ફાઇલ બરાબર ખોલી, અને openpyxl-બનાવેલી ફાઇલ આપણું reader બરાબર વાંચે — ગુજરાતી ટેક્સ્ટ, numbers, booleans, sparse cells, ખાલી પંક્તિઓ સહિત.

**પરિણામ: production dependencies માં 0 vulnerabilities.**

### 7. `LIKE ... ESCAPE` બધા 38 ક્લોઝમાં
Backslash ને JS + SQLite બંને સ્તરે escape કરવું ભૂલભરેલું છે (SQLite string literals માં backslash escape થતો જ નથી), એટલે escape character તરીકે `!` વાપર્યો.

```
પહેલાં:  "Rice_" શોધ → []           (અથવા SQL error)
પછી:     ["Rice_50kg"], "Rice X 50kg" બાકાત ✅
```

### 8. ઇન્વોઇસ નંબરિંગ atomic
`UPDATE ... SET n = n + 1` પછી read-back. વધારામાં collision guard — રિસ્ટોર પછી કાઉન્ટર પાછળ રહી ગયો હોય તો ડુપ્લિકેટ નંબર ન બને.

### 9. convert/create એક જ transaction માં
`createSaleCore()` ને HTTP લેયરથી અલગ કાઢ્યું, જેથી `convert()` સ્રોત-અપડેટ અને લક્ષ્ય-બનાવટ બંને એક ટ્રાન્ઝેક્શનમાં કરે.

```
પહેલાં:  convert નિષ્ફળ → સ્રોત 'converted' માં અટવાયો, નવો બિલ નહીં
પછી:     400, સ્રોત 'completed' જ રહ્યો ✅
```

### 10. `trust proxy` હવે શરતી
`TRUST_PROXY` env થી નિયંત્રિત (મૂળભૂત બંધ). પહેલાં બિનશરતી `1` હોવાથી કોઈપણ ક્લાયન્ટ `X-Forwarded-For` મોકલીને રેટ લિમિટ ચકમો આપી શકતો.

### 11. `restore` પછી સર્વર જીવંત રહે છે
`database.js` માં `reload()` ઉમેર્યું — in-memory image બદલાય, સર્વર ચાલુ રહે. રિસ્ટોર નિષ્ફળ જાય તો આપોઆપ `.pre-restore` snapshot થી rollback થાય.

```
પહેલાં:  restore → DB બંધ → પછીની બધી request 500
પછી:     restore 200 → પછીની GET 200 ✅
```

### 12. Pagination clamp
`pageParams()` બધા 8 કંટ્રોલરમાં. `?page=-5&limit=99999` → `page: 1, limit: 100`.

### 13. ErrorBoundary
`components/ErrorBoundary.jsx` — સફેદ સ્ક્રીનને બદલે "ફરી પ્રયાસ કરો" / "એપ ફરી ચાલુ કરો" બટન સાથે અનુવાદિત fallback.

---

## 🟡 P2

### 14. અનુવાદ પૂર્ણ — 66 → 352 કી
513 hardcoded strings ને `t()` થી લપેટ્યાં (`t()` વપરાશ 129 → 642). બધી કી બંને ભાષામાં.

**બેકએન્ડ error codes પણ અનુવાદિત:** કંટ્રોલર્સ હવે `{ success, message, code }` પરત કરે છે; `frontend/src/utils/apiError.js` એ `code` ને અનુવાદિત સંદેશમાં ફેરવે છે — વપરાશકર્તાને કાચું અંગ્રેજી કદી ન દેખાય.

`npm run i18n:check` — ખૂટતી/અનુવાદ ન થયેલી/વણવપરાયેલી કી શોધે છે, CI માં ચાલે છે.

### 15. `window.confirm()` → `ConfirmContext`
Promise-આધારિત, થીમ-સભાન, અનુવાદ્ય ડાયલોગ (Enter/Escape સપોર્ટ સાથે). બધા 8 કૉલ બદલ્યા.

### 16. Bundle 852 → 332 KB
`React.lazy()` થી રૂટ-લેવલ splitting, અને recharts ને અલગ `DashboardCharts` chunk માં — KPI cards તરત દેખાય.

### 17. Service worker + PWA
SW હવે `/api/` અને `/uploads/` **કદી કેશ કરતું નથી** (POS માં વાસી સ્ટોક/ભાવ જોખમી છે). Navigation network-first, static assets cache-first.
`manifest.webmanifest` + 192/512 આઇકોન ઉમેર્યાં — હવે ખરેખર ઇન્સ્ટોલ થાય છે.

### 18. Tax-inclusive ભાવ
`calcLineTotal()` હવે `inclusive` / `exclusive` / `none` સંભાળે છે અને `taxableAmount` પરત કરે છે. પ્રોડક્ટનું `tax_type` POS માં આપોઆપ વારસામાં મળે છે.

```
₹118 inclusive @18% → taxable ₹100 + tax ₹18 = કુલ ₹118 ✅
```

### 19. GST રિપોર્ટમાં CGST/SGST/IGST + HSN
Intra/inter-state પ્રમાણે વિભાજન, rate-wise સમરી, અને HSN-wise સમરી — GSTR-1/3B ફાઇલિંગ માટે જરૂરી.

### 20. COGS ઐતિહાસિક
`sale_items.cost_price` કૉલમ — વેચાણ સમયનો ખરીદભાવ સ્નેપશોટ. હવે ખરીદભાવ બદલાય તો જૂના મહિનાનો નફો બદલાતો નથી. જૂના રેકોર્ડ માટે migration backfill કરે છે.

### 21. Timezone config-driven
હાર્ડકોડેડ +5:30 કાઢીને `Intl.DateTimeFormat` + `config.timezone`. ખોટા timezone પર સિસ્ટમ zone પર fallback.

### 22. ટેસ્ટ 10 → 48
26 યુનિટ ટેસ્ટ (money maths, validation, sanitize, xlsx round-trip) + 22 API ટેસ્ટ, જેમાં ઉપરની **દરેક P0/P1 બગ માટે regression ટેસ્ટ** છે.

### 23. ESLint
બંને પેકેજમાં flat config. `react-hooks/rules-of-hooks` એ તરત જ **ખરી બગ પકડી** — `Inventory.jsx` માં ત્રણ જગ્યાએ hook `load()` ફંક્શનની અંદર હતો (રનટાઇમ ક્રેશ થાત). ઠીક કર્યું. હવે 0 errors.

### 24. CI પાઇપલાઇન
`.github/workflows/ci.yml` — ત્રણ jobs: backend (lint/test/audit), frontend (lint/i18n/build/audit), secrets (કમિટ થયેલી `.env`/`.db` ફાઇલો શોધે).

---

## 🟢 નાની વાતો

- **404 હેન્ડલર** હવે error handler **પહેલાં** રજિસ્ટર થાય છે.
- **`.env` એક જ સ્રોત** — `server.js` અને `START.sh` બંને હવે `.env.example` કૉપી કરે છે; `SERVE_FRONTEND` પણ config થી.
- **PDF માં ગુજરાતી** — `utils/pdf.js` Noto Sans Gujarati (npm dependency) રજિસ્ટર કરે છે. ફોન્ટ ન મળે તો Helvetica + `Rs.` પર graceful fallback. પહેલાં ગુજરાતી બિલમાં દેખાતું જ નહોતું અને ₹ પણ નહીં.
- **SVG અપલોડ બંધ** — inline script લઈ જઈ શકે અને `/uploads` થી પાછું સર્વ થાય છે.
- **Viewport** — `user-scalable=no` કાઢ્યું; વૃદ્ધ વપરાશકર્તાઓ હવે ઝૂમ કરી શકે.
- **Google Fonts કાઢ્યું** — એપ ઓફલાઇન છે પણ ફોન્ટ નેટવર્કથી આવતો હતો; હવે platform font stack.
- **Dead imports** — 8 ફાઇલોમાંથી વણવપરાયેલા imports સાફ.
- **`paginated()` clamp** — response metadata હંમેશા માન્ય.
- **Version sync** — frontend 1.0.0 → 1.1.0.

---

## ચકાસણી

```bash
cd inventory-system && npm run verify
```

```
backend   ESLint  0 errors
backend   tests   48 pass / 0 fail
backend   audit   0 vulnerabilities (production)
frontend  ESLint  0 errors
frontend  i18n    passed (352 keys, both languages)
frontend  build   ✓ 332 KB main bundle
```

### જાણીતો સ્વીકૃત અપવાદ

`react-router-dom` માટે GHSA-qwww-vcr4-c8h2 (RSC mode CSRF) દરેક 7.12+ રિલીઝમાં નોંધાયેલું છે. આ એપ `<BrowserRouter>` વાપરતું ક્લાયન્ટ-ઓન્લી SPA છે — કોઈ RSC કે server actions નથી, એટલે લાગુ પડતું નથી. જૂનાં વર્ઝનમાં 14 વધુ ગંભીર client-side XSS advisories છે, તેથી 7.18.1 જ સૌથી સુરક્ષિત પસંદગી છે. CI આ એક અપવાદને allowlist કરે છે અને બાકી કોઈપણ high/critical પર તૂટે છે.

---

## માઇગ્રેશન નોંધ

હાલના ડેટાબેઝ આપોઆપ અપગ્રેડ થાય છે — `migrate.js` ખૂટતા કૉલમ (`allow_negative_stock`, `cost_price`) ઉમેરે છે અને જૂની વેચાણ લાઇનો માટે `cost_price` backfill કરે છે. કોઈ મેન્યુઅલ પગલું જરૂરી નથી.
