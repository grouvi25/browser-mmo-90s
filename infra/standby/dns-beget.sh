#!/usr/bin/env bash
# Переключение A-записей kooperativ.space, www и admin на указанный адрес через API Beget
# (DNS домена у Beget). Доступ в /etc/koop-beget-api.env: BEGET_LOGIN, BEGET_API_PASS
# (отдельный пароль API из панели Beget, не пароль входа).
#   dns-beget.sh <ip>            — переключить
#   dns-beget.sh <ip> --dry-run  — только показать, что поменяется
#   dns-beget.sh --show          — показать текущие записи
# Метод dns/changeRecords заменяет ВСЕ записи имени, поэтому скрипт читает текущие,
# меняет только A и проверяет после записи, что остальные записи (MX, TXT и т.д.) не изменились.
# Незнакомый тип записи — отказ, чтобы ничего не потерять.
set -euo pipefail
[ -r /etc/koop-beget-api.env ] || { echo "нет /etc/koop-beget-api.env, домен менять нечем"; exit 3; }
. /etc/koop-beget-api.env
export BEGET_LOGIN BEGET_API_PASS
exec python3 - "$@" <<'PY'
import json, os, sys, urllib.parse, urllib.request

NAMES = ["kooperativ.space", "www.kooperativ.space", "admin.kooperativ.space"]
API = "https://api.beget.com/api/dns/"
# Поля getData -> поле value в changeRecords.
FIELD = {"A": "address", "AAAA": "address", "MX": "exchange", "TXT": "txtdata",
         "CNAME": "cname", "NS": "nsdname", "DNS": "value", "DNS_IP": "value"}

def call(method, data):
    body = urllib.parse.urlencode({
        "login": os.environ["BEGET_LOGIN"], "passwd": os.environ["BEGET_API_PASS"],
        "input_format": "json", "output_format": "json", "input_data": json.dumps(data),
    }).encode()
    with urllib.request.urlopen(urllib.request.Request(API + method, data=body), timeout=30) as r:
        res = json.load(r)
    if res.get("status") != "success" or res.get("answer", {}).get("status") != "success":
        raise SystemExit(f"{method}: ошибка API: {json.dumps(res, ensure_ascii=False)[:400]}")
    return res["answer"]["result"]

def records(fqdn):
    return call("getData", {"fqdn": fqdn}).get("records", {}) or {}

def to_change(recs, new_ip):
    out = {}
    for typ, items in recs.items():
        if not items:
            continue
        if typ not in FIELD:
            raise SystemExit(f"незнакомый тип записи {typ}, ничего не меняю")
        conv = []
        for it in items:
            val = it.get(FIELD[typ], it.get("value"))
            if val is None:
                raise SystemExit(f"не понял запись {typ}: {it}")
            conv.append({"priority": int(it.get("priority", it.get("preference", 10)) or 10), "value": val})
        out[typ] = conv
    if new_ip is not None and "A" in out:
        out["A"] = [{"priority": 10, "value": new_ip}]
    return out

def without_a(recs):
    return {k: v for k, v in recs.items() if k != "A" and v}

args = sys.argv[1:]
if args[:1] == ["--show"]:
    for n in NAMES:
        print(n, json.dumps(records(n), ensure_ascii=False))
    raise SystemExit(0)
ip = args[0]
dry = "--dry-run" in args
for n in NAMES:
    cur = records(n)
    if "A" not in cur or not cur["A"]:
        print(f"{n}: нет A-записи (возможно CNAME), пропускаю: {json.dumps(cur, ensure_ascii=False)}")
        continue
    payload = to_change(cur, ip)
    print(f"{n}: A {[a.get('address') for a in cur['A']]} -> {ip}")
    if dry:
        print("  будет отправлено:", json.dumps(payload, ensure_ascii=False))
        continue
    call("changeRecords", {"fqdn": n, "records": payload})
    after = records(n)
    if [a.get("address") for a in after.get("A", [])] != [ip]:
        raise SystemExit(f"{n}: после записи A = {after.get('A')}")
    if to_change(without_a(after), None) != to_change(without_a(cur), None):
        raise SystemExit(f"{n}: ВНИМАНИЕ, изменились другие записи: было {without_a(cur)}, стало {without_a(after)}")
    print(f"{n}: готово")
PY
