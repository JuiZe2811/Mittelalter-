# Burg-Abwehr (Mittelalter) – Grundgerüst

Ein Mittelalter-Spiel für die Meta Quest 3 (WebXR mit Passthrough). Das ist ein kompletter Neuanfang.
Bisher gibt es nur die Map und Skelette, die durch Türen und Fenster hereinkommen.
Waffen und alles Weitere bauen wir als Nächstes.

Starten: `index.html` über einen Webserver öffnen, z. B. über GitHub Pages oder lokal mit `python3 -m http.server`.

## Was das Spiel kann

**Map einrichten (mit dem Laser):**
- Wände, Türen und Fenster einzeichnen
- Tische und Stühle einzeichnen
- Bodenhöhe einstellen
- Flächen löschen, letzten Schritt rückgängig machen
- Raum aus der Quest-Raumeinrichtung übernehmen
- 5 Speicherplätze für Räume
- Ausrichten: eine geladene Karte an die echten Wände anlegen

**Stimmung:** Hinter Türen liegt ein dunkler Flur mit Flackerlicht, hinter Fenstern ein Nachthimmel mit Blitz und Donner.

**Skelette:**
- Sie erscheinen draußen und kommen von dort herein:
  - Durch Türen laufen sie hindurch.
  - Durch Fenster klettern sie über die Brüstung.
- Im Raum laufen sie um Wände, Tische und Stühle herum zum Spieler.
- Es sind höchstens 6 Skelette gleichzeitig unterwegs.
- Sind keine Türen oder Fenster eingezeichnet, steigen sie aus dem Boden.
- Noch harmlos, weil es keine Waffen gibt: Beim Spieler holen sie aus und zerfallen nach 12 Sekunden.

**Menü:**
- Hauptmenü: START, Raum einrichten, Einstellungen
- Einstellungen: Ton, Bedienung, Grafik
- Pause: Stick drücken oder B/Y, am PC Esc

**PC-Test ohne Brille:**
- umschauen: rechte Maus ziehen
- gehen: WASD
- Menü und Raum-Werkzeuge: Linksklick
- starten: Enter

## Dateien

| Datei | Inhalt |
|---|---|
| `js/main.js` | Hände/Laser, Raum-Einrichtung, Menü, Einstellungen, Pause, Hauptschleife |
| `js/room.js` | Raum-Modell: Wände, Türen, Fenster, Tische, Stühle; Speichern und Laden |
| `js/enemies.js` | Skelette: Aussehen, Erscheinen an Türen/Fenstern, Laufen, Klettern, Animation |
| `js/nav.js` | Laufwege: Raster über dem Raum und A*-Wegsuche |
| `js/physics.js` | Physik-Welt (cannon-es); Wände und Möbel sind feste Körper |
| `js/effects.js` | Partikel, schwebende Texte, Trümmer |
| `js/sfx.js` | Synthetische Geräusche (Web Audio, keine Audiodateien) |
| `js/util.js` | Text-Panels und Hilfsfunktionen |
| `tools/version.py` | Versionsnummer setzen, damit der Browser keine alten Dateien nutzt: `python3 tools/version.py 5` |

Räume, die im alten Spiel (VrSpiel) gespeichert wurden, lassen sich laden.
Wandkauf-, Automaten- und Kistenplätze darin werden übersprungen.
