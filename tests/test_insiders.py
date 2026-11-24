"""Pruebas de la lectura de formularios de directivos (formularios 3/4/5 de la SEC)."""
import datetime as dt
import io
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import insiders as ins  # noqa: E402

FORM4 = """<?xml version="1.0"?>
<ownershipDocument>
  <schemaVersion>X0508</schemaVersion>
  <documentType>4</documentType>
  <periodOfReport>2026-10-15</periodOfReport>
  <aff10b5One>1</aff10b5One>
  <issuer><issuerCik>0000320193</issuerCik><issuerName>Apple Inc.</issuerName><issuerTradingSymbol>AAPL</issuerTradingSymbol></issuer>
  <reportingOwner>
    <reportingOwnerId><rptOwnerCik>0001214156</rptOwnerCik><rptOwnerName>COOK TIMOTHY D</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isDirector>1</isDirector><isOfficer>1</isOfficer><officerTitle>Chief Executive Officer</officerTitle></reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <securityTitle><value>Common Stock</value></securityTitle>
      <transactionDate><value>2026-10-15</value></transactionDate>
      <transactionCoding><transactionFormType>4</transactionFormType><transactionCode>S</transactionCode></transactionCoding>
      <transactionAmounts><transactionShares><value>1000</value></transactionShares>
        <transactionPricePerShare><value>250.5</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode></transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>9000</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
      <ownershipNature><directOrIndirectOwnership><value>D</value></directOrIndirectOwnership></ownershipNature>
    </nonDerivativeTransaction>
    <nonDerivativeHolding>
      <securityTitle><value>Common Stock, par value $0.00001</value></securityTitle>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>500</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
      <ownershipNature><directOrIndirectOwnership><value>I</value></directOrIndirectOwnership><natureOfOwnership><value>By Trust</value></natureOfOwnership></ownershipNature>
    </nonDerivativeHolding>
  </nonDerivativeTable>
</ownershipDocument>"""


def make_zip():
    tsv = lambda rows: "\n".join("\t".join(r) for r in rows) + "\n"
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        z.writestr("SUBMISSION.tsv", tsv([
            ["ACCESSION_NUMBER", "FILING_DATE", "PERIOD_OF_REPORT", "DOCUMENT_TYPE", "ISSUERCIK", "ISSUERNAME", "ISSUERTRADINGSYMBOL"],
            ["0001-26-000001", "05-AUG-2026", "03-AUG-2026", "4", "0000320193", "Apple Inc.", "AAPL"],
            ["0001-26-000002", "06-AUG-2026", "04-AUG-2026", "4", "0000999999", "Otra", "OTRA"]]))
        z.writestr("REPORTINGOWNER.tsv", tsv([
            ["ACCESSION_NUMBER", "RPTOWNERCIK", "RPTOWNERNAME", "RPTOWNER_RELATIONSHIP", "RPTOWNER_TITLE"],
            ["0001-26-000001", "0001214156", "COOK TIMOTHY D", "Director,Officer", "Chief Executive Officer"],
            ["0001-26-000002", "0000000005", "X", "Director", ""]]))
        z.writestr("NONDERIV_TRANS.tsv", tsv([
            ["ACCESSION_NUMBER", "NONDERIV_TRANS_SK", "SECURITY_TITLE", "TRANS_DATE", "TRANS_CODE", "TRANS_SHARES",
             "TRANS_PRICEPERSHARE", "TRANS_ACQUIRED_DISP_CD", "SHRS_OWND_FOLWNG_TRANS", "DIRECT_INDIRECT_OWNERSHIP", "NATURE_OF_OWNERSHIP"],
            ["0001-26-000001", "1", "Common Stock", "03-AUG-2026", "P", "2000", "200", "A", "10000", "D", ""]]))
        z.writestr("NONDERIV_HOLDING.tsv", tsv([
            ["ACCESSION_NUMBER", "NONDERIV_HOLDING_SK", "SECURITY_TITLE", "SHRS_OWND_FOLWNG_TRANS", "DIRECT_INDIRECT_OWNERSHIP", "NATURE_OF_OWNERSHIP"],
            ["0001-26-000001", "1", "Common Stock", "700", "I", "By Trust"]]))
    return b


def test_all():
    f = ins.parse_form4_xml(FORM4)
    assert f["issuer"] == 320193 and f["plan"] and f["owners"][0]["cik"] == "1214156"
    assert f["owners"][0]["role"] == "Chief Executive Officer, Consejero", f["owners"]
    t = f["rows"][0]
    assert t["code"] == "S" and t["sh"] == 1000 and t["px"] == 250.5 and t["after"] == 9000 and t["date"] == "2026-10-15"
    assert f["rows"][1]["k"] == "H" and f["rows"][1]["after"] == 500
    assert ins.share_class("Class A Common Stock") == "A" and ins.share_class("Common Stock, $0.01 par") == "común"
    assert ins.parse_date("05-AUG-2026") == "2026-08-05"

    zp = Path(__file__).with_name("_tmp_form345.zip")
    zp.write_bytes(make_zip().getvalue())
    try:
        d = ins.parse_dataset(zp, {320193})
    finally:
        zp.unlink()
    assert list(d) == ["0001-26-000001"], d
    assert d["0001-26-000001"]["filed"] == "2026-08-05" and len(d["0001-26-000001"]["rows"]) == 2

    f["filed"] = "2026-10-17"
    allf = {**d, "0001-26-000003": f}
    s = ins.summarize(allf, dt.date(2026, 11, 24))[320193]
    # mismo directivo en el zip (CIK con ceros) y en el XML: una sola fila, con la posición más reciente
    assert len(s["owners"]) == 1, s["owners"]
    o = s["owners"][0]
    assert o["s"] == 9500 and o["sd"] == 9000, o  # 9.000 directas + 500 a través de un fideicomiso
    assert [x["c"] for x in s["tx"]] == ["S", "P"] and s["tx"][0]["pl"] == 1 and s["nPS"] == 2
    print("OK insiders")


if __name__ == "__main__":
    test_all()
