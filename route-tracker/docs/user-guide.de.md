# Route Tracker – Benutzerhandbuch

## Übersicht

Route Tracker ist eine Live-GPS-Tracking-Web-App, die Positionsdaten von der **Overlander**-iPhone-App empfängt und auf einer interaktiven Karte anzeigt. Du kannst Routen, Statistiken, Fotos und Videos auf der Karte ansehen sowie Tracks exportieren.

---

## Anmelden

Öffne die Route-Tracker-URL im Browser. Wenn du noch nicht eingeloggt bist, wirst du zur Anmeldeseite weitergeleitet.

- Gib deinen **Benutzernamen** und dein **Passwort** ein.
- Nach dem Login wirst du zur Hauptansicht weitergeleitet.
- Klicke auf **Logout** oben rechts im Header, um deine Sitzung zu beenden.

---

## Hauptansicht

### Steuerungsleiste (linke Seitenleiste)

Als normaler Benutzer siehst du:

| Element | Beschreibung |
|---|---|
| **GPS Monitoring** Schaltfläche | Startet/stoppt das automatische Abrufen neuer Positionsdaten |
| **Gerät** Auswahl | Wechsel zwischen verfügbaren GPS-Geräten |
| **Status** Anzeige | Zeigt Gerätename, Verbindungsstatus und letzte Aktualisierungszeit |

> Token-Einrichtung, Steuerungsbereich (Auto-Refresh, Trennen, Aktualisierungsrate) und der Konfigurationsbereich sind nur für Admins sichtbar.

### Karte

Die Karte zeigt die aktuelle Route als Linie mit Start-Markierung und aktueller Position.

- **Zoomen / Verschieben** ist jederzeit möglich – die Karte setzt die Ansicht nicht automatisch zurück, nachdem du sie bewegt hast.
- Schaltfläche **Reset View** (oben rechts auf der Karte) – passt die Karte wieder an die gesamte Route an.
- Ein Klick auf ein **Foto-Thumbnail** oder **YouTube-Symbol** auf der Karte öffnet den Medien-Viewer.

### Statistik-Dashboard

Zeigt eine Zusammenfassung der aktuell geladenen Route:

| Statistik | Beschreibung |
|---|---|
| Distanz | Gesamtstreckenlänge in km |
| Dauer | Verstrichene Zeit seit Routenstart |
| Ø Geschwindigkeit | Durchschnittsgeschwindigkeit in km/h |
| Max. Geschwindigkeit | Höchstgeschwindigkeit in km/h |
| Höhe | Aktuelle Höhe in Metern |
| GPS-Punkte | Gesamtanzahl aufgezeichneter Punkte |

### Routenverwaltung

Export-Schaltflächen stehen allen Benutzern zur Verfügung:

- **Export GPX** – lädt die aktuelle Route als GPX-Datei herunter (kompatibel mit den meisten GPS-Apps und -Geräten).
- **Export KML** – Download als KML (Google Earth / Maps).
- **Export JSON** – Rohdaten-Export im JSON-Format.

Die **Routenverlauf**-Liste zeigt alle gespeicherten Routen. Klicke auf **Laden**, um eine frühere Route auf der Karte anzuzeigen.

> Die Schaltfläche **Teilen** ist nur für Admins verfügbar.

---

## Medien auf der Karte

Foto-Thumbnails und YouTube-Symbole erscheinen als runde Marker auf der Karte.

- **Klick** auf einen Marker öffnet das vollständige Foto oder spielt das eingebettete YouTube-Video ab.
- Im Viewer kannst du ein Foto **herunterladen** oder einen YouTube-Link in einem neuen Tab **öffnen**.

> Medien hochladen und neu positionieren ist nur für Admins möglich.
