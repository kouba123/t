#!/usr/bin/env python3
"""
Fortnite chest checker - zjisti primo z oficialniho Epic API, jestli a kolik
truhel jsi otevrel ty a tvoji spoluhraci.

Nepouziva zadnou treti stranu (zadny fortnite-api.com, tracker, vercel web).
Vola jen servery Epic Games a vsechno, co dostane, ulozi do slozky `raw/`,
takze si kazde cislo muzes overit sam.

Pouziti:
    python fortnite_chests.py                     # jen ty
    python fortnite_chests.py Kamos1 Kamos2       # ty + spoluhraci podle jmena
    python fortnite_chests.py --party             # ty + lidi v aktualni party
    python fortnite_chests.py --since 2026-11-01  # jen statistiky od data

Jen standardni knihovna Pythonu 3.8+, nic neni treba instalovat.
"""

import argparse
import base64
import datetime as dt
import json
import pathlib
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

# Verejny klient Fortnite PC hry (pouzivaji ho vsechny open-source Fortnite knihovny).
CLIENT_ID = "ec684b8c687f479fadea3cb2ad83f5c6"
CLIENT_SECRET = "e1f31c211f28413186262d37a13fc84d"

AUTH_CODE_URL = (
    "https://www.epicgames.com/id/api/redirect"
    f"?clientId={CLIENT_ID}&responseType=code"
)
ACCOUNT_HOST = "https://account-public-service-prod.ol.epicgames.com"
TOKEN_URL = f"{ACCOUNT_HOST}/account/api/oauth/token"
ACCOUNT_BY_NAME_URL = f"{ACCOUNT_HOST}/account/api/public/account/displayName/{{}}"
ACCOUNTS_BY_ID_URL = f"{ACCOUNT_HOST}/account/api/public/account"
STATS_URL = (
    "https://statsproxy-public-service-live.ol.epicgames.com"
    "/statsproxy/api/statsv2/account/{}"
)
PROFILE_URL = (
    "https://fngw-mcp-gc-livefn.ol.epicgames.com"
    "/fortnite/api/game/v2/profile/{}/client/QueryProfile?profileId=athena&rvn=-1"
)
PARTY_URL = "https://party-service-prod.ol.epicgames.com/party/api/v1/Fortnite/user/{}"

# Slova, podle kterych hledame cokoli, co souvisi s truhlami / prohledavanim.
CHEST_WORDS = ("chest", "search", "container", "ammobox", "llama", "supplydrop", "loot")
CHEST_RE = re.compile("|".join(CHEST_WORDS), re.IGNORECASE)

# Format klicu v statsv2: br_<stat>_<vstup>_m0_playlist_<playlist>
STAT_KEY_RE = re.compile(
    r"^br_(?P<stat>[a-z0-9]+)_(?P<input>keyboardmouse|gamepad|touch)_m0_playlist_(?P<playlist>.+)$"
)

RAW_DIR = pathlib.Path("raw")


class ApiError(Exception):
    def __init__(self, status, body):
        self.status = status
        self.body = body
        try:
            info = json.loads(body)
            msg = info.get("errorMessage") or info.get("errorCode") or body
        except (ValueError, AttributeError):
            msg = body
        super().__init__(f"HTTP {status}: {msg}")


def http(method, url, token=None, data=None, form=None, basic=None):
    headers = {"User-Agent": "chest-checker/1.0"}
    body = None
    if form is not None:
        body = urllib.parse.urlencode(form).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    elif data is not None:
        body = json.dumps(data).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if basic:
        headers["Authorization"] = "Basic " + base64.b64encode(basic.encode()).decode()

    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raise ApiError(e.code, e.read().decode(errors="replace")) from None


# ---------------------------------------------------------------- prihlaseni

def login():
    print("1) Otviram v prohlizeci prihlaseni k Epic uctu.")
    print(f"   Kdyby se neotevrelo, jdi sem: {AUTH_CODE_URL}")
    print('2) Po prihlaseni uvidis JSON s "authorizationCode". Zkopiruj ho (nebo cely JSON).')
    try:
        webbrowser.open(AUTH_CODE_URL)
    except Exception:
        pass
    pasted = input("\nVloz authorizationCode: ").strip()
    m = re.search(r"[0-9a-f]{32}", pasted)
    if not m:
        sys.exit("To nevypada jako authorizationCode (32 hex znaku).")

    tok = http(
        "POST",
        TOKEN_URL,
        form={"grant_type": "authorization_code", "code": m.group(0), "token_type": "eg1"},
        basic=f"{CLIENT_ID}:{CLIENT_SECRET}",
    )
    print(f"\nPrihlasen jako {tok.get('displayName')} ({tok['account_id']})\n")
    return tok["access_token"], tok["account_id"], tok.get("displayName", "ty")


def logout(token):
    # Zrusi token, at po skonceni nezustane platny.
    try:
        http("DELETE", f"{ACCOUNT_HOST}/account/api/oauth/sessions/kill/{token}", token=token)
    except Exception:
        pass


# ---------------------------------------------------------------- ucty

def account_by_name(token, name):
    info = http("GET", ACCOUNT_BY_NAME_URL.format(urllib.parse.quote(name)), token=token)
    return info["id"], info.get("displayName", name)


def names_for_ids(token, ids):
    if not ids:
        return {}
    qs = "&".join("accountId=" + i for i in ids)
    res = http("GET", f"{ACCOUNTS_BY_ID_URL}?{qs}", token=token)
    return {a["id"]: a.get("displayName", a["id"]) for a in res}


def party_members(token, my_id):
    res = http("GET", PARTY_URL.format(my_id), token=token)
    ids = []
    for party in res.get("current", []):
        for m in party.get("members", []):
            if m.get("account_id") and m["account_id"] != my_id:
                ids.append(m["account_id"])
    return ids


# ---------------------------------------------------------------- statistiky

def get_stats(token, account_id, since=None):
    url = STATS_URL.format(account_id)
    if since:
        url += f"?startTime={since}"
    return http("GET", url, token=token)


def summarize_stats(stats):
    """Vrati (zakladni souhrn, {chest klic: hodnota}, mnozina vsech nazvu statistik)."""
    values = stats.get("stats", {}) or {}
    totals = {}
    stat_names = set()
    chest_hits = {}
    for key, val in values.items():
        m = STAT_KEY_RE.match(key)
        stat = m.group("stat") if m else key
        stat_names.add(stat)
        if stat != "lastmodified" and isinstance(val, (int, float)):
            totals[stat] = totals.get(stat, 0) + val
        if CHEST_RE.search(key):
            chest_hits[key] = val
    return totals, chest_hits, stat_names


def find_chest_paths(obj, path="", out=None, limit=200):
    """Rekurzivne projde JSON a najde vse, co v klici nebo textu obsahuje chest/search/..."""
    if out is None:
        out = []
    if len(out) >= limit:
        return out
    if isinstance(obj, dict):
        for k, v in obj.items():
            p = f"{path}.{k}" if path else str(k)
            if CHEST_RE.search(str(k)) and not isinstance(v, (dict, list)):
                out.append((p, v))
            find_chest_paths(v, p, out, limit)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            find_chest_paths(v, f"{path}[{i}]", out, limit)
    elif isinstance(obj, str) and CHEST_RE.search(obj):
        out.append((path, obj))
    return out


def dump(name, kind, data):
    RAW_DIR.mkdir(exist_ok=True)
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", name)
    path = RAW_DIR / f"{safe}_{kind}.json"
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    return path


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description="Kolik truhel jsi otevrel ty a tvoji spoluhraci (oficialni Epic API).")
    ap.add_argument("teammates", nargs="*", help="Epic jmena spoluhracu")
    ap.add_argument("--party", action="store_true", help="pridat lidi z tve aktualni party")
    ap.add_argument("--since", help="jen statistiky od data YYYY-MM-DD")
    args = ap.parse_args()

    since = None
    if args.since:
        since = int(dt.datetime.strptime(args.since, "%Y-%m-%d").replace(tzinfo=dt.timezone.utc).timestamp())

    token, my_id, my_name = login()
    try:
        players = [(my_id, my_name)]
        for n in args.teammates:
            try:
                players.append(account_by_name(token, n))
            except ApiError as e:
                print(f"! Hrace '{n}' jsem nenasel: {e}")
        if args.party:
            try:
                ids = [i for i in party_members(token, my_id) if i not in {p[0] for p in players}]
                players += list(names_for_ids(token, ids).items())
            except ApiError as e:
                print(f"! Party se nepodarilo nacist: {e}")

        any_chest_stat = False
        print("=" * 64)
        for acc_id, name in players:
            print(f"\n## {name}")
            try:
                stats = get_stats(token, acc_id, since)
            except ApiError as e:
                if e.status == 403:
                    print("   Statistiky jsou soukrome (hrac ma v Fortnite vypnute verejne statistiky).")
                else:
                    print(f"   Chyba: {e}")
                continue
            f = dump(name, "stats", stats)
            totals, chest_hits, stat_names = summarize_stats(stats)
            print(f"   zapasy: {int(totals.get('matchesplayed', 0))}   "
                  f"vyhry: {int(totals.get('placetop1', 0))}   "
                  f"killy: {int(totals.get('kills', 0))}")
            print(f"   statistiky, ktere Epic o hraci vraci: {', '.join(sorted(stat_names)) or '(zadne)'}")
            if chest_hits:
                any_chest_stat = True
                print("   >>> TRUHLY / PROHLEDAVANI:")
                for k, v in sorted(chest_hits.items()):
                    print(f"       {k} = {v}")
            else:
                print("   >>> Epic API pro tohoto hrace ZADNY pocet truhel nevraci.")
            print(f"   surova data: {f}")

        # Vlastni herni profil (jde jen pro prihlaseneho hrace, ne pro ostatni).
        print(f"\n## {my_name} - herni profil (questy, accolades)")
        try:
            profile = http("POST", PROFILE_URL.format(my_id), token=token, data={})
            f = dump(my_name, "athena_profile", profile)
            hits = find_chest_paths(profile)
            if hits:
                print("   Polozky souvisejici s truhlami (vetsinou postup questu, ne celkovy pocet):")
                for p, v in hits[:60]:
                    print(f"     {p} = {v}")
                if len(hits) > 60:
                    print(f"     ... a dalsich {len(hits) - 60}, viz {f}")
            else:
                print("   Nic souvisejiciho s truhlami.")
            print(f"   surova data: {f}")
        except ApiError as e:
            print(f"   Profil se nepodarilo nacist: {e}")

        print("\n" + "=" * 64)
        if not any_chest_stat:
            print("ZAVER: Oficialni Epic statistiky neobsahuji pocet otevrenych truhel.\n"
                  "Pokud nejaky web ukazuje presne cislo truhel tvych spoluhracu, nema ho\n"
                  "odkud vzit - nejspis ho odhaduje (napr. z poctu zapasu) nebo vymysli.")
    finally:
        logout(token)


if __name__ == "__main__":
    try:
        main()
    except ApiError as e:
        sys.exit(f"Chyba API: {e}")
    except KeyboardInterrupt:
        sys.exit(1)
