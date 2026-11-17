# Fortnite chest checker

Zjistí z **oficiálního Epic API** (žádná třetí strana), jaké statistiky o tobě a tvých
spoluhráčích Epic má – a jestli mezi nimi je počet otevřených truhel.

```bash
python fortnite_chests.py Kamos1 Kamos2     # ty + spoluhráči podle Epic jména
python fortnite_chests.py --party           # ty + lidi v aktuální party
python fortnite_chests.py --since 2026-11-01
```

- Přihlásíš se svým Epic účtem (authorization code v prohlížeči). Token zůstává jen u tebe
  a na konci se zruší.
- Všechny odpovědi z API se uloží do `raw/*.json`, takže si každé číslo ověříš sám.
- Statistiky ostatních hráčů uvidíš jen tehdy, když je mají ve Fortnite nastavené jako veřejné.
- Herní profil (questy) jde přečíst jen pro tvůj vlastní účet.
