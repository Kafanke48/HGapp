# HGapp

**https://kafanke48.github.io/HGapp/**

Evidenca domačih poker sej. Teče na iPhonu kot nameščena spletna aplikacija, deluje brez interneta in nima nobenih stroškov.

Aplikacija **ne procesira denarja**. Samo beleži, kdo je koliko vzel in plačal, ter izračuna, kdo komu koliko dolguje.

---

## Denarni model

Za vsakega igralca se vodijo tri številke:

| | pomen |
|---|---|
| **B** | koliko žetonov je vzel (vsi buy-ini) |
| **P** | koliko denarja je dejansko plačal — `kredo` šteje 0 |
| **C** | vrednost žetonov ob koncu |

```
neto      = C − B
izplačilo = (C − B) + P
```

Vsota vseh izplačil je natanko enaka vsebini blagajne. Ta lastnost je invarianta, ki jo aplikacija preverja ob vsakem obračunu — če se ne izide, javi napako namesto da bi prikazala napačen načrt.

Kredo zato ne potrebuje posebne obravnave. Kdor vzame na kredo in zmaga, dobi izplačano manj; kdor vzame na kredo in izgubi, vplača.

Podrobnosti: [`docs/superpowers/specs/2026-08-13-hgapp-design.md`](docs/superpowers/specs/2026-08-13-hgapp-design.md).

---

## Namestitev na iPhone

**Obvezno.** iOS po sedmih dneh neuporabe izbriše podatke spletnih strani. Aplikacije na začetnem zaslonu so izvzete.

1. Odpri objavljeni naslov v Safariju.
2. Gumb za deljenje → **Na začetni zaslon**.
3. Od zdaj naprej odpiraj **samo z ikone**, nikoli iz Safarija.

> Nameščena aplikacija in Safari zavihek imata **ločeni shrambi**. Kar vpišeš v zavihku, se po namestitvi ne pojavi. Zato ne vnašaj pravih podatkov, dokler ni nameščena.

---

## Telegram bot

Neobvezno. Brez njega aplikacija deluje v celoti, le skupine ne obvešča.

1. V Telegramu piši **@BotFather** → `/newbot` → izberi ime. Dobiš **token**.
2. Dodaj bota v svojo skupino.
3. V aplikaciji: Nastavitve → Telegram → prilepi token in ID skupine.
4. Vsak igralec, ki želi prejemati potrditve, mora **enkrat** pritisniti Start na botu. Telegram ne dovoli, da bi bot pisal prvi.

Aplikacija posluša odgovore, **dokler je odprta**. iOS ustavi izvajanje kmalu po tem, ko telefon zakleneš. Zamujeni odgovori se poberejo ob naslednjem odprtju — Telegram jih hrani 24 ur.

**Token ostane samo v tvojem telefonu.** Ni v kodi in ni v varnostnih kopijah. Če ga kdaj razkriješ, ga razveljaviš z `/revoke` pri @BotFather.

---

## Varnostne kopije

Vsi podatki živijo v tvojem telefonu. Nikjer drugje jih ni.

Ob poravnavi seje aplikacija sama ponudi izvoz cele baze v eno JSON datoteko — shrani jo v Files ali iCloud Drive. Uvoz je v nastavitvah in vedno vpraša, ali naj podatke **združi** ali **nadomesti**.

---

## Objava

Objava teče samodejno ob vsakem `push` na `main` (glej [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)). Testi so pogoj — če padejo, se objava ustavi.

Enkratna nastavitev: v repozitoriju **Settings → Pages → Source: GitHub Actions**.

> Če repozitorij ni poimenovan `HGapp`, popravi `BASE` na vrhu [`vite.config.ts`](vite.config.ts) — pot mora ustrezati imenu repozitorija, sicer se aplikacija ne naloži.

---

## Razvoj

```bash
npm install
npm run dev
```

```bash
npm test          # testi
npm run typecheck # preverjanje tipov
npm run build     # produkcijski build
```

### Zgradba

| mapa | vsebina |
|---|---|
| `src/domain/` | čista matematika — obračun, denar, žetoni. Brez baze, brez Reacta. |
| `src/db/` | Dexie/IndexedDB, repozitoriji, revizijski dnevnik |
| `src/telegram/` | klient, vrsta odhodnih sporočil, potrjevanja |
| `src/platform/` | PWA, zaznava namestitve, varnostne kopije |
| `src/ui/` | zasloni |

Odvisnosti gredo v eno smer: `domain` ← `db` ← `ui`. `domain/` ne uvaža ničesar iz ostalih slojev, zato se celotna denarna matematika testira brez brskalnika in baze.

Vsi zneski so **cela števila centov**. Nikoli decimalna števila.
