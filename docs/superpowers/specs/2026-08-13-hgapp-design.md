# HGapp — specifikacija

**Datum:** 2026-08-13
**Status:** potrjeno z uporabnikom, pripravljeno za implementacijo

---

## 1. Kontekst

Jaka organizira domače poker cash game seje. Trenutno se buy-ini, rebuy-ji in končna poravnava vodijo na papir ali na pamet, kar vodi v dve ponavljajoči se težavi: blagajna se ob koncu ne izide, in neporavnani dolgovi med sejami se pozabijo.

Obstoječe aplikacije na trgu (PokerBank, PokerPot, Chip & Split) rešujejo poravnavo dobro, a so skoraj brez izjeme iOS-only, brez modela, ki bi znal ločiti "vzel žetone" od "dejansko plačal", in brez povezave s skupino, kjer se dogovarjajo (Telegram).

Cilj: aplikacija za **lastno rabo**, ki teče na Jakovem iPhonu, deluje brez interneta, nima mesečnih stroškov in ostale igralce obvešča prek Telegram bota.

---

## 2. Trde omejitve

Te omejitve so nepogajalne in imajo prednost pred vsemi funkcijami.

| Omejitev | Posledica za načrt |
|---|---|
| **Brez stroškov** | Ni strežnika, ni baze v oblaku, ni naročnine. Gostovanje na GitHub Pages (statične datoteke). |
| **Deluje offline** | Vsi podatki v IndexedDB na telefonu. Nobena funkcija ne sme zahtevati interneta, da bi delovala. |
| **Samo Jakov iPhone** | En operater. Ni sinhronizacije, ni računov, ni prijave, ni reševanja konfliktov med napravami. |
| **Brez plačil** | Aplikacija nikoli ne procesira, sproža ali posreduje denarja. Samo evidenca. |
| **Cash game** | Turnirji, blind timer, ICM in payout lestvice so izrecno izven obsega. |

**Jezik:** slovenščina, ustaljeni pokerski izrazi ostanejo v angleščini (buy-in, rebuy, add-on, cashout, blinds).

---

## 3. Denarni model — jedro

Vse ostalo v aplikaciji sloni na tem razdelku.

Skupina plačuje **večinoma sproti**: ko igralec vzame žetone, običajno takoj plača v skupno blagajno. Občasno pa kdo vzame na kredo ali nakaže kasneje. Zato moramo za vsakega igralca ločeno voditi *koliko žetonov je vzel* in *koliko denarja je dejansko dal*.

### 3.1 Tri številke na igralca

| Oznaka | Pomen |
|---|---|
| **B** | vsota vseh buy-inov, rebuy-jev in add-onov — koliko žetonov je vzel |
| **P** | koliko denarja je dejansko že plačal: `gotovina` in `nakazilo` štejeta, `kredo` šteje 0 |
| **C** | vrednost žetonov ob koncu seje (cashout) |

### 3.2 Osrednja formula

```
neto        = C − B                 (dobiček/izguba igralca)
izplačilo   = (C − B) + P           (koliko denarja mu pripada ob koncu)
```

Negativno izplačilo pomeni, da igralec **vplača** ta znesek.

**Ključna lastnost:** vsota vseh izplačil je natanko enaka vsebini blagajne (`Σ P`). To ni srečno naključje — je matematična nujnost, ki jo aplikacija uveljavlja kot invarianto.

### 3.3 Zakaj to samodejno reši kredo

Kredo ne potrebuje nobene posebne logike. Primeri (buy-in 20 €):

| Situacija | B | P | C | izplačilo | Razlaga |
|---|---|---|---|---|---|
| Plačal gotovino, konča s 50 € | 20 | 20 | 50 | **+50** | dobi vrednost svojih žetonov |
| Vzel na kredo, konča s 50 € | 20 | 0 | 50 | **+30** | kredo se samodejno poplača |
| Vzel na kredo, konča s 5 € | 20 | 0 | 5 | **−15** | vplača 15 € |
| Plačal gotovino, konča s 5 € | 20 | 20 | 5 | **+5** | dobi ostanek nazaj |

Negativno izplačilo se lahko pojavi **izključno** takrat, ko je bil uporabljen kredo. Če je vsak plačal vse sproti, je `P = B` in izplačilo je vedno `C`, torej nikoli negativno.

### 3.4 Kontrola blagajne

Aplikacija ves čas seje prikazuje: **"V blagajni naj bo: X €"**, kjer je `X = Σ P`.

To je najpomembnejša funkcija za preprečevanje težave "blagajna se ne izide". Odstopanje se odkrije med igro, ne šele ob koncu, ko se nihče več ne spomni.

---

## 4. Poravnava

### 4.1 Zaporedje izračuna

Vrstni red je pomemben in fiksen:

1. **Neto saldi:** `neto_i = C_i − B_i`
2. **Neskladje žetonov:** `razlika = Σ C − Σ B`. Če ni 0, mora uporabnik izbrati razrešitev, preden gre naprej.
3. **Delitev stroškov** (če je vklopljena) — se uporabi na že popravljenih številkah.
4. **Izplačila:** `izplačilo_i = neto_i + P_i`
5. **Poravnalni načrt**

Neskladje se razreši **pred** stroški: najprej ugotovimo, kaj se je dejansko zgodilo, šele nato nanj naložimo dogovor o delitvi stroškov. Obraten vrstni red bi dal drugačne rezultate na ravni centov.

### 4.2 Razrešitev neskladja žetonov

Ko `Σ C ≠ Σ B`, aplikacija ponudi štiri možnosti:

- **enakomerno** — razlika se razdeli na vse igralce enako
- **sorazmerno s stackom** — kdor ima več žetonov, nosi večji del
- **pripiši eni osebi** — običajno hostu ali banki
- **ročno** — vpišeš popravke sam; zahteva obvezen zapisek

Izbira se **vedno** zapiše v revizijski dnevnik z razlogom. Nikoli se ne razreši tiho.

### 4.3 Poravnalni načrt — privzeti način "Blagajna"

Igralci se razdelijo v dve skupini:

- **prejemniki** (izplačilo > 0)
- **plačniki** (izplačilo < 0) — nastanejo le zaradi krede

Načrt se sestavi v dveh delih:

**a) Direktna nakazila.** Plačniki nakažejo neposredno prejemnikom. Privzeto se največji dolg usmeri k **največjemu zmagovalcu** — tako, kot skupina to počne v praksi.

**b) Izplačilo iz blagajne.** Kar prejemnikom še ostane, izplača host iz blagajne.

Vsota izplačil iz blagajne je natanko enaka `Σ P`. Aplikacija to preveri in ob neujemanju javi napako namesto da bi prikazala napačen načrt.

### 4.4 Načrt je urejiv

Predlog ni dokončen. Za vsakega plačnika lahko izbereš **drugega prejemnika**. Aplikacija:

- upošteva tvojo izbiro, kolikor daleč seže terjatev tistega prejemnika,
- preostanek samodejno razporedi po privzetem pravilu,
- po vsaki spremembi znova preveri, da se vsote izidejo.

### 4.5 Alternativni način "med igralci (P2P)"

Isti izračun, a s predpostavko `P = 0` za vse — torej v blagajni ni denarja. Da najmanjše število transakcij (največ n−1).

Če je `Σ P > 0`, aplikacija **opozori**, da ta način ne velja, dokler blagajna ni razdeljena. Opozorilo se ne da spregledati, ker bi napačna izbira načina pomenila, da nekdo dobi denar dvakrat.

### 4.6 Delitev stroškov

Privzeto izklopljeno. Ko je vklopljena: vpišeš skupen znesek (npr. 30 € za pijačo) in kdo ga je založil.

- **po glavah** — enak delež za vse, **vključno s tistim, ki je založil**
- **po dobičku** — sorazmerno s pozitivnim netom; kdor je v minusu, ne plača nič

Založnik dobi povrnjen celoten znesek. Pri delitvi 30 € med 5 igralcev torej plača 6 € in prejme 30 €, neto +24 €.

Če pri načinu "po dobičku" nihče ni v plusu, delitev ni definirana — aplikacija se vrne na "po glavah" in to jasno zapiše.

**Rake oziroma hišni delež ni podprt in ne bo dodan.** Odločitev je namerna: v Sloveniji je poker posebna igra na srečo in delež hiše, ki presega dejansko delitev stroškov, tvega prekvalifikacijo v nedovoljeno prirejanje iger na srečo.

### 4.7 Aritmetika

Vsi zneski so **cela števila centov**. Nikoli decimalna števila — tam nastanejo napake za en cent, ki podrejo invarianto ničelne vsote.

Deljenje uporablja metodo največjega ostanka: ostanek centov gre igralcem po fiksnem, determinističnem vrstnem redu. Isti vhod vedno da isti izhod. Vsako tako zaokroževanje se zapiše v dnevnik.

---

## 5. Evidenca odprtih dolgov

Vsaka postavka poravnalnega načrta, ki ni takoj plačana, postane **odprt dolg**.

- vidiš seznam kdo komu koliko dolguje, iz katere seje
- podpira **delna plačila** (dolguje 50 €, plača 20 €, ostane 30 €)
- označiš "plačano"

**Odprti dolgovi so izključno evidenca.** Nikoli se samodejno ne primešajo v izračun nove seje. Razlog: mešanje starih dolgov v svežo poravnavo naredi obračun nerazumljiv, in ko ga nihče ne razume, mu nihče ne zaupa.

---

## 6. Potek seje

**Stanja:** `načrtovana → aktivna → zaključena → poravnana`

### 6.1 Med igro

Med igro nihče noče tipkati, zato:

- Glavni zaslon je **mreža ploščic z imeni igralcev**, vsaka prikazuje trenutni B in P.
- **En tap** = buy-in privzetega zneska. **Dolg pritisk** = izbira drugega zneska in načina vplačila.
- Privzeti način vplačila je `gotovina`; `nakazilo` in `kredo` sta za en tap stran.
- **Undo** je vedno dosegljiv.
- Na vrhu vedno vidiš **"V blagajni naj bo: X €"**.

### 6.2 Zaključek

Vpišeš končno stanje vsakega igralca, nato aplikacija takoj pokaže neskladje (če je), poravnalni načrt in gumb za objavo v Telegram.

### 6.3 Cashout — štetje žetonov

Dva načina, nastavljiva na sejo:

- **v evrih** — prešteješ sam in vpišeš znesek
- **po barvah** — nastaviš vrednosti (bela 0,10 €, rdeča 0,25 €, modra 1 €), vpišeš število po barvah, aplikacija pretvori

Nastavitev barv in vrednosti se shrani kot privzeta za naslednje seje.

---

## 7. Telegram

### 7.1 Kako deluje brez strežnika

`api.telegram.org` vrača glavo `Access-Control-Allow-Origin: *` (preverjeno z živim klicem 2026-08-13), zato lahko aplikacija kliče Telegram Bot API **neposredno iz brskalnika na telefonu**. Strežnik ni potreben.

### 7.2 Nastavitev

Enkratno: v @BotFather ustvariš bota, prilepiš token in ID skupine v aplikacijo. **Token se shrani samo v telefon** — nikoli v kodo, nikoli v repozitorij.

### 7.3 Povezovanje igralcev

Telegram bot **ne more prvi pisati uporabniku** (preverjeno). Vsak igralec mora enkrat pritisniti Start na botu. Nato ga aplikacija zazna in ga s tapom povežeš s profilom igralca.

Igralec brez povezave ni napaka — samo ne prejema zasebnih sporočil. Vse ostalo dela normalno.

### 7.4 Odhodna sporočila

- **v skupino:** začetek seje, vmesno stanje (na tvojo zahtevo, ne samodejno), končna lestvica s poravnalnim načrtom, opomnik za odprte dolgove
- **zasebno igralcu:** potrditev buy-ina

Vsa odhodna sporočila gredo v **vrsto v bazi**, ne direktno na splet. Brez interneta počakajo in odidejo ob povezavi. Vsako ima ključ proti podvajanju, da se poravnava nikoli ne objavi dvakrat, tudi če aplikacijo vmes zapreš.

### 7.5 Potrjevanje buy-ina

Igralec prejme: *"Zabeležen je tvoj buy-in 20 € (gotovina). Potrdi?"* z gumboma **[Potrdim] [Zavrnem]**. Ob zavrnitvi bot vpraša za razlog in ga pripne k zapisu.

**Potrjevanje nikoli ne blokira igre:**

- Buy-in se zabeleži takoj in takoj šteje v izračun.
- Nepotrjen buy-in **šteje normalno**.
- Zavrnjen buy-in **ne spremeni izračuna tiho** — sproži opozorilo, ti pa se odločiš. Samodejni izbris bi lahko podrl blagajno brez da bi opazil.

### 7.6 Prejemanje odgovorov

Aplikacija posluša odgovore, **dokler je odprta** in je seja aktivna. Ko jo zapreš ali zakleneš telefon, poslušanje preneha.

Telegram hrani sporočila 24 ur, položaj branja pa se shrani v bazo — zato se ob naslednjem odprtju zamujeni odgovori poberejo samodejno. Zamuda, ne izguba.

Bot odgovarja tudi na `/stanje` v skupini, z isto omejitvijo.

### 7.7 Iskrena omejitev

iOS ustavi izvajanje kode nekaj sekund po tem, ko aplikacijo daš v ozadje ali zakleneš telefon. Zanesljivega poslušanja v ozadju na iOS PWA ni. To je neizogibna cena zahteve "brez strežnika" in mora biti napisano v sami aplikaciji, ne skrito v dokumentaciji.

### 7.8 Bot token

Token je v shrambi telefona. Realno tveganje: kdor ima odklenjen telefon v rokah, lahko token prebere in piše v skupino kot bot. Ne more do tvojega Telegram računa, kontaktov ali drugih pogovorov. Token kadarkoli razveljaviš v @BotFather z `/revoke`.

---

## 8. Podatki, iOS in varnostne kopije

### 8.1 Namestitev na domači zaslon je obvezna

WebKit izvzema aplikacije, dodane na domači zaslon, iz 7-dnevnega brisanja podatkov. V navadnem Safari zavihku podatki po tednu neuporabe **izginejo**.

Zato aplikacija ob zagonu preveri, ali teče samostojno. Če ne, prikaže **opozorilo čez cel zaslon** — ne odpravljiv namig, ampak oviro, ki jo je treba potrditi.

Dodatna past, ki mora biti izrecno napisana: nameščena aplikacija in Safari zavihek imata **ločeni shrambi**. Kar vpišeš v zavihku, se po namestitvi ne pojavi.

### 8.2 Varnostne kopije

- Ob prehodu seje v `poravnana` aplikacija **samodejno ponudi** izvoz celotne baze kot eno JSON datoteko prek iOS deljenja (shraniš v Files ali iCloud Drive).
- Izvoz in uvoz sta dosegljiva tudi ročno.
- Uvoz preveri datoteko in **zahteva izrecno izbiro** med združi in nadomesti. Nikoli ne piše čez brez vprašanja.

Kopija se ponudi ob poravnavi, ne ob zaključku seje — do poravnave se številke še lahko spremenijo.

### 8.3 Posodobitve

Nova različica se namesti v ozadju in počaka. Aplikacija pokaže nevsiljivo obvestilo *"Na voljo je nova različica"*. Posodobitev **nikoli ne briše podatkov** — IndexedDB je popolnoma ločen od predpomnilnika aplikacije.

---

## 9. Zgodovina in statistika

- seznam preteklih sej s filtri po datumu in lokaciji
- skupni P/L po igralcu, lestvica
- graf salda skozi čas po igralcu
- število sej, povprečje na sejo
- izvoz CSV

---

## 10. Arhitektura

Trije sloji z enosmerno odvisnostjo: `domain` ← `db` ← `ui`.

```
src/
  domain/          čista matematika. Brez baze, brez Reacta, brez datumov.
    money.ts         Cents, deljenje po metodi največjega ostanka
    chips.ts         pretvorba barv žetonov v cente
    settlement/      neto saldi, neskladje, stroški, poravnalni načrt
  db/              Dexie/IndexedDB
    schema.ts        tabele
    repositories/    edino mesto, ki odpira transakcije; vsaka sprememba piše revizijski zapis
  telegram/        klient, vrsta odhodnih sporočil, poslušalec, potrjevanje
  platform/        PWA, zaznava namestitve, varnostne kopije
  ui/              zasloni; nikoli ne dostopa do baze neposredno
```

**`domain/` je čist** — brez uvoza baze in brez Reacta. To ni estetika: pomeni, da se celotna denarna matematika testira brez brskalnika in baze, kar je edini način, da ji zaupamo.

### 10.1 Revizijski dnevnik in undo

Vsaka sprememba se zapiše skupaj s posnetkom stanja pred in po. Undo ni brisanje zgodovine, ampak **nasproten vpis**.

Undo je zavarovan: če je bil zapis vmes že spremenjen, aplikacija undo **zavrne z razlago** namesto da bi tiho pokvarila podatke.

### 10.2 Tehnologija

Vite + React + TypeScript, Tailwind, Dexie, vite-plugin-pwa. Statičen izhod na GitHub Pages pod potjo `/HGapp/`.

**Brez routerja** — preklop pogledov s stanjem. Manj stvari, ki se na GitHub Pages pokvarijo.

---

## 11. Izven obsega

Izrecno **ne** gradimo: turnirje, blind timer, ICM, payout lestvice, rake, plačilne integracije, večnapravno sinhronizacijo, uporabniške račune, online igro, večvalutnost, spletni ogled za goste.

---

## 12. Testiranje

- **`domain/`**: obvezno pokrit z unit testi, vključno z: en sam igralec, vsi na nuli, ostanek enega centa, neskladje skupaj s stroški, kredo v plusu in v minusu, sprememba prejemnika v načrtu.
- **Telegram**: razvoj proti lažnemu transportu, nikoli proti pravi skupini. Za končni test ločen testni bot in testna skupina.
- **Invarianta**, ki jo preverja vsak test poravnave: vsota netov je 0, vsota izplačil je enaka `Σ P`.

---

## 13. Faze

**Faza 1 — uporabno pri naslednji igri**
Igralci, seja, buy-in/rebuy z enim tapom + undo, načini vplačila, kontrola blagajne, cashout, neskladje, poravnalni načrt (blagajna + P2P + urejanje), PWA namestitev, izvoz JSON.

**Faza 2**
Telegram: nastavitev, povezovanje igralcev, objave v skupino, potrjevanje buy-inov, vrsta sporočil.

**Faza 3**
Zgodovina, grafi, filtri, lestvica, evidenca odprtih dolgov z delnimi plačili, CSV, delitev stroškov, cashout po barvah žetonov.

---

## 14. Znana tveganja

| Tveganje | Ravnanje |
|---|---|
| Podatki živijo na eni napravi | Namestitev na domači zaslon je obvezna in vsiljena; samodejna ponudba kopije ob vsaki poravnavi |
| Telegram ne posluša v ozadju | Napisano v aplikaciji; zamujeni odgovori se poberejo ob odprtju |
| Bot token na telefonu | Omejen doseg, razveljavljiv v @BotFather |
| Napake za en cent | Cela števila centov povsod; invarianta ničelne vsote preverjena v testih in ob izvajanju |
| Napačna izbira načina poravnave | Aplikacija opozori, če je v blagajni denar in izbereš P2P |
