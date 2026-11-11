# Burg-Abwehr (Mittelalter) – Neuanfang

Ein Mittelalter-Spiel für die Meta Quest 3 (WebXR mit Passthrough).
Das Grundgerüst stammt aus dem Projekt **VrSpiel**. Alle Spielinhalte sind entfernt, damit wir sie neu bauen können.

Starten: `index.html` über einen Webserver öffnen, z. B. über GitHub Pages oder lokal mit `python3 -m http.server`.

## Was übernommen wurde

- **Raum einrichten:**
  - Wände, Türen und Fenster mit dem Laser einzeichnen
  - Tische und Stühle aufziehen
  - Bodenhöhe einstellen
  - Flächen löschen, letzten Schritt rückgängig machen
  - Raum aus der Quest-Raumeinrichtung übernehmen
  - 5 Speicherplätze für Räume
  - Ausrichten: eine geladene Karte an die echten Wände anlegen
- **Türen und Fenster:** dunkler Flur mit Flackerlicht hinter Türen, Nachthimmel mit Blitz und Donner hinter Fenstern
- **Physik:** cannon-es; echte Wände und Möbel sind feste Körper
- **Greifen und Werfen:**
  - Gegenstände greifen: Griff-Taste
  - aus der Ferne heranziehen: Laser + Griff-Taste
  - werfen: loslassen
  - Zum Testen gibt es Holzkisten.
- **Menü:**
  - Hauptmenü
  - Einstellungen: Ton, Bedienung, Grafik
  - Pause-Menü: Stick drücken oder B/Y, am PC Esc
- **Technik:**
  - Schatten
  - Staub in der Luft
  - Leistungsprofile
  - automatische Anpassung, wenn es ruckelt
  - Bildrate 72, 90 oder 120 Hz
  - Fehler werden abgefangen, das Spiel läuft weiter
- **PC-Test ohne Brille:**
  - umschauen: rechte Maus ziehen
  - gehen: WASD
  - Kiste greifen, nochmal klicken = werfen: Linksklick
  - Testkiste erzeugen: C

## Was entfernt wurde

Alle Waffen, Schilde, Bögen, Dolche und Brandbomben, außerdem:

- Tränke und Automaten, Schmiede, Schatztruhe, Wandkäufe, Fallen
- Gegner (Skelette, Troll, Boss) mit ihren 3D-Modellen
- Wellen, Punkte, Bestenliste, Bretter an Türen und Fenstern

Ältere gespeicherte Räume aus dem Hauptspiel lassen sich weiter laden. Wandkauf-, Automaten- und Kisten-Plätze darin werden übersprungen.

## Dateien

| Datei | Inhalt |
|---|---|
| `js/main.js` | Grundgerüst: Hände, Greifen, Raum-Einrichtung, Menü, Einstellungen, Pause, Hauptschleife |
| `js/room.js` | Raum-Modell: Wände, Türen, Fenster, Tische, Stühle; Speichern und Laden |
| `js/physics.js` | Physik-Welt (cannon-es) |
| `js/effects.js` | Partikel, schwebende Texte, Trümmer, Flecken |
| `js/sfx.js` | Synthetische Geräusche und Musik (Web Audio, keine Audiodateien) |
| `js/util.js` | Text-Panels, Materialien, Geometrie-Hilfen |
| `tools/version.py` | Versionsnummer setzen, damit der Browser keine alten Dateien nutzt: `python3 tools/version.py 4` |
