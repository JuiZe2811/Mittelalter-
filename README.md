# Burg-Abwehr (Mittelalter)

Ein Mittelalter-Kampfspiel für die Meta Quest 3 (WebXR mit Passthrough).
Bewaffnete Angreifer kommen durch die Türen und Fenster deines echten Raums. Du kämpfst mit Dolch, Langschwert, Schild und Bogen.
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
| Tiefer Hieb | auf die Beine |
| Stich | Brust; mit dem Speer auch Kopf oder Bein |
| Schildstoß | Schildträger und Ritter stoßen aus der Nähe mit dem Schild zu |
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

### Deine Angriffe

- **Hieb:** Die Klinge muss wirklich geschwungen werden. Je schneller, desto mehr Schaden; langsames Hineinhalten zählt nicht.
- **Schneide:** Ein Hieb mit der Schneide wirkt voll, mit der flachen Seite nur etwa halb.
- **Stich:** Eine Bewegung entlang der Klinge zählt als Stich. Stiche gehen deutlich besser durch Rüstung.
- **Schwert beidhändig:** Greifst du mit der zweiten Hand unten an den Griff, führen beide Hände die Klinge.
  - Hiebe werden 30 % stärker, Stiche 20 %.
  - Das Schwert hält auch schweren Schlägen stand.
- **Schildstoß:** Stößt du den Schild schnell nach vorne gegen einen Gegner, taumelt er zurück.
- **Dolch werfen:** Lässt du den Dolch mitten im Schwung los, fliegt er.
- **Bogen:** In einer Hand halten, mit der anderen die Sehne greifen, ziehen, loslassen. Pfeile bleiben im Gegner oder in seinem Schild stecken.

### Verteidigung der Gegner

- **Schild:** Der Schild wird nach oben, zur Mitte oder nach unten geführt. Was ihn trifft, ist geblockt. Ziele auf das, was er nicht deckt, oder schlage zu, während der Gegner selbst angreift – dann ist sein Schild zur Seite.
- **Parade:** Geübte Gegner parieren mit der Waffe und setzen danach oft zum Gegenangriff an.
- **Ausweichen:** Leichte Gegner springen zurück.
- Von hinten und von der Seite können sie nicht blocken.

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
| Stoff | 90 % | 95 % | 95 % |
| Leder | 70 % | 85 % | 85 % |
| Gambeson | 58 % | 80 % | 75 % |
| Kettenhemd | 30 % | 65 % | 85 % |
| Plattenrüstung | 12 % | 35 % | 70 % |
| Eisenhelm | 25 % | 50 % | 65 % |
| Topfhelm | 10 % | 25 % | 55 % |

## Gegner

Es gibt nur normale menschliche Gegner, keine Bosse und keine Riesen.

| Gegner | Bewaffnung | Rüstung | Besonderheit |
|---|---|---|---|
| Räuber | Dolch oder Keule | Stoff | schnell, weicht aus, flieht leicht |
| Söldner | Schwert | Gambeson, oft Helm | pariert, fintiert, Kombos |
| Schildträger | Schwert und Rundschild | Kettenhemd, Eisenhelm | blockt mit dem Schild, Schildstoß |
| Speerträger | Speer | Gambeson, Eisenhut | große Reichweite, Stiche auf Kopf, Brust und Bein |
| Axtkämpfer | Streitaxt (zweihändig) | Leder | langsam, sehr harte Schläge |
| Bogenschütze | Bogen, im Nahkampf Dolch | Stoff | hält Abstand, schießt |
| Ritter | Schwert und Wappenschild | Platte, Kettenbeine, Topfhelm | kaum mit Hieben zu verletzen |

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
| 1 / 2 / 3 / 4 | Dolch / Schwert / Bogen / Schild |
| Linksklick | Hieb dorthin, wo das Fadenkreuz zeigt; mit dem Bogen halten = spannen |
| E | Stich |
| Leertaste | Deckung: Schild vor den Körper bzw. Klinge quer über den Kopf |
| F | Dolch werfen |
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
| `tools/version.py` | Versionsnummer setzen: `python3 tools/version.py 8` |
