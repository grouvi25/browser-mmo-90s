#!/usr/bin/env python3
"""Переносит три игровых A-записи с Aeza на Beget. Повторный запуск безопасен."""
import argparse
import json
import subprocess
import sys
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

SITE = "kooperativ.space"
AEZA = "82.148.244.248"
BEGET = "85.198.67.48"
ZONE_ID = "c7915eb50e7b6b7bdb5d19e3dab8a435"
NAMES = (SITE, f"www.{SITE}", f"admin.{SITE}")
NS = ("beth.ns.cloudflare.com", "emerson.ns.cloudflare.com")
API = f"https://api.cloudflare.com/client/v4/zones/{ZONE_ID}"


def request(token, path, body=None):
    req = Request(
        API + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urlopen(req, timeout=10) as response:
            result = json.load(response)
    except HTTPError as error:
        raise RuntimeError(f"Cloudflare HTTP {error.code}") from None
    if not result["success"]:
        raise RuntimeError("Cloudflare отклонил запрос")
    return result["result"]


def records(token):
    games = []
    for name in NAMES:
        query = urlencode({"name": name, "per_page": 100})
        entries = request(token, f"/dns_records?{query}")
        addresses = [r for r in entries if r["type"] in ("A", "AAAA", "CNAME")]
        if len(addresses) != 1:
            raise RuntimeError(f"{name}: ожидается одна адресная запись")
        record = addresses[0]
        if (
            record["name"] != name
            or record["type"] != "A"
            or record["content"] not in (AEZA, BEGET)
            or record["proxied"]
            or record["ttl"] != 60
        ):
            raise RuntimeError(f"{name}: неожиданные параметры A-записи")
        games.append(record)
    return games


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    options = parser.parse_args()
    token = Path("/etc/koop-cloudflare.token").read_text().strip()
    if not token:
        raise RuntimeError("Пустой токен Cloudflare")
    zone = request(token, "")
    if zone["name"] != SITE or zone["status"] != "active" or sorted(zone["name_servers"]) != sorted(NS):
        raise RuntimeError("Делегирование Cloudflare не подтверждено")
    patches = []
    for record in records(token):
        print(f'{record["name"]}: {record["content"]} → {BEGET}', flush=True)
        if record["content"] != BEGET:
            patches.append({"id": record["id"], "content": BEGET})
    if options.dry_run:
        return
    if patches:
        request(token, "/dns_records/batch", {"patches": patches})
    if any(r["content"] != BEGET for r in records(token)):
        raise RuntimeError("Не все A-записи обновились в API")
    for server in NS:
        for name in NAMES:
            answer = subprocess.check_output(
                ["dig", "+time=3", "+tries=1", "+short", "@" + server, name, "A"],
                text=True, timeout=5,
            )
            if answer.strip() != BEGET:
                raise RuntimeError(f"{server}: ещё не опубликована новая A-запись {name}")
    print("Оба NS Cloudflare направляют игру на Beget")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        sys.exit(str(error))
