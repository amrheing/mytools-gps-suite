# Route Tracker – Admin-Handbuch

## Übersicht

Als Admin hast du vollen Zugriff auf alle Funktionen von Route Tracker: Benutzerverwaltung, API-Token-Konfiguration, Medien-Upload und -Verwaltung, freigegebene Links und Debug-Werkzeuge.

---

## Admin-Panel (`/admin`)

Öffne das Admin-Panel über die Schaltfläche **Admin** oben rechts im Header (nur für Admins sichtbar).

---

### 1 · Benutzerverwaltung

Benutzerkonten erstellen und verwalten.

| Aktion | Vorgehensweise |
|---|---|
| **Benutzer hinzufügen** | Klicke auf **Benutzer hinzufügen**, Benutzername, Passwort und Rolle eingeben |
| **Benutzer bearbeiten** | Klicke auf das Stift-Symbol neben einem Benutzer |
| **Benutzer löschen** | Klicke auf das Papierkorb-Symbol neben einem Benutzer |
| **Passwort ändern** | Benutzer bearbeiten und neues Passwort eingeben |

**Rollen:**

| Rolle | Zugriff |
|---|---|
| `admin` | Vollzugriff – alle Funktionen, Admin-Panel, Medien-Upload, Debug-Werkzeuge |
| `viewer` | Nur lesend – kann Karte und Routen ansehen, kein Upload oder Konfiguration |

---

### 2 · API-Tokens

API-Tokens verknüpfen einen eingehenden GPS-Webhook mit einem bestimmten Gerät und Benutzer.

| Aktion | Vorgehensweise |
|---|---|
| **Token erstellen** | Klicke auf **Token hinzufügen**, Namen eingeben und Geräte-IDs zuweisen |
| **Token widerrufen** | Klicke auf das Papierkorb-Symbol neben einem Token |
| **Token kopieren** | Klicke auf das Kopier-Symbol – in die Overlander-Webhook-URL einfügen |

Der Token wird als Query-Parameter angehängt:
```
https://deine-domain.com/route-tracker/api/gps?token=DEIN_TOKEN
```

---

### 3 · Freigegebene Links

Erstelle zeitlich begrenzte öffentliche Links, um eine Routenansicht mit Personen zu teilen, die kein Konto haben.

| Feld | Beschreibung |
|---|---|
| Gerät | Welche Route des Geräts geteilt werden soll |
| Ablauf | Wie lange der Link gültig ist (in Stunden) |
| Passwort | Optionaler Passwortschutz |

Kopiere den generierten Link und sende ihn weiter. Er öffnet eine schreibgeschützte Kartenansicht ohne Login.

---

### 4 · Medienverwaltung

Alle Medieneinträge pro Gerät ansehen, Beschreibungen bearbeiten, neu positionieren und löschen.

- Jedes Gerät ist als aufklappbare Sektion aufgelistet – klicken zum Öffnen.
- Die Tabelle zeigt: Typ (Foto/YouTube), Beschreibung, Koordinaten, Datum und Aktionsschaltflächen.
- **Bearbeiten** (Stift) – Beschreibungstext ändern.
- **Löschen** (Papierkorb) – entfernt den Eintrag und seine Dateien dauerhaft.

---

## Hauptansicht – Exklusive Admin-Funktionen

### Medien-Upload

Klicke auf **Medien hinzufügen** im Karten-Header, um ein Foto oder YouTube-Video an einen Kartenort zu heften.

#### Foto

1. Bilddatei auswählen.
2. Enthält das Foto **EXIF-GPS-Daten**, werden die Koordinaten automatisch erkannt und angezeigt.
3. Werden keine GPS-Daten gefunden, schließt sich der Dialog und der Cursor wechselt zum Fadenkreuz – **Klick auf die Karte** setzt den Ort. Der Dialog öffnet sich wieder mit den gewählten Koordinaten.
4. Optionale Beschreibung eingeben.
5. Klicke auf **Foto hochladen**.

#### YouTube

1. Zum Reiter **YouTube** wechseln.
2. YouTube-URL einfügen (`youtu.be/...` oder `youtube.com/watch?v=...`).
3. Beschreibung eingeben.
4. Auf die Karte klicken, um den Ort festzulegen.
5. Klicke auf **Video hinzufügen**.

#### Medien-Marker neu positionieren

Als Admin zeigen alle Medien-Marker auf der Karte einen **Greif-Cursor**. Einfach das Thumbnail oder YouTube-Symbol an die neue Position **ziehen** – die neuen Koordinaten werden automatisch gespeichert.

---

### Routen-Steuerung

| Schaltfläche | Beschreibung |
|---|---|
| **Test Connection** | Prüft die Verbindung zum GPS-API-Endpunkt |
| **Debug** | Öffnet das System-Debug-Panel mit Sitzungsinfos und Live-GPS-Monitor |
| **Clear Route** | Entfernt die aktuelle Live-Route von der Karte (löscht nicht vom Server) |
| **Reset View** | Passt die Karte wieder an den gesamten Routenbereich an |

---

### Test- / Simulations-Werkzeuge

Der Abschnitt **Testing Tools** (nur Admin, aufklappbar) ermöglicht die Simulation von GPS-Eingaben ohne echtes Gerät:

| Schaltfläche | Beschreibung |
|---|---|
| **GPS Sender starten/stoppen** | Sendet fortlaufend simulierte GPS-Punkte |
| **Einzelnen GPS senden** | Sendet einen GPS-Punkt am aktuellen Kartenmittelpunkt |
| **Fake GPS senden** | Sendet einen fest codierten Testpunkt |
| **Zufälligen Punkt senden** | Sendet einen zufälligen Punkt nahe der letzten bekannten Position |

---

### Overlander-Setup

Klicke auf **Overlander Setup** in der Steuerungsleiste, um die genaue Webhook-URL und den Token für die Overlander-iPhone-App anzuzeigen.

---

## Deployment-Hinweise

Infrastrukturdetails (nginx-Konfigurationspfad, Landingpage-Ort, Container-Rebuild-Befehle, statisches Datei-Deployment) befinden sich in `.github/DEPLOYMENT.md`.
