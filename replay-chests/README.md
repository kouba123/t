# Truhly z replayů

Spočítá z Fortnite replayů, kolik truhel (a beden s municí) jsi otevřel ty a tvoji spoluhráči.
Všechno běží jen u tebe na počítači.

## Spuštění (Windows)

1. Nainstaluj [Node.js](https://nodejs.org) (verze LTS), pokud ho nemáš.
2. Stáhni tuhle složku `replay-chests`.
3. Dvakrát klikni na `spustit.bat`.
4. Zeptá se, do kdy počítat. Napiš třeba `2026-11-17 13:50` (nebo jen Enter = všechno).

**Jen vybrané replaye:** označ je v Průzkumníku a přetáhni myší na `spustit.bat`.

Replaye hledá automaticky v `Plocha\data` (i na OneDrivu), jinak v
`%LOCALAPPDATA%\FortniteGame\Saved\Demos`.

## Z příkazové řádky

```bash
node count-chests.js --do "2026-11-17 13:50"
node count-chests.js "C:\Users\ja\Desktop\data" --od 2026-11-01 --do "2026-11-17 13:50"
node count-chests.js --ja MojeJmeno --detail
```

- `--od` / `--do` – počítá jen truhly otevřené v tomto čase (místní čas, i uprostřed zápasu).
- `--ja` – tvoje jméno ve hře, když ho skript nepozná sám (bere hráče, který je v nejvíc replayích).
- `--detail` – vypíše i ostatní týmy a truhly, u kterých nejde poznat, kdo je otevřel.

## Jak počítá

Každá truhla má v replayi `SearchingPawn` (kdo ji otevírá) a `bAlreadySearched` (už je otevřená).
Když se truhla přepne na otevřenou, připíše se tomu, kdo ji otevíral.

Omezení:
- Počítají se jen zápasy, které máš uložené jako replay.
- Truhly spoluhráčů se zapíšou, jen když byli blízko tebe. Replay ukládá jen to, co viděla tvoje hra.
- Pokud Fortnite přidal nový typ truhly, skript na konci vypíše, že ho nepočítá.

Parser replayů: [xNocken/replay-reader](https://github.com/xNocken/replay-reader) (MIT), přibalený ve `vendor/`.
