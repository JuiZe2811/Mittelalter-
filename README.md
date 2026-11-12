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
| 🛡 Schild | Block, Schildstoß | | |
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

## PC-Test ohne Brille

| Taste | Aktion |
|---|---|
| rechte Maus ziehen | umschauen |
| WASD | gehen, auch auf den Tisch hinauf |
| Q | Waffen-Menü |
| 1–9, 0 | Dolch, Schwert, Streitkolben, Axt, Hammer, Speer, Bogen, Armbrust, Schild, Stein |
| Linksklick | Hieb oder Schlag dorthin, wo das Fadenkreuz zeigt; Bogen: halten = spannen; Armbrust: erst spannen, dann schießen |
| E | Stich |
| Leertaste | Deckung: Schild vor den Körper bzw. Klinge quer über den Kopf |
| F | Waffe in der Hand werfen |
| Enter / Esc | Start / Pause |

## Dateien

| Datei | Inhalt |
|---|---|
| `js/main.js` | Hände und Laser, Raum-Einrichtung, Waffen führen, Treffer und Blocks des Spielers, Menüs, Hauptschleife |
| `js/enemies.js` | Kampf-KI: Angriffsbahnen, Paraden, Schildführung, Trefferzonen, Verletzungen, Flucht, Bogenschützen |
| `js/fighter.js` | Gegner-Modelle und Daten: Typen, Rüstungen, Waffen, Angriffe |
| `js/weapons.js` | Waffen des Spielers, Pfeilflug, Wurfdolch |
| `js/geom.js` | Geometrie für Treffer: Abstand Strecke–Strecke, Strecke–Scheibe |
| `js/arrow.js` | Pfeil-Modell |
| `js/nav.js` | Laufwege: Raster mit Höhen und A*-Wegsuche |
| `js/room.js` | Raum-Modell; Speichern und Laden |
| `js/physics.js` | Physik für fallen gelassene Waffen |
| `js/effects.js`, `js/sfx.js`, `js/util.js` | Partikel, Texte, Geräusche, Hilfsfunktionen |
| `tools/version.py` | Versionsnummer setzen: `python3 tools/version.py 10` |
