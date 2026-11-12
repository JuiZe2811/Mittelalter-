# Burg-Abwehr (Mittelalter)

Ein Mittelalter-Kampfspiel für die Meta Quest 3 (WebXR mit Passthrough).
Bewaffnete Angreifer kommen durch die Türen und Fenster deines echten Raums. Du kämpfst mit neun Waffen, vom Dolch bis zur Armbrust.
Welche Waffe wirkt, hängt von der Rüstung des Gegners ab. Die Gegner kämpfen taktisch und arbeiten zusammen.
Treffer, Blocks und Paraden werden aus der echten Bewegung der Waffen berechnet.

Starten: `index.html` über einen Webserver öffnen, z. B. über GitHub Pages oder lokal mit `python3 -m http.server`.

## Map einrichten (mit dem Laser)

- Wände, Türen und Fenster einzeichnen
- Tische, Betten und Stühle einzeichnen; ein Bett zeichnest du als Tisch ein
- Bodenhöhe einstellen
- Flächen löschen, letzten Schritt rückgängig machen
- Raum aus der Quest-Raumeinrichtung übernehmen
- 5 Speicherplätze für Räume
- Ausrichten: eine geladene Karte an die echten Wände anlegen

## Soldat wählen und Runden

Nach **START** wählst du einen Soldaten. Seine Waffen und seine Rüstung sind alles, was du hast. Im Kampf gibt das Waffen-Menü keine Waffen heraus. Mehr bekommst du nur, wenn du aufhebst, was Gefallene fallen lassen (Schwert, Dolch, Streitkolben, Axt, Speer, Bogen, Schild).

| Soldat | Waffen (Holster) | Rüstung | Besonderheit |
|---|---|---|---|
| 🛡 Ritter | Langschwert (Hüfte links), Dolch (Hüfte rechts), Wappenschild (Rücken) | Platte, Topfhelm, Kettenbeinlinge | Hiebe prallen ab, Ausdauer kommt langsamer zurück |
| ⚔ Landsknecht | Zweihänder (Rücken), Kurzschwert (Hüfte) | Gambeson, Eisenhut | große Reichweite, Halbschwert und Mordschlag |
| 🔱 Speerträger | Speer und Schild (Rücken), Kurzschwert (Hüfte) | Kettenhemd, Eisenhut | hält Gegner auf Abstand |
| 🏹 Bogenschütze | Bogen (Rücken), Säbel und Dolch (Hüften) | Leder | Pfeile: hinter die linke Schulter greifen |
| 🪓 Raufbold | Streitaxt und Streitkolben (Hüften), Armbrust (Rücken) | kaum | Ausdauer kommt am schnellsten zurück |

- **Rüstung:** dämpft Treffer je nach Art (Hieb, Stich, Wucht) und Körperstelle. Selbst Platte fängt höchstens etwa zwei Drittel ab.
- **Runden:** jede Runde eine feste Zahl Gegner (Runde 1: 4, dann mehr). Danach 12 s Pause und +25 Leben.
- **Aufräumen:** Nach jeder dritten Runde verschwindet alles, was lose am Boden liegt: Waffen, in Wänden steckende Waffen, Pfeile, Trümmer. Fünf Sekunden vorher kommt eine Warnung. Was du hältst, im Holster trägst oder vor dir schweben hast, bleibt.
- **Am PC:** Soldat mit den Tasten 1–5 wählen. Im Kampf rüsten die Zahlentasten nur Waffen aus, die du besitzt.

## So funktioniert der Kampf

### Angriffe der Gegner

Jeder Angriff ist eine echte Waffenbahn: ausholen, zuschlagen, durchschwingen. Am Ausholen erkennst du, was kommt.

| Angriff | Ziel |
|---|---|
| Oberhau | von oben auf den Kopf |
| Hieb von rechts / von links | auf den Rumpf |
| Zornhau | schräg von der Schulter herab |
| Unterhau | von unten nach oben |
| Zwerchhau | waagrecht zum Kopf |
| Tiefer Hieb | auf die Beine |
| Stich | Brust; mit dem Speer auch Kopf oder Bein |
| Schildstoß | Schildträger und Ritter stoßen aus der Nähe mit dem Schild zu |
| Tritt | gegen deinen Schild (er deckt dann kurz nicht) oder in den Bauch |
| Pfeil | Bogenschützen schießen aus der Entfernung |

Dazu kommen:
- **Kombos:** zwei oder drei Angriffe direkt hintereinander
- **Finten:** Der Gegner holt zu einem Hieb aus und setzt blitzschnell auf einen anderen um.

Das Ziel wird am Ende des Ausholens festgelegt. Wer rechtzeitig zurückweicht, zur Seite geht oder sich duckt, wird nicht getroffen.

### Deine Verteidigung

- **Schild:** Der Schlag ist geblockt, wenn die Waffe des Gegners den Schild wirklich trifft.
  - Gegen den Oberhau musst du den Schild heben, gegen den tiefen Hieb senken.
  - Pfeile bleiben im Schild stecken.
- **Block mit der Klinge:** Hältst du Schwert oder Dolch in die Bahn, ist der Schlag abgefangen.
- **Parade:** Führst du die Klinge dem Schlag entgegen, prallt der Gegner weit zurück und ist kurz offen für deinen Gegenangriff.
- **Schwere Waffen:** Die Streitaxt schlägt durch eine nur hingehaltene Klinge durch und trifft dann mit weniger Wucht. Dagegen hilft eine echte Parade, ein beidhändig geführtes Schwert oder der Schild.
- **Pfeile** kannst du mit einer schnellen Klinge wegschlagen.

### Deine Waffen

| Waffe | Art | Stark gegen | Schwach gegen |
|---|---|---|---|
| 🗡 Dolch | Stich, schwacher Hieb | Stoff, Gambeson, Kette (Stich) | Platte |
| ⚔ Langschwert | Hieb und Stich | Ungepanzerte (Hieb), Gambeson und Kette (Stich) | Platte: Hiebe gleiten ab |
| 🔨 Streitkolben | stumpf | Kette, Platte; betäubt am Helm | Gambeson dämpft etwas |
| 🪓 Streitaxt | Hieb mit Durchschlag | fast alles; zertrümmert Schilde | Platte nur mäßig |
| ⚒ Kriegshammer | stumpf, beidhändig | Platte; wirft Gegner zu Boden | einhändig geführt schwach |
| 🔱 Speer | Stich, große Reichweite | Gambeson, Kette; hält Gegner auf Abstand | Platte, Schilde |
| 🏹 Bogen | Pfeile | leichte Rüstung | Schilde fangen Pfeile ab, Platte |
| 🎯 Armbrust | Bolzen mit Durchschlag | auch Kette und Platte | langsames Spannen |
| 🗡 Kurzschwert | Hieb und Stich, wendig | Ungepanzerte; ideal paarweise oder mit Buckler | Platte |
| 🌙 Säbel | gebogene Klinge, Hieb | Stoff, Leder (Schneide ×1,2) | Stich, Kette, Platte |
| 🤺 Rapier | Stich | schon kleine Stöße zählen, Stiche gehen teils durch Rüstung | Hiebe kaum wirksam |
| ⚔ Zweihänder | Hieb und Stich, beidhändig | größte Reichweite, wuchtig | einhändig träge und schwach (×0,6) |
| ⛓ Morgenstern | Kugel an einer simulierten Kette | schlägt über den Rand von Schilden | Schwung nötig |
| 🛡 Schild | Block, Schildstoß | | |
| 🔘 Buckler | kleiner Faustschild | perfekte Ablenkung, wenn dem Schlag entgegengestoßen | nur gehalten rutschen Schläge durch |
| 🪨 Stein | zum Werfen | Ungepanzerte, am Kopf betäubend | Rüstung |

So wirken sie:
- **Hieb:** Die Klinge muss wirklich geschwungen werden. Je schneller, desto mehr Schaden; langsames Hineinhalten zählt nicht.
- **Schneide:** Ein Hieb mit der Schneide wirkt voll, mit der flachen Seite nur etwa halb. Das gilt für Schwert, Dolch und Axt.
- **Stich:** Eine Bewegung entlang der Klinge oder des Speerschafts zählt als Stich. Stiche gehen deutlich besser durch Rüstung.
- **Stumpf:** Kolben und Hammer wirken in jede Schlagrichtung. Sehr wuchtige Treffer werfen den Gegner zu Boden; dort ist er einen Moment wehrlos.
- **Beidhändig:** Schwert, Hammer und Speer kannst du mit der zweiten Hand hinten am Griff fassen. Beide Hände führen dann die Waffe, und sie trifft härter.
- **Schilde der Gegner** haben eine Haltbarkeit. Die Axt zertrümmert einen Rundschild in drei Hieben, das Schwert braucht ein Vielfaches.
- **Schildstoß:** Stößt du den Schild schnell nach vorne gegen einen Gegner, taumelt er zurück.
- **Bogen:** In einer Hand halten, mit der anderen die Sehne greifen, ziehen, loslassen.
- **Armbrust:** Mit der anderen Hand die Sehne zurückziehen, bis sie einrastet. Der Abzug schießt.
- Pfeile und Bolzen bleiben im Gegner oder in seinem Schild stecken.

### Verteidigung der Gegner

- **Schild:** Der Schild wird nach oben, zur Mitte oder nach unten geführt. Was ihn trifft, ist geblockt. Ziele auf das, was er nicht deckt, oder schlage zu, während der Gegner selbst angreift – dann ist sein Schild zur Seite.
- **Parade:** Geübte Gegner parieren mit der Waffe und setzen danach oft zum Gegenangriff an.
- **Ausweichen:** Leichte Gegner springen zurück.
- Von hinten und von der Seite können sie nicht blocken.

### Handhabung der Waffen

- **Haltung:** Nahkampfwaffen sitzen in der Handfläche, die Klinge verlängert die geschlossene Faust. Der Winkel ist einstellbar: Einstellungen → Bedienung → Griffwinkel.
  - Fühlt es sich falsch an, kannst du mit „Waffe sitzt in der Handfläche: Aus“ zur alten Haltung am Zeigestrahl zurück.
- **Griff-Taste:**
  - „Halten“: Die Waffe bleibt in der Hand, solange du die Taste drückst.
  - „Tippen = festhalten“: Einmal drücken greift, nochmal drücken lässt los. Die Hand ermüdet so nicht.
- **Greifen:** Liegt eine Waffe in Greifweite, wird sie etwas größer und der Controller vibriert kurz.
- **Speer und Hammer** hältst du dort am Schaft, wo du zugreifst.
- **Beidhändig:** Die zweite Hand kann am Griff, am Schaft oder sogar an der Klinge zufassen. Die Waffe zeigt dann von der hinteren zur vorderen Hand.
- **Gewicht:** Schwere Waffen folgen der Drehung der Hand etwas träge, beidhändig geführt doppelt so schnell. Abschaltbar unter „Gewicht spürbar“.
- **Rückmeldung:**
  - Kräftige Schwünge zischen hörbar, der Controller vibriert leicht, und eine helle Schwung-Spur folgt der Klinge (abschaltbar).
  - Bei Treffern, Blocks und auf Rüstung federt die Waffe sichtbar zurück.

### Werfen

Alles, was du in der Hand hältst, kannst du werfen: Lass es mitten im Schwung los.

| Gegenstand | Flug | Wirkung |
|---|---|---|
| Dolch, Speer | Spitze voran | bleiben im Gegner stecken (beim Herausziehen blutet die Wunde) oder in Wand und Tisch |
| Streitaxt | überschlägt sich | trifft hart, bleibt manchmal stecken, beschädigt Schilde |
| Kriegshammer | überschlägt sich | wirft Gegner zu Boden |
| Streitkolben, Schwert, Schild, Bogen | überschlagen sich | stumpfer bzw. schwacher Treffer |
| Stein | überschlägt sich | am Kopf betäubend |

- Gezählt wird die schnellste Handbewegung kurz vor dem Loslassen. Die Wurfkraft lässt sich unter Bedienung → Wurfkraft einstellen.
- Schilde der Gegner fangen Würfe ab.
- **Waffen der Gegner:** Lässt ein Gegner seine Waffe oder seinen Schild fallen (entwaffnet, Arm unbrauchbar, tot), liegt sie als echte Waffe am Boden. Du kannst sie aufheben, benutzen und werfen.
  - Keule wird zum Streitkolben, Hellebarde zum Speer.

### Holster, Köcher und Greifen

- **Gürtel (Hüfte links und rechts):** je eine Einhandwaffe: Dolch, Kurzschwert, Langschwert, Säbel, Rapier, Streitkolben, Morgenstern, Axt, Buckler.
- **Rücken (links und rechts):** alles. Speer, Zweihänder, Kriegshammer, Schild, Bogen und Armbrust passen **nur** auf den Rücken.
- **Pfeile:** Greif hinter die Schulter, wo nichts auf dem Rücken hängt: Du bekommst immer einen neuen Pfeil. Ein losgelassener Pfeil fällt zu Boden.

### Griffarten (B/Y mit der Waffe in der Hand, am PC G)

| Waffe | Griffe |
|---|---|
| Speer | wie gegriffen · lang (am Ende, 1,9 m Reichweite) · kurz (am Eisen, für die Nähe) · überhand (Spitze nach unten, über Schilde stechen) |
| Langschwert, Zweihänder | normal · **Halbschwert** (Hand an der Klinge: Stiche gehen durch Rüstungsfugen, Hiebe schwach) · **Mordschlag** (verkehrt gefasst, Knauf und Parierstange voran: wirkt wie ein Hammer, gut gegen Platte) |

### Nahdistanz

Ganz nah kommt man nicht auf Schwungtempo. Trotzdem verletzt eine Klinge, die du in den Körper **drückst** (Druckstoß) oder mit der Schneide am Körper **ziehst** (Ziehschnitt). Das geht etwa zweimal pro Sekunde.


**Holster** (Einstellungen → 🎒 Körper):
- Plätze: linke und rechte Hüfte, Rücken über beiden Schultern, Köcher.
- **Einstecken:** Waffe an einen passenden Platz halten und loslassen. Der Platz leuchtet auf, und der Controller vibriert kurz.
- **Ziehen:** Hingreifen und die Griff-Taste drücken.
- **Was wohin passt:** An die Hüfte passen kleine und mittlere Waffen, auf den Rücken alles.
- **Körper-Schätzung:** Der Körper wird aus Kopf und Händen geschätzt. Kleine Kopfdrehungen bewegen die Holster nicht mit.
  - Körpergröße und Hüftposition sind einstellbar.
  - Für Linkshänder sitzt der Köcher links.
- **🎒 Ausrüstung anlegen** (Waffen-Menü): Schwert linke Hüfte, Dolch rechte Hüfte, Schild und Bogen auf dem Rücken.

**Köcher:**
- Ist „Pfeile aus dem Köcher ziehen“ an: Hinter die Schulter greifen, Pfeil ziehen, an die Sehne führen (er rastet ein), ziehen, loslassen.
- Aus (bequem für kleine Räume): Wie bisher die Sehne direkt greifen.

**Greifen:**
- Übergabe: Hält eine Hand eine Waffe, kann die andere sie am Griff übernehmen.
- Zwei Waffen gleichzeitig führen (zwei Kurzschwerter, Rapier und Dolch, Schwert und Buckler …) funktioniert unabhängig voneinander.
- Zweihänder, Speer und Hammer kannst du an Griff, Schaft oder Klinge mit der zweiten Hand fassen.

### Kampfsystem: Treffer, Paraden, Gleichgewicht

**Treffer**
- **Kontaktpunkt:** Gezählt wird die Geschwindigkeit genau an der Stelle, die trifft. Am Klingenansatz schneidet ein Schwert kaum, im vorderen Drittel voll.
  - Gemessen: derselbe Schwung macht am Ansatz etwa ein Drittel des Schadens der Spitze.
- **Art des Treffers:** Schneide, flache Seite (stumpf) oder Parierstange (stumpf).
- **Kontinuierliche Prüfung:** Zwischen zwei Bildern wird die Klinge auf dem Bogen um die Hand geprüft, nicht auf einer geraden Linie. Auch sehr schnelle Hiebe oder ein ausgefallenes Bild gehen nicht durch Gegner hindurch.
- **Ein Schwung:** Jeder Gegner wird je Schwung höchstens einmal getroffen. Ein Schwung kann aber mehrere Gegner nacheinander treffen.
- **Konter:** Wer beim Ausholen, nach einem abgeprallten Schlag oder mit weggeschlagener Deckung getroffen wird, nimmt 20 % mehr Schaden.

**Weitere Angriffe**
- **Knaufschlag:** Ein Griffende, das kräftig voran gestoßen wird, trifft stumpf.
- **Freie Hand:**
  - Ein schneller Faustschlag trifft stumpf.
  - Langsam gegen den Rumpf eines Gegners gedrückt schiebt sie ihn weg und kostet ihn Gleichgewicht.

**Bindung (Druck Klinge an Klinge)**
- Liegt deine Klinge an der Waffe des Gegners, spürst du ein Klicken und leichtes Vibrieren.
- Langsames seitliches Drücken schiebt seine Klinge mit. Er drückt zurück, Zweihänder und frische Gegner stärker.
- Hast du sie weit genug weggedrückt (etwa 20 cm), geht seine Deckung auf.
- Solange ihr gebunden seid, greift er nicht an.

**Kontakt:** Trifft deine Klinge Schild oder Waffe, bleibt die virtuelle Klinge einen Moment stehen und folgt dann federnd deiner Hand. Die echte Hand bleibt frei.

**Klinge an Klinge**
- Die Waffe des Gegners ist immer im Weg, nicht nur wenn er pariert.
- Ein kräftiger Schlag gegen seine Klinge schlägt sie zur Seite, er ist dann kurz offen.
- Ein sehr harter Schlag gegen eine erschöpfte oder verletzte Hand entwaffnet ihn.
- Treffen sich beide Waffen mitten im Schlag, prallen sie aufeinander.

**Paraden**
- Klinge nur hingehalten: Block. Er kostet Ausdauer, und deine Waffe wird zur Seite gedrückt.
- Klinge dem Schlag entgegengeführt: Parade.
- Schnell auf den Angreifer zu: **perfekte Parade**. Der Gegner ist lange offen, verliert Gleichgewicht und Ausdauer und kann die Waffe verlieren.
- Den Schild dem Schlag entgegenstoßen: **Schild-Parade**.

**Gleichgewicht der Gegner**
- Jeder Treffer kostet Standfestigkeit. Stumpfe Schläge, Beintreffer und Treffer mitten im Angriff kosten mehr.
- Ist sie aufgebraucht, taumelt der Gegner lange oder fällt.
- Sie erholt sich, wenn er nicht mehr getroffen wird.

**Ausdauer der Gegner**
- Angriffe, Blocks und weggeschlagene Klingen kosten Ausdauer.
- Erschöpfte Gegner greifen langsamer an, decken schlechter, lassen den Schild sinken und keuchen sichtbar.

**Treffer-Reaktionen**
- Der Körper reagiert auf die Richtung des Treffers: Von vorne knickt er zurück, von der Seite dreht er sich weg.
- Am Arm zuckt der Arm zurück. Am Bein knickt er ein und kippt zur Seite.

**Entwaffnet**
- Ein entwaffneter Gegner läuft zur nächsten Waffe am Boden und hebt sie auf, oft deine eigene.
- Liegt keine in der Nähe, zieht er einen Ersatzdolch oder kämpft mit den Fäusten.

**Verwundet:** Unter halbem Leben kämpfen Gegner vorsichtiger. Sie halten mehr Abstand, decken öfter und greifen seltener an.

**Deine Ausdauer (⚡ am Handgelenk)**
- Blocks kosten Ausdauer, perfekte Paraden fast nichts, Treffer ein wenig. Schwingen allein kostet nichts.
- Bist du erschöpft (unter 15), triffst du schwächer.
- Unter 8 werden deine Blocks durchgeschlagen.
- Die Ausdauer kommt nach einer Sekunde Pause schnell zurück.

**Controller-Ausfall:**
- Verliert die Brille einen Controller kurz aus dem Blick, bleibt die Waffe stehen. Beim Wiederfinden gibt es keinen Schein-Treffer.
- Nach dem Neu-Zentrieren (Oculus-Taste) wird die Bodenhöhe neu angewandt, und du bekommst einen Hinweis.

### Taktik der Gegner

Die Gegner sprechen sich ab und reagieren auf das, was du tust:

- **Umzingeln:** Einer bindet dich von vorne, die anderen gehen in die Flanke und in den Rücken. Wer hinter dir steht, greift bevorzugt an.
- **In die Blöße schlagen:** Sie prüfen, was dein Schild oder deine Klinge gerade deckt, und schlagen daran vorbei: hoch, tief oder schräg.
- **Den Moment nutzen:** Hast du gerade einen Schlag geblockt, daneben geschlagen oder dich am Schild eines Gegners festgehauen, schlagen die anderen sofort zu.
- **Schild wegtreten:** Verschanzt du dich hinter dem Schild, tritt ein Gegner dagegen. Der Schild deckt dann kurz nicht.
- **Gegen Bogen und Armbrust:**
  - Schildträger und Ritter halten den Schild genau in deine Schusslinie und rücken dahinter vor. Die Schienbeine bleiben frei.
  - Gegner ohne Schild laufen im Zickzack heran und springen beim Schuss zur Seite.
  - Alle Nahkämpfer stürmen schneller auf dich zu.
- **Bogenschützen** zielen auf das, was dein Schild nicht deckt, und wechseln nach jedem Schuss die Stellung.
- **Rückzug:** Schwer Verletzte ziehen sich hinter ihre Verbündeten zurück und kommen später wieder.
- **Drohen:** Wartende brüllen mit erhobener Waffe oder schlagen auf ihren Schild.
- Geübte Kämpfer wechseln ihre Grundstellung und kontern, wenn dein Hieb ins Leere geht.
- **Nie gleichzeitig:** Zwei Angriffe beginnen nie im selben Moment, sondern mindestens gut 0,3 s versetzt.
- **Um den Schild herum:** Hältst du einen Schild, wandern kluge Gegner zu deiner ungedeckten Seite.
- **Kameraden decken:** Geht einer zu Boden, greift der nächste sofort an. Stirbt einer, sinkt die Moral der anderen; Berserker werden rasend.
- **Reichweite:** Mit kurzer Waffe gegen deine lange drängen kluge Gegner hinein. Elite und Vorsichtige warten knapp außerhalb deiner Reichweite und treten erst zum Angriff hinein.

### Persönlichkeiten

Jeder Gegner hat zusätzlich zu seinem Typ eine Persönlichkeit, und innerhalb davon eigene Werte (±15 %). Die Persönlichkeit steht in der Test-Anzeige über dem Kopf.

| Persönlichkeit | Verhalten |
|---|---|
| **Berserker** | rückt nah heran, greift am häufigsten an, liebt schwere Hiebe; kleine Treffer steckt er ohne Zucken weg. Pariert kaum. Ein schwerer Hieb ins Leere lässt ihn nach vorne stolpern – deine Gelegenheit. Ergibt sich nie, wird rasend, wenn ein Kamerad fällt. |
| **Elite-Ritter** | hält den Abstand knapp außerhalb deiner Reichweite, pariert am besten, fintiert, setzt einen Hieb im Ausholen um, wenn du die Bahn deckst; nach einer Parade sticht er aus der Bindung nach. Lernt am schnellsten. |
| **Vorsichtig** | hält mehr Abstand, blockt und pariert viel, lauert auf deine Fehlschläge und kontert; zieht sich nach Angriffen zurück. |
| **Ängstlich** | zögert vor dem Angriff, weicht zurück; bei niedriger Moral lässt er vor Angst die Waffe fallen, ergibt sich oder flieht. |

Typische Zuordnung: Axtkämpfer meist Berserker, Ritter meist Elite, Schildträger meist vorsichtig, Räuber oft ängstlich.

### Was die Gegner von dir lernen

Gegner wissen nur, was sie sehen:
- woher deine Hiebe kommen (oben, tief, links, rechts, Stich),
- womit du ihre Angriffe abwehrst (Schild, Klinge, Zurückweichen),
- wie oft du daneben schlägst.

Dieses Wissen kommt mit einer Verzögerung an (Reaktionszeit), wird manchmal falsch eingeordnet (je weniger klug, desto öfter) und verblasst nach etwa 20 Sekunden.

Die Gegner nutzen es so:
- **Vorbereitet:** Schlägst du immer gleich, parieren sie schneller und sicherer.
- **Andere Ziele:** Was du oft abwehrst, greifen sie seltener an.
- **Finten:** Wer viel abwehrt, wird öfter getäuscht.
- **Stiche:** Weichst du oft zurück, stechen sie mehr.
- **Konter:** Schlägst du oft daneben, lauern sie darauf.

Die Stärke des Lernens hängt von der Persönlichkeit ab und lässt sich im Test-Menü regeln.

### Paraden und Konter der Gegner

- **Echte Parade:** Die Klinge des Gegners stellt sich quer zu deiner heranfliegenden Klinge, zwischen seine Brust und deinen Hieb.
- **Nach der Parade:** Riposte, Stich aus der Bindung (Elite), Tritt (Berserker) oder Rückzug (Vorsichtige, Ängstliche).
- **Keine Endlos-Abwehr:** Nach vier Abwehren hintereinander bricht der Gegner aus, entweder mit einem Gegenangriff oder mit Abstand.
- **Angriff abbrechen:** Kommst du im Ausholen mit einem schnellen Hieb zuvor, brechen kluge Gegner ab und parieren.
- **Kombo anpassen:** Wird ein Hieb oben abgewehrt, setzt ein lernfähiger Gegner sofort unten nach (und umgekehrt).

### Waffe packen und entwaffnen

**Gegner packen deine Waffe:** Ein Gegner mit freier Hand greift nach einer langsamen oder ruhenden Klinge in seiner Reichweite. Das passiert etwa nach einem Stich oder in der Bindung. Entwaffnete Gegner versuchen es öfter.

- **Am Griff:** Er kontrolliert dein Handgelenk direkt.
- **An der Klinge:**
  - Mit Handschuh (Gambeson-, Ketten-, Plattenärmel) hält er sicher fest.
  - Mit bloßer Hand hält er nur zaghaft. Ziehst du die Klinge ruckartig heraus, schneidet sie ihm die Hand.
- **Widerstand:** Die Waffe bleibt an seiner Hand hängen, dein Controller bewegt sich frei weiter. Du spürst Vibration und siehst den Hinweis „Gepackt!“.
- **Befreien:** Ruckartig zurückziehen oder die Klinge kräftig drehen.
- **Kräftemessen:** Wer es gewinnt, hängt von Hebel und Kraft ab, nicht vom Zufall:
  - Je weiter vorne er die Klinge fasst, desto mehr Hebel hat er gegen dein Handgelenk.
  - Für ihn zählen außerdem seine Griffkraft und seine Ausdauer.
  - Für dich zählen beidhändiger Griff, deine Ausdauer und langsames Gegenziehen.
  - Gewinnt er, reißt er dir die Waffe aus der Hand. Ein Entwaffneter behält sie, sonst fällt sie zu Boden.

**Du entwaffnest Gegner nach Hebel:**
- **Hieb auf seine Waffe:** Je weiter vorne du sie triffst, desto größer das Drehmoment an seinem Handgelenk. Dagegen stehen Griffkraft, Ausdauer, Verletzung und beidhändiger Griff (nur ±12 % Streuung).
- **Bindung (Winden):** Gewinnst du sie gegen ein schwaches oder müdes Handgelenk, drehst du ihm die Waffe heraus.
- **Perfekte Parade:** Hat er nur noch wenig Griffkraft, verliert er die Waffe.

### Moral: kämpfen, fliehen, sich ergeben

Jeder Gegner hat eine Moral (0–100).

| Senkt die Moral | Stärkt die Moral |
|---|---|
| Wunden (im Verhältnis zu seinen Lebenspunkten) | Verbündete in der Nähe |
| verkrüppelte Gliedmaßen | |
| entwaffnet werden | |
| Stürze | |
| fallende oder sich ergebende Kameraden | |
| ein getöteter Ergebener | |

- **Wirkung:** Wenig Moral macht vorsichtiger.
- **Wird sie sehr niedrig, entscheidet die Persönlichkeit:**
  - Ängstliche ergeben sich schnell.
  - Vorsichtige fliehen eher.
  - Elite-Ritter geben nur hilflos auf.
  - Berserker nie.
- **Flucht:** zur nächsten Tür oder zum nächsten Fenster, über die Laufwege.
- **Ergeben:**
  - Er lässt Waffe und Schild fallen, hebt die Hände, geht auf die Knie und bittet um Gnade (Sprachausgabe der Brille, Lautstärke „Stimmen“).
  - Ergebene zählen nicht mehr als Angreifer.
  - Im Test-Menü kannst du sie stehen lassen, wegschicken, wieder kämpfen lassen, entwaffnet lassen oder entfernen.

### Stürze und Ragdoll-Physik

**Fallen:** Stirbt ein Gegner oder geht er zu Boden, übernimmt die Physik den Körper. Es ist dieselbe Physik-Engine wie für Waffen und Möbel.
- Der Körper besteht aus 11 Teilen (Kopf, Rumpf, Becken, Ober- und Unterarme, Ober- und Unterschenkel), verbunden mit begrenzten Gelenken. Das Knie beugt nur nach hinten.
- Die Fallrichtung ergibt sich aus Trefferpunkt, Schlagrichtung, Wucht und seiner eigenen Bewegung.
- Er fällt auf eingezeichnete Möbel und gegen Wände.

**Liegen und Aufstehen** (wer den Sturz überlebt):
1. liegt benommen und sieht sich um,
2. steht über eine Hocke auf: ein fließender Übergang aus der liegenden Physik-Haltung in die Animation, ohne Sprung,
3. kämpft weiter, oder sucht erst seine Waffe, oder flieht bzw. ergibt sich, je nach Moral.

**Waffe im Sturz:** Ein leichter Sturz lässt sie in der Hand, ein harter schleudert sie weg (Wucht gegen Griffkraft). Sie fällt, rutscht und springt als echte Waffe. Du kannst sie aufheben, ein Gegner kann sie holen. Sie springt nie in die Hand zurück.

**Leistung:**
- Höchstens 2 Ragdolls rechnen gleichzeitig (einstellbar 1–4).
- Liegt ein Körper still, wird er eingefroren: Er bleibt genau so liegen, kostet aber nichts mehr.
- Schlägst du auf einen Gefallenen, wird er wieder lebendig und rutscht weg.
- Ist das Budget voll, während alle noch fallen, fällt der nächste mit der einfachen Sturz-Animation.

### Trefferzonen und Folgen

| Zone | Folge |
|---|---|
| Kopf | Doppelter Schaden; der Gegner ist benommen und reagiert schlechter. Ein Helm kann abfliegen, danach ist der Kopf ungeschützt. |
| Rumpf | Voller Schaden; schwer verwundet greift er langsamer an. |
| Waffenarm | Verletzt: langsamere und schwächere Angriffe. Unbrauchbar: Die Waffe fällt; wenn möglich kämpft er mit dem Dolch in der anderen Hand weiter. |
| Schildarm | Verletzt: Der Schild wird langsamer geführt. Unbrauchbar: Der Schild fällt. |
| Beine | Verletzt: Er hinkt. Ein Bein unbrauchbar: Er ist sehr langsam. Beide: Er geht in die Knie und kämpft von dort weiter. |

- **Blutung:** Offene Wunden bluten nach und kosten weiter Leben.
- **Taumeln:** Ein Treffer unterbricht meist den Angriff des Gegners.
- **Flucht:** Schwer angeschlagene oder wehrlose Gegner fliehen manchmal durch die nächste Tür oder das nächste Fenster. Auch das zählt als besiegt.

### Rüstung

Rüstung senkt den Schaden je Zone. Die Tabelle zeigt, wie viel Schaden durchkommt.

| Rüstung | Hieb | Stich | Stumpf |
|---|---|---|---|
| Stoff | 90 % | 95 % | 90 % |
| Leder | 65 % | 85 % | 80 % |
| Gambeson | 50 % | 80 % | 70 % |
| Kettenhemd | 20 % | 60 % | 90 % |
| Plattenrüstung | 8 % | 30 % | 75 % |
| Eisenhelm | 20 % | 45 % | 70 % |
| Topfhelm | 8 % | 22 % | 60 % |

Durchschlag hebt einen Teil der Rüstung auf: Streitaxt 30 %, Kriegshammer 25 %, Armbrustbolzen 45 %.

Beispiel Ritter, Treffer auf die Brustplatte: Ein Schwerthieb kostet ihn etwa 4 Leben, ein Stich 11, die Axt 19, der Streitkolben 35 und der Kriegshammer 58.

## Gegner

Es gibt nur normale menschliche Gegner, keine Bosse und keine Riesen.

| Gegner | Bewaffnung | Rüstung | Besonderheit |
|---|---|---|---|
| Räuber | Dolch oder Keule | Stoff | schnell, weicht aus, flieht leicht |
| Söldner | Schwert oder Streitkolben | Gambeson, oft Helm | pariert, fintiert, Kombos |
| Schildträger | Schwert und Rundschild | Kettenhemd, Eisenhelm | blockt mit dem Schild, Schildstoß |
| Speerträger | Speer | Gambeson, Eisenhut | große Reichweite, Stiche auf Kopf, Brust und Bein |
| Hellebardier | Hellebarde (zweihändig) | Kettenhemd, Eisenhut | größte Reichweite, Stich und schwerer Hieb |
| Axtkämpfer | Streitaxt (zweihändig) | Leder | langsam, sehr harte Schläge |
| Bogenschütze | Bogen, im Nahkampf Dolch | Stoff | hält Abstand, schießt |
| Ritter | Schwert oder Streitkolben, Wappenschild | Platte, Kettenbeine, Topfhelm | kaum mit Hieben zu verletzen |

- Sie kommen von draußen: Durch Türen laufen sie, durch Fenster klettern sie.
- Im Raum laufen sie um Wände und Möbel herum. Auf Hindernisse bis 1,05 m Höhe (Bett, Tisch) klettern sie hinauf.
- Höchstens zwei Nahkämpfer greifen gleichzeitig an, die anderen umkreisen dich und warten. Bogenschützen schießen unabhängig davon.
- Mit der Zeit kommen mehr und gefährlichere Gegner, höchstens 6 gleichzeitig.

## Waffen-Menü

Öffnen: in VR mit **A/X**, im Hauptmenü und im Pause-Menü über **🗡 Waffen-Menü**, am PC mit **Q**.

- **Waffe anklicken:** Sie kommt in die Hand, mit der du geklickt hast.
- **Waffe loslassen:** Griff-Taste drücken und loslassen.
- **Übungsgegner:** Typ wählen, dann
  - **🎯 Passiv:** Er steht still und wehrt sich nicht. Gut, um Trefferzonen und Rüstung zu testen.
  - **⚔ Duell:** Er kämpft gegen dich. Im Hauptmenü kannst du dabei nicht sterben.
- **Waffen herholen**, **Waffen weg**, **Gegner weg**

Solange das Waffen-Menü offen ist, steht alles still.

## Sicherheit im echten Zimmer

- **Sicherheitsabstand** (Einstellungen → 🎒 Körper; 30, 50 oder 80 cm):
  - Kommen Kopf oder Hände einer eingezeichneten Wand, einem Tisch oder Stuhl zu nahe, leuchtet die Fläche rot auf.
  - Sehr nah vibriert der Controller.
  - Die rote Fläche ist nur ein Hinweis, kein Schutz: Sie warnt nur vor dem, was du eingezeichnet hast.
- **Pause bei Tracking-Verlust:** Verliert die Brille ihre Position oder beide Controller, pausiert die Runde.

## Flüssiges Bild

In VR fühlt sich die Kopfbewegung nur dann flüssig an, wenn jedes Bild rechtzeitig fertig wird.

- **Keine Hänger beim Auftauchen:** Alle Gegner, Waffen, Gesichter und Texte werden beim Laden einmal vorbereitet.
- **Wiederverwendete Texte:** Kampf-Texte kommen aus einem festen Vorrat und werden nicht jedes Mal neu erzeugt.
- **Günstige Schatten:** Gegner werfen einen weichen Bodenschatten statt echter Schatten. Echte Schatten sind standardmäßig aus; schaltest du sie ein, werden sie jedes Bild berechnet statt nur jedes zweite.
- **Bildrate:** Unter Einstellungen → Grafik → „Bildrate anzeigen“ siehst du die aktuelle Bildrate am linken Handgelenk.
  - Hält die Brille 90 Hz nicht, schaltet „Automatisch flüssig halten“ jetzt nach gut einer Sekunde auf 72 Hz und spart dann schrittweise Details.

## Einstellungen

Im Reiter **⚔ Kampf**:
- **Schwierigkeit:** Leicht, Normal oder Schwer. Sie ändert Schaden, Reaktionsvermögen und Tempo der Gegner.
- **Kampf-Texte:** kurze Einblendungen wie „Parade!“, „Bein verletzt“ oder „Rüstung hält“
- **Blut:** an oder aus
- **Ragdoll-Physik bei Stürzen:** an oder aus (aus = einfache Sturz-Animation)
- **Ragdolls gleichzeitig:** 1–4 (Standard 2; mehr kostet auf der Quest Rechenzeit)
- **Test-Menü (Entwickler):** schaltet das Test-Menü frei (Standard aus)

## Test-Menü (Entwickler)

Freischalten unter Einstellungen → ⚔ Kampf → „Test-Menü“. Öffnen über das Pause-Menü (**🛠 Test**), das Waffen-Menü oder am PC mit **T**. Das Spiel läuft dabei weiter. Die Knöpfe wirken auf den Gegner, auf den du am ehesten schaust.

- **Gegner:** Typ und Persönlichkeit wählen. Dann als Kämpfer oder passiv erzeugen, oder die Persönlichkeit dem Ziel-Gegner geben.
- **KI-Regler** (alle Gegner, 25–200 %): Schwierigkeit, Aggression, Reaktion, Lernfähigkeit, Moral, Verteidigung
- **Physik:**
  - Ragdoll an/aus
  - wie viele gleichzeitig aktiv
  - Stöße als rote Pfeile anzeigen
- **Tests am Ziel-Gegner:** Zu Boden, Stolpern, Entwaffnen, Packt Waffe (greift nach deiner langsamen Klinge in Reichweite), Ergeben
- **Ergebene:** wegschicken, wieder kämpfen, entwaffnet lassen, entfernen
- **Anzeige über den Gegnern:**
  - Persönlichkeit
  - Zustand
  - Moral, Ausdauer, Leben
  - gewählter Hieb oder Entscheidung
  - erkannte Muster
  - Physik-Zustand, Hebel
- **Oben im Menü:** aktive und eingefrorene Ragdolls, Bildrate, Rechenzeit der Gegner

## PC-Test ohne Brille

| Taste | Aktion |
|---|---|
| rechte Maus ziehen | umschauen |
| WASD | gehen, auch auf den Tisch hinauf |
| Q | Waffen-Menü |
| T | Test-Menü (wenn in den Einstellungen freigeschaltet) |
| 1–9, 0 | die ersten zehn Waffen im Waffen-Menü; alle über Q |
| Linksklick | Hieb oder Schlag dorthin, wo das Fadenkreuz zeigt; Bogen: halten = spannen; Armbrust: erst spannen, dann schießen |
| E | Stich |
| Leertaste | Deckung: Schild vor den Körper bzw. Klinge quer über den Kopf |
| F | Waffe in der Hand werfen |
| Enter / Esc | Start / Pause |

## Dateien

| Datei | Inhalt |
|---|---|
| `js/main.js` | Hände und Laser, Raum-Einrichtung, Waffen führen, Treffer und Blocks des Spielers, Menüs, Hauptschleife |
| `js/enemies.js` | Kampf-KI: Angriffsbahnen, Paraden, Schildführung, Trefferzonen, Verletzungen, Moral, Ergeben, Flucht, Waffe packen, Stürze, Bogenschützen |
| `js/ai.js` | Persönlichkeiten, Wahrnehmung und Lernen (Spielstil), Moral-Ereignisse |
| `js/ragdoll.js` | Ragdoll-Physik (cannon-es): Körperteile, Gelenke, Budget, Einfrieren, Aufsteh-Übergang |
| `js/fighter.js` | Gegner-Modelle und Daten: Typen, Rüstungen, Waffen, Angriffe |
| `js/weapons.js` | Waffen des Spielers, Pfeilflug, Wurfdolch |
| `js/geom.js` | Geometrie für Treffer: Abstand Strecke–Strecke, Strecke–Scheibe |
| `js/arrow.js` | Pfeil-Modell |
| `js/nav.js` | Laufwege: Raster mit Höhen und A*-Wegsuche |
| `js/room.js` | Raum-Modell; Speichern und Laden |
| `js/physics.js` | Physik für fallen gelassene Waffen |
| `js/effects.js`, `js/sfx.js`, `js/util.js` | Partikel, Texte, Geräusche, Hilfsfunktionen |
| `tools/version.py` | Versionsnummer setzen: `python3 tools/version.py 10` |
