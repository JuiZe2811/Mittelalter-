# Burg-Abwehr (Mittelalter)

Ein Mittelalter-Spiel für die Meta Quest 3 (WebXR mit Passthrough).
Skelette kommen durch die Türen und Fenster deines echten Raums. Du wehrst dich mit Dolch, Langschwert, Schild und Bogen.

Starten: `index.html` über einen Webserver öffnen, z. B. über GitHub Pages oder lokal mit `python3 -m http.server`.

## Map einrichten (mit dem Laser)

- Wände, Türen und Fenster einzeichnen
- Tische, Betten und Stühle einzeichnen; ein Bett zeichnest du als Tisch ein
- Bodenhöhe einstellen
- Flächen löschen, letzten Schritt rückgängig machen
- Raum aus der Quest-Raumeinrichtung übernehmen
- 5 Speicherplätze für Räume
- Ausrichten: eine geladene Karte an die echten Wände anlegen

## Gegner: nur normale Skelette

Es gibt keine Bosse und keine Riesen.

- Die Skelette erscheinen draußen und kommen von dort herein:
  - Durch Türen laufen sie hindurch.
  - Durch Fenster klettern sie über die Brüstung.
- Im Raum laufen sie um Wände, Stühle und hohe Möbel herum.
- **Klettern:** Auf niedrige Hindernisse bis 1,05 m Höhe, zum Beispiel Bett oder Tisch, klettern sie hinauf. Das dauert kurz. Stehst du auf dem Bett, kommen sie zu dir hoch.
- **Angriff:** Sie holen sichtbar mit dem Schwert über den Kopf aus und schlagen dann zu.
  - Jeder Treffer kostet 14 Leben.
  - Leben kommt langsam zurück, wenn du eine Weile nicht getroffen wirst.
- **Treffer:**
  - Kopftreffer zählen dreifach.
  - Getroffene Skelette taumeln, und ihr Angriff wird unterbrochen.
  - Bei 0 Leben zerfallen sie in Knochen.
- Mit der Zeit wird es schwerer: Es kommen mehr Skelette gleichzeitig, höchstens 8, und sie kommen schneller nach.

## Waffen

Zu Beginn schweben alle Waffen vor dir. Du nimmst sie so:
- hingreifen und die Griff-Taste halten
- oder mit dem Laser darauf zeigen und die Griff-Taste drücken, dann fliegt die Waffe in deine Hand

Loslässt du eine Waffe, fällt sie mit Physik herunter. Im Pause-Menü holt **Waffen holen** alle Waffen wieder vor dich.

| Waffe | Bedienung |
|---|---|
| 🗡 Dolch | Schnell zustechen oder schlagen. Lässt du ihn mitten im Schwung los, fliegt er als Wurfdolch. |
| ⚔ Langschwert | Kräftig ausholen. Je schneller die Klinge, desto mehr Schaden; Langsames Hineinhalten zählt nicht. |
| 🛡 Schild | Halte ihn zwischen dich und das Skelett, dann wird der Schlag geblockt und das Skelett taumelt zurück. |
| 🏹 Bogen | In einer Hand halten, mit der anderen Hand die Sehne greifen (Griff-Taste), zurückziehen und loslassen. Je weiter du ziehst, desto schneller und stärker ist der Pfeil. Pfeile sind unbegrenzt. |

## Anzeige und Menü

- **Anzeige:** Leben (❤) und erledigte Skelette (💀) siehst du am linken Handgelenk, am PC unten links.
- **Pause:** Stick drücken oder B/Y mit freier Hand, am PC Esc.
  - Weiter
  - Einstellungen
  - Waffen holen
  - Runde beenden
- **Nach der Runde** zeigt das Menü, wie viele Skelette du erledigt hast und wie lange du durchgehalten hast.

## PC-Test ohne Brille

| Taste | Aktion |
|---|---|
| rechte Maus ziehen | umschauen |
| WASD | gehen, auch auf den Tisch hinauf (zum Testen des Kletterns) |
| 1 / 2 / 3 / 4 | Dolch / Schwert / Bogen / Schild (Schild zusätzlich links) |
| Linksklick | zuschlagen; mit dem Bogen gedrückt halten = spannen, loslassen = schießen |
| F | Dolch werfen |
| Enter | Start |
| Esc | Pause |

## Dateien

| Datei | Inhalt |
|---|---|
| `js/main.js` | Hände und Laser, Raum-Einrichtung, Waffen greifen und benutzen, Leben, Menü, Pause, Hauptschleife |
| `js/weapons.js` | Waffen-Modelle (Dolch, Langschwert, Schild, Bogen, Pfeil), Pfeilflug, Wurfdolch |
| `js/enemies.js` | Skelette: Aussehen, Erscheinen an Türen/Fenstern, Laufen, Klettern, Angriff, Trefferzonen |
| `js/nav.js` | Laufwege: Raster mit Höhen (Bett/Tisch) und A*-Wegsuche |
| `js/room.js` | Raum-Modell; Speichern und Laden |
| `js/physics.js` | Physik (cannon-es) für fallen gelassene Waffen |
| `js/effects.js` | Partikel, schwebende Texte, Trümmer |
| `js/sfx.js` | Synthetische Geräusche (Web Audio) |
| `js/util.js` | Text-Panels und Hilfsfunktionen |
| `tools/version.py` | Versionsnummer setzen: `python3 tools/version.py 6` |
