#!/usr/bin/env python3
"""
Descarga y procesa los datos de la web:

  1. Lista de empresas con ticker (SEC).
  2. Fundamentales anuales + últimos 12 meses (SEC EDGAR XBRL "companyfacts", fichero masivo).
  3. Sector (SEC "submissions", fichero masivo).
  4. Precios mensuales de 10 años (Yahoo Finance, alternativa Stooq).
  5. Carteras 13F de grandes inversores (SEC EDGAR).

Salida en site/data/:
  index.json                 buscador (ticker, nombre, bolsa)
  c/{TICKER}.json            ficha de cada empresa
  screener.json              métricas clave de todas las empresas
  investors/index.json       lista de grandes inversores
  investors/{CIK}.json       carteras trimestrales y movimientos
  meta.json                  fecha de actualización

Uso:
  python scripts/build_data.py                 # todo
  python scripts/build_data.py --limit 50      # prueba rápida con 50 empresas
  python scripts/build_data.py --tickers AAPL,MSFT,KO

Variable de entorno SEC_USER_AGENT: la SEC exige identificarse ("Nombre email@dominio").
"""
import argparse
import concurrent.futures as cf
import datetime as dt
import io
import json
import math
import os
import re
import sys
import threading
import time
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "data"
CACHE = ROOT / ".cache"

SEC_UA = os.environ.get("SEC_USER_AGENT") or "WebInversion research contacto@webinversion.org"
BROWSER_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------
_sec_lock = threading.Lock()
_sec_last = [0.0]


def sec_get(url, stream=False, tries=5):
    """GET a la SEC respetando su límite (10 peticiones/segundo)."""
    for i in range(tries):
        with _sec_lock:
            wait = 0.12 - (time.time() - _sec_last[0])
            if wait > 0:
                time.sleep(wait)
            _sec_last[0] = time.time()
        try:
            r = requests.get(url, headers={"User-Agent": SEC_UA, "Accept-Encoding": "gzip, deflate"},
                             timeout=120, stream=stream)
            if r.status_code == 200:
                return r
            if r.status_code == 404:
                return None
            print(f"  SEC {r.status_code} {url}", file=sys.stderr)
        except requests.RequestException as e:
            print(f"  SEC error {e} {url}", file=sys.stderr)
        time.sleep(2 ** i)
    return None


def download(url, dest: Path, max_age_hours=20):
    """Descarga un fichero grande de la SEC a disco (con caché)."""
    if dest.exists() and (time.time() - dest.stat().st_mtime) < max_age_hours * 3600:
        print(f"  usando caché {dest.name}")
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"  descargando {url}")
    r = sec_get(url, stream=True)
    if r is None:
        raise RuntimeError(f"No se pudo descargar {url}")
    tmp = dest.with_suffix(".part")
    with open(tmp, "wb") as f:
        for chunk in r.iter_content(1 << 20):
            f.write(chunk)
    tmp.rename(dest)
    return dest


# ---------------------------------------------------------------------------
# Conceptos contables (por orden de preferencia; se mezclan año a año)
# ---------------------------------------------------------------------------
G, I = "us-gaap", "ifrs-full"
DURATION = {
    "revenue": [(G, "Revenues"), (G, "RevenueFromContractWithCustomerExcludingAssessedTax"),
                (G, "RevenueFromContractWithCustomerIncludingAssessedTax"), (G, "SalesRevenueNet"),
                (G, "SalesRevenueGoodsNet"), (G, "SalesRevenueServicesNet"), (G, "RevenuesNetOfInterestExpense"),
                (G, "TotalRevenuesAndOtherIncome"), (I, "Revenue"), (I, "RevenueFromContractsWithCustomers")],
    "costOfRevenue": [(G, "CostOfRevenue"), (G, "CostOfGoodsAndServicesSold"), (G, "CostOfGoodsSold"),
                      (G, "CostOfServices"), (I, "CostOfSales")],
    "grossProfit": [(G, "GrossProfit"), (I, "GrossProfit")],
    "rnd": [(G, "ResearchAndDevelopmentExpense"),
            (G, "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost"), (I, "ResearchAndDevelopmentExpense")],
    "sga": [(G, "SellingGeneralAndAdministrativeExpense"), (I, "SellingGeneralAndAdministrativeExpense")],
    "operatingIncome": [(G, "OperatingIncomeLoss"), (I, "ProfitLossFromOperatingActivities")],
    "interestExpense": [(G, "InterestExpense"), (G, "InterestExpenseNonoperating"), (G, "InterestExpenseDebt"),
                        (G, "InterestAndDebtExpense"), (I, "FinanceCosts"), (I, "InterestExpense")],
    "pretaxIncome": [(G, "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest"),
                     (G, "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"),
                     (G, "IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic"), (I, "ProfitLossBeforeTax")],
    "incomeTax": [(G, "IncomeTaxExpenseBenefit"), (I, "IncomeTaxExpenseContinuingOperations")],
    "netIncome": [(G, "NetIncomeLoss"), (G, "NetIncomeLossAvailableToCommonStockholdersBasic"), (G, "ProfitLoss"),
                  (I, "ProfitLossAttributableToOwnersOfParent"), (I, "ProfitLoss")],
    "epsDiluted": [(G, "EarningsPerShareDiluted"), (G, "EarningsPerShareBasicAndDiluted"),
                   (G, "EarningsPerShareBasic"), (I, "DilutedEarningsLossPerShare"), (I, "BasicEarningsLossPerShare")],
    "sharesDiluted": [(G, "WeightedAverageNumberOfDilutedSharesOutstanding"),
                      (G, "WeightedAverageNumberOfShareOutstandingBasicAndDiluted"),
                      (G, "WeightedAverageNumberOfSharesOutstandingBasic"),
                      (I, "AdjustedWeightedAverageShares"), (I, "WeightedAverageShares")],
    "dna": [(G, "DepreciationDepletionAndAmortization"), (G, "DepreciationAmortizationAndAccretionNet"),
            (G, "DepreciationAndAmortization"), (G, "Depreciation"),
            (I, "DepreciationAndAmortisationExpense"), (I, "DepreciationPropertyPlantAndEquipment")],
    "sbc": [(G, "ShareBasedCompensation"), (G, "AllocatedShareBasedCompensationExpense")],
    "cfo": [(G, "NetCashProvidedByUsedInOperatingActivities"),
            (G, "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"),
            (I, "CashFlowsFromUsedInOperatingActivities")],
    "capex": [(G, "PaymentsToAcquirePropertyPlantAndEquipment"), (G, "PaymentsToAcquireProductiveAssets"),
              (G, "PaymentsForCapitalImprovements"),
              (I, "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities"),
              (I, "PurchaseOfPropertyPlantAndEquipment")],
    "dividendsPaid": [(G, "PaymentsOfDividends"), (G, "PaymentsOfDividendsCommonStock"),
                      (I, "DividendsPaidClassifiedAsFinancingActivities"), (I, "DividendsPaid")],
    "buybacks": [(G, "PaymentsForRepurchaseOfCommonStock"), (I, "PaymentsToAcquireOrRedeemEntitysShares")],
    "dps": [(G, "CommonStockDividendsPerShareDeclared"), (G, "CommonStockDividendsPerShareCashPaid"),
            (I, "DividendsRecognisedAsDistributionsToOwnersPerShare")],
}
INSTANT = {
    "cash": [(G, "CashAndCashEquivalentsAtCarryingValue"),
             (G, "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"), (G, "Cash"),
             (I, "CashAndCashEquivalents")],
    "shortInvestments": [(G, "ShortTermInvestments"), (G, "MarketableSecuritiesCurrent"),
                         (G, "AvailableForSaleSecuritiesDebtSecuritiesCurrent"), (I, "CurrentFinancialAssetsAtFairValueThroughProfitOrLoss")],
    "receivables": [(G, "AccountsReceivableNetCurrent"), (I, "TradeAndOtherCurrentReceivables")],
    "inventory": [(G, "InventoryNet"), (I, "Inventories")],
    "currentAssets": [(G, "AssetsCurrent"), (I, "CurrentAssets")],
    "goodwill": [(G, "Goodwill"), (I, "Goodwill")],
    "intangibles": [(G, "IntangibleAssetsNetExcludingGoodwill"), (G, "FiniteLivedIntangibleAssetsNet"),
                    (I, "IntangibleAssetsOtherThanGoodwill")],
    "totalAssets": [(G, "Assets"), (I, "Assets")],
    "currentLiabilities": [(G, "LiabilitiesCurrent"), (I, "CurrentLiabilities")],
    "totalLiabilities": [(G, "Liabilities"), (I, "Liabilities")],
    "ltDebtNoncurrent": [(G, "LongTermDebtNoncurrent"), (G, "LongTermDebtAndCapitalLeaseObligations"),
                         (G, "LongTermNotesPayable"), (I, "NoncurrentPortionOfNoncurrentBorrowings"),
                         (I, "LongtermBorrowings")],
    "ltDebtTotal": [(G, "LongTermDebt"), (G, "DebtInstrumentCarryingAmount")],
    "ltDebtCurrent": [(G, "LongTermDebtCurrent"), (G, "LongTermDebtAndCapitalLeaseObligationsCurrent"),
                      (I, "CurrentPortionOfNoncurrentBorrowings"), (I, "CurrentPortionOfLongtermBorrowings")],
    "stDebt": [(G, "ShortTermBorrowings"), (G, "CommercialPaper"), (G, "DebtCurrent"), (I, "ShorttermBorrowings"),
               (I, "CurrentBorrowings")],
    "equity": [(G, "StockholdersEquity"), (G, "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"),
               (I, "EquityAttributableToOwnersOfParent"), (I, "Equity")],
    "sharesOutstanding": [(G, "CommonStockSharesOutstanding"), ("dei", "EntityCommonStockSharesOutstanding")],
}
PER_SHARE = {"epsDiluted", "dps"}
SHARE_UNITS = {"sharesDiluted", "sharesOutstanding"}


def _d(s):
    return dt.date.fromisoformat(s)


def pick_unit(units: dict, key: str, currency: str):
    if key in SHARE_UNITS:
        return units.get("shares")
    if key in PER_SHARE:
        return units.get(f"{currency}/shares") or units.get("USD/shares")
    return units.get(currency)


def detect_currency(facts):
    counts = {}
    for tax in (G, I):
        for tag in ("Revenues", "Revenue", "NetIncomeLoss", "ProfitLoss", "Assets",
                    "RevenueFromContractWithCustomerExcludingAssessedTax"):
            for u, vals in facts.get(tax, {}).get(tag, {}).get("units", {}).items():
                if re.fullmatch(r"[A-Z]{3}", u):
                    counts[u] = counts.get(u, 0) + len(vals)
    if not counts:
        return "USD"
    return max(counts, key=counts.get)


def best_by_period(entries, instant: bool):
    """{(start,end) o end: valor} quedándose con la presentación más reciente (reformulaciones)."""
    out = {}
    for e in entries:
        if "end" not in e or e.get("val") is None:
            continue
        if instant:
            k = e["end"]
        else:
            if "start" not in e:
                continue
            k = (e["start"], e["end"])
        prev = out.get(k)
        if prev is None or e.get("filed", "") >= prev[1]:
            out[k] = (e["val"], e.get("filed", ""), e.get("form", ""))
    return out


def annual_durations(per):
    """Periodos de ~1 año -> {end: valor}."""
    res = {}
    for (s, e), (v, filed, form) in per.items():
        days = (_d(e) - _d(s)).days
        if 340 <= days <= 390:
            if e not in res or filed >= res[e][1]:
                res[e] = (v, filed)
    return {k: v[0] for k, v in res.items()}


def ttm_value(per, annual: dict):
    """Últimos 12 meses = último anual + acumulado del año en curso − mismo acumulado del año anterior."""
    if not annual:
        return None, None
    last_end = max(annual)
    cands = [(e, s, v) for (s, e), (v, _, _) in per.items() if e > last_end]
    if not cands:
        return annual[last_end], last_end
    cands.sort(reverse=True)
    for e, s, v in cands:
        days = (_d(e) - _d(s)).days
        if 340 <= days <= 390:  # ya es un periodo de 12 meses
            return v, e
        # acumulado del ejercicio: su inicio debe ser el día siguiente al último cierre anual
        if abs((_d(s) - _d(last_end)).days) > 10:
            continue
        prev_end = _d(e) - dt.timedelta(days=365)
        for (ps, pe), (pv, _, _) in per.items():
            if abs((_d(pe) - prev_end).days) <= 10 and abs((_d(pe) - _d(ps)).days - days) <= 10:
                return annual[last_end] + v - pv, e
    return annual[last_end], last_end


def extract_company(facts_json):
    facts = facts_json.get("facts", {})
    currency = detect_currency(facts)
    annual, ttm, ttm_end = {}, {}, {}

    for key, concepts in DURATION.items():
        merged, best = {}, None
        for tax, tag in concepts:
            node = facts.get(tax, {}).get(tag)
            if not node:
                continue
            entries = pick_unit(node.get("units", {}), key, currency)
            if not entries:
                continue
            per = best_by_period(entries, instant=False)
            ann = annual_durations(per)
            for k, v in ann.items():
                merged.setdefault(k, v)
            if ann and key not in PER_SHARE:
                tv, te = ttm_value(per, ann)
                # nos quedamos con el concepto que llegue a la fecha más reciente
                if tv is not None and (best is None or te > best[1]):
                    best = (tv, te)
        if merged:
            annual[key] = merged
        if best is not None:
            ttm[key], ttm_end[key] = best

    instant_all = {}
    for key, concepts in INSTANT.items():
        merged = {}
        for tax, tag in concepts:
            node = facts.get(tax, {}).get(tag)
            if not node:
                continue
            entries = pick_unit(node.get("units", {}), key, currency)
            if not entries:
                continue
            per = best_by_period(entries, instant=True)
            for k, (v, _, _) in per.items():
                merged.setdefault(k, v)
        if merged:
            instant_all[key] = merged

    # Fechas de cierre anual: las de ingresos / beneficio / flujo de caja
    ends = set()
    for k in ("revenue", "netIncome", "operatingIncome", "cfo"):
        ends |= set(annual.get(k, {}).keys())
    if not ends:
        return None
    # Agrupar en ejercicios (cierres a < 300 días son el mismo ejercicio por cambios de calendario)
    ends = sorted(ends)
    years = []
    for e in ends:
        if years and (_d(e) - _d(years[-1])).days < 300:
            years[-1] = max(years[-1], e)
        else:
            years.append(e)
    years = years[-20:]

    def near(series: dict, end: str, tol=10):
        if end in series:
            return series[end]
        de = _d(end)
        best = None
        for k, v in series.items():
            diff = abs((_d(k) - de).days)
            if diff <= tol and (best is None or diff < best[0]):
                best = (diff, v)
        return best[1] if best else None

    rows = {}
    for key in list(DURATION) + list(INSTANT):
        src = annual.get(key) if key in DURATION else instant_all.get(key)
        if not src:
            continue
        vals = [near(src, e) for e in years]
        if any(v is not None for v in vals):
            rows[key] = vals

    # Balance más reciente (puede ser de un trimestre posterior al último anual)
    latest_bs = {}
    for key, series in instant_all.items():
        if key == "sharesOutstanding":
            continue
        last = max(series)
        latest_bs[key] = series[last]
        latest_bs.setdefault("_date", last)
        latest_bs["_date"] = max(latest_bs["_date"], last)
    # acciones: dato más reciente de portada (dei) o balance
    so = None
    for tax, tag in (("dei", "EntityCommonStockSharesOutstanding"), (G, "CommonStockSharesOutstanding")):
        u = facts.get(tax, {}).get(tag, {}).get("units", {}).get("shares")
        if u:
            last = max(u, key=lambda e: (e.get("end", ""), e.get("filed", "")))
            if so is None or last["end"] > so[1]:
                # dei puede venir partido por clases: sumamos las de la misma fecha
                same = [x["val"] for x in u if x.get("end") == last["end"] and x.get("filed") == last.get("filed")]
                so = (sum(same) if tax == "dei" else last["val"], last["end"])
    return {
        "currency": currency,
        "years": years,
        "annual": rows,
        "ttm": {k: v for k, v in ttm.items()},
        "ttmEnd": max(ttm_end.values()) if ttm_end else None,
        "latestBalance": latest_bs,
        "sharesOutstanding": so[0] if so else None,
        "sharesOutstandingDate": so[1] if so else None,
    }


# ---------------------------------------------------------------------------
# Precios
# ---------------------------------------------------------------------------

def yahoo_prices(ticker):
    sym = ticker if ticker.endswith("=X") else ticker.replace(".", "-")
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=10y&interval=1mo&includeAdjustedClose=false"
    for i in range(3):
        try:
            r = requests.get(url, headers={"User-Agent": BROWSER_UA}, timeout=20)
            if r.status_code == 429:
                time.sleep(5 * (i + 1))
                continue
            if r.status_code != 200:
                return None
            res = r.json()["chart"]["result"][0]
            meta = res["meta"]
            ts = res.get("timestamp") or []
            closes = res["indicators"]["quote"][0].get("close") or []
            hist = []
            for t, c in zip(ts, closes):
                if c is not None:
                    hist.append([dt.datetime.utcfromtimestamp(t).strftime("%Y-%m"), round(c, 4)])
            price = meta.get("regularMarketPrice")
            if price is None and hist:
                price = hist[-1][1]
            return {"price": price, "currency": meta.get("currency"),
                    "date": dt.datetime.utcfromtimestamp(meta.get("regularMarketTime", time.time())).strftime("%Y-%m-%d"),
                    "history": hist, "source": "Yahoo Finance"}
        except Exception:
            time.sleep(2)
    return None


def stooq_prices(ticker):
    url = f"https://stooq.com/q/d/l/?s={ticker.lower().replace('.', '-')}.us&i=m"
    try:
        r = requests.get(url, headers={"User-Agent": BROWSER_UA}, timeout=20)
        if r.status_code != 200 or not r.text.startswith("Date"):
            return None
        hist = []
        for line in r.text.strip().splitlines()[1:]:
            p = line.split(",")
            if len(p) >= 5:
                hist.append([p[0][:7], float(p[4])])
        hist = hist[-121:]
        if not hist:
            return None
        return {"price": hist[-1][1], "currency": "USD", "date": dt.date.today().isoformat(),
                "history": hist, "source": "Stooq"}
    except Exception:
        return None


def fx_to_usd(ccy):
    """Dólares por unidad de la divisa (Yahoo)."""
    if ccy == "USD":
        return 1.0
    p = yahoo_prices(f"{ccy}USD=X")
    return p["price"] if p and p.get("price") else None


def get_prices(ticker):
    return yahoo_prices(ticker) or stooq_prices(ticker)


# ---------------------------------------------------------------------------
# Métricas para el screener (la ficha calcula las suyas en el navegador)
# ---------------------------------------------------------------------------

def _last(arr):
    if not arr:
        return None
    for v in reversed(arr):
        if v is not None:
            return v
    return None


def _div(a, b):
    try:
        if a is None or b in (None, 0):
            return None
        return a / b
    except Exception:
        return None


def summary_metrics(f, px, fxr=None):
    a = f["annual"]
    t = f["ttm"]
    g = lambda k: t.get(k) if t.get(k) is not None else _last(a.get(k))
    rev, op, ni, cfo, capex = g("revenue"), g("operatingIncome"), g("netIncome"), g("cfo"), g("capex")
    fcf = cfo - (capex or 0) if cfo is not None else None
    bs = f["latestBalance"]
    eq = bs.get("equity")
    ta, cl = bs.get("totalAssets"), bs.get("currentLiabilities")
    debt = (bs.get("ltDebtNoncurrent") or 0) + (bs.get("ltDebtCurrent") or 0) + (bs.get("stDebt") or 0)
    if not bs.get("ltDebtNoncurrent") and bs.get("ltDebtTotal"):
        debt = bs["ltDebtTotal"] + (bs.get("stDebt") or 0)
    cash = (bs.get("cash") or 0) + (bs.get("shortInvestments") or 0)
    price = px.get("price") if px else None
    shares = f.get("sharesOutstanding") or _last(a.get("sharesDiluted"))
    # pasamos el precio (en USD) a la divisa de los estados financieros
    if f["currency"] != "USD":
        price = price / fxr if price and fxr else None
    mc = price * shares if price and shares else None
    ev = mc + debt - cash if mc else None
    revs = [v for v in a.get("revenue", []) if v]
    g5 = None
    if len(revs) >= 6 and revs[-6] > 0 and revs[-1] > 0:
        g5 = (revs[-1] / revs[-6]) ** (1 / 5) - 1
    r = lambda x, n=4: round(x, n) if x is not None and math.isfinite(x) else None
    mc_usd = mc * fxr if mc and f["currency"] != "USD" and fxr else mc
    return {
        "mc": r(mc_usd, 0), "pe": r(_div(mc, ni) if ni and ni > 0 else None, 2),
        "pfcf": r(_div(mc, fcf) if fcf and fcf > 0 else None, 2),
        "evebit": r(_div(ev, op) if op and op > 0 else None, 2),
        "gm": r(_div(g("grossProfit") or ((rev - g("costOfRevenue")) if rev and g("costOfRevenue") else None), rev)),
        "om": r(_div(op, rev)), "nm": r(_div(ni, rev)), "fcfm": r(_div(fcf, rev)),
        "roe": r(_div(ni, eq) if eq and eq > 0 else None),
        "roce": r(_div(op, (ta - cl)) if ta and cl and ta > cl else None),
        "de": r(_div(debt, eq) if eq and eq > 0 else None, 2),
        "g5": r(g5), "dy": r(_div(abs(g("dividendsPaid") or 0), mc) if mc else None),
    }


# ---------------------------------------------------------------------------
# 13F
# ---------------------------------------------------------------------------
INVESTORS_FILE = ROOT / "scripts" / "investors.json"


def parse_infotable(xml_bytes):
    root = ET.fromstring(xml_bytes)
    rows = []
    for el in root.iter():
        if el.tag.split("}")[-1] != "infoTable":
            continue
        d = {}
        for ch in el.iter():
            tag = ch.tag.split("}")[-1]
            if ch.text and ch.text.strip():
                d[tag] = ch.text.strip()
        rows.append(d)
    return rows


def fetch_13f(cik, quarters=8):
    sub = sec_get(f"https://data.sec.gov/submissions/CIK{int(cik):010d}.json")
    if sub is None:
        return None
    sj = sub.json()
    rec = sj["filings"]["recent"]
    filings = []
    for form, acc, rdate, fdate in zip(rec["form"], rec["accessionNumber"], rec["reportDate"], rec["filingDate"]):
        if form == "13F-HR":
            filings.append((rdate, fdate, acc))
    # una presentación por trimestre (la más reciente)
    byq = {}
    for rdate, fdate, acc in filings:
        if rdate not in byq or fdate > byq[rdate][0]:
            byq[rdate] = (fdate, acc)
    qs = sorted(byq.items(), reverse=True)[:quarters]
    out = []
    for rdate, (fdate, acc) in qs:
        nodash = acc.replace("-", "")
        idx = sec_get(f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{nodash}/index.json")
        if idx is None:
            continue
        items = idx.json()["directory"]["item"]
        xmls = [it["name"] for it in items if it["name"].lower().endswith(".xml") and it["name"] != "primary_doc.xml"]
        rows = None
        for name in xmls:
            r = sec_get(f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{nodash}/{name}")
            if r is None:
                continue
            try:
                rows = parse_infotable(r.content)
            except ET.ParseError:
                rows = None
            if rows:
                break
        if not rows:
            continue
        mult = 1000 if rdate < "2022-12-31" else 1  # antes de 2023 el valor iba en miles de dólares
        agg = {}
        for x in rows:
            if x.get("putCall"):
                continue
            cusip = x.get("cusip", "").upper()
            if not cusip:
                continue
            a = agg.setdefault(cusip, {"cusip": cusip, "name": x.get("nameOfIssuer", ""),
                                       "cls": x.get("titleOfClass", ""), "value": 0, "shares": 0})
            a["value"] += float(x.get("value", 0) or 0) * mult
            if x.get("sshPrnamtType", "SH") == "SH":
                a["shares"] += float(x.get("sshPrnamt", 0) or 0)
        out.append({"period": rdate, "filed": fdate, "holdings": list(agg.values())})
    return {"name": sj.get("name"), "quarters": out}


_SUFFIXES = r"\b(INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|SA|NV|AG|SE|HLDGS?|HOLDINGS?|GROUP|GRP|THE|CL|CLASS|COM|NEW|DEL|ADR|SPONSORED|SPONS|ADS|LP|LLC|TR|TRUST)\b"


def norm_name(s):
    s = re.sub(r"[^A-Z0-9 ]", " ", s.upper())
    s = re.sub(_SUFFIXES, " ", s)
    return re.sub(r"\s+", " ", s).strip()


def map_cusips(cusips, name_by_cusip, tickers, cache_path):
    cache = {}
    if cache_path.exists():
        cache = json.loads(cache_path.read_text())
    todo = [c for c in cusips if c not in cache]
    # 1) OpenFIGI (gratis, sin clave: 25 peticiones/minuto, 10 CUSIP por petición)
    key = os.environ.get("OPENFIGI_API_KEY")
    batch = 100 if key else 10
    pause = 0.3 if key else 2.6
    for i in range(0, len(todo), batch):
        chunk = todo[i:i + batch]
        body = [{"idType": "ID_CUSIP", "idValue": c, "exchCode": "US"} for c in chunk]
        hdr = {"Content-Type": "application/json"}
        if key:
            hdr["X-OPENFIGI-APIKEY"] = key
        try:
            r = requests.post("https://api.openfigi.com/v3/mapping", json=body, headers=hdr, timeout=30)
            if r.status_code == 429:
                time.sleep(60)
                r = requests.post("https://api.openfigi.com/v3/mapping", json=body, headers=hdr, timeout=30)
            if r.status_code == 200:
                for c, res in zip(chunk, r.json()):
                    data = res.get("data") or []
                    tk = data[0].get("ticker") if data else None
                    cache[c] = tk.replace("/", ".").replace(" ", ".") if tk else None
        except Exception as e:
            print(f"  OpenFIGI error {e}", file=sys.stderr)
        time.sleep(pause)
    # 2) por nombre, para lo que quede sin resolver
    by_name = {}
    for t in tickers:
        by_name.setdefault(norm_name(t["name"]), t["ticker"])
    for c in cusips:
        if not cache.get(c):
            n = norm_name(name_by_cusip.get(c, ""))
            if n in by_name:
                cache[c] = by_name[n]
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(cache, indent=0, sort_keys=True))
    return cache


def build_investors(tickers, known_tickers):
    investors = json.loads(INVESTORS_FILE.read_text())
    (OUT / "investors").mkdir(parents=True, exist_ok=True)
    raw = {}
    for inv in investors:
        print(f"  13F {inv['manager']} ({inv['cik']})")
        try:
            d = fetch_13f(inv["cik"])
        except Exception as e:
            print(f"   error: {e}", file=sys.stderr)
            d = None
        if d and d["quarters"]:
            raw[inv["cik"]] = d
    cusips, names = set(), {}
    for d in raw.values():
        for q in d["quarters"]:
            for h in q["holdings"]:
                cusips.add(h["cusip"])
                names[h["cusip"]] = h["name"]
    cmap = map_cusips(sorted(cusips), names, tickers, CACHE / "cusip_map.json")

    holders = {}  # ticker -> lista de inversores
    index = []
    for inv in investors:
        d = raw.get(inv["cik"])
        if not d:
            continue
        qs = d["quarters"]
        for q in qs:
            tot = sum(h["value"] for h in q["holdings"]) or 1
            q["total"] = tot
            for h in q["holdings"]:
                h["ticker"] = cmap.get(h["cusip"])
                h["weight"] = h["value"] / tot
        # movimientos de cada trimestre frente al anterior
        for i, q in enumerate(qs):
            prev = {h["cusip"]: h for h in qs[i + 1]["holdings"]} if i + 1 < len(qs) else None
            cur = {h["cusip"] for h in q["holdings"]}
            for h in q["holdings"]:
                if prev is None:
                    h["chg"] = None
                elif h["cusip"] not in prev:
                    h["chg"] = "new"
                else:
                    ps = prev[h["cusip"]]["shares"]
                    h["chg"] = round(h["shares"] / ps - 1, 4) if ps else None
                    h["prevShares"] = ps
            if prev is not None:
                q["soldOut"] = [{"cusip": c, "name": p["name"], "ticker": cmap.get(c), "prevShares": p["shares"],
                                 "prevValue": p["value"]} for c, p in prev.items() if c not in cur]
            q["holdings"].sort(key=lambda h: -h["value"])
        latest = qs[0]
        index.append({"cik": inv["cik"], "manager": inv["manager"], "fund": d["name"], "style": inv.get("style", ""),
                      "period": latest["period"], "total": latest["total"], "positions": len(latest["holdings"]),
                      "top": [h.get("ticker") or h["name"] for h in latest["holdings"][:5]]})
        (OUT / "investors" / f"{inv['cik']}.json").write_text(
            json.dumps({**inv, "fund": d["name"], "quarters": qs}, separators=(",", ":")))
        for h in latest["holdings"]:
            tk = h.get("ticker")
            if tk:
                holders.setdefault(tk, []).append({"cik": inv["cik"], "manager": inv["manager"],
                                                   "weight": round(h["weight"], 5), "value": h["value"],
                                                   "shares": h["shares"], "chg": h.get("chg"),
                                                   "period": latest["period"]})
    index.sort(key=lambda x: -x["total"])
    (OUT / "investors" / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    return holders


# ---------------------------------------------------------------------------
# Principal
# ---------------------------------------------------------------------------

def load_tickers():
    r = sec_get("https://www.sec.gov/files/company_tickers_exchange.json")
    j = r.json()
    f = j["fields"]
    out = []
    seen = set()
    for row in j["data"]:
        d = dict(zip(f, row))
        t = (d["ticker"] or "").upper().replace("-", ".")
        if not t or t in seen:
            continue
        seen.add(t)
        out.append({"ticker": t, "cik": int(d["cik"]), "name": d["name"], "exchange": d.get("exchange") or ""})
    return out


def load_sic(ciks):
    """Sector (código SIC) desde el fichero masivo de 'submissions'."""
    try:
        p = download("https://www.sec.gov/Archives/edgar/daily-index/bulkdata/submissions.zip",
                     CACHE / "submissions.zip")
    except Exception as e:
        print(f"  sin sectores: {e}", file=sys.stderr)
        return {}
    res = {}
    with zipfile.ZipFile(p) as z:
        for cik in ciks:
            name = f"CIK{cik:010d}.json"
            try:
                d = json.loads(z.read(name))
            except KeyError:
                continue
            res[cik] = {"sic": d.get("sicDescription") or "", "fy": d.get("fiscalYearEnd") or "",
                        "web": d.get("website") or "", "state": d.get("stateOfIncorporation") or "",
                        "country": (d.get("addresses", {}).get("business", {}) or {}).get("stateOrCountryDescription") or ""}
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--tickers", default="")
    ap.add_argument("--skip-prices", action="store_true")
    ap.add_argument("--skip-13f", action="store_true")
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "c").mkdir(exist_ok=True)

    print("1/5 Lista de empresas")
    tickers = load_tickers()
    if args.tickers:
        want = {t.strip().upper() for t in args.tickers.split(",")}
        tickers = [t for t in tickers if t["ticker"] in want]
    elif args.limit:
        tickers = tickers[:args.limit]
    by_cik = {}
    for t in tickers:
        by_cik.setdefault(t["cik"], []).append(t)
    print(f"  {len(tickers)} tickers, {len(by_cik)} empresas")

    print("2/5 Fundamentales (SEC companyfacts)")
    fundamentals = {}
    small = len(by_cik) <= 200
    if small:
        for cik in by_cik:
            r = sec_get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json")
            if r is not None:
                try:
                    f = extract_company(r.json())
                    if f:
                        fundamentals[cik] = f
                except Exception as e:
                    print(f"  error CIK {cik}: {e}", file=sys.stderr)
    else:
        p = download("https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip", CACHE / "companyfacts.zip")
        with zipfile.ZipFile(p) as z:
            names = set(z.namelist())
            for n, cik in enumerate(by_cik):
                name = f"CIK{cik:010d}.json"
                if name not in names:
                    continue
                try:
                    f = extract_company(json.loads(z.read(name)))
                    if f:
                        fundamentals[cik] = f
                except Exception as e:
                    print(f"  error CIK {cik}: {e}", file=sys.stderr)
                if n % 1000 == 0:
                    print(f"  {n}/{len(by_cik)}")
    print(f"  {len(fundamentals)} empresas con fundamentales")

    print("3/5 Sectores")
    sic = load_sic(list(fundamentals)) if not small else {}
    if small:
        for cik in fundamentals:
            r = sec_get(f"https://data.sec.gov/submissions/CIK{cik:010d}.json")
            if r is not None:
                d = r.json()
                sic[cik] = {"sic": d.get("sicDescription") or "", "fy": d.get("fiscalYearEnd") or "",
                            "web": d.get("website") or "", "state": d.get("stateOfIncorporation") or "",
                            "country": (d.get("addresses", {}).get("business", {}) or {}).get("stateOrCountryDescription") or ""}

    print("4/5 Precios")
    tick_list = [t for t in tickers if t["cik"] in fundamentals]
    prices = {}
    if not args.skip_prices:
        done = [0]

        def job(t):
            p = get_prices(t["ticker"])
            done[0] += 1
            if done[0] % 500 == 0:
                print(f"  {done[0]}/{len(tick_list)}")
            return t["ticker"], p

        with cf.ThreadPoolExecutor(args.workers) as ex:
            for tk, p in ex.map(job, tick_list):
                if p:
                    prices[tk] = p
    print(f"  {len(prices)} con precio")
    fx = {}
    if not args.skip_prices:
        for ccy in sorted({f["currency"] for f in fundamentals.values()}):
            v = fx_to_usd(ccy)
            if v:
                fx[ccy] = v
    print(f"  divisas: {fx}")

    print("5/5 Grandes inversores (13F)")
    holders = {} if args.skip_13f else build_investors(load_tickers() if (args.limit or args.tickers) else tickers,
                                                        {t["ticker"] for t in tick_list})

    print("Escribiendo ficheros")
    index, screener = [], []
    for t in tick_list:
        f = fundamentals[t["cik"]]
        px = prices.get(t["ticker"])
        info = sic.get(t["cik"], {})
        doc = {"ticker": t["ticker"], "name": t["name"], "cik": t["cik"], "exchange": t["exchange"],
               "sector": info.get("sic", ""), "country": info.get("country", ""), "web": info.get("web", ""),
               **f, "price": px, "fxUSD": fx.get(f["currency"]), "holders": sorted(holders.get(t["ticker"], []), key=lambda h: -h["value"])}
        (OUT / "c" / f"{t['ticker']}.json").write_text(json.dumps(doc, separators=(",", ":"), allow_nan=False,
                                                                 default=lambda o: None))
        index.append([t["ticker"], t["name"], t["exchange"]])
        m = summary_metrics(f, px, fx.get(f["currency"]))
        screener.append({"t": t["ticker"], "n": t["name"], "s": info.get("sic", ""), "c": f["currency"],
                         "p": px.get("price") if px else None, **m, "h": len(holders.get(t["ticker"], []))})
    (OUT / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    (OUT / "screener.json").write_text(json.dumps(screener, separators=(",", ":")))
    (OUT / "meta.json").write_text(json.dumps({"updated": dt.datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
                                               "companies": len(index), "withPrice": len(prices)}))
    print(f"Listo: {len(index)} empresas")


if __name__ == "__main__":
    main()
