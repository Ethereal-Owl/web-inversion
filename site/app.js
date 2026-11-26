/* Análisis Fundamental: web estática. Todos los cálculos se hacen en el navegador. */
(function () {
'use strict';

const DATA = 'data/';
const app = document.getElementById('app');
const cache = {};
let charts = [];

// ---------------------------------------------------------------- utilidades
const $ = (sel, el = document) => el.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isNum = v => typeof v === 'number' && isFinite(v);
const nf = (d = 2) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmt = (v, d = 2) => isNum(v) ? nf(d).format(v) : '–';
const pct = (v, d = 1) => isNum(v) ? nf(d).format(v * 100) + ' %' : '–';
const mult = v => isNum(v) ? nf(1).format(v) + 'x' : '–';
function big(v, ccy) {
  if (!isNum(v)) return '–';
  const a = Math.abs(v), s = ccy ? ' ' + ccySym(ccy) : '';
  if (a >= 1e12) return nf(2).format(v / 1e12) + ' bill.' + s;
  if (a >= 1e9) return nf(1).format(v / 1e9) + ' mil M' + s;
  if (a >= 1e6) return nf(1).format(v / 1e6) + ' M' + s;
  if (a >= 1e3) return nf(0).format(v / 1e3) + ' mil' + s;
  return nf(0).format(v) + s;
}
const ccySym = c => ({ USD: '$', EUR: '€', GBP: '£', JPY: '¥' }[c] || c || '');
const money = (v, ccy, d = 2) => isNum(v) ? nf(d).format(v) + ' ' + ccySym(ccy) : '–';
const sum = a => a.reduce((x, y) => x + (y || 0), 0);
const avg = a => { const b = a.filter(isNum); return b.length ? sum(b) / b.length : null; };
const median = a => { const b = a.filter(isNum).sort((x, y) => x - y); if (!b.length) return null; const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const div = (a, b) => (isNum(a) && isNum(b) && b !== 0) ? a / b : null;
const cagr = (a, b, n) => (isNum(a) && isNum(b) && a > 0 && b > 0 && n > 0) ? Math.pow(b / a, 1 / n) - 1 : null;
const help = t => `<span class="help" title="${esc(t)}">?</span>`;
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } }
};

async function getJSON(path) {
  if (cache[path]) return cache[path];
  const r = await fetch(DATA + path);
  if (!r.ok) throw new Error(r.status === 404 ? 'No encontrado' : 'Error ' + r.status);
  return (cache[path] = await r.json());
}
function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function destroyCharts() { charts.forEach(c => c.destroy()); charts = []; }
function chart(canvas, cfg) {
  if (!window.Chart) return;
  Chart.defaults.color = css('--muted');
  Chart.defaults.borderColor = css('--line');
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
    plugins: { legend: { labels: { boxWidth: 12 } } } }, cfg.options || {});
  charts.push(new Chart(canvas, cfg));
}
const COLORS = () => ['--c1', '--c2', '--c3', '--c4', '--c5'].map(css);

// ---------------------------------------------------------------- glosario
const DEF = {
  gm: 'Margen bruto: beneficio bruto / ventas. Indica cuánto queda tras el coste directo de lo vendido.',
  om: 'Margen operativo: beneficio operativo (EBIT) / ventas. Mide la rentabilidad del negocio principal.',
  nm: 'Margen neto: beneficio neto / ventas.',
  fcfm: 'Margen de flujo de caja libre: (flujo de caja operativo − inversiones en inmovilizado) / ventas.',
  ebitdam: 'Margen EBITDA: (beneficio operativo + amortizaciones) / ventas.',
  roe: 'ROE (rentabilidad sobre fondos propios): beneficio neto / patrimonio neto medio del año.',
  roa: 'ROA (rentabilidad sobre activos): beneficio neto / activos totales medios.',
  roce: 'ROCE (rentabilidad sobre capital empleado): beneficio operativo / (activos totales − pasivo corriente).',
  roic: 'ROIC (rentabilidad sobre capital invertido): beneficio operativo después de impuestos / (patrimonio + deuda − caja).',
  revg: 'Crecimiento de las ventas respecto al año anterior.',
  epsg: 'Crecimiento del beneficio por acción respecto al año anterior.',
  de: 'Deuda / patrimonio: deuda financiera total entre fondos propios.',
  ndebitda: 'Deuda neta / EBITDA: años de EBITDA necesarios para pagar la deuda neta. Por encima de 3x suele considerarse elevado.',
  cr: 'Liquidez corriente: activo corriente / pasivo corriente.',
  ic: 'Cobertura de intereses: beneficio operativo / gastos financieros.',
  payout: 'Payout: dividendos pagados / beneficio neto.',
  pe: 'PER: precio / beneficio por acción. Cuántos años de beneficio pagas.',
  pfcf: 'P/FCF: capitalización / flujo de caja libre.',
  ps: 'P/Ventas: capitalización / ventas.',
  pb: 'P/Valor contable: capitalización / patrimonio neto.',
  evebit: 'EV/EBIT: valor de empresa (capitalización + deuda − caja) / beneficio operativo.',
  evebitda: 'EV/EBITDA: valor de empresa / EBITDA.',
  fcfy: 'Rentabilidad por flujo de caja libre: FCF / capitalización (lo inverso del P/FCF).',
  dy: 'Rentabilidad por dividendo: dividendos pagados / capitalización.',
  shg: 'Variación del número de acciones. Negativo = la empresa recompra acciones (bueno para el accionista); positivo = dilución.',
  dcf: 'DCF (descuento de flujos de caja): el valor de una empresa es la suma de los flujos de caja libres que generará en el futuro, traídos a valor de hoy con una tasa de descuento (tu rentabilidad exigida).',
  wacc: 'Tasa de descuento: la rentabilidad anual que exiges. Un 8-10 % es habitual para empresas grandes; más alta si el negocio es más arriesgado.',
  tg: 'Crecimiento a perpetuidad: lo que crecerá el flujo de caja para siempre a partir del año 10. No debería superar el crecimiento de la economía (2-3 %).',
  mos: 'Margen de seguridad: cuánto por debajo de su valor estimado cotiza la acción.',
  ttm: 'Últimos 12 meses (TTM): suma de los cuatro últimos trimestres publicados.'
};

// ---------------------------------------------------------------- router
const routes = [
  [/^#?\/?$/, home],
  [/^#\/c\/([^/]+)(?:\/(\w+))?$/, company],
  [/^#\/inversores$/, investors],
  [/^#\/inversor\/(\d+)$/, investor],
  [/^#\/screener$/, screener],
  [/^#\/ayuda$/, glossary],
  [/^#\/guia$/, guide]
];
async function route() {
  destroyCharts();
  const h = location.hash || '#/';
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active',
    ('#/' + (a.dataset.nav === 'home' ? '' : a.dataset.nav)) === h || (a.dataset.nav === 'inversores' && h.startsWith('#/inversor'))));
  for (const [re, fn] of routes) {
    const m = h.match(re);
    if (m) {
      app.innerHTML = '<div class="loading">Cargando…</div>';
      try { await fn(...m.slice(1).map(x => x && decodeURIComponent(x))); }
      catch (e) { console.error(e); app.innerHTML = `<div class="card"><h2>No se pudo cargar</h2><p class="muted">${esc(e.message)}</p><p><a href="#/">Volver al inicio</a></p></div>`; }
      window.scrollTo(0, 0);
      return;
    }
  }
  app.innerHTML = '<div class="card">Página no encontrada. <a href="#/">Inicio</a></div>';
}
window.addEventListener('hashchange', route);

// ---------------------------------------------------------------- buscador
let INDEX = null;
async function loadIndex() { if (!INDEX) INDEX = await getJSON('index.json'); return INDEX; }
function searchIndex(q) {
  q = q.trim().toUpperCase();
  if (!q || !INDEX) return [];
  const exact = [], starts = [], name = [];
  for (const r of INDEX) {
    const t = r[0], n = r[1].toUpperCase();
    if (t === q) exact.push(r);
    else if (t.startsWith(q)) starts.push(r);
    else if (n.includes(q)) name.push(r);
    if (starts.length + name.length > 60) break;
  }
  starts.sort((a, b) => a[0].length - b[0].length);
  return exact.concat(starts, name).slice(0, 12);
}
function attachSearch(input, box) {
  let sel = 0, items = [];
  const render = () => {
    items = searchIndex(input.value);
    if (!items.length) { box.hidden = true; return; }
    box.innerHTML = items.map((r, i) => `<div data-t="${esc(r[0])}" class="${i === sel ? 'sel' : ''}"><b>${esc(r[0])}</b><span>${esc(r[1])}</span><span class="muted small">${esc(r[2])}</span></div>`).join('');
    box.hidden = false;
  };
  input.addEventListener('focus', loadIndex);
  input.addEventListener('input', async () => { await loadIndex(); sel = 0; render(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, items.length - 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); render(); e.preventDefault(); }
    else if (e.key === 'Enter') {
      const t = items[sel] ? items[sel][0] : input.value.trim().toUpperCase();
      if (t) { location.hash = '#/c/' + encodeURIComponent(t); input.value = ''; box.hidden = true; input.blur(); }
    } else if (e.key === 'Escape') box.hidden = true;
  });
  box.addEventListener('mousedown', e => {
    const d = e.target.closest('[data-t]');
    if (d) { location.hash = '#/c/' + encodeURIComponent(d.dataset.t); input.value = ''; box.hidden = true; }
  });
  input.addEventListener('blur', () => setTimeout(() => (box.hidden = true), 150));
}
attachSearch($('#search'), $('#suggest'));

// ---------------------------------------------------------------- inicio
async function home() {
  let meta = null;
  try { meta = await getJSON('meta.json'); } catch (e) { /* sin datos */ }
  const popular = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'BRK.B', 'KO', 'JNJ', 'V', 'MA', 'COST', 'ASML', 'NVO', 'TSM', 'MCD', 'PEP', 'PG'];
  app.innerHTML = `
  <section class="hero">
    <h1>Análisis fundamental, gratis</h1>
    <p class="muted">Métricas, históricos, valor intrínseco, proyecciones y carteras de grandes inversores${meta ? ` para <b>${nf(0).format(meta.companies)}</b> empresas que cotizan en EE. UU.` : ''}.</p>
    <div class="big-search"><input id="s2" type="search" placeholder="Escribe un ticker o un nombre…" autocomplete="off"><div id="sug2" class="suggest" hidden></div></div>
    <div class="chips">${popular.map(t => `<a class="chip" href="#/c/${t}">${t}</a>`).join('')}</div>
  </section>
  ${meta ? '' : `<div class="note">Todavía no hay datos descargados. Se generan automáticamente con el proceso de actualización diaria.</div>`}
  <div class="grid g3">
    <a class="card" href="#/screener"><h3>Buscador de acciones</h3><p class="muted">Filtra todas las empresas por ROCE, márgenes, PER, crecimiento o deuda.</p></a>
    <a class="card" href="#/inversores"><h3>Grandes inversores</h3><p class="muted">Carteras y movimientos trimestrales de Buffett, Ackman, Burry, Li Lu, Terry Smith y más.</p></a>
    <a class="card" href="#/ayuda"><h3>Glosario</h3><p class="muted">Qué significa cada métrica y cómo se calcula.</p></a>
  </div>`;
  attachSearch($('#s2'), $('#sug2'));
  $('#s2').focus();
}

// ---------------------------------------------------------------- modelo de empresa
// Detecta splits en una serie anual de acciones: un salto entre dos años (o entre el último año y las acciones actuales)
// casi exacto a una proporción típica (2:1, 3:1, 4:1, 10:1, 3:2… o al revés). Devuelve el factor por el que multiplicar
// las acciones de cada año (y dividir el BPA) para expresarlo todo en acciones de hoy.
const SPLIT_RATIOS = [1.5, 2, 3, 4, 5, 6, 7, 8, 10, 15, 20, 25, 30, 40, 50, 100];
function splitRatio(r) {
  if (!isNum(r) || r <= 0) return null;
  const up = r >= 1 ? r : 1 / r;
  if (up < 1.45) return null;
  // Tolerancia: ±6 %; en splits de 2:1 o más, hasta un 30 % de más, porque el mismo año puede haber emisiones
  // (p. ej., Tesla 2020: split 5:1 + ampliaciones, las acciones se multiplicaron por 3,65 en los datos de la SEC).
  const ok = SPLIT_RATIOS.filter(x => up / x > 0.94 && up / x < (x >= 2 ? 1.3 : 1.06));
  const k = ok.sort((x, y) => Math.abs(Math.log(up / x)) - Math.abs(Math.log(up / y)))[0];
  return k ? (r >= 1 ? k : 1 / k) : null;
}
function splitFactors(sh, current) {
  const n = sh.length, f = new Array(n).fill(1), events = [];
  let acc = 1, next = null;
  // De las acciones actuales hacia atrás.
  const lastIdx = (() => { for (let i = n - 1; i >= 0; i--) if (isNum(sh[i]) && sh[i] > 0) return i; return -1; })();
  if (lastIdx >= 0 && isNum(current) && current > 0) { const k = splitRatio(current / sh[lastIdx]); if (k && Math.abs(k) >= 2 || (k && k <= 0.5)) { acc = k; events.push({ after: lastIdx, k }); } }
  for (let i = n - 1; i >= 0; i--) {
    if (!isNum(sh[i]) || sh[i] <= 0) { f[i] = acc; continue; }
    if (next !== null) { const k = splitRatio(sh[next] / sh[i]); if (k) { acc *= k; events.push({ after: i, k }); } }
    f[i] = acc; next = i;
  }
  return { f, events };
}

function buildModel(d) {
  const A = d.annual || {}, n = d.years.length;
  const col = k => (A[k] || new Array(n).fill(null)).map(v => isNum(v) ? v : null);
  const fx = d.currency === 'USD' ? 1 : (d.fxUSD || null);
  const priceUSD = d.price && d.price.price;
  const price = isNum(priceUSD) && fx ? priceUSD / fx : null; // precio en la divisa de los informes
  const hist = (d.price && d.price.history) || [];
  const priceAt = end => { // cierre mensual del mes de cierre fiscal
    const ym = end.slice(0, 7);
    for (let i = hist.length - 1; i >= 0; i--) if (hist[i][0] <= ym) return hist[i][0] === ym || i === hist.length - 1 ? (fx ? hist[i][1] / fx : null) : (fx ? hist[i][1] / fx : null);
    return null;
  };
  const Y = {
    revenue: col('revenue'), cogs: col('costOfRevenue'), gp: col('grossProfit'), op: col('operatingIncome'),
    ni: col('netIncome'), eps: col('epsDiluted'), shares: col('sharesDiluted'), dna: col('dna'), sbc: col('sbc'),
    rnd: col('rnd'), sga: col('sga'), interest: col('interestExpense'), tax: col('incomeTax'), pretax: col('pretaxIncome'),
    cfo: col('cfo'), capex: col('capex'), divs: col('dividendsPaid'), buybacks: col('buybacks'), dps: col('dps'),
    cash: col('cash'), sti: col('shortInvestments'), rec: col('receivables'), inv: col('inventory'), ca: col('currentAssets'),
    gw: col('goodwill'), intang: col('intangibles'), assets: col('totalAssets'), cl: col('currentLiabilities'),
    liab: col('totalLiabilities'), ltdn: col('ltDebtNoncurrent'), ltdt: col('ltDebtTotal'), ltdc: col('ltDebtCurrent'),
    std: col('stDebt'), equity: col('equity'), so: col('sharesOutstanding')
  };
  const debtOf = (ltdn, ltdt, ltdc, std) => {
    if (isNum(ltdn)) return ltdn + (ltdc || 0) + (std || 0);
    if (isNum(ltdt)) return ltdt + (std || 0);
    if (isNum(ltdc) || isNum(std)) return (ltdc || 0) + (std || 0);
    return null;
  };
  // Splits: la SEC solo reexpresa los 2-3 últimos años tras un split; los anteriores quedan con acciones y BPA antiguos
  // (p. ej., Nvidia 4:1 en 2021 y 10:1 en 2024). Sin ajustarlos, la «variación de acciones» sale en +900 % un año,
  // el PER histórico en 3-5 y la proyección no tiene sentido. Los precios (Yahoo) ya vienen ajustados.
  const splitAdj = splitFactors(Y.shares, d.sharesOutstanding);
  const soAdj = splitFactors(Y.so, d.sharesOutstanding);
  Y.splits = splitAdj.events;
  Y.shares = Y.shares.map((v, i) => isNum(v) ? v * splitAdj.f[i] : v);
  Y.so = Y.so.map((v, i) => isNum(v) ? v * soAdj.f[i] : v);
  const perShare = (v, i) => isNum(v) ? v / (isNum(Y.shares[i]) ? splitAdj.f[i] : soAdj.f[i]) : v;
  Y.eps = Y.eps.map(perShare); Y.dps = Y.dps.map(perShare);
  Y.gp = Y.gp.map((v, i) => isNum(v) ? v : (isNum(Y.revenue[i]) && isNum(Y.cogs[i]) ? Y.revenue[i] - Y.cogs[i] : null));
  Y.debt = Y.ltdn.map((_, i) => debtOf(Y.ltdn[i], Y.ltdt[i], Y.ltdc[i], Y.std[i]));
  Y.cashT = Y.cash.map((v, i) => isNum(v) || isNum(Y.sti[i]) ? (v || 0) + (Y.sti[i] || 0) : null);
  Y.fcf = Y.cfo.map((v, i) => isNum(v) ? v - Math.abs(Y.capex[i] || 0) : null);
  Y.ebitda = Y.op.map((v, i) => isNum(v) && isNum(Y.dna[i]) ? v + Y.dna[i] : null);
  Y.shares = Y.shares.map((v, i) => isNum(v) ? v : (isNum(Y.eps[i]) && Y.eps[i] !== 0 && isNum(Y.ni[i]) ? Y.ni[i] / Y.eps[i] : Y.so[i]));
  Y.eps = Y.eps.map((v, i) => isNum(v) ? v : div(Y.ni[i], Y.shares[i]));
  Y.taxRate = Y.tax.map((t, i) => { const r = div(t, Y.pretax[i]); return isNum(r) && r >= 0 && r <= 0.5 ? r : null; });
  Y.price = d.years.map(priceAt);

  // Últimos 12 meses (TTM) con el balance más reciente
  const T = d.ttm || {}, B = d.latestBalance || {};
  const L = {};
  const last = arr => { for (let i = arr.length - 1; i >= 0; i--) if (isNum(arr[i])) return arr[i]; return null; };
  const tv = (k, y) => isNum(T[k]) ? T[k] : last(y);
  L.revenue = tv('revenue', Y.revenue); L.op = tv('operatingIncome', Y.op); L.ni = tv('netIncome', Y.ni);
  L.cogs = tv('costOfRevenue', Y.cogs);
  L.gp = isNum(T.grossProfit) ? T.grossProfit : (isNum(T.revenue) && isNum(T.costOfRevenue) ? T.revenue - T.costOfRevenue : last(Y.gp));
  L.cfo = tv('cfo', Y.cfo); L.capex = tv('capex', Y.capex); L.fcf = isNum(L.cfo) ? L.cfo - Math.abs(L.capex || 0) : null;
  L.dna = tv('dna', Y.dna); L.ebitda = isNum(L.op) && isNum(L.dna) ? L.op + L.dna : null; L.sbc = tv('sbc', Y.sbc);
  L.divs = tv('dividendsPaid', Y.divs); L.interest = tv('interestExpense', Y.interest); L.buybacks = tv('buybacks', Y.buybacks);
  L.tax = tv('incomeTax', Y.tax); L.pretax = tv('pretaxIncome', Y.pretax);
  const bl = (k, y) => isNum(B[k]) ? B[k] : last(y);
  L.cash = bl('cash', Y.cash); L.sti = bl('shortInvestments', Y.sti); L.cashT = (L.cash || 0) + (L.sti || 0);
  L.assets = bl('totalAssets', Y.assets); L.cl = bl('currentLiabilities', Y.cl); L.ca = bl('currentAssets', Y.ca);
  L.equity = bl('equity', Y.equity); L.liab = bl('totalLiabilities', Y.liab);
  L.debt = Object.keys(B).some(k => /Debt/.test(k)) ? debtOf(B.ltDebtNoncurrent, B.ltDebtTotal, B.ltDebtCurrent, B.stDebt) : last(Y.debt);
  L.shares = d.sharesOutstanding || last(Y.shares);
  L.eps = div(L.ni, last(Y.shares) || L.shares);
  L.taxRate = (() => { const r = div(L.tax, L.pretax); return isNum(r) && r >= 0 && r <= 0.5 ? r : (avg(Y.taxRate.slice(-3)) ?? 0.21); })();
  L.price = price; L.mc = isNum(price) && isNum(L.shares) ? price * L.shares : null;
  L.ev = isNum(L.mc) ? L.mc + (L.debt || 0) - (L.cashT || 0) : null;
  L.netDebt = (L.debt || 0) - (L.cashT || 0);
  L.date = d.ttmEnd;
  return { d, Y, L, n, fx, price, priceUSD, ccy: d.currency };
}

function yearRatios(M) {
  const { Y, n } = M;
  const R = {};
  const f = fn => Array.from({ length: n }, (_, i) => { const v = fn(i); return isNum(v) ? v : null; });
  const avg2 = (a, i) => isNum(a[i]) ? (isNum(a[i - 1]) ? (a[i] + a[i - 1]) / 2 : a[i]) : null;
  R.gm = f(i => div(Y.gp[i], Y.revenue[i])); R.om = f(i => div(Y.op[i], Y.revenue[i]));
  R.ebitdam = f(i => div(Y.ebitda[i], Y.revenue[i])); R.nm = f(i => div(Y.ni[i], Y.revenue[i]));
  R.fcfm = f(i => div(Y.fcf[i], Y.revenue[i]));
  R.roe = f(i => { const e = avg2(Y.equity, i); return e > 0 ? div(Y.ni[i], e) : null; });
  R.roa = f(i => div(Y.ni[i], avg2(Y.assets, i)));
  R.roce = f(i => { const ce = isNum(Y.assets[i]) && isNum(Y.cl[i]) ? Y.assets[i] - Y.cl[i] : null; return ce > 0 ? div(Y.op[i], ce) : null; });
  R.roic = f(i => { const ic = isNum(Y.equity[i]) ? Y.equity[i] + (Y.debt[i] || 0) - (Y.cashT[i] || 0) : null; const t = Y.taxRate[i] ?? 0.21; return ic > 0 && isNum(Y.op[i]) ? Y.op[i] * (1 - t) / ic : null; });
  const g = a => f(i => i > 0 && isNum(a[i - 1]) && a[i - 1] > 0 && isNum(a[i]) ? a[i] / a[i - 1] - 1 : null);
  R.revg = g(Y.revenue); R.epsg = g(Y.eps); R.fcfg = g(Y.fcf); R.shg = g(Y.shares);
  R.de = f(i => Y.equity[i] > 0 ? div(Y.debt[i], Y.equity[i]) : null);
  R.ndebitda = f(i => Y.ebitda[i] > 0 && isNum(Y.debt[i]) ? (Y.debt[i] - (Y.cashT[i] || 0)) / Y.ebitda[i] : null);
  R.cr = f(i => div(Y.ca[i], Y.cl[i]));
  R.ic = f(i => Y.interest[i] > 0 ? div(Y.op[i], Y.interest[i]) : null);
  R.payout = f(i => Y.ni[i] > 0 && isNum(Y.divs[i]) ? Math.abs(Y.divs[i]) / Y.ni[i] : null);
  R.fcfps = f(i => div(Y.fcf[i], Y.shares[i])); R.bvps = f(i => div(Y.equity[i], Y.shares[i]));
  R.dps = f(i => isNum(Y.dps[i]) ? Y.dps[i] : div(Math.abs(Y.divs[i] || 0) || null, Y.shares[i]));
  const mc = f(i => isNum(Y.price[i]) && isNum(Y.shares[i]) ? Y.price[i] * Y.shares[i] : null);
  R.mc = mc;
  R.pe = f(i => Y.eps[i] > 0 ? div(Y.price[i], Y.eps[i]) : null);
  R.pfcf = f(i => Y.fcf[i] > 0 ? div(mc[i], Y.fcf[i]) : null);
  R.ps = f(i => div(mc[i], Y.revenue[i]));
  R.pb = f(i => Y.equity[i] > 0 ? div(mc[i], Y.equity[i]) : null);
  R.evebit = f(i => Y.op[i] > 0 && isNum(mc[i]) ? (mc[i] + (Y.debt[i] || 0) - (Y.cashT[i] || 0)) / Y.op[i] : null);
  R.evebitda = f(i => Y.ebitda[i] > 0 && isNum(mc[i]) ? (mc[i] + (Y.debt[i] || 0) - (Y.cashT[i] || 0)) / Y.ebitda[i] : null);
  R.fcfy = f(i => mc[i] > 0 ? div(Y.fcf[i], mc[i]) : null);
  R.dy = f(i => mc[i] > 0 && isNum(Y.divs[i]) ? Math.abs(Y.divs[i]) / mc[i] : null);
  return R;
}

function ltmRatios(M) {
  const L = M.L, R = {};
  R.gm = div(L.gp, L.revenue); R.om = div(L.op, L.revenue); R.nm = div(L.ni, L.revenue); R.fcfm = div(L.fcf, L.revenue);
  R.ebitdam = div(L.ebitda, L.revenue);
  R.roe = L.equity > 0 ? div(L.ni, L.equity) : null; R.roa = div(L.ni, L.assets);
  R.roce = (L.assets - L.cl) > 0 ? div(L.op, L.assets - L.cl) : null;
  const ic = isNum(L.equity) ? L.equity + (L.debt || 0) - (L.cashT || 0) : null;
  R.roic = ic > 0 && isNum(L.op) ? L.op * (1 - L.taxRate) / ic : null;
  R.de = L.equity > 0 ? div(L.debt, L.equity) : null;
  R.ndebitda = L.ebitda > 0 ? L.netDebt / L.ebitda : null;
  R.cr = div(L.ca, L.cl); R.ic = L.interest > 0 ? div(L.op, L.interest) : null;
  R.payout = L.ni > 0 && isNum(L.divs) ? Math.abs(L.divs) / L.ni : null;
  R.pe = L.ni > 0 ? div(L.mc, L.ni) : null; R.pfcf = L.fcf > 0 ? div(L.mc, L.fcf) : null;
  R.ps = div(L.mc, L.revenue); R.pb = L.equity > 0 ? div(L.mc, L.equity) : null;
  R.evebit = L.op > 0 ? div(L.ev, L.op) : null; R.evebitda = L.ebitda > 0 ? div(L.ev, L.ebitda) : null;
  R.fcfy = L.mc > 0 ? div(L.fcf, L.mc) : null; R.dy = L.mc > 0 && isNum(L.divs) ? Math.abs(L.divs) / L.mc : null;
  R.fcfps = div(L.fcf, L.shares); R.bvps = div(L.equity, L.shares); R.eps = L.eps;
  return R;
}

// ---------------------------------------------------------------- medias históricas y fiabilidad
const stdev = a => { if (a.length < 2) return null; const m = sum(a) / a.length; return Math.sqrt(sum(a.map(x => (x - m) ** 2)) / (a.length - 1)); };
const lastVals = (a, k) => a.slice(-k).filter(isNum);
// Convierte una medida de dispersión en una nota de 0 a 100: 0 → 100; «a» → 70 (límite de fiabilidad alta); «b» → 40 (límite de media); 2·b → 0.
function dispScore(x, a, b) {
  if (!isNum(x)) return null;
  if (x <= a) return 100 - 30 * x / a;
  if (x <= b) return 70 - 30 * (x - a) / (b - a);
  return Math.max(0, 40 - 40 * (x - b) / b);
}
const LEVELS = { alta: ['Alta', 'up'], media: ['Media', 'mid'], baja: ['Baja', 'down'] };
const levelOf = s => !isNum(s) ? null : s >= 70 ? 'alta' : s >= 40 ? 'media' : 'baja';
const levelBadge = s => { const l = levelOf(s); return l ? `<span class="badge ${LEVELS[l][1]}">${LEVELS[l][0]}</span>` : '<span class="muted small">sin datos</span>'; };

// Medias de 5 y 10 años y fiabilidad (predecibilidad) de las métricas que usa la proyección.
// La fiabilidad se mide con los últimos 10 años (mínimo 5 con datos).
function predictability(M, R) {
  const { Y, n } = M;
  const W = 10, MIN = 5;
  const out = [];
  // Crecimiento de ventas: la «media» es el crecimiento anual compuesto; la fiabilidad, lo que se desvía cada año (desviación típica, en puntos).
  {
    const g = lastVals(R.revg, W), sd = g.length >= MIN ? stdev(g) : null;
    const up = g.filter(v => v > 0).length;
    const c = k => cagr(Y.revenue[n - 1 - k], Y.revenue[n - 1], k);
    out.push({ key: 'g', input: 'pg', label: 'Crecimiento de ventas', help: 'Media = crecimiento anual compuesto (CAGR). Variabilidad = desviación típica del crecimiento de cada año.',
      a5: c(5), a10: c(10) ?? (g.length >= MIN ? cagr(Y.revenue[n - 1 - g.length], Y.revenue[n - 1], g.length) : null), f: pct,
      score: dispScore(isNum(sd) ? sd * 100 : null, 5, 10), years: g.length, inIndex: 0.3,
      disp: isNum(sd) ? `± ${fmt(sd * 100, 1)} pts · creció ${up} de ${g.length} años` : '–' });
  }
  // Métricas de nivel (márgenes, ROIC, PER): coeficiente de variación = desviación típica / media.
  const level = (key, input, label, arr, a, b, w, opts = {}) => {
    const v = lastVals(arr, W), m = avg(v), sd = v.length >= MIN ? stdev(v) : null;
    const cv = isNum(sd) && isNum(m) && m > 0 ? sd / m : null;
    const neg = v.filter(x => x < 0).length;
    const score = v.length < MIN ? null : (isNum(m) && m > 0 ? dispScore(cv, a, b) : 0);
    const mid = opts.median ? median : avg;
    out.push({ key, input, label, help: opts.help, a5: mid(arr.slice(-5)), a10: mid(arr.slice(-10)), f: opts.f || pct,
      score, years: v.length, inIndex: w,
      disp: isNum(cv) ? `± ${opts.f === mult ? mult(sd) : fmt(sd * 100, 1) + ' pts'} · CV ${fmt(cv * 100, 0)} %${neg ? ` · ${neg} año${neg > 1 ? 's' : ''} negativo${neg > 1 ? 's' : ''}` : ''}` : (v.length >= MIN ? 'media negativa' : '–') });
  };
  level('om', null, 'Margen operativo', R.om, 0.15, 0.35, 0.2, { help: DEF.om });
  level('nm', 'pnm', 'Margen neto', R.nm, 0.15, 0.35, 0.2, { help: DEF.nm });
  level('roic', null, 'ROIC', R.roic, 0.15, 0.35, 0.3, { help: DEF.roic });
  // Variación de acciones: puede ser 0 o negativa, así que se mide en puntos.
  {
    const v = lastVals(R.shg, W), sd = v.length >= MIN ? stdev(v) : null;
    out.push({ key: 'shg', input: 'psh', label: 'Variación de acciones', help: DEF.shg, a5: avg(R.shg.slice(-5)), a10: avg(R.shg.slice(-10)), f: pct,
      score: dispScore(isNum(sd) ? sd * 100 : null, 1.5, 4), years: v.length, inIndex: 0, disp: isNum(sd) ? `± ${fmt(sd * 100, 1)} pts` : '–' });
  }
  level('pe', 'ppe', 'PER (mediana)', R.pe, 0.2, 0.4, 0, { median: true, f: mult, help: 'PER al cierre de cada ejercicio. Se usa la mediana porque un año raro lo distorsiona mucho. Depende del humor del mercado, por eso no entra en el índice de la empresa.' });
  {
    const v = lastVals(R.payout, W);
    out.push({ key: 'payout', input: 'ppo', label: 'Payout', help: DEF.payout, a5: avg(R.payout.slice(-5)), a10: avg(R.payout.slice(-10)), f: pct, score: null, years: v.length, inIndex: 0, disp: '' });
  }

  // Índice global: media ponderada de crecimiento de ventas (30 %), ROIC (30 %), margen operativo (20 %) y margen neto (20 %).
  const parts = out.filter(r => r.inIndex && isNum(r.score));
  const wsum = sum(parts.map(r => r.inIndex));
  let score = wsum >= 0.5 ? sum(parts.map(r => r.score * r.inIndex)) / wsum : null;
  const warnings = [];
  const yrsData = lastVals(Y.revenue, W).length;
  const losses = lastVals(Y.ni, W).filter(v => v < 0).length;
  if (yrsData < 8) warnings.push(`solo hay ${yrsData} años de datos`);
  if (losses) warnings.push(`ha tenido pérdidas ${losses} año${losses > 1 ? 's' : ''} de los últimos ${Math.min(W, yrsData)}`);
  const capped = isNum(score) && warnings.length > 0 && score > 55;
  if (capped) score = 55;
  return { rows: out, score, warnings, capped, years: yrsData };
}

function predictabilityCard(P, withButtons) {
  const l = levelOf(P.score);
  const text = {
    alta: 'Los números de la empresa han sido estables: usar sus medias históricas para proyectar tiene sentido.',
    media: 'Hay altibajos: la proyección sirve como orientación, pero usa supuestos prudentes y mira sobre todo el escenario pesimista.',
    baja: 'Los resultados han cambiado mucho de un año a otro: el pasado no es una buena guía y la rentabilidad calculada es poco fiable.'
  }[l] || 'No hay suficientes años de datos para medir la fiabilidad.';
  return `<div class="card">
    <h2>Medias históricas y fiabilidad ${help('Fiabilidad = lo constante que ha sido cada métrica en los últimos 10 años. Cuanto más constante, más razonable es suponer que seguirá parecida y más fiable es la proyección. Explicación completa en la guía.')}</h2>
    <div class="result" style="margin-top:.5rem">
      <div class="box hl"><div class="muted small">Índice de predecibilidad de la empresa</div><div class="v">${isNum(P.score) ? fmt(P.score, 0) + ' <span class="small muted">/ 100</span>' : '–'}</div><div>${levelBadge(P.score)}</div></div>
      <div class="box" style="grid-column: span 2"><div class="small">${text}</div>${P.warnings.length ? `<div class="small muted" style="margin-top:.3rem">${P.capped ? 'Limitado a «media» porque' : 'Además,'} ${P.warnings.join(' y ')}.</div>` : ''}<div class="small muted" style="margin-top:.3rem">70-100 alta · 40-69 media · 0-39 baja. <a href="#/guia">Cómo se calcula</a></div></div>
    </div>
    <div class="tbl-wrap"><table><thead><tr><th>Métrica</th><th>Media 5 años</th><th>Media 10 años</th><th>Variabilidad (10 años) ${help('«±» es la desviación típica: cuánto se aleja normalmente cada año de la media. CV (coeficiente de variación) = desviación típica / media: un CV del 10 % significa que la métrica suele moverse un 10 % arriba o abajo de su media.')}</th><th>Fiabilidad</th></tr></thead><tbody>
      ${P.rows.map(r => `<tr><td>${esc(r.label)}${r.help ? ' ' + help(r.help) : ''}</td><td>${r.f(r.a5)}</td><td>${r.f(r.a10)}</td><td class="small">${r.disp}</td><td>${r.key === 'payout' ? '' : levelBadge(r.score)}${r.inIndex ? '' : (r.key === 'payout' ? '' : ' <span class="muted small">(no entra en el índice)</span>')}</td></tr>`).join('')}
    </tbody></table></div>
    ${withButtons ? `<p style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn ghost" data-avg="5">Rellenar la proyección con las medias de 5 años</button><button class="btn ghost" data-avg="10">Rellenar con las medias de 10 años</button></p>
    <p class="small muted">Los botones solo cambian crecimiento de ventas, margen neto, variación de acciones, PER y payout. El índice usa crecimiento de ventas (30 %), ROIC (30 %), margen operativo (20 %) y margen neto (20 %).</p>` : ''}
  </div>`;
}

// ---------------------------------------------------------------- ficha de empresa
async function company(ticker, tab) {
  ticker = ticker.toUpperCase();
  let d;
  try { d = await getJSON('c/' + ticker + '.json'); }
  catch (e) { throw new Error(`No hay datos para «${ticker}». Puede que no presente sus cuentas a la SEC o que no tenga datos XBRL.`); }
  const M = buildModel(d), R = yearRatios(M), LR = ltmRatios(M);
  const { L, ccy } = M;
  tab = tab || 'resumen';
  const TABS = [['resumen', 'Resumen'], ['finanzas', 'Estados financieros'], ['metricas', 'Métricas'], ['valoracion', 'Valor intrínseco (DCF)'], ['proyeccion', 'Proyección y rentabilidad'], ['previsiones', 'Previsiones de analistas'], ['directivos', 'Directivos'], ['inversores', 'Grandes inversores']];
  const px = d.price;
  const chg1y = (() => { const h = (px && px.history) || []; if (h.length < 13) return null; return h[h.length - 1][1] / h[h.length - 13][1] - 1; })();
  const warn = [];
  if (ccy !== 'USD') warn.push(`Los estados financieros están en <b>${esc(ccy)}</b> y el precio cotiza en dólares. Se convierte con el tipo de cambio actual${M.fx ? ` (1 ${esc(ccy)} = ${fmt(M.fx, 4)} $)` : ''}. Si cotiza como ADR, una acción ADR puede equivaler a varias acciones ordinarias, así que la capitalización y los ratios de precio pueden estar desajustados.`);
  if (M.Y.splits && M.Y.splits.length) warn.push(`Acciones y BPA de años anteriores ajustados por ${M.Y.splits.length > 1 ? 'los splits' : 'el split'} (${M.Y.splits.map(e => (e.k >= 1 ? fmt(e.k, e.k % 1 ? 1 : 0) + ':1' : '1:' + fmt(1 / e.k, 0)) + ' (' + (M.d.years[e.after + 1] ? 'entre ' + esc(M.d.years[e.after].slice(0, 4)) + ' y ' + esc(M.d.years[e.after + 1].slice(0, 4)) : 'después de ' + esc(M.d.years[e.after].slice(0, 4))) + ')').join(', ')}), para que se puedan comparar con los de hoy.`);
  if (!px) warn.push('No se ha podido obtener la cotización: los ratios de valoración no están disponibles. Puedes escribir el precio a mano en las pestañas de valoración.');
  app.innerHTML = `
  <div class="card">
    <div class="co-head">
      <div>
        <h1>${esc(d.name)} <span class="muted">(${esc(d.ticker)})</span></h1>
        <div class="muted small">${[d.exchange, d.sector, d.country].filter(Boolean).map(esc).join(' · ')}${d.web ? ` · <a href="${esc(/^https?:/.test(d.web) ? d.web : 'https://' + d.web)}" target="_blank" rel="noopener">web</a>` : ''}
          · <a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${d.cik}&type=10-K" target="_blank" rel="noopener">informes en la SEC</a></div>
      </div>
      <div style="text-align:right">
        <div class="price">${px ? money(px.price, px.currency || 'USD') : '–'}</div>
        <div class="small muted">${chg1y !== null ? `<span class="${chg1y >= 0 ? 'good' : 'bad'}">${chg1y >= 0 ? '+' : ''}${pct(chg1y)}</span> en 1 año · ` : ''}Capitalización ${big(L.mc && M.fx ? L.mc * M.fx : null, 'USD')}${px ? ` · ${esc(px.date)}` : ''}</div>
      </div>
    </div>
    ${warn.map(w => `<div class="note">${w}</div>`).join('')}
  </div>
  <div class="tabs" role="tablist">${TABS.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'active' : ''}">${l}</button>`).join('')}</div>
  <div id="tab"></div>`;
  app.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => { history.replaceState(null, '', '#/c/' + ticker + '/' + b.dataset.tab); app.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('active', x === b)); renderTab(b.dataset.tab); }));
  const renderTab = t => {
    destroyCharts();
    const el = $('#tab');
    ({ resumen: tabSummary, finanzas: tabFinancials, metricas: tabMetrics, valoracion: tabDCF, proyeccion: tabProjection, previsiones: tabEstimates, directivos: tabInsiders, inversores: tabHolders }[t] || tabSummary)(el, M, R, LR);
  };
  renderTab(tab);
}

function tabSummary(el, M, R, LR) {
  const { d, Y, L, ccy } = M;
  const yrs = d.years.map(y => y.slice(0, 4));
  const n = yrs.length;
  const revC5 = cagr(Y.revenue[n - 6], Y.revenue[n - 1], 5), revC10 = cagr(Y.revenue[n - 11], Y.revenue[n - 1], 10);
  const epsC5 = cagr(Y.eps[n - 6], Y.eps[n - 1], 5), fcfC5 = cagr(Y.fcf[n - 6], Y.fcf[n - 1], 5);
  const tile = (k, v, key) => `<div class="tile"><div class="k">${k}${key ? help(DEF[key]) : ''}</div><div class="v">${v}</div></div>`;
  el.innerHTML = `
  <div class="card">
    <h2>Lo esencial <span class="muted small">(últimos 12 meses${L.date ? ' hasta ' + esc(L.date) : ''})</span></h2>
    <div class="tiles">
      ${tile('Ventas', big(L.revenue, ccy))}
      ${tile('Beneficio neto', big(L.ni, ccy))}
      ${tile('Flujo de caja libre', big(L.fcf, ccy))}
      ${tile('Margen bruto', pct(LR.gm), 'gm')}
      ${tile('Margen operativo', pct(LR.om), 'om')}
      ${tile('Margen neto', pct(LR.nm), 'nm')}
      ${tile('ROCE', pct(LR.roce), 'roce')}
      ${tile('ROE', pct(LR.roe), 'roe')}
      ${tile('ROIC', pct(LR.roic), 'roic')}
      ${tile('PER', mult(LR.pe), 'pe')}
      ${tile('P/FCF', mult(LR.pfcf), 'pfcf')}
      ${tile('EV/EBIT', mult(LR.evebit), 'evebit')}
      ${tile('Rent. FCF', pct(LR.fcfy), 'fcfy')}
      ${tile('Rent. dividendo', pct(LR.dy), 'dy')}
      ${tile('Deuda neta/EBITDA', mult(LR.ndebitda), 'ndebitda')}
      ${tile('Crec. ventas 5 años', pct(revC5) + '/año', 'revg')}
      ${tile('Crec. ventas 10 años', pct(revC10) + '/año', 'revg')}
      ${tile('Crec. BPA 5 años', pct(epsC5) + '/año', 'epsg')}
      ${tile('Crec. FCF 5 años', pct(fcfC5) + '/año')}
      ${(() => { if (!d.insiders) return ''; const v = insiderVerdict(d.insiders); return `<a class="tile" href="#/c/${encodeURIComponent(d.ticker)}/directivos" style="color:inherit"><div class="k">Directivos (12 meses)${help('Compras y ventas en bolsa de directivos y consejeros. Detalle en la pestaña «Directivos».')}</div><div class="v"><span class="badge ${v.cls}">${esc(v.text)}</span></div></a>`; })()}
      ${(() => { const P = predictability(M, R); return `<div class="tile"><div class="k">Predecibilidad${help('Índice de 0 a 100 que mide lo constantes que han sido las ventas, los márgenes y el ROIC en los últimos 10 años. Detalle en la pestaña «Proyección y rentabilidad».')}</div><div class="v">${isNum(P.score) ? fmt(P.score, 0) : '–'} ${levelBadge(P.score)}</div></div>`; })()}
    </div>
  </div>
  <div class="grid g2">
    <div class="card"><h3>Ventas, beneficio neto y flujo de caja libre</h3><div class="chart-box"><canvas id="ch1"></canvas></div></div>
    <div class="card"><h3>Márgenes</h3><div class="chart-box"><canvas id="ch2"></canvas></div></div>
    <div class="card"><h3>Rentabilidad sobre el capital</h3><div class="chart-box"><canvas id="ch3"></canvas></div></div>
    <div class="card"><h3>Cotización (10 años)</h3><div class="chart-box"><canvas id="ch4"></canvas></div></div>
  </div>`;
  const C = COLORS();
  const sc = 1e6;
  chart($('#ch1'), { type: 'bar', data: { labels: yrs, datasets: [
    { label: 'Ventas', data: Y.revenue.map(v => v && v / sc), backgroundColor: C[0] },
    { label: 'Beneficio neto', data: Y.ni.map(v => v && v / sc), backgroundColor: C[1] },
    { label: 'FCF', data: Y.fcf.map(v => v && v / sc), backgroundColor: C[2] }] },
    options: { scales: { y: { ticks: { callback: v => nf(0).format(v) + ' M' } } }, plugins: { tooltip: { callbacks: { label: c => c.dataset.label + ': ' + big(c.raw * sc, ccy) } } } } });
  const line = (id, sets) => chart($(id), { type: 'line', data: { labels: yrs, datasets: sets.map(([l, a], i) => ({ label: l, data: a.map(v => v === null ? null : v * 100), borderColor: C[i], backgroundColor: C[i], tension: .25, spanGaps: true })) },
    options: { scales: { y: { ticks: { callback: v => v + ' %' } } }, plugins: { tooltip: { callbacks: { label: c => c.dataset.label + ': ' + fmt(c.raw, 1) + ' %' } } } } });
  line('#ch2', [['Bruto', R.gm], ['Operativo', R.om], ['Neto', R.nm], ['FCF', R.fcfm]]);
  line('#ch3', [['ROCE', R.roce], ['ROE', R.roe], ['ROIC', R.roic]]);
  const h = (d.price && d.price.history) || [];
  chart($('#ch4'), { type: 'line', data: { labels: h.map(x => x[0]), datasets: [{ label: 'Precio ($)', data: h.map(x => x[1]), borderColor: C[0], backgroundColor: C[0], pointRadius: 0, tension: .1, fill: false }] },
    options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 10 } } } } });
}

function tableHTML(M, rows, opts = {}) {
  const { d } = M;
  const yrs = d.years;
  const start = Math.max(0, yrs.length - (opts.cols || 12));
  const ys = yrs.slice(start);
  const head = `<tr><th></th>${ys.map(y => `<th>${y.slice(0, 7)}</th>`).join('')}${opts.ltm ? `<th class="ttm">Últ. 12m ${help(DEF.ttm)}</th>` : ''}</tr>`;
  const body = rows.map(r => {
    if (r.section) return `<tr class="section"><td colspan="${ys.length + 2}">${r.section}</td></tr>`;
    const vals = r.vals.slice(start);
    return `<tr class="${r.chart ? 'clickable' : ''}" data-row="${esc(r.label)}"><td>${r.label}${r.def ? ' ' + help(r.def) : ''}</td>${vals.map(v => `<td>${r.f(v)}</td>`).join('')}${opts.ltm ? `<td class="ttm">${r.f(r.ltm)}</td>` : ''}</tr>`;
  }).join('');
  return `<div class="tbl-wrap"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

function tabFinancials(el, M) {
  const { Y, L, ccy } = M;
  const m = v => isNum(v) ? nf(0).format(v / 1e6) : '–';
  const ps = v => fmt(v, 2);
  const neg = a => a.map(v => isNum(v) ? -Math.abs(v) : null);
  const rows = [
    { section: 'Cuenta de resultados' },
    { label: 'Ventas', vals: Y.revenue, ltm: L.revenue, f: m },
    { label: 'Coste de ventas', vals: neg(Y.cogs), ltm: isNum(L.cogs) ? -Math.abs(L.cogs) : null, f: m },
    { label: 'Beneficio bruto', vals: Y.gp, ltm: L.gp, f: m },
    { label: 'I+D', vals: neg(Y.rnd), f: m },
    { label: 'Gastos generales y de venta', vals: neg(Y.sga), f: m },
    { label: 'Beneficio operativo (EBIT)', vals: Y.op, ltm: L.op, f: m },
    { label: 'Amortizaciones (D&A)', vals: Y.dna, ltm: L.dna, f: m },
    { label: 'EBITDA', vals: Y.ebitda, ltm: L.ebitda, f: m },
    { label: 'Gastos financieros', vals: neg(Y.interest), ltm: isNum(L.interest) ? -Math.abs(L.interest) : null, f: m },
    { label: 'Beneficio antes de impuestos', vals: Y.pretax, ltm: L.pretax, f: m },
    { label: 'Impuestos', vals: Y.tax.map(v => isNum(v) ? -v : null), ltm: isNum(L.tax) ? -L.tax : null, f: m },
    { label: 'Beneficio neto', vals: Y.ni, ltm: L.ni, f: m },
    { label: 'BPA diluido', vals: Y.eps, ltm: L.eps, f: ps },
    { label: 'Acciones diluidas (M)', vals: Y.shares, ltm: L.shares, f: m },
    { section: 'Balance' },
    { label: 'Caja e inversiones c/p', vals: Y.cashT, ltm: L.cashT, f: m },
    { label: 'Cuentas a cobrar', vals: Y.rec, f: m },
    { label: 'Inventarios', vals: Y.inv, f: m },
    { label: 'Activo corriente', vals: Y.ca, ltm: L.ca, f: m },
    { label: 'Fondo de comercio', vals: Y.gw, f: m },
    { label: 'Intangibles', vals: Y.intang, f: m },
    { label: 'Activos totales', vals: Y.assets, ltm: L.assets, f: m },
    { label: 'Pasivo corriente', vals: Y.cl, ltm: L.cl, f: m },
    { label: 'Deuda financiera total', vals: Y.debt, ltm: L.debt, f: m },
    { label: 'Pasivo total', vals: Y.liab, ltm: L.liab, f: m },
    { label: 'Patrimonio neto', vals: Y.equity, ltm: L.equity, f: m },
    { section: 'Flujo de caja' },
    { label: 'Flujo de caja operativo', vals: Y.cfo, ltm: L.cfo, f: m },
    { label: 'Inversión en inmovilizado (capex)', vals: neg(Y.capex), ltm: isNum(L.capex) ? -Math.abs(L.capex) : null, f: m },
    { label: 'Flujo de caja libre', vals: Y.fcf, ltm: L.fcf, f: m },
    { label: 'Remuneración en acciones', vals: Y.sbc, ltm: L.sbc, f: m },
    { label: 'Dividendos pagados', vals: neg(Y.divs), ltm: isNum(L.divs) ? -Math.abs(L.divs) : null, f: m },
    { label: 'Recompra de acciones', vals: neg(Y.buybacks), ltm: isNum(L.buybacks) ? -Math.abs(L.buybacks) : null, f: m }
  ].filter(r => r.section || r.vals.some(isNum));
  el.innerHTML = `<div class="card"><h2>Estados financieros anuales <span class="muted small">(millones de ${esc(ccy)}, salvo BPA)</span></h2>
  <p class="muted small">Fuente: informes anuales (10-K / 20-F) presentados a la SEC. La columna azul son los últimos 12 meses; en el balance es el último balance publicado.</p>
  ${tableHTML(M, rows, { ltm: true, cols: 15 })}</div>`;
}

function tabMetrics(el, M, R, LR) {
  const { Y } = M;
  const rows = [
    { section: 'Rentabilidad' },
    { label: 'ROCE', vals: R.roce, ltm: LR.roce, f: pct, def: DEF.roce, chart: 1 },
    { label: 'ROIC', vals: R.roic, ltm: LR.roic, f: pct, def: DEF.roic, chart: 1 },
    { label: 'ROE', vals: R.roe, ltm: LR.roe, f: pct, def: DEF.roe, chart: 1 },
    { label: 'ROA', vals: R.roa, ltm: LR.roa, f: pct, def: DEF.roa, chart: 1 },
    { section: 'Márgenes' },
    { label: 'Margen bruto', vals: R.gm, ltm: LR.gm, f: pct, def: DEF.gm, chart: 1 },
    { label: 'Margen EBITDA', vals: R.ebitdam, ltm: LR.ebitdam, f: pct, def: DEF.ebitdam, chart: 1 },
    { label: 'Margen operativo', vals: R.om, ltm: LR.om, f: pct, def: DEF.om, chart: 1 },
    { label: 'Margen neto', vals: R.nm, ltm: LR.nm, f: pct, def: DEF.nm, chart: 1 },
    { label: 'Margen FCF', vals: R.fcfm, ltm: LR.fcfm, f: pct, def: DEF.fcfm, chart: 1 },
    { section: 'Crecimiento' },
    { label: 'Ventas', vals: R.revg, f: pct, def: DEF.revg, chart: 1 },
    { label: 'BPA', vals: R.epsg, f: pct, def: DEF.epsg, chart: 1 },
    { label: 'Flujo de caja libre', vals: R.fcfg, f: pct, chart: 1 },
    { label: 'Nº de acciones', vals: R.shg, f: pct, def: DEF.shg, chart: 1 },
    { section: 'Solidez financiera' },
    { label: 'Deuda / patrimonio', vals: R.de, ltm: LR.de, f: mult, def: DEF.de, chart: 1 },
    { label: 'Deuda neta / EBITDA', vals: R.ndebitda, ltm: LR.ndebitda, f: mult, def: DEF.ndebitda, chart: 1 },
    { label: 'Liquidez corriente', vals: R.cr, ltm: LR.cr, f: mult, def: DEF.cr, chart: 1 },
    { label: 'Cobertura de intereses', vals: R.ic, ltm: LR.ic, f: mult, def: DEF.ic, chart: 1 },
    { label: 'Payout', vals: R.payout, ltm: LR.payout, f: pct, def: DEF.payout, chart: 1 },
    { section: 'Por acción' },
    { label: 'BPA', vals: Y.eps, ltm: LR.eps, f: v => fmt(v), chart: 1 },
    { label: 'FCF por acción', vals: R.fcfps, ltm: LR.fcfps, f: v => fmt(v), chart: 1 },
    { label: 'Dividendo por acción', vals: R.dps, f: v => fmt(v), chart: 1 },
    { label: 'Valor contable por acción', vals: R.bvps, ltm: LR.bvps, f: v => fmt(v), chart: 1 },
    { section: 'Valoración (precio al cierre de cada ejercicio)' },
    { label: 'PER', vals: R.pe, ltm: LR.pe, f: mult, def: DEF.pe, chart: 1 },
    { label: 'P/FCF', vals: R.pfcf, ltm: LR.pfcf, f: mult, def: DEF.pfcf, chart: 1 },
    { label: 'P/Ventas', vals: R.ps, ltm: LR.ps, f: mult, def: DEF.ps, chart: 1 },
    { label: 'P/Valor contable', vals: R.pb, ltm: LR.pb, f: mult, def: DEF.pb, chart: 1 },
    { label: 'EV/EBIT', vals: R.evebit, ltm: LR.evebit, f: mult, def: DEF.evebit, chart: 1 },
    { label: 'EV/EBITDA', vals: R.evebitda, ltm: LR.evebitda, f: mult, def: DEF.evebitda, chart: 1 },
    { label: 'Rentabilidad FCF', vals: R.fcfy, ltm: LR.fcfy, f: pct, def: DEF.fcfy, chart: 1 },
    { label: 'Rentabilidad dividendo', vals: R.dy, ltm: LR.dy, f: pct, def: DEF.dy, chart: 1 }
  ].filter(r => r.section || r.vals.some(isNum) || isNum(r.ltm));
  el.innerHTML = `<div class="card"><h2>Métricas históricas</h2><p class="muted small">Pulsa una fila para verla en el gráfico. Pasa el ratón por el «?» para ver cómo se calcula.</p>
  <div class="chart-box" style="height:220px"><canvas id="mch"></canvas></div>
  ${tableHTML(M, rows, { ltm: true, cols: 15 })}
  <p class="muted small">Medias y medianas útiles: ROCE medio 5 años ${pct(avg(R.roce.slice(-5)))}, margen operativo medio 5 años ${pct(avg(R.om.slice(-5)))}, PER mediano 10 años ${mult(median(R.pe.slice(-10)))}, P/FCF mediano 10 años ${mult(median(R.pfcf.slice(-10)))}.</p></div>`;
  const yrs = M.d.years.map(y => y.slice(0, 4));
  const draw = r => {
    destroyCharts();
    const isPct = r.f === pct;
    chart($('#mch'), { type: 'bar', data: { labels: yrs, datasets: [{ label: r.label, data: r.vals.map(v => isNum(v) ? (isPct ? v * 100 : v) : null), backgroundColor: COLORS()[0] }] },
      options: { plugins: { legend: { display: true } }, scales: { y: { ticks: { callback: v => isPct ? v + ' %' : v } } } } });
  };
  const byLabel = Object.fromEntries(rows.filter(r => r.label).map(r => [r.label, r]));
  el.querySelectorAll('tr.clickable').forEach(tr => tr.addEventListener('click', () => draw(byLabel[tr.dataset.row])));
  draw(byLabel['ROCE'] || rows.find(r => r.vals));
}

// ---------------------------------------------------------------- DCF
function dcfValue(p) {
  // p: fcf0, g1 (años 1-5), g2 (años 6-10), tg, r, netDebt, shares
  let fcf = p.fcf0, pv = 0;
  const flows = [];
  for (let t = 1; t <= 10; t++) {
    fcf *= 1 + (t <= 5 ? p.g1 : p.g2);
    const d = fcf / Math.pow(1 + p.r, t);
    pv += d;
    flows.push({ t, fcf, pv: d });
  }
  const tv = p.r > p.tg ? fcf * (1 + p.tg) / (p.r - p.tg) : NaN;
  const pvtv = tv / Math.pow(1 + p.r, 10);
  const ev = pv + pvtv;
  const eq = ev - p.netDebt;
  return { flows, pv, tv, pvtv, ev, eq, perShare: eq / p.shares };
}
function solveGrowth(p, target) {
  let lo = -0.5, hi = 1.0;
  const f = g => dcfValue({ ...p, g1: g, g2: g }).perShare - target;
  if (f(lo) > 0 || f(hi) < 0) return null;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (f(m) > 0) hi = m; else lo = m; }
  return (lo + hi) / 2;
}

function defaultsFor(M, R) {
  const { Y, L, n } = M;
  const revC5 = cagr(Y.revenue[n - 6], Y.revenue[n - 1], 5) ?? cagr(Y.revenue[0], Y.revenue[n - 1], n - 1);
  const g = clamp(isNum(revC5) ? revC5 : 0.05, 0.0, 0.15);
  const fcfAvg3 = avg(Y.fcf.slice(-3));
  const sbc = L.sbc || 0;
  return {
    fcf0: L.fcf > 0 ? L.fcf : (fcfAvg3 > 0 ? fcfAvg3 : null),
    g1: g, g2: (g + 0.025) / 2, tg: 0.025, r: 0.09,
    netDebt: L.netDebt, shares: L.shares, price: M.price, sbc
  };
}

function tabDCF(el, M, R) {
  const { d, ccy } = M;
  const key = 'dcf:' + d.ticker;
  const def = defaultsFor(M, R);
  const saved = store.get(key) || {};
  const s = Object.assign({}, def, saved, { netDebt: saved.netDebt ?? def.netDebt, shares: saved.shares ?? def.shares });
  const field = (id, label, val, step, unit, tip) => `<label>${label}${tip ? ' ' + help(tip) : ''}<input id="${id}" type="number" step="${step}" value="${isNum(val) ? +val.toFixed(Math.abs(val) >= 100 ? 0 : 2) : ''}" inputmode="decimal"> ${unit ? `<span class="small">${unit}</span>` : ''}</label>`;
  el.innerHTML = `
  <div class="card">
    <h2>Valor intrínseco por descuento de flujos de caja ${help(DEF.dcf)}</h2>
    <p class="info">¿No sabes qué poner? Lee la <a href="#/guia">guía paso a paso</a> (parte 2).</p>
    <p class="muted small">Proyectamos el flujo de caja libre 10 años con el crecimiento que indiques, le sumamos un valor terminal y lo descontamos a hoy. Los valores por defecto salen de los históricos de la empresa (crecimiento de ventas de los últimos 5 años, limitado entre 0 % y 15 %). <b>Cámbialos según tu criterio</b>: un DCF es tan bueno como sus supuestos. Todas las cifras en millones de ${esc(ccy)}.</p>
    <div class="form-grid">
      ${field('fcf0', 'Flujo de caja libre inicial (M)', def.fcf0 !== null ? s.fcf0 / 1e6 : null, 'any', '', 'Por defecto: FCF de los últimos 12 meses (o la media de 3 años si es negativo).')}
      ${field('g1', 'Crecimiento años 1-5 (%)', s.g1 * 100, '0.5')}
      ${field('g2', 'Crecimiento años 6-10 (%)', s.g2 * 100, '0.5')}
      ${field('tg', 'Crecimiento a perpetuidad (%)', s.tg * 100, '0.25', '', DEF.tg)}
      ${field('r', 'Tasa de descuento (%)', s.r * 100, '0.25', '', DEF.wacc)}
      ${field('nd', 'Deuda neta (M)', s.netDebt / 1e6, 'any', '', 'Deuda financiera menos caja. Negativo = la empresa tiene más caja que deuda.')}
      ${field('sh', 'Acciones (M)', s.shares / 1e6, 'any')}
      ${field('px', `Precio actual (${esc(ccy)})`, s.price, 'any')}
      <label>Restar remuneración en acciones ${help('Muchas empresas pagan a empleados con acciones. Es un coste real que el FCF no recoge; marcarlo da una valoración más conservadora.')}<select id="sbc"><option value="0">No</option><option value="1" ${saved.subSbc ? 'selected' : ''}>Sí</option></select></label>
    </div>
    <p><button class="btn ghost" id="reset">Volver a los valores por defecto</button></p>
    <div id="dcfout"></div>
  </div>`;
  const read = () => {
    const v = id => parseFloat($('#' + id).value);
    const subSbc = $('#sbc').value === '1';
    return { fcf0: v('fcf0') * 1e6 - (subSbc ? (def.sbc || 0) : 0), g1: v('g1') / 100, g2: v('g2') / 100, tg: v('tg') / 100, r: v('r') / 100,
      netDebt: (v('nd') || 0) * 1e6, shares: v('sh') * 1e6, price: v('px'), subSbc, raw: { fcf0: v('fcf0') * 1e6 } };
  };
  const out = $('#dcfout');
  const run = () => {
    destroyCharts();
    const p = read();
    store.set(key, { fcf0: p.raw.fcf0, g1: p.g1, g2: p.g2, tg: p.tg, r: p.r, netDebt: p.netDebt, shares: p.shares, price: p.price, subSbc: p.subSbc });
    if (!isNum(p.fcf0) || !isNum(p.shares) || p.shares <= 0) { out.innerHTML = '<div class="note">Falta el flujo de caja libre o el número de acciones. Si la empresa tiene flujo de caja negativo, un DCF no es adecuado: prueba con la pestaña de proyección.</div>'; return; }
    if (p.r <= p.tg) { out.innerHTML = '<div class="note">La tasa de descuento debe ser mayor que el crecimiento a perpetuidad.</div>'; return; }
    const res = dcfValue(p);
    const mos = isNum(p.price) ? 1 - p.price / res.perShare : null;
    const implied = isNum(p.price) ? solveGrowth(p, p.price) : null;
    const rs = [-0.02, -0.01, 0, 0.01, 0.02].map(x => p.r + x), ts = [-0.01, -0.005, 0, 0.005, 0.01].map(x => p.tg + x);
    out.innerHTML = `
    <div class="result">
      <div class="box hl"><div class="muted small">Valor intrínseco por acción</div><div class="v">${money(res.perShare, ccy)}</div></div>
      <div class="box"><div class="muted small">Precio actual</div><div class="v">${money(p.price, ccy)}</div></div>
      <div class="box"><div class="muted small">Margen de seguridad ${help(DEF.mos)}</div><div class="v ${mos > 0 ? 'good' : 'bad'}">${pct(mos)}</div><div class="small muted">${mos > 0 ? 'Cotiza por debajo del valor estimado' : 'Cotiza por encima del valor estimado'}</div></div>
      <div class="box"><div class="muted small">Crecimiento que descuenta el precio ${help('DCF inverso: el crecimiento anual del FCF durante 10 años que justificaría el precio actual con tu tasa de descuento.')}</div><div class="v">${implied === null ? '–' : pct(implied)}</div><div class="small muted">al año durante 10 años</div></div>
    </div>
    <div class="grid g2">
      <div><h3>Flujos proyectados (M ${esc(ccy)})</h3><div class="tbl-wrap"><table><thead><tr><th>Año</th><th>FCF</th><th>Valor hoy</th></tr></thead><tbody>
        ${res.flows.map(f => `<tr><td>${f.t}</td><td>${fmt(f.fcf / 1e6, 0)}</td><td>${fmt(f.pv / 1e6, 0)}</td></tr>`).join('')}
        <tr><td>Valor terminal</td><td>${fmt(res.tv / 1e6, 0)}</td><td>${fmt(res.pvtv / 1e6, 0)}</td></tr>
        <tr class="section"><td>Valor de empresa</td><td></td><td>${fmt(res.ev / 1e6, 0)}</td></tr>
        <tr><td>− Deuda neta</td><td></td><td>${fmt(p.netDebt / 1e6, 0)}</td></tr>
        <tr class="section"><td>Valor del patrimonio</td><td></td><td>${fmt(res.eq / 1e6, 0)}</td></tr>
      </tbody></table></div>
      <p class="small muted">El valor terminal supone el ${pct(res.pvtv / res.ev, 0)} del total.${res.pvtv / res.ev > 0.75 ? ' Es mucho: la valoración depende sobre todo de lo que pase después del año 10.' : ''}</p></div>
      <div><h3>Sensibilidad: valor por acción</h3><p class="small muted">Filas: tasa de descuento. Columnas: crecimiento a perpetuidad.</p>
        <div class="tbl-wrap"><table class="sens"><thead><tr><th></th>${ts.map(t => `<th>${pct(t)}</th>`).join('')}</tr></thead><tbody>
        ${rs.map(r => `<tr><td><b>${pct(r)}</b></td>${ts.map(t => { const v = r > t ? dcfValue({ ...p, r, tg: t }).perShare : NaN; const c = isNum(p.price) && isNum(v) ? (v > p.price ? 'good' : 'bad') : ''; return `<td class="${c} ${r === p.r && t === p.tg ? 'mid' : ''}">${fmt(v)}</td>`; }).join('')}</tr>`).join('')}
        </tbody></table></div>
        <div class="chart-box" style="height:200px;margin-top:1rem"><canvas id="dcfch"></canvas></div>
      </div>
    </div>`;
    chart($('#dcfch'), { type: 'bar', data: { labels: res.flows.map(f => 'Año ' + f.t), datasets: [
      { label: 'FCF', data: res.flows.map(f => f.fcf / 1e6), backgroundColor: COLORS()[0] },
      { label: 'Valor hoy', data: res.flows.map(f => f.pv / 1e6), backgroundColor: COLORS()[1] }] } });
  };
  el.querySelectorAll('input,select').forEach(i => i.addEventListener('input', run));
  $('#reset').addEventListener('click', () => { store.set(key, null); tabDCF(el, M, R); });
  run();
}

// ---------------------------------------------------------------- Proyección
function tabProjection(el, M, R) {
  const { d, Y, L, n, ccy } = M;
  const key = 'proj:' + d.ticker;
  const revC5 = cagr(Y.revenue[n - 6], Y.revenue[n - 1], 5) ?? cagr(Y.revenue[0], Y.revenue[n - 1], n - 1);
  const shg = avg(R.shg.slice(-5));
  const peHist = median(R.pe.slice(-10));
  const def = {
    years: 5,
    g: clamp(isNum(revC5) ? revC5 : 0.05, -0.05, 0.15),
    nm: clamp(avg(R.nm.slice(-3)) ?? div(L.ni, L.revenue) ?? 0.1, -0.5, 0.6),
    shg: clamp(isNum(shg) ? shg : 0, -0.05, 0.05),
    pe: clamp(isNum(peHist) ? peHist : 15, 8, 40),
    payout: clamp(avg(R.payout.slice(-3)) ?? 0, 0, 1),
    price: M.price
  };
  const s = Object.assign({}, def, store.get(key) || {});
  const P = predictability(M, R);
  // Margen neto actual de la empresa (12 meses o media de 3 años), para avisar si el supuesto está muy lejos.
  const refNm = (() => { const a = div(L.ni, L.revenue); return isNum(a) ? a : avg(R.nm.slice(-3)); })();
  const f = (id, label, val, step, tip) => `<label>${label}${tip ? ' ' + help(tip) : ''}<input id="${id}" type="number" step="${step}" value="${isNum(val) ? +val.toFixed(Math.abs(val) >= 1000 ? 0 : 2) : ''}" inputmode="decimal"></label>`;
  el.innerHTML = predictabilityCard(P, true) + `
  <div class="card">
    <h2>Proyección de resultados y rentabilidad esperada</h2>
    <p class="info">¿No sabes qué poner? Lee la <a href="#/guia">guía paso a paso</a> (parte 1).</p>
    <div class="info"><b>Importante:</b> esta es una <b>proyección propia</b>, no la de los analistas (esa está en la pestaña <a href="#/c/${esc(d.ticker)}/previsiones">Previsiones de analistas</a>, desde donde puedes copiarla aquí). Parte de los históricos de la empresa. Los valores por defecto son: crecimiento de ventas de los últimos 5 años, margen neto medio de 3 años, variación media del nº de acciones, PER mediano de 10 años y payout medio. Ajústalos a lo que tú creas razonable.</div>
    <div class="form-grid">
      ${f('py', 'Años de inversión', s.years, '1')}
      ${f('pg', 'Crecimiento anual de ventas (%)', s.g * 100, '0.5')}
      ${f('pnm', 'Margen neto (%)', s.nm * 100, '0.5', DEF.nm)}
      ${f('psh', 'Variación anual de acciones (%)', s.shg * 100, '0.25', DEF.shg)}
      ${f('ppe', 'PER de salida', s.pe, '0.5', 'El PER al que crees que cotizará al final del periodo. Por defecto, la mediana de los últimos 10 años.')}
      ${f('ppo', 'Payout (%)', s.payout * 100, '1', DEF.payout)}
      ${f('ppx', `Precio de compra (${esc(ccy)})`, s.price, 'any')}
      ${f('ptg', 'Rentabilidad anual que quieres (%)', s.target ?? 10, '0.5', 'La rentabilidad mínima que te exiges. Como referencia, el índice S&P 500 ha dado históricamente en torno a un 9-10 % anual.')}
    </div>
    <p><button class="btn ghost" id="preset">Volver a los valores por defecto</button></p>
    <div id="pout"></div>
  </div>`;
  const out = $('#pout');
  const project = (p) => {
    const rows = [];
    let rev = L.revenue, sh = L.shares, divs = 0;
    for (let t = 1; t <= p.years; t++) {
      rev *= 1 + p.g; sh *= 1 + p.shg;
      const ni = rev * p.nm, eps = ni / sh, dps = eps * p.payout;
      divs += dps;
      rows.push({ t, rev, ni, sh, eps, dps });
    }
    const last = rows[rows.length - 1];
    const priceEnd = last.eps * p.pe;
    const total = priceEnd + divs;
    const cagrR = p.price > 0 && total > 0 ? Math.pow(total / p.price, 1 / p.years) - 1 : null;
    return { rows, priceEnd, divs, cagr: cagrR };
  };
  const run = () => {
    destroyCharts();
    const v = id => parseFloat($('#' + id).value);
    const p = { years: clamp(Math.round(v('py')) || 5, 1, 30), g: v('pg') / 100, nm: v('pnm') / 100, shg: v('psh') / 100, pe: v('ppe'), payout: v('ppo') / 100, price: v('ppx'), target: v('ptg') };
    store.set(key, p);
    if (!isNum(L.revenue) || !isNum(L.shares)) { out.innerHTML = '<div class="note">Faltan las ventas o el número de acciones para proyectar.</div>'; return; }
    const base = project(p);
    const bear = project({ ...p, g: p.g * 0.5 - 0.01, nm: p.nm * 0.85, pe: p.pe * 0.75 });
    const bull = project({ ...p, g: p.g * 1.3 + 0.01, nm: p.nm * 1.1, pe: p.pe * 1.2 });
    const cls = v => isNum(v) ? (v >= 0.1 ? 'good' : v < 0.05 ? 'bad' : '') : '';
    const maxBuy = isNum(p.target) && base.priceEnd + base.divs > 0 ? (base.priceEnd + base.divs) / Math.pow(1 + p.target / 100, p.years) : null;
    const lv = levelOf(P.score);
    out.innerHTML = `
    ${isNum(refNm) && refNm > 0.05 && (p.nm < refNm / 5 || p.nm > Math.max(refNm * 3, 0.8)) ? `<div class="note"><b>Revisa el margen neto:</b> has puesto un ${pct(p.nm)}, pero esta empresa gana hoy un ${pct(refNm)} de lo que vende. Un cambio así es muy raro y suele venir de un dato erróneo (por ejemplo, de una previsión mal copiada). Pulsa «Volver a los valores por defecto» o vuelve a pulsar «Usar el consenso en la proyección» en la pestaña de previsiones.</div>` : ''}
    ${p.g > 0.2 ? `<div class="note"><b>Crecimiento muy alto:</b> un ${pct(p.g)} de crecimiento de ventas cada año durante ${p.years} años multiplica las ventas por ${fmt(Math.pow(1 + p.g, p.years), 1)}. Muy pocas empresas lo consiguen; prueba también con un crecimiento menor.</div>` : ''}
    ${lv === 'baja' ? '<div class="note"><b>Fiabilidad baja</b> (índice ' + fmt(P.score, 0) + '/100): esta empresa ha sido poco predecible y la rentabilidad calculada puede alejarse mucho de la real. Tómala solo como orientación.</div>' : lv === 'media' ? '<div class="note"><b>Fiabilidad media</b> (índice ' + fmt(P.score, 0) + '/100): usa supuestos prudentes y fíjate sobre todo en el escenario pesimista.</div>' : ''}
    <div class="result">
      <div class="box hl"><div class="muted small">Rentabilidad anual esperada (escenario base)</div><div class="v ${cls(base.cagr)}">${pct(base.cagr)}</div><div class="small muted">incluye dividendos (sin reinvertir)</div></div>
      <div class="box"><div class="muted small">Precio objetivo en ${p.years} años</div><div class="v">${money(base.priceEnd, ccy)}</div></div>
      <div class="box"><div class="muted small">Dividendos acumulados por acción</div><div class="v">${money(base.divs, ccy)}</div></div>
      <div class="box"><div class="muted small">Precio máximo para ganar un ${fmt(p.target, 1)} % anual ${help('El precio al que tendrías que comprar hoy para obtener la rentabilidad que quieres, si se cumple el escenario base.')}</div><div class="v ${isNum(maxBuy) && isNum(p.price) ? (p.price <= maxBuy ? 'good' : 'bad') : ''}">${money(maxBuy, ccy)}</div><div class="small muted">${isNum(maxBuy) && isNum(p.price) ? (p.price <= maxBuy ? 'El precio actual está por debajo' : 'El precio actual está por encima') : ''}</div></div>
      <div class="box"><div class="muted small">BPA en ${p.years} años</div><div class="v">${money(base.rows[base.rows.length - 1].eps, ccy)}</div><div class="small muted">hoy ${money(L.eps, ccy)}</div></div>
    </div>
    <h3>Escenarios</h3>
    <div class="tbl-wrap"><table><thead><tr><th>Escenario</th><th>Crec. ventas</th><th>Margen neto</th><th>PER salida</th><th>Precio objetivo</th><th>Rentab. anual</th></tr></thead><tbody>
      ${[['Pesimista', bear, { g: p.g * 0.5 - 0.01, nm: p.nm * 0.85, pe: p.pe * 0.75 }], ['Base', base, p], ['Optimista', bull, { g: p.g * 1.3 + 0.01, nm: p.nm * 1.1, pe: p.pe * 1.2 }]].map(([l, r, q]) =>
        `<tr><td><b>${l}</b></td><td>${pct(q.g)}</td><td>${pct(q.nm)}</td><td>${mult(q.pe)}</td><td>${money(r.priceEnd, ccy)}</td><td class="${cls(r.cagr)}"><b>${pct(r.cagr)}</b></td></tr>`).join('')}
    </tbody></table></div>
    <p class="small muted">Pesimista: la mitad del crecimiento menos 1 punto, un 15 % menos de margen y un PER un 25 % menor. Optimista: lo contrario, más moderado.</p>
    <h3>Estimación año a año (escenario base)</h3>
    <div class="tbl-wrap"><table><thead><tr><th></th><th>Últ. 12m</th>${base.rows.map(r => `<th>Año ${r.t}</th>`).join('')}</tr></thead><tbody>
      <tr><td>Ventas (M)</td><td>${fmt(L.revenue / 1e6, 0)}</td>${base.rows.map(r => `<td>${fmt(r.rev / 1e6, 0)}</td>`).join('')}</tr>
      <tr><td>Beneficio neto (M)</td><td>${fmt(L.ni / 1e6, 0)}</td>${base.rows.map(r => `<td>${fmt(r.ni / 1e6, 0)}</td>`).join('')}</tr>
      <tr><td>Acciones (M)</td><td>${fmt(L.shares / 1e6, 0)}</td>${base.rows.map(r => `<td>${fmt(r.sh / 1e6, 0)}</td>`).join('')}</tr>
      <tr><td>BPA</td><td>${fmt(L.eps)}</td>${base.rows.map(r => `<td>${fmt(r.eps)}</td>`).join('')}</tr>
      <tr><td>Dividendo por acción</td><td></td>${base.rows.map(r => `<td>${fmt(r.dps)}</td>`).join('')}</tr>
      <tr><td>Precio implícito (BPA × PER)</td><td>${fmt(p.price)}</td>${base.rows.map(r => `<td>${fmt(r.eps * p.pe)}</td>`).join('')}</tr>
    </tbody></table></div>
    <div class="chart-box" style="margin-top:1rem"><canvas id="pch"></canvas></div>`;
    const yrs = d.years.map(y => y.slice(0, 4));
    const ly = +yrs[yrs.length - 1];
    const labels = yrs.concat(base.rows.map(r => String(ly + r.t) + 'e'));
    const histEps = Y.eps.concat(base.rows.map(() => null));
    const projEps = Y.eps.map((v, i) => i === Y.eps.length - 1 ? v : null).concat(base.rows.map(r => r.eps));
    const C = COLORS();
    chart($('#pch'), { type: 'line', data: { labels, datasets: [
      { label: 'BPA histórico', data: histEps, borderColor: C[0], backgroundColor: C[0], spanGaps: true },
      { label: 'BPA proyectado (base)', data: projEps, borderColor: C[2], backgroundColor: C[2], borderDash: [6, 4], spanGaps: true }] } });
  };
  el.querySelectorAll('input').forEach(i => i.addEventListener('input', run));
  el.querySelectorAll('button[data-avg]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.avg === '5' ? 'a5' : 'a10';
    P.rows.forEach(r => {
      const v = r[k], inp = r.input && $('#' + r.input);
      if (!inp || !isNum(v)) return;
      // Límites prudentes: una media rara (p. ej., por una gran ampliación de capital) no debe romper la proyección.
      const lim = { pg: [-0.2, 0.3], pnm: [-0.5, 0.8], psh: [-0.06, 0.06], ppe: [5, 60], ppo: [0, 1] }[r.input];
      const vv = lim ? clamp(v, lim[0], lim[1]) : v;
      const x = r.f === pct ? vv * 100 : vv;
      inp.value = +x.toFixed(2);
    });
    run();
  }));
  $('#preset').addEventListener('click', () => { store.set(key, null); tabProjection(el, M, R); });
  run();
}

// ---------------------------------------------------------------- Previsiones de analistas
// Los datos de consenso no se guardan en la web: cada usuario usa su propia clave gratuita y su navegador
// los pide directamente al proveedor (uso personal, sin redistribuir datos de terceros).
const EST_KEYS = 'est:keys';
const EST_TTL = 24 * 3600 * 1000; // una consulta al día por empresa para no gastar el cupo gratuito
const estKeys = () => store.get(EST_KEYS) || {};
const numOf = v => (v === null || v === undefined || v === '' || v === 'None') ? null : (isNum(+v) ? +v : null);
const pick = (x, names) => { for (const k of names) { const v = numOf(x[k]); if (v !== null) return v; } return null; };

async function fetchJSON(url) {
  let r;
  try { r = await fetch(url); } catch (e) { throw new Error('No se pudo conectar con el proveedor (¿sin internet o algún bloqueador de anuncios?).'); }
  let j = null;
  try { j = await r.json(); } catch (e) { /* respuesta no JSON */ }
  return { ok: r.ok, status: r.status, j };
}

// Financial Modeling Prep: ventas, EBITDA, EBIT, beneficio neto y BPA de varios años, con máximo, mínimo y nº de analistas.
async function estFMP(ticker, key) {
  const sym = ticker.replace(/\./g, '-');
  const { ok, status, j } = await fetchJSON(`https://financialmodelingprep.com/stable/analyst-estimates?symbol=${encodeURIComponent(sym)}&period=annual&page=0&limit=10&apikey=${encodeURIComponent(key)}`);
  const msg = j && !Array.isArray(j) ? (j['Error Message'] || j.message || j.error || JSON.stringify(j)) : null;
  if (!ok || msg) {
    if (status === 401 || /invalid api key/i.test(msg || '')) throw new Error('Financial Modeling Prep no acepta la clave. Revisa que la has copiado entera.');
    if (status === 402 || /premium|subscription|upgrade|special endpoint/i.test(msg || '')) throw new Error('El plan gratuito de Financial Modeling Prep no incluye previsiones para esta empresa.');
    if (status === 429 || /limit/i.test(msg || '')) throw new Error('Has agotado las consultas gratuitas de hoy en Financial Modeling Prep (250 al día). Vuelve a probar mañana.');
    throw new Error('Financial Modeling Prep respondió con un error' + (status ? ' (' + status + ')' : '') + (msg ? ': ' + String(msg).slice(0, 160) : '.'));
  }
  if (!Array.isArray(j) || !j.length) return null;
  const trio = (x, k, old, nKeys) => ({
    avg: pick(x, [k + 'Avg', 'estimated' + old + 'Avg']), low: pick(x, [k + 'Low', 'estimated' + old + 'Low']),
    high: pick(x, [k + 'High', 'estimated' + old + 'High']), n: pick(x, nKeys)
  });
  const nRev = ['numAnalystsRevenue', 'numberAnalystEstimatedRevenue'], nEps = ['numAnalystsEps', 'numberAnalystsEstimatedEps'];
  return {
    source: 'Financial Modeling Prep', full: true,
    years: j.filter(x => x && x.date).map(x => ({
      date: String(x.date).slice(0, 10),
      revenue: trio(x, 'revenue', 'Revenue', nRev), ebitda: trio(x, 'ebitda', 'Ebitda', nRev), ebit: trio(x, 'ebit', 'Ebit', nRev),
      ni: trio(x, 'netIncome', 'NetIncome', nEps), eps: trio(x, 'eps', 'Eps', nEps)
    }))
  };
}

// Alpha Vantage: solo ventas y BPA del ejercicio actual y el siguiente, pero con revisiones de los últimos 30 días.
async function estAV(ticker, key) {
  const sym = ticker.replace(/\./g, '-');
  const { ok, status, j } = await fetchJSON(`https://www.alphavantage.co/query?function=EARNINGS_ESTIMATES&symbol=${encodeURIComponent(sym)}&apikey=${encodeURIComponent(key)}`);
  const msg = j && (j['Error Message'] || j.Information || j.Note);
  if (!ok || msg || !j) {
    if (/rate limit|requests per day|25 requests/i.test(msg || '')) throw new Error('Has agotado las consultas gratuitas de hoy en Alpha Vantage (25 al día). Vuelve a probar mañana.');
    if (/apikey|api key/i.test(msg || '')) throw new Error('Alpha Vantage no acepta la clave. Revisa que la has copiado entera.');
    throw new Error('Alpha Vantage respondió con un error' + (status && !ok ? ' (' + status + ')' : '') + (msg ? ': ' + String(msg).slice(0, 160) : '.'));
  }
  const list = (j.estimates || j.annualEstimates || []).filter(x => /year/i.test(x.horizon || ''));
  if (!list.length) return null;
  const trio = (x, k) => ({ avg: pick(x, [k + '_estimate_average']), low: pick(x, [k + '_estimate_low']), high: pick(x, [k + '_estimate_high']), n: pick(x, [k + '_estimate_analyst_count']) });
  const empty = { avg: null, low: null, high: null, n: null };
  return {
    source: 'Alpha Vantage', full: false,
    years: list.filter(x => x.date).map(x => ({
      date: String(x.date).slice(0, 10), revenue: trio(x, 'revenue'), eps: trio(x, 'eps'), ebitda: empty, ebit: empty, ni: empty,
      eps90: pick(x, ['eps_estimate_average_90_days_ago', 'eps_estimate_average_90days_ago']),
      up30: pick(x, ['eps_estimate_revision_up_trailing_30_days']), down30: pick(x, ['eps_estimate_revision_down_trailing_30_days'])
    }))
  };
}

// Prueba primero Financial Modeling Prep (más completo) y, si falla, Alpha Vantage. Guarda el resultado 24 horas.
async function getEstimates(ticker, force) {
  const ck = 'est:' + ticker, c = store.get(ck);
  if (!force && c && Date.now() - c.t < EST_TTL) return c.data;
  const K = estKeys(), errors = [];
  let data = null;
  for (const [k, fn] of [['fmp', estFMP], ['av', estAV]]) {
    if (!K[k]) continue;
    try { data = await fn(ticker, K[k]); if (data && data.years.length) break; data = null; }
    catch (e) { errors.push(e.message); }
  }
  if (!data && errors.length) throw new Error(errors.join(' '));
  if (data) { data.fetched = new Date().toISOString(); store.set(ck, { t: Date.now(), data }); }
  return data;
}

// Dispersión = (máximo − mínimo) / media. Se convierte en nota 0-100 con los mismos tramos que el índice de predecibilidad.
function spreadOf(e) { return e && isNum(e.avg) && isNum(e.low) && isNum(e.high) && e.avg !== 0 ? (e.high - e.low) / Math.abs(e.avg) : null; }
function agreement(e, a, b) {
  const s = spreadOf(e);
  if (!isNum(s)) return { score: null, spread: null, n: e ? e.n : null };
  let score = dispScore(s * 100, a, b);
  if (isNum(e.n) && e.n <= 1) score = null; // con un solo analista no hay consenso
  else if (isNum(e.n) && e.n < 4) score = Math.min(score, 55); // pocos analistas: como mucho «media»
  return { score, spread: s, n: e.n };
}
const yearConsensus = y => {
  const r = agreement(y.revenue, 8, 20), p = agreement(y.eps, 15, 40);
  const parts = [[r.score, 0.4], [p.score, 0.6]].filter(([s]) => isNum(s));
  const w = sum(parts.map(x => x[1]));
  return { rev: r, eps: p, score: w ? sum(parts.map(([s, k]) => s * k)) / w : null };
};

function estKeyForm(K) {
  return `<p>Para ver el consenso necesitas una <b>clave gratuita</b> de un proveedor de datos. Solo hay que hacerlo una vez:</p>
  <ol>
    <li>Crea una cuenta gratis en <a href="https://site.financialmodelingprep.com/register" target="_blank" rel="noopener">Financial Modeling Prep</a>. Al entrar, en el panel (<i>Dashboard</i>) verás tu <b>API key</b>: un código largo de letras y números. Cópialo.</li>
    <li>Pégalo abajo y pulsa <b>Guardar</b>.</li>
    <li><i>Opcional, como respaldo:</i> pide otra clave gratis en <a href="https://www.alphavantage.co/support/#api-key" target="_blank" rel="noopener">Alpha Vantage</a> (solo pide un email). Se usa si la primera falla; da menos datos (ventas y BPA de 2 años) y 25 consultas al día.</li>
  </ol>
  <div class="form-grid">
    <label>Clave de Financial Modeling Prep<input id="kfmp" type="text" autocomplete="off" spellcheck="false" value="${esc(K.fmp || '')}" placeholder="p. ej. a1b2c3d4…"></label>
    <label>Clave de Alpha Vantage (opcional)<input id="kav" type="text" autocomplete="off" spellcheck="false" value="${esc(K.av || '')}" placeholder="p. ej. ABCD1234…"></label>
  </div>
  <p style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn" id="ksave">Guardar</button>${K.fmp || K.av ? '<button class="btn ghost" id="kdel">Borrar mis claves</button>' : ''}</p>
  <p class="small muted">Tus claves se guardan <b>solo en este navegador</b>: no se suben a GitHub ni las ve nadie más. Cada consulta va directamente de tu navegador al proveedor, y la web la recuerda 24 horas para no gastar tu cupo (con el plan gratuito puedes mirar unas 250 empresas al día). En otro ordenador o móvil tendrás que pegarlas otra vez.</p>`;
}

function tabEstimates(el, M, R) {
  const { d, Y, L, n, ccy } = M;
  const K = estKeys();
  const hasKey = !!(K.fmp || K.av);
  el.innerHTML = `<div class="card">
    <h2>Previsiones de analistas (consenso)</h2>
    <div class="info">Es la <b>media de lo que esperan los analistas</b> de bancos y casas de análisis que siguen la empresa: lo mismo que muestran TIKR o InvestingPro. Aquí lo comparamos con las <b>medias históricas</b> y con el <b>índice de predecibilidad</b>, y medimos cuánto <b>discrepan los analistas entre sí</b> para saber cuánto fiarse. <a href="#/guia">Cómo leerlo</a>.</div>
    ${hasKey ? `<details><summary class="small muted">Claves de datos (${[K.fmp && 'Financial Modeling Prep', K.av && 'Alpha Vantage'].filter(Boolean).join(' y ')})</summary>${estKeyForm(K)}</details>` : estKeyForm(K)}
  </div><div id="eout">${hasKey ? '<div class="loading">Pidiendo el consenso…</div>' : ''}</div>`;
  const save = () => {
    store.set(EST_KEYS, { fmp: ($('#kfmp').value || '').trim(), av: ($('#kav').value || '').trim() });
    tabEstimates(el, M, R);
  };
  $('#ksave').addEventListener('click', save);
  const del = $('#kdel');
  if (del) del.addEventListener('click', () => { store.set(EST_KEYS, null); tabEstimates(el, M, R); });
  if (!hasKey) return;
  const load = force => getEstimates(d.ticker, force)
    .then(data => renderEstimates($('#eout'), M, R, data, () => { $('#eout').innerHTML = '<div class="loading">Pidiendo el consenso…</div>'; load(true); }))
    .catch(e => { const o = $('#eout'); if (o) o.innerHTML = `<div class="card"><div class="note"><b>No se ha podido obtener el consenso.</b> ${esc(e.message)}</div><p class="small muted">Si la empresa es pequeña o extranjera, puede que ningún proveedor gratuito la cubra. TIKR, Yahoo Finance (pestaña «Analysis») o Marketscreener la muestran en su web sin pagar.</p></div>`; });
  load(false);
}

function renderEstimates(out, M, R, data, refresh) {
  if (!out) return;
  const { d, Y, L, n, ccy } = M;
  const lastEnd = d.years[n - 1];
  const P = predictability(M, R);
  const cutoff = (() => { const t = new Date(lastEnd); t.setDate(t.getDate() + 60); return t.toISOString().slice(0, 10); })();
  const yrs = data ? data.years.filter(y => y.date > cutoff).sort((a, b) => a.date < b.date ? -1 : 1).slice(0, 5) : [];
  if (!yrs.length) {
    out.innerHTML = `<div class="card"><p>No hay previsiones de analistas para ${esc(d.ticker)} en ${data ? esc(data.source) : 'los proveedores configurados'}. Suele pasar con empresas pequeñas o que cotizan sobre todo fuera de EE. UU.</p></div>`;
    return;
  }
  const full = data.full;
  const fy = y => 'Ej. ' + y.date.slice(0, 4) + 'e';
  const lastRev = Y.revenue[n - 1], lastEps = Y.eps[n - 1];
  // ¿Están las estimaciones en la misma divisa y escala que los informes? (p. ej., ADR o empresas que informan en otra moneda)
  const ratio = div(yrs[0].revenue.avg, lastRev);
  const sameUnits = isNum(ratio) && ratio > 0.4 && ratio < 2.5;
  const yearsAfter = y => (new Date(y.date) - new Date(lastEnd)) / (365.25 * 864e5);
  const gOf = (a, b, t) => (isNum(a) && isNum(b) && a > 0 && b > 0 && t > 0.5) ? Math.pow(b / a, 1 / Math.round(t)) - 1 : null;
  const C = yrs.map(y => {
    const t = yearsAfter(y);
    return Object.assign({}, y, {
      t, agr: yearConsensus(y),
      revG: sameUnits ? gOf(lastRev, y.revenue.avg, t) : null,
      epsG: sameUnits ? gOf(lastEps, y.eps.avg, t) : null,
      ebitdam: div(y.ebitda.avg, y.revenue.avg), om: div(y.ebit.avg, y.revenue.avg), nm: div(y.ni.avg, y.revenue.avg)
    });
  });
  // Años con pocos analistas (1-2): su media es la opinión de una o dos personas y no se usa para resumir.
  C.forEach(c => { c.few = isNum(c.revenue.n) && c.revenue.n < 3; });
  const reliable = C.filter(c => !c.few);
  const first = C[0], near = (reliable.length ? reliable : C.slice(0, 1)).slice(0, 3);
  const consG = (() => { const z = [...near].reverse().find(c => isNum(c.revG)); return z ? z.revG : null; })();
  // BPA de comprobación: beneficio neto previsto / acciones actuales. Si no cuadra con el BPA del proveedor, uno de los dos
  // está mal (p. ej., Nvidia: el proveedor da un beneficio neto unas 100 veces menor que su propio BPA × acciones).
  // Para saber cuál, se mira qué margen neto implica cada uno y se elige el más parecido al de la empresa hoy.
  C.forEach(c => { c.epsCalc = div(c.ni.avg, L.shares); });
  const refNm = (() => { const a = div(L.ni, L.revenue), b = avg(R.nm.slice(-3)); return isNum(a) && a > 0 ? a : isNum(b) && b > 0 ? b : 0.15; })();
  const far = m => isNum(m) && m > 0 ? Math.abs(Math.log(m / refNm)) : Infinity;
  const mism = C.filter(c => sameUnits && isNum(c.epsCalc) && isNum(c.eps.avg) && c.eps.avg > 0 && c.epsCalc > 0 && (c.eps.avg / c.epsCalc > 1.6 || c.eps.avg / c.epsCalc < 0.6));
  mism.forEach(c => {
    const nmEps = div(c.eps.avg * L.shares, c.revenue.avg);
    if (far(nmEps) < far(c.nm)) {
      // El beneficio neto es el erróneo: se sustituye por BPA × acciones (y su margen), para que la proyección no salga disparatada.
      c.niBad = c.ni.avg;
      const x = v => isNum(v) ? v * L.shares : null;
      c.ni = { avg: x(c.eps.avg), low: x(c.eps.low), high: x(c.eps.high), n: c.ni.n };
      c.nm = nmEps; c.epsCalc = c.eps.avg;
    } else {
      // El BPA es el erróneo (p. ej., sin ajustar un split): se usa el calculado en tablas, PER y gráficos.
      c.epsBad = c.eps.avg; c.eps = { avg: c.epsCalc, low: div(c.ni.low, L.shares), high: div(c.ni.high, L.shares), n: c.eps.n }; c.epsG = gOf(lastEps, c.eps.avg, c.t);
    }
  });
  const epsOff = mism.filter(c => 'epsBad' in c), niOff = mism.filter(c => 'niBad' in c);
  const consEpsG = (() => { const z = [...near].reverse().find(c => isNum(c.epsG)); return z ? z.epsG : null; })();
  // Crecimiento equivalente para la proyección: ventas de los años con consenso fiable y, después, un crecimiento que se frena
  // (la mitad del último año previsto, como mucho un 10 %). Se mide desde los últimos 12 meses, que es donde arranca la proyección.
  const projYears = clamp(Math.round((store.get('proj:' + d.ticker) || {}).years || 5), 1, 30);
  const projG = (() => {
    if (!sameUnits || !isNum(L.revenue) || L.revenue <= 0) return null;
    const t0 = new Date(L.date || lastEnd), yr = x => (new Date(x) - t0) / (365.25 * 864e5);
    // Se descartan los años cuyas ventas no encajan con las anteriores (más de −50 % o +150 % al año): suelen ser errores del proveedor.
    const path = [[0, L.revenue]], pts = [];
    near.filter(c => isNum(c.revenue.avg) && c.revenue.avg > 0 && yr(c.date) > 0.05).sort((a, b) => a.date < b.date ? -1 : 1).forEach(c => {
      const [tp, rp] = path[path.length - 1], t = yr(c.date), gy = Math.pow(c.revenue.avg / rp, 1 / Math.max(t - tp, 0.25)) - 1;
      if (gy > -0.5 && gy < 1.5) { path.push([t, c.revenue.avg]); pts.push(c); } else c.revOdd = true;
    });
    if (!pts.length) return null;
    const [tl, rl] = path[path.length - 1];
    const prev = path.length > 1 ? path[path.length - 2] : null;
    const lastG = prev && tl - prev[0] > 0.3 ? Math.pow(rl / prev[1], 1 / (tl - prev[0])) - 1 : (consG ?? 0);
    const tail = clamp(lastG / 2, 0, 0.10);
    let revEnd;
    if (projYears >= tl) revEnd = rl * Math.pow(1 + tail, projYears - tl);
    else { // interpolación entre dos puntos del camino
      let i = 1; while (i < path.length && path[i][0] < projYears) i++;
      const [ta, ra] = path[i - 1], [tb, rb] = path[i];
      revEnd = ra * Math.pow(rb / ra, (projYears - ta) / (tb - ta));
    }
    return { g: Math.pow(revEnd / L.revenue, 1 / projYears) - 1, tail, until: pts[pts.length - 1].date.slice(0, 4), revEnd, pts, tl };
  })();
  const avgOf = k => avg(near.map(c => c[k]));
  // Margen neto que copia el botón. Se ancla al BPA del consenso (la cifra que citan los analistas): el margen que hace que,
  // con las acciones de hoy, el BPA proyectado coincida con el BPA previsto del último año fiable. Si no hay BPA creíble,
  // se usa beneficio neto / ventas. Solo se copia si es creíble (entre −50 % y 80 %); si no, se deja el que tengas.
  const okNm = m => isNum(m) && m > -0.5 && m < 0.8 ? m : null;
  const projAnchor = (() => {
    if (!projG || !isNum(L.shares) || L.shares <= 0) return null;
    const base = isNum(L.eps) && L.eps > 0 ? L.eps : null;
    for (const c of [...projG.pts].reverse()) {
      const e = c.eps.avg;
      if (!isNum(e) || e <= 0) continue;
      if (base) { const gy = Math.pow(e / base, 1 / Math.max(c.t, 0.5)) - 1; if (gy < -0.6 || gy > 2) continue; }
      const m = okNm(e * L.shares / c.revenue.avg);
      if (m !== null) return { nm: m, c };
    }
    return null;
  })();
  const projNm = full || projAnchor ? (projAnchor ? projAnchor.nm : okNm(avgOf('nm'))) : null;
  // Comprobación para el usuario: BPA al que llevan esos supuestos, con las acciones de hoy.
  const projEps = projG && isNum(L.shares) && L.shares > 0 ? projG.revEnd * (projNm ?? avg(R.nm.slice(-3)) ?? 0) / L.shares : null;
  const row = k => P.rows.find(r => r.key === k) || {};
  const histEpsG = { a5: cagr(Y.eps[n - 6], Y.eps[n - 1], 5), a10: cagr(Y.eps[n - 11], Y.eps[n - 1], 10) };
  const ebitdamHist = { a5: avg(R.ebitdam.slice(-5)), a10: avg(R.ebitdam.slice(-10)) };
  // Compara el consenso con la historia: diferencia en puntos.
  const verdict = (c, h, tolPts) => {
    if (!isNum(c) || !isNum(h)) return '';
    const dp = (c - h) * 100;
    if (Math.abs(dp) <= tolPts) return '<span class="badge up">En línea con su historia</span>';
    return dp > 0 ? `<span class="badge mid">Más optimista (+${fmt(dp, 1)} pts)</span>` : `<span class="badge mid">Más pesimista (${fmt(dp, 1)} pts)</span>`;
  };
  const cmpRows = [
    ['Crecimiento anual de ventas', row('g').a5, row('g').a10, consG, 3, 'Consenso = crecimiento anual compuesto desde el último ejercicio publicado hasta el último año previsto (máx. 3).'],
    ['Crecimiento anual del BPA', histEpsG.a5, histEpsG.a10, consEpsG, 5, 'Ojo: los analistas suelen estimar el BPA «ajustado» (sin partidas extraordinarias), que suele ser algo mayor que el BPA oficial de los informes.'],
    ...(full ? [
      ['Margen EBITDA', ebitdamHist.a5, ebitdamHist.a10, avgOf('ebitdam'), 3, DEF.ebitdam],
      ['Margen operativo (EBIT)', row('om').a5, row('om').a10, avgOf('om'), 3, DEF.om],
      ['Margen neto', row('nm').a5, row('nm').a10, avgOf('nm'), 3, DEF.nm + ' Los analistas suelen usar el beneficio ajustado.']
    ] : [])
  ];
  const consScore = first.agr.score;
  const lvC = levelOf(consScore), lvP = levelOf(P.score);
  const offTrack = cmpRows.filter(r => isNum(r[3]) && isNum(r[1] ?? r[2]) && Math.abs((r[3] - (r[1] ?? r[2])) * 100) > r[4]).length;
  const reading = (() => {
    if (!lvC) return 'No hay suficientes datos de máximos y mínimos para medir el acuerdo entre analistas.';
    if (lvC === 'alta' && lvP === 'alta' && !offTrack) return 'Empresa predecible, analistas de acuerdo entre sí y previsiones en línea con su historia: es el caso en que el consenso suele acertar más.';
    if (lvC === 'alta' && offTrack) return 'Los analistas están de acuerdo entre sí, pero esperan algo distinto de lo que la empresa ha hecho en el pasado. Busca por qué (nuevo producto, adquisición, ciclo…) antes de dar por buena la previsión.';
    if (lvC === 'baja') return 'Los analistas discrepan mucho entre sí: el futuro de la empresa es incierto y la media puede servir de poco. Fíjate en el mínimo, no en la media.';
    if (lvP === 'baja') return 'La empresa ha sido poco predecible en el pasado. Aunque el consenso parezca razonable, los analistas suelen fallar más en este tipo de empresas.';
    return 'Fiabilidad intermedia: úsalo como referencia, con supuestos algo más prudentes que la media de los analistas.';
  })();
  const dispCell = (e, ag, money_) => `${money_(e.low)} – ${money_(e.high)}<div class="small muted">${isNum(ag.spread) ? 'dispersión ' + fmt(ag.spread * 100, 0) + ' %' : ''}</div>`;
  const B = v => big(v, ccy), E = v => isNum(v) ? fmt(v) : '–';
  const metric = (label, key, f, ag, tip) => C.some(c => isNum(c[key].avg)) ? `<tr class="section"><td colspan="${C.length + 1}">${label}${tip ? ' ' + help(tip) : ''}</td></tr>
      <tr><td>Media</td>${C.map(c => `<td><b>${f(c[key].avg)}</b></td>`).join('')}</tr>
      <tr><td>Mínimo – máximo</td>${C.map(c => `<td>${dispCell(c[key], ag ? ag(c) : { spread: spreadOf(c[key]) }, f)}</td>`).join('')}</tr>
      <tr><td>Nº de analistas</td>${C.map(c => `<td>${isNum(c[key].n) ? fmt(c[key].n, 0) : '–'}</td>`).join('')}</tr>` : '';
  const pctRow = (label, key, tip) => C.some(c => isNum(c[key])) ? `<tr><td>${label}${tip ? ' ' + help(tip) : ''}</td>${C.map(c => `<td>${pct(c[key])}</td>`).join('')}</tr>` : '';
  const revisions = C.filter(c => isNum(c.up30) || isNum(c.eps90));
  const fetchedTxt = data.fetched ? new Date(data.fetched).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '';

  out.innerHTML = `
  <div class="card">
    <div class="result" style="margin-top:0">
      <div class="box hl"><div class="muted small">Acuerdo entre analistas (${esc(fy(first))}) ${help('Nota de 0 a 100 según la dispersión de las estimaciones: (máximo − mínimo) / media, de las ventas (40 %) y del BPA (60 %). Si hay menos de 4 analistas no puede pasar de «media». Cuanto más de acuerdo están, más fiable suele ser la media.')}</div><div class="v">${isNum(consScore) ? fmt(consScore, 0) + ' <span class="small muted">/ 100</span>' : '–'}</div><div>${levelBadge(consScore)}</div></div>
      <div class="box"><div class="muted small">Predecibilidad histórica ${help('El índice de la pestaña «Proyección y rentabilidad»: lo constantes que han sido ventas, márgenes y ROIC en 10 años.')}</div><div class="v">${isNum(P.score) ? fmt(P.score, 0) + ' <span class="small muted">/ 100</span>' : '–'}</div><div>${levelBadge(P.score)}</div></div>
      <div class="box" style="grid-column: span 2"><div class="small"><b>Cómo leerlo:</b> ${reading}</div></div>
    </div>
    ${sameUnits ? '' : `<div class="note">Las previsiones no parecen estar en la misma moneda o escala que los informes (${esc(ccy)}${d.currency !== 'USD' ? ', mientras que la acción cotiza en dólares' : ''}). Se muestran tal cual, pero no se calculan crecimientos frente al último año publicado.</div>`}
    ${C.some(c => c.few) ? `<div class="note">Los años ${C.filter(c => c.few).map(c => esc(c.date.slice(0, 4))).join(', ')} tienen solo 1 o 2 analistas: es la opinión de muy poca gente y no se usan para los resúmenes ni para el botón de la proyección.</div>` : ''}
    ${C.some(c => c.revOdd) ? `<div class="note">Las ventas previstas para ${C.filter(c => c.revOdd).map(c => esc(c.date.slice(0, 4))).join(', ')} no encajan con las de los años anteriores (cambio de más del −50 % o +150 % en un año). Parece un error del proveedor y no se usan para el botón de la proyección.</div>` : ''}
    ${niOff.length ? `<div class="note">El beneficio neto que da el proveedor no cuadra con su propio BPA multiplicado por las acciones (${niOff.map(c => esc(c.date.slice(0, 4)) + ': ' + B(c.niBad) + ' frente a ' + B(c.ni.avg)).join('; ')}). El BPA es el que encaja con los márgenes de la empresa, así que en esos años se usa BPA × acciones como beneficio neto (y para el margen neto que copia el botón).</div>` : ''}
    ${epsOff.length ? `<div class="note">El BPA que da el proveedor no cuadra con su propio beneficio neto dividido entre las acciones actuales (${epsOff.map(c => esc(c.date.slice(0, 4)) + ': ' + fmt(c.epsBad) + ' frente a ' + fmt(c.epsCalc)).join('; ')}). Parece un error de sus datos (por ejemplo, sin ajustar un split), así que en esos años se usa el BPA calculado.</div>` : ''}
    ${full ? '' : '<div class="note">Estos datos vienen de Alpha Vantage, que solo da ventas y BPA del ejercicio actual y el siguiente. Con una clave de Financial Modeling Prep verías también EBITDA, EBIT, beneficio neto y más años.</div>'}
    <h3>Consenso frente a su historia</h3>
    <div class="tbl-wrap"><table><thead><tr><th>Métrica</th><th>Media 5 años</th><th>Media 10 años</th><th>Consenso analistas</th><th>Comparación con la media de 5 años</th></tr></thead><tbody>
      ${cmpRows.map(([l, a5, a10, c, tol, tip]) => `<tr><td>${l} ${help(tip)}</td><td>${pct(a5)}</td><td>${pct(a10)}</td><td><b>${pct(c)}</b></td><td>${verdict(c, a5 ?? a10, tol)}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="small muted">Márgenes del consenso: media de los próximos ${near.length} ejercicios. «En línea» = menos de 3 puntos de diferencia (5 en el BPA).</p>
    <p style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn ghost" id="euse" ${projG ? '' : 'disabled'}>Usar el consenso en la proyección</button></p>
    ${projG ? `<p class="small muted">El botón pone en la pestaña «Proyección y rentabilidad» un crecimiento de ventas del <b>${pct(projG.g)}</b> anual durante ${projYears} años${projNm !== null ? ` y un margen neto del <b>${pct(projNm)}</b>${projAnchor ? ` (el que lleva al BPA que esperan los analistas para ${esc(projAnchor.c.date.slice(0, 4))}: ${E(projAnchor.c.eps.avg)})` : ' (el de los analistas)'}` : ''}. Ese ${pct(projG.g)} sale de las ventas que esperan los analistas hasta ${esc(projG.until)} y, a partir de ahí, de suponer que el crecimiento se frena (${pct(projG.tail)} al año). No se usa el crecimiento de los primeros años para todo el periodo, porque los crecimientos muy altos casi nunca duran. El resto de supuestos (PER, acciones, payout) se quedan como estén.${isNum(projEps) ? ` Con estos supuestos y el número de acciones de hoy, el BPA dentro de ${projYears} años saldría en torno a <b>${E(projEps)}</b>.` : ''}</p>` : ''}
  </div>
  <div class="card">
    <h2>Estimaciones año a año</h2>
    <div class="tbl-wrap"><table><thead><tr><th></th><th>Últ. ejercicio (${esc(lastEnd.slice(0, 4))})</th>${C.map(c => `<th>${esc(fy(c))}</th>`).join('')}</tr></thead><tbody>
      <tr class="section"><td colspan="${C.length + 2}">Resumen</td></tr>
      <tr><td>Ventas</td><td>${B(lastRev)}</td>${C.map(c => `<td>${B(c.revenue.avg)}</td>`).join('')}</tr>
      <tr><td>Crecimiento de ventas</td><td>${pct(R.revg[n - 1])}</td>${C.map((c, i) => `<td>${sameUnits ? pct(div(c.revenue.avg, i ? C[i - 1].revenue.avg : lastRev) - 1) : '–'}</td>`).join('')}</tr>
      ${full ? `<tr><td>EBITDA</td><td>${B(Y.ebitda[n - 1])}</td>${C.map(c => `<td>${B(c.ebitda.avg)}</td>`).join('')}</tr>
      <tr><td>Margen EBITDA</td><td>${pct(R.ebitdam[n - 1])}</td>${C.map(c => `<td>${pct(c.ebitdam)}</td>`).join('')}</tr>
      <tr><td>Margen operativo (EBIT)</td><td>${pct(R.om[n - 1])}</td>${C.map(c => `<td>${pct(c.om)}</td>`).join('')}</tr>
      <tr><td>Beneficio neto</td><td>${B(Y.ni[n - 1])}</td>${C.map(c => `<td>${B(c.ni.avg)}</td>`).join('')}</tr>
      <tr><td>Margen neto</td><td>${pct(R.nm[n - 1])}</td>${C.map(c => `<td>${pct(c.nm)}</td>`).join('')}</tr>` : ''}
      <tr><td>BPA</td><td>${E(lastEps)}</td>${C.map(c => `<td>${E(c.eps.avg)}</td>`).join('')}</tr>
      ${full ? `<tr><td>BPA calculado ${help('Beneficio neto previsto / número de acciones actual. Sirve para comprobar el BPA del proveedor; si las acciones bajan por recompras, el BPA real será algo mayor.')}</td><td></td>${C.map(c => `<td>${sameUnits ? E(c.epsCalc) : '–'}</td>`).join('')}</tr>` : ''}
      <tr><td>Nº de analistas (ventas)</td><td></td>${C.map(c => `<td>${isNum(c.revenue.n) ? fmt(c.revenue.n, 0) : '–'}${c.few ? ' <span class="badge down">pocos</span>' : ''}</td>`).join('')}</tr>
      <tr><td>PER con el precio actual ${help('Precio actual / BPA previsto de cada año. Sirve para ver si la acción está cara respecto a lo que se espera que gane.')}</td><td>${mult(L.eps > 0 ? div(M.price, lastEps) : null)}</td>${C.map(c => `<td>${sameUnits && c.eps.avg > 0 ? mult(div(M.price, c.eps.avg)) : '–'}</td>`).join('')}</tr>
      <tr><td>Acuerdo entre analistas</td><td></td>${C.map(c => `<td>${levelBadge(c.agr.score)}</td>`).join('')}</tr>
    </tbody></table></div>
    <h3 style="margin-top:1rem">Detalle: media, mínimo, máximo y número de analistas</h3>
    <div class="tbl-wrap"><table><thead><tr><th></th>${C.map(c => `<th>${esc(fy(c))}<div class="small muted">cierre ${esc(c.date)}</div></th>`).join('')}</tr></thead><tbody>
      ${metric('Ventas', 'revenue', B, c => c.agr.rev)}
      ${full ? metric('EBITDA', 'ebitda', B) + metric('EBIT (beneficio operativo)', 'ebit', B) + metric('Beneficio neto', 'ni', B, null, 'Normalmente ajustado: sin partidas extraordinarias.') : ''}
      ${metric('BPA (beneficio por acción)', 'eps', E, c => c.agr.eps, 'Normalmente ajustado: sin partidas extraordinarias.')}
    </tbody></table></div>
    <p class="small muted">Dispersión = (máximo − mínimo) / media. En ventas, menos de un 8 % es mucho acuerdo y más de un 20 % es poco; en el BPA, menos de un 15 % y más de un 40 %. Cuanto más lejano el año, menos analistas y más dispersión: es normal.</p>
    ${revisions.length ? `<h3 style="margin-top:1rem">Revisiones del BPA ${help('Cambios en las estimaciones recientes. Si los analistas suben sus previsiones (revisiones al alza), suele ser buena señal; si las bajan, mala.')}</h3>
    <div class="tbl-wrap"><table><thead><tr><th></th>${revisions.map(c => `<th>${esc(fy(c))}</th>`).join('')}</tr></thead><tbody>
      <tr><td>BPA esperado hace 90 días</td>${revisions.map(c => `<td>${E(c.eps90)}</td>`).join('')}</tr>
      <tr><td>BPA esperado hoy</td>${revisions.map(c => `<td>${E(c.eps.avg)}${isNum(c.eps90) && c.eps90 ? ` <span class="small ${c.eps.avg >= c.eps90 ? 'good' : 'bad'}">${c.eps.avg >= c.eps90 ? '+' : ''}${pct(c.eps.avg / c.eps90 - 1)}</span>` : ''}</td>`).join('')}</tr>
      <tr><td>Analistas que suben / bajan (30 días)</td>${revisions.map(c => `<td><span class="good">${isNum(c.up30) ? fmt(c.up30, 0) : '–'}</span> / <span class="bad">${isNum(c.down30) ? fmt(c.down30, 0) : '–'}</span></td>`).join('')}</tr>
    </tbody></table></div>` : ''}
    <div class="grid g2" style="margin-top:1rem">
      <div><h3>Ventas: historia y consenso</h3><div class="chart-box"><canvas id="ech1"></canvas></div></div>
      <div><h3>BPA: historia y consenso</h3><div class="chart-box"><canvas id="ech2"></canvas></div></div>
    </div>
    <p class="small muted">Fuente: ${esc(data.source)}, con tu clave personal${fetchedTxt ? ` · consultado el ${esc(fetchedTxt)}` : ''} · <a href="#" id="erefresh">actualizar ahora</a>. Las previsiones de analistas fallan a menudo, sobre todo más allá de 1-2 años. No es asesoramiento financiero.</p>
  </div>`;

  // Gráficos: histórico + media del consenso con banda mínimo-máximo.
  const hy = d.years.map(y => y.slice(0, 4)).slice(-10);
  const labels = hy.concat(C.map(c => c.date.slice(0, 4) + 'e'));
  const k = hy.length;
  const series = (hist, key, scale) => {
    const h = hist.slice(-10).map(v => isNum(v) ? v / scale : null).concat(C.map(() => null));
    const join = (arr) => hist.slice(-10).map((v, i) => i === k - 1 && isNum(v) ? v / scale : null).concat(arr);
    return {
      h, avg: join(C.map(c => isNum(c[key].avg) ? c[key].avg / scale : null)),
      low: join(C.map(c => isNum(c[key].low) ? c[key].low / scale : null)),
      high: join(C.map(c => isNum(c[key].high) ? c[key].high / scale : null))
    };
  };
  const col = COLORS();
  const draw = (id, s, name) => chart($(id), { type: 'line', data: { labels, datasets: [
    { label: name + ' histórico', data: s.h, borderColor: col[0], backgroundColor: col[0], spanGaps: true },
    { label: 'Mínimo analistas', data: s.low, borderColor: 'transparent', backgroundColor: 'transparent', pointRadius: 0, spanGaps: true },
    { label: 'Rango analistas (mín.–máx.)', data: s.high, borderColor: 'transparent', backgroundColor: col[2] + '33', fill: '-1', pointRadius: 0, spanGaps: true },
    { label: 'Media analistas', data: s.avg, borderColor: col[2], backgroundColor: col[2], borderDash: [6, 4], spanGaps: true }] },
    options: { plugins: { legend: { labels: { boxWidth: 12, filter: it => !/Mínimo/.test(it.text) } } } } });
  if (sameUnits) {
    draw('#ech1', series(Y.revenue, 'revenue', 1e6), 'Ventas (M)');
    draw('#ech2', series(Y.eps, 'eps', 1), 'BPA');
  } else {
    $('#ech1').closest('.grid').innerHTML = '';
  }

  $('#erefresh').addEventListener('click', ev => { ev.preventDefault(); refresh(); });
  $('#euse').addEventListener('click', () => {
    const pk = 'proj:' + d.ticker;
    const cur = store.get(pk) || {};
    const upd = Object.assign({}, cur, { g: projG.g });
    if (projNm !== null) upd.nm = projNm;
    store.set(pk, upd);
    location.hash = '#/c/' + d.ticker + '/proyeccion';
  });
}

function chgBadge(c) {
  if (c === 'new') return '<span class="badge new">Nueva</span>';
  if (!isNum(c)) return '';
  if (Math.abs(c) < 0.005) return '<span class="muted small">Sin cambios</span>';
  return `<span class="badge ${c > 0 ? 'up' : 'down'}">${c > 0 ? '+' : ''}${pct(c, 0)}</span>`;
}

function tabHolders(el, M) {
  const h = M.d.holders || [];
  el.innerHTML = `<div class="card"><h2>Grandes inversores que la tienen</h2>
  <p class="muted small">Según su último formulario 13F (presentado hasta 45 días después del cierre de cada trimestre). Solo incluye a los inversores que seguimos.</p>
  ${h.length ? `<div class="tbl-wrap"><table><thead><tr><th>Inversor</th><th>Peso en cartera</th><th>Valor</th><th>Acciones</th><th>Último trimestre</th><th>Fecha</th></tr></thead><tbody>
  ${h.map(x => `<tr class="clickable" data-cik="${x.cik}"><td><a href="#/inversor/${x.cik}">${esc(x.manager)}</a></td><td>${pct(x.weight, 2)}</td><td>${big(x.value, 'USD')}</td><td>${fmt(x.shares, 0)}</td><td>${chgBadge(x.chg)}</td><td>${esc(x.period)}</td></tr>`).join('')}
  </tbody></table></div>` : '<p>Ninguno de los grandes inversores que seguimos tiene esta acción en su última cartera publicada.</p>'}</div>`;
  el.querySelectorAll('tr[data-cik]').forEach(tr => tr.addEventListener('click', () => (location.hash = '#/inversor/' + tr.dataset.cik)));
}

// ---------------------------------------------------------------- directivos (insiders)
const TX_CODES = {
  P: ['Compra en bolsa', 'up', 'La persona ha comprado acciones con su propio dinero en el mercado. Es la señal más clara de confianza.'],
  S: ['Venta en bolsa', 'down', 'Ha vendido acciones en el mercado. Puede ser por motivos personales (impuestos, diversificar, comprar una casa…), no necesariamente porque vea la acción cara.'],
  A: ['Recibe acciones (sueldo)', 'new', 'Acciones que la empresa le entrega como parte de su remuneración. No paga por ellas.'],
  M: ['Ejerce opciones', 'new', 'Convierte opciones o derechos que tenía en acciones.'],
  X: ['Ejerce opciones', 'new', 'Convierte opciones que tenía en acciones.'],
  C: ['Conversión', 'new', 'Convierte otro valor (p. ej. acciones de otra clase) en estas acciones.'],
  F: ['Retención para impuestos', 'mid', 'La empresa se queda con parte de las acciones que le entrega para pagar sus impuestos. No es una venta voluntaria.'],
  G: ['Regalo / donación', 'mid', 'Regala o dona acciones (p. ej. a una fundación o a familiares).'],
  D: ['Devuelve a la empresa', 'mid', 'Entrega acciones a la propia empresa.'],
  J: ['Otra', 'mid', 'Otro tipo de operación (se explica en el formulario).'],
  W: ['Herencia', 'mid', 'Acciones recibidas o transmitidas por herencia.'],
  I: ['Plan de la empresa', 'mid', 'Operación dentro de un plan de pensiones o de ahorro de la empresa.'],
  L: ['Pequeña compra', 'new', 'Pequeña adquisición (menos de 10.000 $).'],
  K: ['Derivado', 'mid', 'Operación con una permuta financiera u otro derivado.'],
};
const txInfo = c => TX_CODES[c] || ['Otra (' + (c || '?') + ')', 'mid', 'Otro tipo de operación.'];
const txAmount = t => isNum(t.s) && isNum(t.p) && t.p > 0 ? t.s * t.p : null;

function insiderStats(ins, months) {
  const cut = new Date(); cut.setMonth(cut.getMonth() - months);
  const c = cut.toISOString().slice(0, 10);
  const r = { buy: 0, sell: 0, buyers: new Set(), sellers: new Set(), nb: 0, ns: 0 };
  (ins.tx || []).forEach(t => {
    if (t.d < c) return;
    if (t.c === 'P') { r.buy += txAmount(t) || 0; r.buyers.add(t.n); r.nb++; }
    if (t.c === 'S') { r.sell += txAmount(t) || 0; r.sellers.add(t.n); r.ns++; }
  });
  return r;
}

function insiderVerdict(ins) {
  const s = insiderStats(ins, 12);
  if (!s.nb && !s.ns) return { text: 'Sin compras ni ventas en bolsa', cls: '' };
  if (s.nb && !s.ns) return { text: 'Solo compras', cls: 'up' };
  if (!s.nb && s.ns) return { text: 'Solo ventas', cls: 'down' };
  return s.buy >= s.sell ? { text: 'Compran más que venden', cls: 'up' } : { text: 'Venden más que compran', cls: 'down' };
}

async function tabInsiders(el, M) {
  const d = M.d, ins = d.insiders;
  const px = d.price && d.price.price;
  const shOut = d.sharesOutstanding;
  let meta = null;
  try { meta = await getJSON('meta.json'); } catch (e) { /* sin meta */ }
  const im = (meta && meta.insiders) || {};
  const secLink = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${d.cik}&type=4&dateb=&owner=include&count=40`;
  const intro = `<div class="info">Los <b>directivos, consejeros y accionistas con más del 10 %</b> de una empresa de EE. UU. están obligados a comunicar a la SEC cada compra o venta de acciones en un plazo de 2 días hábiles (formulario 4). Aquí ves <b>cuántas acciones tiene cada uno</b> según su último formulario y <b>qué ha hecho en los últimos 12 meses</b>.
    <br>Cómo leerlo: <b>las compras en bolsa son la señal más útil</b>, porque alguien que conoce la empresa por dentro pone su propio dinero. Las ventas son mucho más frecuentes y a menudo no significan nada (pagar impuestos, diversificar, ventas programadas de antemano con un plan 10b5-1). Fíjate sobre todo en compras de <b>varios directivos a la vez</b> o en ventas grandes <b>fuera de plan</b>.</div>`;
  if (!ins || (!(ins.owners || []).length && !(ins.tx || []).length)) {
    el.innerHTML = `<div class="card"><h2>Directivos y consejeros</h2>${intro}
      <p>No hay formularios de directivos de esta empresa en los últimos 3 años en nuestros datos. Suele pasar con empresas extranjeras (con ADR), que no están obligadas a presentarlos, o con empresas muy pequeñas.</p>
      <p><a href="${secLink}" target="_blank" rel="noopener">Ver los formularios en la SEC</a></p></div>`;
    return;
  }
  const S = [3, 6, 12].map(m => [m, insiderStats(ins, m)]);
  const v = insiderVerdict(ins);
  const owners = ins.owners || [];
  const totalOwned = sum(owners.map(o => o.s));
  const mixClass = owners.some(o => o.cl > 1);
  const statTile = (label, val, sub, cls) => `<div class="tile"><div class="k">${label}</div><div class="v ${cls || ''}">${val}</div><div class="small muted">${sub}</div></div>`;
  const people = s => s.size === 1 ? '1 persona' : s.size + ' personas';
  el.innerHTML = `
  <div class="card"><h2>Directivos y consejeros <span class="badge ${v.cls}">${esc(v.text)}</span> <span class="muted small">(últimos 12 meses)</span></h2>${intro}
    <div class="tbl-wrap"><table><thead><tr><th>Periodo</th><th>Compras en bolsa</th><th>Quién compra</th><th>Ventas en bolsa</th><th>Quién vende</th><th>Saldo</th></tr></thead><tbody>
    ${S.map(([m, s]) => `<tr><td>Últimos ${m} meses</td><td class="${s.nb ? 'good' : ''}">${s.nb ? big(s.buy, 'USD') : '–'}</td><td>${s.nb ? people(s.buyers) : '–'}</td><td class="${s.ns ? 'bad' : ''}">${s.ns ? big(s.sell, 'USD') : '–'}</td><td>${s.ns ? people(s.sellers) : '–'}</td><td class="${s.buy - s.sell >= 0 ? 'good' : 'bad'}">${s.nb || s.ns ? (s.buy - s.sell >= 0 ? '+' : '') + big(s.buy - s.sell, 'USD') : '–'}</td></tr>`).join('')}
    </tbody></table></div>
  </div>
  <div class="card"><h2>Cuántas acciones tienen</h2>
    <div class="tiles" style="margin-bottom:.6rem">
      ${statTile('Entre todos', big(totalOwned) + ' acciones', isNum(px) ? '≈ ' + big(totalOwned * px, 'USD') : '')}
      ${statTile('Parte de la empresa', isNum(shOut) && shOut > 0 ? pct(totalOwned / shOut, 2) : '–', 'de todas las acciones')}
    </div>
    <div class="tbl-wrap"><table><thead><tr><th>Persona</th><th style="text-align:left">Cargo</th><th>Acciones</th><th>% empresa</th><th>Valor aprox.</th><th>Directas</th><th>Último formulario</th></tr></thead><tbody>
    ${owners.map(o => `<tr><td>${esc(o.n)}</td><td style="text-align:left">${esc(o.r)}</td><td>${fmt(o.s, 0)}</td><td>${isNum(shOut) && shOut > 0 ? pct(o.s / shOut, 2) : '–'}</td><td>${isNum(px) ? big(o.s * px, 'USD') : '–'}</td><td>${o.s ? pct(o.sd / o.s, 0) : '–'}</td><td>${esc(o.d)}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="muted small">Acciones que declaró en su último formulario (de los últimos 3 años). «Directas» = a su nombre; el resto las tiene a través de familiares, fideicomisos o sociedades. No incluye opciones sin ejercer. Solo aparecen quienes han presentado algún formulario en ese plazo: un directivo que no ha operado en 3 años puede faltar; la lista completa está en el informe anual a los accionistas (proxy, DEF 14A).${mixClass ? ' <b>Ojo:</b> esta empresa tiene varias clases de acciones y aquí se suman todas, así que el valor es aproximado.' : ''}</p>
  </div>
  <div class="card"><h2>Operaciones recientes</h2>
    <div class="filters" style="margin-bottom:.6rem"><label>Mostrar<select id="txf"><option value="ps">Solo compras y ventas en bolsa</option><option value="all">Todas (también sueldo en acciones, opciones, impuestos, regalos…)</option></select></label></div>
    <div class="tbl-wrap"><table><thead><tr><th>Fecha</th><th style="text-align:left">Persona</th><th style="text-align:left">Cargo</th><th style="text-align:left">Operación</th><th>Acciones</th><th>Precio</th><th>Importe</th><th>Le quedan</th><th>Plan 10b5-1 ${help('Plan de compraventa programado con meses de antelación. Las operaciones dentro de un plan dicen menos sobre lo que piensa el directivo hoy.')}</th></tr></thead><tbody id="txb"></tbody></table></div>
    <p class="muted small" id="txn"></p>
    <p class="muted small">Fuente: formularios 3, 4 y 5 de la SEC. Fecha = día de la operación. Datos hasta ${esc(ins.lastFiled || '–')}${im.pendingRecent ? ` (todavía se están descargando ${fmt(im.pendingRecent, 0)} formularios de las últimas semanas para todas las empresas; se completan en las próximas actualizaciones)` : ''}. <a href="${secLink}" target="_blank" rel="noopener">Ver los formularios originales en la SEC</a>.</p>
  </div>`;
  const draw = () => {
    const all = $('#txf').value === 'all';
    const rows = (ins.tx || []).filter(t => all || t.c === 'P' || t.c === 'S');
    $('#txb').innerHTML = rows.length ? rows.map(t => {
      const [lbl, cls, tip] = txInfo(t.c);
      return `<tr><td>${esc(t.d)}</td><td style="text-align:left">${esc(t.n)}</td><td style="text-align:left">${esc(t.r)}</td><td style="text-align:left"><span class="badge ${cls}" title="${esc(tip)}">${esc(lbl)}</span>${t.i ? ' <span class="muted small" title="A través de familiares, fideicomisos o sociedades">indirecta</span>' : ''}</td>
        <td class="${t.a === 'D' ? 'bad' : t.a === 'A' ? 'good' : ''}">${t.a === 'D' ? '−' : t.a === 'A' ? '+' : ''}${fmt(t.s, 0)}</td><td>${isNum(t.p) ? money(t.p, 'USD') : '–'}</td><td>${big(txAmount(t), 'USD')}</td><td>${fmt(t.o, 0)}</td><td>${t.pl ? 'Sí' : ''}</td></tr>`;
    }).join('') : `<tr><td colspan="9" style="text-align:left">${all ? 'No hay operaciones en los últimos 12 meses.' : 'Ninguna compra ni venta en bolsa en los últimos 12 meses. Prueba con «Todas».'}</td></tr>`;
    $('#txn').textContent = ins.nTx > (ins.tx || []).length ? `Se muestran las ${ins.tx.length} más recientes de ${ins.nTx} operaciones en 12 meses.` : '';
  };
  $('#txf').addEventListener('change', draw);
  draw();
}

// ---------------------------------------------------------------- inversores
async function investors() {
  const list = await getJSON('investors/index.json');
  app.innerHTML = `<h1>Grandes inversores</h1>
  <p class="muted">Carteras publicadas en los formularios 13F de la SEC. Solo incluyen acciones de EE. UU. (y ADR) en posiciones largas; no muestran posiciones cortas, bonos ni acciones extranjeras. Se publican hasta 45 días después de cada trimestre.</p>
  <input id="flt" type="search" placeholder="Filtrar por nombre…" style="margin-bottom:1rem;max-width:320px;width:100%">
  <div class="grid g3" id="invs">${list.map(i => `
    <a class="card inv-card" href="#/inversor/${i.cik}" data-q="${esc((i.manager + ' ' + i.fund + ' ' + i.style).toLowerCase())}">
      <h3>${esc(i.manager)}</h3><div class="muted small">${esc(i.fund)} · ${esc(i.style)}</div>
      <p style="margin:.5rem 0 .2rem"><b>${big(i.total, 'USD')}</b> en ${i.positions} posiciones</p>
      <div class="small muted">Principales: ${i.top.map(esc).join(', ')}</div>
      <div class="small muted">Cartera a ${esc(i.period)}</div>
    </a>`).join('')}</div>`;
  $('#flt').addEventListener('input', e => { const q = e.target.value.toLowerCase(); app.querySelectorAll('#invs [data-q]').forEach(c => (c.style.display = c.dataset.q.includes(q) ? '' : 'none')); });
}

async function investor(cik) {
  const d = await getJSON('investors/' + cik + '.json');
  let qi = 0;
  app.innerHTML = `<p><a href="#/inversores">← Todos los inversores</a></p>
  <div class="card"><h1>${esc(d.manager)}</h1><div class="muted">${esc(d.fund)} · ${esc(d.style || '')} · <a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${d.cik}&type=13F-HR" target="_blank" rel="noopener">13F en la SEC</a></div>
  <p><label>Trimestre: <select id="q">${d.quarters.map((q, i) => `<option value="${i}">${esc(q.period)} (presentado ${esc(q.filed)})</option>`).join('')}</select></label></p>
  <div id="qv"></div></div>`;
  const render = () => {
    destroyCharts();
    const q = d.quarters[qi];
    const nw = q.holdings.filter(h => h.chg === 'new'), up = q.holdings.filter(h => isNum(h.chg) && h.chg > 0.005), dn = q.holdings.filter(h => isNum(h.chg) && h.chg < -0.005);
    const link = h => h.ticker ? `<a href="#/c/${encodeURIComponent(h.ticker)}">${esc(h.ticker)}</a>` : '';
    $('#qv').innerHTML = `
    <div class="result">
      <div class="box hl"><div class="muted small">Valor de la cartera</div><div class="v">${big(q.total, 'USD')}</div></div>
      <div class="box"><div class="muted small">Posiciones</div><div class="v">${q.holdings.length}</div></div>
      <div class="box"><div class="muted small">Compras nuevas</div><div class="v">${nw.length}</div></div>
      <div class="box"><div class="muted small">Aumenta / reduce</div><div class="v">${up.length} / ${dn.length}</div></div>
      <div class="box"><div class="muted small">Ventas totales</div><div class="v">${q.soldOut ? q.soldOut.length : '–'}</div></div>
    </div>
    <div class="grid g2">
      <div><h3>Reparto (10 mayores)</h3><div class="chart-box"><canvas id="ich"></canvas></div></div>
      <div><h3>Movimientos del trimestre</h3>
        ${nw.length ? `<p><b>Nuevas:</b> ${nw.map(h => (link(h) || esc(h.name)) + ` (${pct(h.weight, 1)})`).join(', ')}</p>` : ''}
        ${q.soldOut && q.soldOut.length ? `<p><b>Vende todo:</b> ${q.soldOut.map(h => h.ticker ? `<a href="#/c/${encodeURIComponent(h.ticker)}">${esc(h.ticker)}</a>` : esc(h.name)).join(', ')}</p>` : ''}
        ${up.length ? `<p><b>Aumenta:</b> ${up.slice(0, 25).map(h => (link(h) || esc(h.name)) + ` (+${pct(h.chg, 0)})`).join(', ')}</p>` : ''}
        ${dn.length ? `<p><b>Reduce:</b> ${dn.slice(0, 25).map(h => (link(h) || esc(h.name)) + ` (${pct(h.chg, 0)})`).join(', ')}</p>` : ''}
        ${q.soldOut === undefined ? '<p class="muted">No hay trimestre anterior para comparar.</p>' : ''}
      </div>
    </div>
    <h3 style="margin-top:1rem">Cartera completa</h3>
    <div class="tbl-wrap"><table><thead><tr><th>Empresa</th><th>Ticker</th><th>Peso</th><th></th><th>Valor</th><th>Acciones</th><th>Cambio</th></tr></thead><tbody>
    ${q.holdings.map(h => `<tr class="${h.ticker ? 'clickable' : ''}" data-t="${esc(h.ticker || '')}"><td>${esc(h.name)} <span class="muted small">${esc(h.cls)}</span></td><td>${link(h)}</td><td>${pct(h.weight, 2)}</td><td><div class="bar"><i style="width:${Math.min(100, h.weight / q.holdings[0].weight * 100)}%"></i></div></td><td>${big(h.value, 'USD')}</td><td>${fmt(h.shares, 0)}</td><td>${chgBadge(h.chg)}</td></tr>`).join('')}
    </tbody></table></div>`;
    $('#qv').querySelectorAll('tr[data-t]').forEach(tr => tr.dataset.t && tr.addEventListener('click', e => { if (e.target.tagName !== 'A') location.hash = '#/c/' + encodeURIComponent(tr.dataset.t); }));
    const top = q.holdings.slice(0, 10), rest = 1 - sum(top.map(h => h.weight));
    const C = COLORS();
    chart($('#ich'), { type: 'doughnut', data: { labels: top.map(h => h.ticker || h.name).concat(rest > 0.001 ? ['Resto'] : []),
      datasets: [{ data: top.map(h => +(h.weight * 100).toFixed(2)).concat(rest > 0.001 ? [+(rest * 100).toFixed(2)] : []),
        backgroundColor: top.map((_, i) => C[i % 5] + (i < 5 ? '' : '99')).concat([css('--line')]), borderColor: css('--card') }] },
      options: { interaction: { mode: 'nearest' }, plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: c => c.label + ': ' + fmt(c.raw, 1) + ' %' } } } } });
  };
  $('#q').addEventListener('change', e => { qi = +e.target.value; render(); });
  render();
}

// ---------------------------------------------------------------- screener
async function screener() {
  const rows = await getJSON('screener.json');
  const sectors = [...new Set(rows.map(r => r.s).filter(Boolean))].sort();
  const saved = store.get('screener') || {};
  const COLS = [
    ['t', 'Ticker'], ['n', 'Empresa'], ['mc', 'Capitaliz.', v => big(v)], ['pe', 'PER', mult], ['pfcf', 'P/FCF', mult], ['evebit', 'EV/EBIT', mult],
    ['om', 'Marg. oper.', pct], ['roce', 'ROCE', pct], ['roe', 'ROE', pct], ['g5', 'Crec. ventas 5a', pct], ['de', 'Deuda/Patr.', mult], ['dy', 'Rent. div.', pct], ['h', 'Inversores', v => v || '']
  ];
  const FIL = [
    ['q', 'Nombre o ticker', 'text'], ['sector', 'Sector', 'sector'], ['mcMin', 'Capitalización mín. (mil M $)', 'number'],
    ['peMax', 'PER máx.', 'number'], ['pfcfMax', 'P/FCF máx.', 'number'], ['evebitMax', 'EV/EBIT máx.', 'number'],
    ['omMin', 'Margen operativo mín. (%)', 'number'], ['roceMin', 'ROCE mín. (%)', 'number'], ['roeMin', 'ROE mín. (%)', 'number'],
    ['g5Min', 'Crec. ventas 5a mín. (%)', 'number'], ['deMax', 'Deuda/Patrimonio máx.', 'number'], ['dyMin', 'Rent. dividendo mín. (%)', 'number'], ['hMin', 'Nº grandes inversores mín.', 'number']
  ];
  let sort = saved.sort || ['mc', -1], page = 0;
  app.innerHTML = `<h1>Buscador de acciones</h1>
  <p class="muted">Filtra ${nf(0).format(rows.length)} empresas por sus métricas de los últimos 12 meses. Pulsa en una columna para ordenar.</p>
  <div class="card"><div class="filters">${FIL.map(([k, l, t]) => t === 'sector'
    ? `<label>${l}<select data-f="${k}"><option value="">Todos</option>${sectors.map(s => `<option ${saved[k] === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>`
    : `<label>${l}<input data-f="${k}" type="${t}" value="${esc(saved[k] ?? '')}" ${t === 'number' ? 'step="any"' : ''}></label>`).join('')}
    <div><button class="btn ghost" id="clr">Limpiar filtros</button></div></div>
  <div class="small muted" style="margin-top:.6rem">Ideas: calidad a buen precio = ROCE mín. 15, margen operativo mín. 15, PER máx. 20. Ver qué tienen los grandes inversores = nº inversores mín. 3.</div></div>
  <div class="card"><div id="cnt" class="small muted"></div><div class="tbl-wrap"><table class="scr"><thead><tr>${COLS.map(([k, l]) => `<th class="sortable" data-k="${k}">${l}</th>`).join('')}</tr></thead><tbody id="sb"></tbody></table></div>
  <div class="pager"><button class="btn ghost" id="prev">Anterior</button><span id="pg" class="small"></span><button class="btn ghost" id="next">Siguiente</button></div></div>`;
  const PER = 100;
  let filtered = rows;
  const apply = () => {
    const F = {};
    app.querySelectorAll('[data-f]').forEach(i => (F[i.dataset.f] = i.value));
    store.set('screener', { ...F, sort });
    const num = k => F[k] === '' || F[k] === undefined ? null : parseFloat(F[k]);
    const q = (F.q || '').toUpperCase();
    const lim = [['mc', num('mcMin') !== null ? num('mcMin') * 1e9 : null, 1], ['pe', num('peMax'), -1], ['pfcf', num('pfcfMax'), -1], ['evebit', num('evebitMax'), -1],
      ['om', num('omMin') !== null ? num('omMin') / 100 : null, 1], ['roce', num('roceMin') !== null ? num('roceMin') / 100 : null, 1], ['roe', num('roeMin') !== null ? num('roeMin') / 100 : null, 1],
      ['g5', num('g5Min') !== null ? num('g5Min') / 100 : null, 1], ['de', num('deMax'), -1], ['dy', num('dyMin') !== null ? num('dyMin') / 100 : null, 1], ['h', num('hMin'), 1]].filter(x => x[1] !== null && !isNaN(x[1]));
    filtered = rows.filter(r => {
      if (q && !(r.t.includes(q) || r.n.toUpperCase().includes(q))) return false;
      if (F.sector && r.s !== F.sector) return false;
      for (const [k, v, dir] of lim) { const x = r[k]; if (!isNum(x)) return false; if (dir > 0 ? x < v : x > v) return false; }
      return true;
    });
    const [sk, sd] = sort;
    filtered.sort((a, b) => { const x = a[sk], y = b[sk]; if (x === y) return 0; if (x === null || x === undefined) return 1; if (y === null || y === undefined) return -1; return (x > y ? 1 : -1) * sd; });
    page = 0; draw();
  };
  const draw = () => {
    const pages = Math.max(1, Math.ceil(filtered.length / PER));
    $('#cnt').textContent = nf(0).format(filtered.length) + ' empresas';
    $('#pg').textContent = `Página ${page + 1} de ${pages}`;
    $('#sb').innerHTML = filtered.slice(page * PER, page * PER + PER).map(r => `<tr class="clickable" data-t="${esc(r.t)}">${COLS.map(([k, , f]) => `<td>${k === 't' ? `<a href="#/c/${encodeURIComponent(r.t)}">${esc(r.t)}</a>` : k === 'n' ? esc(r.n.length > 32 ? r.n.slice(0, 31) + '…' : r.n) : f(r[k])}</td>`).join('')}</tr>`).join('');
    app.querySelectorAll('th.sortable').forEach(th => th.textContent = COLS.find(c => c[0] === th.dataset.k)[1] + (th.dataset.k === sort[0] ? (sort[1] > 0 ? ' ▲' : ' ▼') : ''));
  };
  app.querySelectorAll('[data-f]').forEach(i => i.addEventListener('input', apply));
  app.querySelectorAll('th.sortable').forEach(th => th.addEventListener('click', () => { const k = th.dataset.k; sort = [k, sort[0] === k ? -sort[1] : (k === 't' || k === 'n' || k === 'pe' || k === 'pfcf' || k === 'evebit' || k === 'de' ? 1 : -1)]; apply(); }));
  $('#sb').addEventListener('click', e => { const tr = e.target.closest('tr[data-t]'); if (tr && e.target.tagName !== 'A') location.hash = '#/c/' + encodeURIComponent(tr.dataset.t); });
  $('#prev').addEventListener('click', () => { if (page > 0) { page--; draw(); } });
  $('#next').addEventListener('click', () => { if ((page + 1) * PER < filtered.length) { page++; draw(); } });
  $('#clr').addEventListener('click', () => { app.querySelectorAll('[data-f]').forEach(i => (i.value = '')); apply(); });
  apply();
}

// ---------------------------------------------------------------- glosario
function glossary() {
  const groups = [
    ['Rentabilidad', ['roce', 'roic', 'roe', 'roa']],
    ['Márgenes', ['gm', 'ebitdam', 'om', 'nm', 'fcfm']],
    ['Crecimiento', ['revg', 'epsg', 'shg']],
    ['Solidez financiera', ['de', 'ndebitda', 'cr', 'ic', 'payout']],
    ['Valoración', ['pe', 'pfcf', 'ps', 'pb', 'evebit', 'evebitda', 'fcfy', 'dy']],
    ['Valor intrínseco', ['dcf', 'wacc', 'tg', 'mos', 'ttm']]
  ];
  app.innerHTML = `<h1>Glosario</h1><div class="grid g2">${groups.map(([g, ks]) => `<div class="card"><h2>${g}</h2><dl class="gloss">${ks.map(k => { const [t, ...rest] = DEF[k].split(':'); return `<dt>${esc(t)}</dt><dd>${esc(rest.join(':').trim())}</dd>`; }).join('')}</dl></div>`).join('')}</div>
  <div class="card"><h2>De dónde salen los datos</h2>
  <p><b>Estados financieros:</b> de los informes anuales y trimestrales (10-K, 10-Q, 20-F, 40-F) que las empresas presentan a la SEC de EE. UU. en formato XBRL. Cubre las empresas cotizadas en EE. UU., incluidas muchas extranjeras que cotizan allí (ADR). No cubre empresas que solo cotizan en Europa u otros mercados.</p>
  <p><b>Precios:</b> Yahoo Finance, actualizados una vez al día.</p>
  <p><b>Grandes inversores:</b> formularios 13F de la SEC, que los gestores con más de 100 millones de dólares deben presentar cada trimestre.</p>
  <p><b>Directivos:</b> formularios 3, 4 y 5 de la SEC, que directivos, consejeros y accionistas con más del 10 % deben presentar en 2 días hábiles cada vez que compran o venden. Se usan los conjuntos de datos trimestrales de la SEC y, para las semanas más recientes, cada formulario 4. Solo empresas de EE. UU.</p>
  <p><b>Proyecciones:</b> cálculos propios a partir de los históricos.</p>
  <p><b>Previsiones de analistas:</b> consenso de Financial Modeling Prep (o Alpha Vantage como respaldo), pedido desde tu navegador con tu propia clave gratuita. La web no guarda ni publica esos datos.</p></div>`;
}


// ---------------------------------------------------------------- guía
function guide() {
  app.innerHTML = `<h1>Cómo calcular la rentabilidad y el valor intrínseco</h1>
  <p class="muted">Una guía para quien empieza. No hace falta saber hacer estimaciones: se trata de hacerse buenas preguntas y usar los datos del pasado como punto de partida, siendo prudente.</p>

  <div class="card"><h2>La idea de fondo</h2>
  <p>Una acción es un trozo de una empresa. A largo plazo, lo que ganas depende de tres cosas:</p>
  <ol><li><b>Cuánto crecen los beneficios</b> de la empresa.</li><li><b>Cuánto paga el mercado por esos beneficios</b> al final (el PER): si compras caro y acaba cotizando más barato, pierdes rentabilidad aunque la empresa vaya bien.</li><li><b>Los dividendos</b> que cobras por el camino.</li></ol>
  <p>La web tiene dos herramientas que responden a dos preguntas distintas:</p>
  <ul><li><b>Proyección y rentabilidad</b>: «Si compro hoy a este precio, ¿qué rentabilidad anual puedo esperar?». Es la más intuitiva: <b>empieza por aquí</b>.</li>
  <li><b>Valor intrínseco (DCF)</b>: «¿Cuánto vale hoy la empresa según el dinero que generará?». Sirve para contrastar el resultado anterior.</li></ul>
  <p>La web ya rellena todo con valores por defecto sacados del histórico. Tu trabajo es <b>revisar si esos valores son razonables</b> y, si dudas, ser algo más prudente.</p></div>

  <div class="card"><h2>Antes de nada: ¿es predecible la empresa?</h2>
  <p>Toda proyección supone que el futuro se parecerá al pasado. Eso solo es razonable si el pasado ha sido <b>constante</b>. Para no tener que juzgarlo a ojo, la pestaña <b>Proyección y rentabilidad</b> empieza con un cuadro de <b>medias históricas y fiabilidad</b>, y el <b>Resumen</b> muestra el <b>índice de predecibilidad</b>.</p>
  <h3>Medias de 5 y 10 años</h3>
  <p>Para cada dato que entra en la proyección verás su media de los últimos 5 y 10 años: crecimiento de ventas (anual compuesto), margen operativo, margen neto, ROIC, variación de acciones, PER (mediana) y payout. Si las dos medias se parecen, la empresa es estable. Si la de 5 años es mucho mejor que la de 10, pregúntate si esa mejora es duradera o un buen momento pasajero; en la duda, usa la de 10 años o un número intermedio. Con los botones <b>«Rellenar con las medias»</b> pasas esos valores a la proyección de un clic.</p>
  <h3>Fiabilidad de cada métrica</h3>
  <p>Mide cuánto se ha movido cada métrica en los últimos 10 años:</p>
  <ul><li><b>Márgenes, ROIC y PER</b>: se usa el <b>coeficiente de variación (CV)</b> = desviación típica / media. Un CV del 10 % quiere decir que la métrica suele estar un 10 % por encima o por debajo de su media. Ejemplo: un margen medio del 20 % con CV 10 % se mueve normalmente entre el 18 % y el 22 %.<br>Fiabilidad <b>alta</b> si el CV es menor del 15 % (PER: 20 %), <b>media</b> hasta el 35 % (PER: 40 %) y <b>baja</b> por encima. Si la media es negativa (pérdidas), es baja.</li>
  <li><b>Crecimiento de ventas</b>: se usa la <b>desviación típica</b> del crecimiento de cada año, en puntos. Ejemplo: si crece de media un 8 % con ± 3 puntos, casi todos los años crece entre un 5 % y un 11 %. Alta por debajo de ± 5 puntos, media hasta ± 10 y baja por encima. También verás cuántos años crecieron las ventas.</li>
  <li><b>Variación de acciones</b>: alta por debajo de ± 1,5 puntos, media hasta ± 4.</li></ul>
  <h3>Índice de predecibilidad (0 a 100)</h3>
  <p>Resume en un número lo predecible que es la empresa. Cada métrica recibe una nota de 0 a 100 según su variabilidad y se hace una media ponderada: <b>crecimiento de ventas 30 %, ROIC 30 %, margen operativo 20 % y margen neto 20 %</b>. El PER no entra porque depende del humor del mercado, no del negocio. Si la empresa ha tenido <b>pérdidas</b> algún año de los últimos 10 o hay <b>menos de 8 años</b> de datos, el índice no puede pasar de «media».</p>
  <div class="tbl-wrap"><table><thead><tr><th>Índice</th><th>Fiabilidad</th><th>Qué hacer</th></tr></thead><tbody>
  <tr><td>70-100</td><td><span class="badge up">Alta</span></td><td style="white-space:normal;text-align:left">Negocio estable. Las medias históricas son un buen punto de partida y la rentabilidad calculada es una referencia útil.</td></tr>
  <tr><td>40-69</td><td><span class="badge mid">Media</span></td><td style="white-space:normal;text-align:left">Hay altibajos. Úsala como orientación, con supuestos prudentes (la media de 10 años o la peor de las dos) y decide mirando el escenario pesimista.</td></tr>
  <tr><td>0-39</td><td><span class="badge down">Baja</span></td><td style="white-space:normal;text-align:left">El pasado no sirve para predecir. No te fíes de la proyección ni del DCF: son típicas las empresas cíclicas, en pérdidas o en plena transformación.</td></tr>
  </tbody></table></div>
  <p>Fíjate también en <b>qué</b> métrica falla. Si las ventas son estables pero el margen no, el negocio es sólido pero su rentabilidad depende del ciclo: usa un margen conservador. Si lo que falla es el crecimiento de ventas, ponte en un crecimiento bajo.</p>
  <p class="muted small">Un índice alto no garantiza nada: mide el pasado. Comprueba también que la <b>deuda neta / EBITDA</b> sea baja (menos de 2-3x) y que entiendes el negocio. Los bancos y aseguradoras pueden salir estables, pero estas herramientas no están pensadas para ellos.</p></div>

  <div class="card"><h2>Parte 1. Proyección y rentabilidad, casilla a casilla</h2>
  <dl class="gloss">
  <dt>Años de inversión</dt><dd>Déjalo en 5. Más allá todo es más incierto.</dd>
  <dt>Crecimiento anual de ventas</dt><dd>Por defecto, lo que creció en los últimos 5 años. Mira en el cuadro de medias el crecimiento a 5 y a 10 años. Usa el <b>menor</b> de los dos y, si la empresa es ya muy grande, réstale un poco. Referencias: empresa madura (Coca-Cola, Procter & Gamble) 3-6 %; empresa de calidad que aún crece (Visa, Microsoft) 8-12 %; más del 15 % durante 5 años lo consiguen muy pocas.</dd>
  <dt>Margen neto</dt><dd>Por defecto, la media de los últimos 3 años. Compárala con las medias de 5 y 10 años del cuadro de fiabilidad. Si el margen reciente es mucho mayor que el de antes, usa un número intermedio o la media de 10 años.</dd>
  <dt>Variación anual de acciones</dt><dd>Si la empresa recompra acciones, saldrá negativo (por ejemplo −2 %) y eso aumenta tu beneficio por acción. Si emite acciones, saldrá positivo. Suele bastar con el valor por defecto.</dd>
  <dt>PER de salida (la casilla más importante)</dt><dd>Es a cuántas veces beneficios crees que cotizará la acción dentro de 5 años. Por defecto, la mediana de los últimos 10 años. Reglas prudentes: no pongas más que el PER actual ni más que la mediana histórica; empresa madura 12-18; buena empresa con crecimiento moderado 18-25; más de 25 solo para empresas excepcionales que sigan creciendo rápido. Si hoy cotiza a PER 40, asumir que seguirá a 40 es arriesgado.</dd>
  <dt>Payout</dt><dd>Parte del beneficio que reparte como dividendo. Deja el valor por defecto.</dd>
  <dt>Rentabilidad anual que quieres</dt><dd>Tu objetivo. Como referencia, el índice S&amp;P 500 ha dado en torno a un 9-10 % anual a largo plazo; si no esperas superarlo, comprar el índice es más sencillo. Un 10-12 % es un objetivo razonable.</dd></dl>
  <h3>Cómo leer el resultado</h3>
  <ul><li><b>Rentabilidad anual esperada</b>: lo que ganarías al año si se cumple el escenario base.</li>
  <li><b>Precio máximo</b>: a qué precio tendrías que comprar para lograr tu rentabilidad objetivo. Si el precio actual está por encima, la acción está cara para tu objetivo: puedes esperar a que baje.</li>
  <li><b>Escenarios</b>: mira sobre todo el <b>pesimista</b>. Una buena compra es la que en el escenario base te da tu objetivo y en el pesimista no te hace perder dinero.</li></ul></div>

  <div class="card"><h2>Previsiones de analistas: qué son y cuánto fiarse</h2>
  <p>Unos 10-50 analistas de bancos y casas de análisis siguen a cada gran empresa y publican cuánto creen que venderá y ganará los próximos años. La <b>media</b> de todos ellos es el <b>consenso</b>. TIKR o InvestingPro lo compran a proveedores como S&amp;P Capital IQ; aquí se pide gratis a <b>Financial Modeling Prep</b> con tu propia clave (la primera vez la pestaña te explica cómo conseguirla en un minuto).</p>
  <h3>Tres preguntas para saber cuánto fiarse</h3>
  <ol><li><b>¿Están de acuerdo los analistas?</b> Mira la <b>dispersión</b>: (máximo − mínimo) / media. Si para el próximo año un analista espera un BPA de 5,8 y otro de 6,2 con una media de 6, la dispersión es del 7 %: mucho acuerdo. Si van de 3 a 9, es del 100 %: nadie sabe lo que va a pasar. La web lo resume en la nota <b>Acuerdo entre analistas</b> (0-100), con los mismos tramos que el índice de predecibilidad.</li>
  <li><b>¿Cuántos analistas hay?</b> Con 1-3 la media es poco representativa (la nota no pasa de «media»). Con 15 o más, mucho mejor.</li>
  <li><b>¿Encaja con su historia?</b> El cuadro «Consenso frente a su historia» compara lo que esperan los analistas con las medias de 5 y 10 años. Si la empresa es predecible y los analistas esperan algo parecido a su pasado, la previsión es razonable. Si esperan mucho más (o mucho menos), busca el motivo antes de creértelo.</li></ol>
  <h3>Limitaciones que conviene saber</h3>
  <ul><li>Los analistas suelen ser <b>optimistas</b>, sobre todo a 2-3 años vista, y fallan más en empresas cíclicas o en pérdidas.</li>
  <li>Estiman el BPA <b>ajustado</b> (sin partidas extraordinarias), que suele ser algo mayor que el BPA oficial que ves en Estados financieros.</li>
  <li>El proveedor gratuito no da previsiones de flujo de caja libre (FCF). Para el DCF puedes usar el crecimiento de ventas del consenso como referencia.</li></ul>
  <p><b>Uso práctico:</b> el botón <b>Usar el consenso en la proyección</b> copia el margen neto de los analistas en la Parte 1 y un crecimiento de ventas «equivalente»: sigue las ventas que esperan los analistas mientras haya al menos 3 que las estimen y, después, supone que el crecimiento se frena a la mitad (como mucho un 10 % al año). Así, una empresa que hoy crece un 60 % no se proyecta creciendo un 60 % durante 5 años, algo que casi nunca ocurre. Si tú crees que las ventas se estancarán antes, baja ese número: la proyección es tuya. Luego mira el escenario pesimista: si aun así te da una rentabilidad aceptable, tienes margen de seguridad aunque los analistas se equivoquen.</p></div>

  <div class="card"><h2>Parte 2. Valor intrínseco (DCF), casilla a casilla</h2>
  <dl class="gloss">
  <dt>Flujo de caja libre inicial</dt><dd>El dinero que genera la empresa en un año después de invertir lo necesario. Por defecto, el de los últimos 12 meses. Si ese año fue anormalmente bueno o malo, pon la media de los 3 últimos años (la ves en Estados financieros → Flujo de caja libre).</dd>
  <dt>Crecimiento años 1-5</dt><dd>Usa el mismo criterio que para las ventas en la Parte 1. Mejor quedarse corto.</dd>
  <dt>Crecimiento años 6-10</dt><dd>Más bajo que el anterior: con el tiempo todas las empresas crecen menos. Una buena regla es la mitad del de los años 1-5.</dd>
  <dt>Crecimiento a perpetuidad</dt><dd>Déjalo entre 2 % y 3 %. Nunca más del 3 %: ninguna empresa crece más que la economía para siempre.</dd>
  <dt>Tasa de descuento</dt><dd>La rentabilidad que exiges. Pon el mismo número que tu objetivo de la Parte 1 (9-10 % para empresas grandes y estables, 11-12 % si son más pequeñas o arriesgadas). Cuanto más alta, más prudente es el resultado.</dd>
  <dt>Deuda neta, acciones y precio</dt><dd>Vienen de los últimos informes; no hace falta tocarlos.</dd>
  <dt>Restar remuneración en acciones</dt><dd>Ponlo en «Sí» en empresas tecnológicas, que pagan mucho a sus empleados con acciones. Es más realista.</dd></dl>
  <h3>Cómo leer el resultado</h3>
  <ul><li><b>Margen de seguridad</b>: cuánto más barato que su valor cotiza. Como tus estimaciones pueden fallar, busca un margen de al menos un 20-30 %.</li>
  <li><b>Tabla de sensibilidad</b>: muestra el valor con otras tasas de descuento y crecimientos. Si la acción solo parece barata en la esquina más optimista, no lo es.</li>
  <li><b>Crecimiento que descuenta el precio</b> (la herramienta más útil para principiantes): en vez de adivinar el futuro, te dice qué crecimiento anual necesita la empresa para justificar su precio. Compáralo con su crecimiento histórico. Si el precio exige un 15 % anual y la empresa ha crecido un 7 %, está cara. Si exige un 3 % y ha crecido un 8 %, puede estar barata.</li></ul></div>

  <div class="card"><h2>Ejemplo completo (empresa inventada)</h2>
  <p>Una empresa cotiza a <b>100 $</b>, gana <b>5 $ por acción</b> (PER 20). En <b>Métricas</b> ves que sus ventas crecieron un 9 % anual en 5 años y un 7 % en 10 años, su margen es estable y su PER mediano de 10 años es 22.</p>
  <ol><li><b>Crecimiento de ventas</b>: el menor de 9 % y 7 % es 7 %; como ya es grande pongo <b>6 %</b>.</li>
  <li><b>Margen neto</b>: estable, dejo el valor por defecto.</li>
  <li><b>PER de salida</b>: el actual es 20 y el histórico 22; me quedo con el menor, <b>20</b>. Si quiero ser más prudente, 18.</li>
  <li><b>Resultado</b>: el BPA pasa de 5 $ a unos 6,7 $ en 5 años (6 % anual). 6,7 × 20 = 134 $, más unos 12 $ de dividendos cobrados por el camino si reparte el 40 % del beneficio: en total unos 146 $ por cada 100 $ invertidos, cerca de un <b>8 % anual</b>.</li>
  <li><b>Decisión</b>: si mi objetivo es un 10 %, el «precio máximo» me dirá unos 91 $. Hoy está por encima: la pongo en mi lista de seguimiento y espero a que baje.</li>
  <li><b>Contraste con el DCF</b>: si el DCF inverso dice que el precio descuenta un 6 % de crecimiento y la empresa ha crecido un 7-9 %, el precio es razonable pero no una ganga. Coincide con la conclusión anterior.</li></ol></div>

  <div class="card"><h2>Errores típicos</h2>
  <ul><li>Usar el crecimiento de los mejores años como si fuera a repetirse siempre.</li>
  <li>Poner un PER de salida alto «porque ahora cotiza así».</li>
  <li>Fiarse de un único número. Un valor intrínseco no es un precio exacto, es un rango: mira la tabla de sensibilidad y los escenarios.</li>
  <li>Usar el DCF o la proyección en bancos, aseguradoras, empresas con pérdidas o muy cíclicas (índice de predecibilidad bajo).</li>
  <li>Olvidar comprobar los datos: si algo parece raro, revisa el informe oficial con el enlace «informes en la SEC».</li></ul></div>

  <div class="card"><h2>Lista rápida antes de comprar</h2>
  <ol><li>¿Es un negocio estable y lo entiendo? (Índice de predecibilidad alto o, como mínimo, medio)</li>
  <li>¿Tiene poca deuda? (deuda neta / EBITDA menor de 2-3x)</li>
  <li>Con supuestos prudentes, ¿la rentabilidad esperada base supera mi objetivo?</li>
  <li>¿El escenario pesimista evita pérdidas?</li>
  <li>¿El crecimiento que descuenta el precio es menor que el que ha tenido la empresa?</li></ol>
  <p class="muted small">Esta guía es educativa y no es asesoramiento financiero.</p></div>`;
}

// ---------------------------------------------------------------- arranque
getJSON('meta.json').then(m => { $('#updated').textContent = 'Datos actualizados: ' + m.updated + '.'; }).catch(() => {});
route();
})();
