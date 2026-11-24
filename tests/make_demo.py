"""Genera datos FICTICIOS con el mismo formato que la web, para probar la interfaz sin conexión.
Uso: python tests/make_demo.py <carpeta_salida>
"""
import datetime as dt
import json
import math
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import build_data as bd  # noqa: E402
from test_extract import dur, inst  # noqa: E402

out = Path(sys.argv[1])
(out / "c").mkdir(parents=True, exist_ok=True)
(out / "investors").mkdir(parents=True, exist_ok=True)
random.seed(1)


def fake_company(seed, rev0, g, margin, ccy="USD"):
    random.seed(seed)
    tags = {}
    def add(tag, entries, unit=ccy, tax="us-gaap"):
        tags.setdefault(tax, {}).setdefault(tag, {"units": {}})["units"][unit] = entries
    rev, years = rev0, range(2012, 2025)
    R, OP, NI, CFO, CAP, EPS, SH, DNA, TAX, PRE, DIV, A, EQ, CL, CA, CASH, LTD, INT, GP, SBC = ([] for _ in range(20))
    shares = 1000e6
    for y in years:
        rev *= 1 + g + random.uniform(-0.04, 0.04)
        op = rev * (margin + random.uniform(-0.02, 0.02))
        ni = op * 0.78
        shares *= 0.985
        s, e = f"{y}-01-01", f"{y}-12-31"
        R.append(dur(rev, s, e)); OP.append(dur(op, s, e)); NI.append(dur(ni, s, e)); GP.append(dur(rev * 0.55, s, e))
        CFO.append(dur(ni * 1.2, s, e)); CAP.append(dur(rev * 0.04, s, e)); DNA.append(dur(rev * 0.03, s, e))
        PRE.append(dur(op * 0.98, s, e)); TAX.append(dur(op * 0.2, s, e)); DIV.append(dur(ni * 0.35, s, e))
        INT.append(dur(rev * 0.005, s, e)); SBC.append(dur(rev * 0.01, s, e))
        EPS.append(dur(round(ni / shares, 2), s, e)); SH.append(dur(shares, s, e))
        A.append(inst(rev * 1.3, e)); EQ.append(inst(rev * 0.6, e)); CL.append(inst(rev * 0.25, e)); CA.append(inst(rev * 0.5, e))
        CASH.append(inst(rev * 0.15, e)); LTD.append(inst(rev * 0.3, e))
    # 3 trimestres de 2025
    R += [dur(rev * 0.8, "2025-01-01", "2025-09-30", "10-Q", "2025-11-01"), dur(rev * 0.74, "2024-01-01", "2024-09-30", "10-Q", "2025-11-01")]
    for tag, en in [("Revenues", R), ("OperatingIncomeLoss", OP), ("NetIncomeLoss", NI), ("GrossProfit", GP),
                    ("NetCashProvidedByUsedInOperatingActivities", CFO), ("PaymentsToAcquirePropertyPlantAndEquipment", CAP),
                    ("DepreciationDepletionAndAmortization", DNA), ("IncomeTaxExpenseBenefit", TAX), ("PaymentsOfDividends", DIV),
                    ("IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", PRE),
                    ("InterestExpense", INT), ("ShareBasedCompensation", SBC),
                    ("Assets", A), ("StockholdersEquity", EQ), ("LiabilitiesCurrent", CL), ("AssetsCurrent", CA),
                    ("CashAndCashEquivalentsAtCarryingValue", CASH), ("LongTermDebtNoncurrent", LTD)]:
        add(tag, en)
    add("EarningsPerShareDiluted", EPS, f"{ccy}/shares")
    add("WeightedAverageNumberOfDilutedSharesOutstanding", SH, "shares")
    add("EntityCommonStockSharesOutstanding", [{"end": "2025-10-15", "val": shares, "filed": "2025-11-01"}], "shares", "dei")
    f = bd.extract_company({"facts": tags})
    eps = f["annual"]["epsDiluted"][-1]
    hist, p = [], eps * 22
    for i in range(120):
        y, m = 2015 + i // 12, i % 12 + 1
        hist.append([f"{y}-{m:02d}", round(p * (0.4 + 0.6 * i / 119) * (1 + 0.05 * math.sin(i / 4)), 2)])
    price = {"price": hist[-1][1], "currency": "USD", "date": "2025-11-21", "history": hist, "source": "demo"}
    return f, price


companies = [("DEMO", "Empresa Ejemplo de Calidad (FICTICIA)", 1, 20e9, 0.08, 0.25),
             ("LENTA", "Industrial Lenta (FICTICIA)", 2, 50e9, 0.02, 0.08),
             ("EURO", "Europea en Euros (FICTICIA)", 3, 10e9, 0.05, 0.15)]
index, screener = [], []
for t, n, seed, r0, g, m in companies:
    ccy = "EUR" if t == "EURO" else "USD"
    f, px = fake_company(seed, r0, g, m, ccy)
    holders = [{"cik": 1, "manager": "Inversor Ficticio A", "weight": 0.12, "value": 5e9, "shares": 2e7, "chg": "new", "period": "2025-09-30"}] if t == "DEMO" else []
    insiders = None
    ago = lambda n: (dt.date.today() - dt.timedelta(days=n)).isoformat()
    if t == "DEMO":
        insiders = {"owners": [{"n": "PEREZ ANA (FICTICIA)", "r": "Chief Executive Officer, Consejero", "s": 3.2e6, "sd": 2.9e6, "d": ago(10), "cl": 1},
                               {"n": "GOMEZ LUIS (FICTICIO)", "r": "Chief Financial Officer", "s": 410000, "sd": 410000, "d": ago(50), "cl": 1},
                               {"n": "RUIZ MARTA (FICTICIA)", "r": "Consejero", "s": 52000, "sd": 52000, "d": ago(100), "cl": 1}],
                    "tx": [{"d": ago(12), "n": "PEREZ ANA (FICTICIA)", "r": "Chief Executive Officer, Consejero", "c": "S", "s": 50000, "p": px["price"], "a": "D", "o": 2.9e6, "i": 0, "pl": 1},
                           {"d": ago(51), "n": "GOMEZ LUIS (FICTICIO)", "r": "Chief Financial Officer", "c": "F", "s": 3000, "p": px["price"] * 0.95, "a": "D", "o": 410000, "i": 0, "pl": 0},
                           {"d": ago(101), "n": "RUIZ MARTA (FICTICIA)", "r": "Consejero", "c": "P", "s": 4000, "p": px["price"] * 0.9, "a": "A", "o": 52000, "i": 0, "pl": 0},
                           {"d": ago(270), "n": "GOMEZ LUIS (FICTICIO)", "r": "Chief Financial Officer", "c": "A", "s": 20000, "p": None, "a": "A", "o": 413000, "i": 0, "pl": 0}],
                    "lastFiled": ago(10), "nTx": 4, "nPS": 2}
    fx = 1.08 if ccy == "EUR" else 1
    doc = {"ticker": t, "name": n, "cik": seed, "exchange": "NYSE", "sector": "Sector ficticio", "country": "", "web": "",
           **f, "price": px, "fxUSD": fx, "holders": holders, "insiders": insiders}
    (out / "c" / f"{t}.json").write_text(json.dumps(doc))
    index.append([t, n, "NYSE"])
    screener.append({"t": t, "n": n, "s": "Sector ficticio", "c": ccy, "p": px["price"], **bd.summary_metrics(f, px, fx), "h": len(holders)})
(out / "index.json").write_text(json.dumps(index))
(out / "screener.json").write_text(json.dumps(screener))
(out / "meta.json").write_text(json.dumps({"updated": "DEMO (datos ficticios)", "companies": 3, "withPrice": 3}))

q = lambda period, hs, sold=None: {"period": period, "filed": period[:8] + "14", "total": sum(h["value"] for h in hs), "holdings": hs, **({"soldOut": sold} if sold is not None else {})}
h1 = [{"cusip": "X1", "name": "EMPRESA EJEMPLO", "cls": "COM", "value": 5e9, "shares": 2e7, "ticker": "DEMO", "weight": 0.5, "chg": "new"},
      {"cusip": "X2", "name": "INDUSTRIAL LENTA", "cls": "COM", "value": 3e9, "shares": 1e7, "ticker": "LENTA", "weight": 0.3, "chg": 0.25},
      {"cusip": "X3", "name": "SIN TICKER CORP", "cls": "COM", "value": 2e9, "shares": 5e6, "ticker": None, "weight": 0.2, "chg": -0.4}]
h0 = [{"cusip": "X2", "name": "INDUSTRIAL LENTA", "cls": "COM", "value": 2e9, "shares": 8e6, "ticker": "LENTA", "weight": 0.4, "chg": None},
      {"cusip": "X3", "name": "SIN TICKER CORP", "cls": "COM", "value": 3e9, "shares": 8.3e6, "ticker": None, "weight": 0.6, "chg": None}]
inv = {"cik": 1, "manager": "Inversor Ficticio A", "style": "Demo", "fund": "FICTICIO CAPITAL LLC",
       "quarters": [q("2025-09-30", h1, [{"cusip": "X9", "name": "VENDIDA INC", "ticker": None, "prevShares": 1, "prevValue": 1}]), q("2025-06-30", h0)]}
(out / "investors" / "1.json").write_text(json.dumps(inv))
(out / "investors" / "index.json").write_text(json.dumps([{"cik": 1, "manager": "Inversor Ficticio A", "fund": "FICTICIO CAPITAL LLC", "style": "Demo",
                                                          "period": "2025-09-30", "total": 1e10, "positions": 3, "top": ["DEMO", "LENTA"]}]))
print("demo ok", out)
