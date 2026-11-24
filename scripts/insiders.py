"""Directivos y consejeros (insiders): acciones que poseen y compras/ventas recientes.

Fuentes (gratis, SEC EDGAR, formularios 3, 4 y 5):
  1. Conjuntos de datos trimestrales de la SEC «Insider Transactions Data Sets»
     (un zip por trimestre con todos los formularios presentados en ese trimestre).
  2. Para los días posteriores al último trimestre publicado: cada formulario 4 en XML,
     localizado en la lista de presentaciones de cada empresa (submissions). Se guardan
     en caché entre ejecuciones y en cada ejecución se descargan como máximo `max_fetch`.
"""
import csv
import datetime as dt
import gzip
import io
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

# La SEC ha cambiado la carpeta: desde 2026T2 está en «datastandardsinnovation». Se prueban las dos.
DATASET_URLS = ["https://www.sec.gov/files/datastandardsinnovation/data/insider-transactions-data-sets/{y}q{q}_form345.zip",
                "https://www.sec.gov/files/structureddata/data/insider-transactions-data-sets/{y}q{q}_form345.zip"]
WINDOW_DAYS = 366          # operaciones que se muestran
HOLD_DAYS = 3 * 365        # antigüedad máxima de un formulario para contar las acciones que posee
MAX_TX = 150               # filas máximas por empresa

csv.field_size_limit(10 ** 8)


# ---------------------------------------------------------------------------
# utilidades
# ---------------------------------------------------------------------------
def parse_date(s):
    s = (s or "").strip()
    if not s:
        return None
    for f in ("%Y-%m-%d", "%d-%b-%Y", "%Y%m%d", "%m/%d/%Y"):
        try:
            return dt.datetime.strptime(s[:11] if f == "%d-%b-%Y" else s[:10], f).date().isoformat()
        except ValueError:
            pass
    m = re.match(r"(\d{4}-\d{2}-\d{2})", s)
    return m.group(1) if m else None


def num(s):
    try:
        v = float(str(s).replace(",", "").strip())
        return v if v == v else None
    except (TypeError, ValueError):
        return None


def role_of(director, officer, ten, other, title):
    parts = []
    if officer:
        parts.append((title or "Directivo").strip())
    if director:
        parts.append("Consejero")
    if ten:
        parts.append("Accionista >10 %")
    if other and not parts:
        parts.append((title or "Otro").strip())
    return ", ".join(parts) or (title or "").strip()


def share_class(title):
    """'Class A Common Stock, par value $0.001' -> 'A'; 'Common Stock' -> 'común'."""
    m = re.search(r"\bclass\s+([a-z0-9])\b", (title or "").lower())
    if m:
        return m.group(1).upper()
    m = re.search(r"\bseries\s+([a-z0-9])\b", (title or "").lower())
    return m.group(1).upper() if m else "común"


def truthy(v):
    return str(v or "").strip().lower() in ("1", "true", "y", "yes", "x")


# ---------------------------------------------------------------------------
# 1) conjuntos de datos trimestrales
# ---------------------------------------------------------------------------
def _quarters_back(today, n):
    y, q = today.year, (today.month - 1) // 3 + 1
    out = []
    for _ in range(n):
        out.append((y, q))
        q -= 1
        if q == 0:
            y, q = y - 1, 4
    return out


def _read_tsv(z, name):
    match = [n for n in z.namelist() if n.upper().endswith(name.upper())]
    if not match:
        return
    with z.open(match[0]) as fh:
        rd = csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8", errors="replace"), delimiter="\t",
                            quoting=csv.QUOTE_NONE)
        for row in rd:
            yield {k.strip().upper(): (v or "").strip() for k, v in row.items() if k}


def parse_dataset(path, issuer_ciks):
    """Devuelve {accession: filing} de un zip trimestral, solo para los emisores pedidos."""
    filings = {}
    with zipfile.ZipFile(path) as z:
        for r in _read_tsv(z, "SUBMISSION.tsv"):
            try:
                icik = int(r.get("ISSUERCIK") or 0)
            except ValueError:
                continue
            form = r.get("DOCUMENT_TYPE", "")
            if icik not in issuer_ciks or form not in ("3", "4", "5"):
                continue
            filings[r["ACCESSION_NUMBER"]] = {
                "issuer": icik, "form": form, "filed": parse_date(r.get("FILING_DATE")),
                "plan": truthy(r.get("AFF10B5ONE")), "owners": [], "rows": []}
        for r in _read_tsv(z, "REPORTINGOWNER.tsv"):
            f = filings.get(r.get("ACCESSION_NUMBER"))
            if f is None:
                continue
            rel = (r.get("RPTOWNER_RELATIONSHIP") or "").lower()
            f["owners"].append({
                "cik": (r.get("RPTOWNERCIK") or "").lstrip("0"), "name": r.get("RPTOWNERNAME", ""),
                "role": role_of("director" in rel, "officer" in rel, "tenpercent" in rel.replace(" ", ""),
                                "other" in rel, r.get("RPTOWNER_TITLE") or r.get("RPTOWNER_TXT"))})
        for r in _read_tsv(z, "NONDERIV_TRANS.tsv"):
            f = filings.get(r.get("ACCESSION_NUMBER"))
            if f is None:
                continue
            f["rows"].append({"k": "T", "sec": r.get("SECURITY_TITLE", ""), "date": parse_date(r.get("TRANS_DATE")),
                              "code": r.get("TRANS_CODE", ""), "sh": num(r.get("TRANS_SHARES")),
                              "px": num(r.get("TRANS_PRICEPERSHARE")), "ad": r.get("TRANS_ACQUIRED_DISP_CD", ""),
                              "after": num(r.get("SHRS_OWND_FOLWNG_TRANS")),
                              "di": r.get("DIRECT_INDIRECT_OWNERSHIP", "D") or "D",
                              "nat": r.get("NATURE_OF_OWNERSHIP", "")})
        for r in _read_tsv(z, "NONDERIV_HOLDING.tsv"):
            f = filings.get(r.get("ACCESSION_NUMBER"))
            if f is None:
                continue
            f["rows"].append({"k": "H", "sec": r.get("SECURITY_TITLE", ""), "date": None, "code": "",
                              "sh": None, "px": None, "ad": "", "after": num(r.get("SHRS_OWND_FOLWNG_TRANS")),
                              "di": r.get("DIRECT_INDIRECT_OWNERSHIP", "D") or "D",
                              "nat": r.get("NATURE_OF_OWNERSHIP", "")})
    return filings


def load_datasets(download, cache_dir, issuer_ciks, today, n_quarters=4):
    """Descarga los últimos trimestres publicados. Devuelve (filings, última fecha cubierta)."""
    filings, covered_until, got = {}, None, 0
    for y, q in _quarters_back(today, n_quarters + 2):
        if got >= n_quarters:
            break
        end = dt.date(y, 3 * q, 1) + dt.timedelta(days=31)
        end = end.replace(day=1) - dt.timedelta(days=1)
        if end >= today:  # el trimestre en curso todavía no se ha publicado
            continue
        p, err = None, None
        for url in DATASET_URLS:
            try:
                p = download(url.format(y=y, q=q), cache_dir / f"form345_{y}q{q}.zip", max_age_hours=24 * 20)
                break
            except Exception as e:
                err = e
        if p is None:
            print(f"  sin datos de directivos {y}T{q}: {err}", file=sys.stderr)
            if got:  # hay un hueco más antiguo: no seguir
                break
            continue
        try:
            part = parse_dataset(p, issuer_ciks)
        except Exception as e:
            print(f"  error leyendo {p.name}: {e}", file=sys.stderr)
            continue
        print(f"  directivos {y}T{q}: {len(part)} formularios")
        filings.update(part)
        got += 1
        covered_until = max(covered_until or end, end) if covered_until else end
    return filings, covered_until


# ---------------------------------------------------------------------------
# 2) formularios 4 recientes (XML)
# ---------------------------------------------------------------------------
def _t(el, path):
    x = el.find(path)
    if x is None:
        return ""
    v = x.find("value")
    if v is not None:
        x = v
    return (x.text or "").strip()


def parse_form4_xml(text):
    """Lee un formulario 3/4/5 en XML (ownershipDocument)."""
    m = re.search(r"<ownershipDocument.*?</ownershipDocument>", text, re.S)
    if not m:
        return None
    root = ET.fromstring(m.group(0))
    try:
        icik = int(_t(root, "issuer/issuerCik") or 0)
    except ValueError:
        icik = 0
    f = {"issuer": icik, "form": _t(root, "documentType"), "filed": None,
         "plan": truthy(_t(root, "aff10b5One")), "owners": [], "rows": []}
    for o in root.findall("reportingOwner"):
        rel = o.find("reportingOwnerRelationship")
        g = (lambda k: truthy(_t(rel, k))) if rel is not None else (lambda k: False)
        f["owners"].append({"cik": _t(o, "reportingOwnerId/rptOwnerCik").lstrip("0"),
                            "name": _t(o, "reportingOwnerId/rptOwnerName"),
                            "role": role_of(g("isDirector"), g("isOfficer"), g("isTenPercentOwner"), g("isOther"),
                                            (_t(rel, "officerTitle") or _t(rel, "otherText")) if rel is not None else "")})
    for tr in root.iter("nonDerivativeTransaction"):
        f["rows"].append({"k": "T", "sec": _t(tr, "securityTitle"), "date": parse_date(_t(tr, "transactionDate")),
                          "code": _t(tr, "transactionCoding/transactionCode"),
                          "sh": num(_t(tr, "transactionAmounts/transactionShares")),
                          "px": num(_t(tr, "transactionAmounts/transactionPricePerShare")),
                          "ad": _t(tr, "transactionAmounts/transactionAcquiredDisposedCode"),
                          "after": num(_t(tr, "postTransactionAmounts/sharesOwnedFollowingTransaction")),
                          "di": _t(tr, "ownershipNature/directOrIndirectOwnership") or "D",
                          "nat": _t(tr, "ownershipNature/natureOfOwnership")})
    for h in root.iter("nonDerivativeHolding"):
        f["rows"].append({"k": "H", "sec": _t(h, "securityTitle"), "date": None, "code": "", "sh": None, "px": None,
                          "ad": "", "after": num(_t(h, "postTransactionAmounts/sharesOwnedFollowingTransaction")),
                          "di": _t(h, "ownershipNature/directOrIndirectOwnership") or "D",
                          "nat": _t(h, "ownershipNature/natureOfOwnership")})
    return f


def recent_list(submissions, since):
    """Formularios 3/4 de una empresa presentados después de `since`, según su JSON de submissions."""
    rec = (submissions or {}).get("filings", {}).get("recent", {})
    out = []
    for form, acc, fdate, doc in zip(rec.get("form", []), rec.get("accessionNumber", []),
                                     rec.get("filingDate", []), rec.get("primaryDocument", [])):
        if form in ("3", "4") and fdate > since and doc:
            out.append((fdate, acc, doc.split("/")[-1]))
    return out


def fetch_recent(sec_get, todo, cache_path, since, max_fetch):
    """todo: lista de (fecha, issuer_cik, accession, documento). Usa y actualiza la caché."""
    cache = {}
    if cache_path.exists():
        try:
            cache = json.loads(gzip.decompress(cache_path.read_bytes()))
        except Exception:
            cache = {}
    cache = {k: v for k, v in cache.items() if (v or {}).get("filed", "9999") > since}
    pending = sorted((x for x in todo if x[2] not in cache), reverse=True)
    print(f"  formularios recientes: {len(todo)} ({len(todo) - len(pending)} en caché, "
          f"se descargan {min(len(pending), max_fetch)} de {len(pending)})")
    for n, (fdate, icik, acc, doc) in enumerate(pending[:max_fetch]):
        url = f"https://www.sec.gov/Archives/edgar/data/{icik}/{acc.replace('-', '')}/{doc}"
        r = sec_get(url)
        f = None
        if r is not None:
            try:
                f = parse_form4_xml(r.text)
            except ET.ParseError:
                f = None
        if f:
            f["filed"] = fdate
            f["issuer"] = f["issuer"] or icik
            cache[acc] = f
        if n and n % 1000 == 0:
            print(f"   {n}/{min(len(pending), max_fetch)}")
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_bytes(gzip.compress(json.dumps(cache, separators=(",", ":")).encode()))
    missing = len(pending) - min(len(pending), max_fetch)
    return cache, missing


# ---------------------------------------------------------------------------
# 3) resumen por empresa
# ---------------------------------------------------------------------------
def summarize(filings, today):
    """filings: iterable de formularios ya leídos. Devuelve {issuer_cik: {...}} para la web."""
    cut_tx = (today - dt.timedelta(days=WINDOW_DAYS)).isoformat()
    cut_hold = (today - dt.timedelta(days=HOLD_DAYS)).isoformat()
    by_issuer = {}
    for acc, f in filings.items():
        if not f.get("owners") or not f.get("filed") or f.get("form", "").endswith("/A"):
            continue
        by_issuer.setdefault(f["issuer"], []).append((f["filed"], acc, f))
    out = {}
    for icik, fl in by_issuer.items():
        fl.sort(key=lambda x: (x[0], x[1]))
        owners, tx, last_filed = {}, [], None
        for filed, acc, f in fl:
            if filed < cut_hold:
                continue
            last_filed = max(last_filed or filed, filed)
            o = f["owners"][0]
            key = o["cik"] or o["name"]
            name = o["name"] + (" y otros" if len(f["owners"]) > 1 else "")
            ow = owners.setdefault(key, {"n": name, "r": o["role"], "pos": {}, "d": filed})
            if o["role"]:
                ow["r"] = o["role"]
            ow["d"] = filed
            for r in f["rows"]:
                if r["after"] is not None:
                    pos_key = (share_class(r["sec"]), r["di"].upper()[:1], re.sub(r"\W+", " ", r["nat"].lower()).strip())
                    ow["pos"][pos_key] = r["after"]
                if r["k"] == "T" and r["date"] and r["date"] >= cut_tx and r["sh"]:
                    tx.append({"d": r["date"], "f": filed, "n": name, "r": o["role"], "c": r["code"][:1],
                               "s": r["sh"], "p": r["px"] if r["px"] else None, "a": r["ad"][:1] or None,
                               "o": r["after"], "i": 1 if r["di"].upper().startswith("I") else 0,
                               "pl": 1 if f["plan"] else 0})
        if not owners and not tx:
            continue
        own_list = []
        for ow in owners.values():
            total = sum(v for v in ow["pos"].values() if v)
            direct = sum(v for (s, di, nat), v in ow["pos"].items() if v and not di.upper().startswith("I"))
            classes = sorted({s for (s, di, nat), v in ow["pos"].items() if v})
            own_list.append({"n": ow["n"], "r": ow["r"], "s": total, "sd": direct, "d": ow["d"],
                             "cl": len(classes)})
        own_list.sort(key=lambda x: -x["s"])
        tx.sort(key=lambda x: (x["d"], x["f"]), reverse=True)
        ps = [t for t in tx if t["c"] in ("P", "S")]
        other = [t for t in tx if t["c"] not in ("P", "S")]
        keep = ps[:MAX_TX] + other[:max(30, MAX_TX - len(ps))]
        keep.sort(key=lambda x: (x["d"], x["f"]), reverse=True)
        for t in keep:
            t.pop("f", None)
        out[icik] = {"owners": own_list[:40], "tx": keep, "lastFiled": last_filed,
                     "nTx": len(tx), "nPS": len(ps)}
    return out


def build(issuer_ciks, sec_get, download, cache_dir, submissions_of, today=None, max_fetch=6000):
    """Punto de entrada. submissions_of(cik) -> JSON de submissions (o None)."""
    today = today or dt.date.today()
    filings, covered = load_datasets(download, cache_dir, issuer_ciks, today)
    since = (covered or (today - dt.timedelta(days=120))).isoformat()
    print(f"  trimestres hasta {covered}; formularios recientes desde {since}")
    todo = []
    for cik in issuer_ciks:
        try:
            for fdate, acc, doc in recent_list(submissions_of(cik), since):
                todo.append((fdate, cik, acc, doc))
        except Exception as e:
            print(f"  submissions {cik}: {e}", file=sys.stderr)
    recent, missing = fetch_recent(sec_get, todo, cache_dir / "insiders_recent.json.gz", since, max_fetch)
    for acc, f in recent.items():
        if f.get("issuer") in issuer_ciks:
            filings[acc] = f
    res = summarize(filings, today)
    meta = {"datasetsUntil": covered.isoformat() if covered else None, "pendingRecent": missing}
    print(f"  {len(res)} empresas con datos de directivos (pendientes: {missing})")
    return res, meta
