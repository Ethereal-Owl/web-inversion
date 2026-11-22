"""Pruebas del procesado de datos con un 'companyfacts' sintético con el mismo formato que la SEC."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import build_data as bd  # noqa: E402


def dur(val, start, end, form="10-K", filed=None, fp="FY"):
    return {"start": start, "end": end, "val": val, "form": form, "filed": filed or end[:4] + "-12-31", "fp": fp}


def inst(val, end, form="10-K", filed=None):
    return {"end": end, "val": val, "form": form, "filed": filed or end[:4] + "-12-31"}


def make_facts():
    rev_old = [dur(100, "2015-01-01", "2015-12-31"), dur(110, "2016-01-01", "2016-12-31")]
    # cambio de etiqueta en 2017 (como hacen muchas empresas con ASC 606)
    rev_new = [dur(120 + 10 * i, f"{2017 + i}-01-01", f"{2017 + i}-12-31") for i in range(8)]  # 2017..2024
    rev_new += [dur(90, "2025-01-01", "2025-09-30", "10-Q", "2025-11-01", "Q3"),
                dur(80, "2024-01-01", "2024-09-30", "10-Q", "2025-11-01", "Q3"),
                dur(30, "2025-07-01", "2025-09-30", "10-Q", "2025-11-01", "Q3")]
    # reformulación: 2018 re-presentado más tarde con otro valor
    rev_new.append(dur(131, "2018-01-01", "2018-12-31", filed="2020-02-01"))
    op = [dur(20 + i, f"{2015 + i}-01-01", f"{2015 + i}-12-31") for i in range(10)]
    ni = [dur(15 + i, f"{2015 + i}-01-01", f"{2015 + i}-12-31") for i in range(10)]
    cfo = [dur(25 + i, f"{2015 + i}-01-01", f"{2015 + i}-12-31") for i in range(10)]
    capex = [dur(5, f"{2015 + i}-01-01", f"{2015 + i}-12-31") for i in range(10)]
    assets = [inst(500 + 10 * i, f"{2015 + i}-12-31") for i in range(10)] + [inst(600, "2025-09-30", "10-Q")]
    eq = [inst(200 + 5 * i, f"{2015 + i}-12-31") for i in range(10)]
    cl = [inst(100, f"{2015 + i}-12-31") for i in range(10)]
    eps = [dur(1.5 + i * 0.1, f"{2015 + i}-01-01", f"{2015 + i}-12-31") for i in range(10)]
    return {
        "cik": 1, "entityName": "TEST",
        "facts": {
            "dei": {"EntityCommonStockSharesOutstanding": {"units": {"shares": [
                {"end": "2025-10-20", "val": 6, "filed": "2025-11-01"},
                {"end": "2025-10-20", "val": 4, "filed": "2025-11-01"}]}}},
            "us-gaap": {
                "SalesRevenueNet": {"units": {"USD": rev_old}},
                "Revenues": {"units": {"USD": rev_new}},
                "OperatingIncomeLoss": {"units": {"USD": op}},
                "NetIncomeLoss": {"units": {"USD": ni}},
                "NetCashProvidedByUsedInOperatingActivities": {"units": {"USD": cfo}},
                "PaymentsToAcquirePropertyPlantAndEquipment": {"units": {"USD": capex}},
                "Assets": {"units": {"USD": assets}},
                "StockholdersEquity": {"units": {"USD": eq}},
                "LiabilitiesCurrent": {"units": {"USD": cl}},
                "EarningsPerShareDiluted": {"units": {"USD/shares": eps}},
            },
        },
    }


def test_extract():
    f = bd.extract_company(make_facts())
    assert f["currency"] == "USD"
    assert f["years"][0] == "2015-12-31" and f["years"][-1] == "2024-12-31", f["years"]
    rev = f["annual"]["revenue"]
    assert rev[0] == 100 and rev[1] == 110 and rev[2] == 120, rev  # mezcla de etiquetas
    assert rev[3] == 131, rev  # usa la reformulación más reciente
    assert rev[-1] == 190
    # TTM = 190 + 90 - 80
    assert f["ttm"]["revenue"] == 200, f["ttm"]
    assert f["ttmEnd"] == "2025-09-30"
    assert f["latestBalance"]["totalAssets"] == 600
    assert f["sharesOutstanding"] == 10  # suma de clases
    assert f["annual"]["epsDiluted"][-1] == 2.4
    m = bd.summary_metrics(f, {"price": 50})
    assert m["mc"] == 500
    print("OK", json.dumps(m))


def test_ifrs_currency():
    facts = {"facts": {"ifrs-full": {
        "Revenue": {"units": {"EUR": [dur(1000 + i, f"{2018 + i}-01-01", f"{2018 + i}-12-31", "20-F") for i in range(5)]}},
        "ProfitLoss": {"units": {"EUR": [dur(100, f"{2018 + i}-01-01", f"{2018 + i}-12-31", "20-F") for i in range(5)]}},
    }}}
    f = bd.extract_company(facts)
    assert f["currency"] == "EUR" and f["annual"]["revenue"][-1] == 1004
    print("OK ifrs")


def test_13f_parse():
    xml = b"""<?xml version="1.0"?><informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable">
    <infoTable><nameOfIssuer>APPLE INC</nameOfIssuer><titleOfClass>COM</titleOfClass><cusip>037833100</cusip>
    <value>1000</value><shrsOrPrnAmt><sshPrnamt>10</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt></infoTable>
    </informationTable>"""
    rows = bd.parse_infotable(xml)
    assert rows[0]["cusip"] == "037833100" and rows[0]["sshPrnamt"] == "10"
    assert bd.norm_name("APPLE INC") == bd.norm_name("Apple Inc.") == "APPLE"
    print("OK 13f")


if __name__ == "__main__":
    test_extract()
    test_ifrs_currency()
    test_13f_parse()
