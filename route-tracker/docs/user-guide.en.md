# Route Tracker – User Guide

## Overview

Route Tracker is a live GPS tracking web app that receives position data from the **Overlander** iPhone app and displays it on an interactive map. You can view routes, statistics, photos and videos placed on the map, and export your tracks.

---

## Logging In

Open the Route Tracker URL in your browser. You will be redirected to the login page if you are not already logged in.

- Enter your **username** and **password**.
- After login you are redirected back to the main view.

---

## Main View

### Control Panel (left sidebar)

| Element | Description |
|---|---|
| **GPS Monitoring** button | Starts/stops automatic polling for new position data |
| **Auto Refresh** button | Toggles automatic refresh every few seconds |
| **Refresh** button | Manually fetches the latest position and route |
| **Device** display | Shows the GPS device currently being tracked |
| **Status** | Shows connection state, last update time and number of GPS points |

### Map

The map shows the current route as a polyline with start marker and current-position marker.

- **Zoom / Pan** freely — the map will not automatically reset its view after you interact with it.
- **Reset View** button (top right of map) — fits the map back to the full route.
- Clicking a **photo thumbnail** or **YouTube icon** on the map opens the media viewer.

### Statistics Dashboard

Shows a summary of the current route:

| Stat | Description |
|---|---|
| Distance | Total route length in km |
| Duration | Elapsed time since route start |
| Avg Speed | Average speed in km/h |
| Max Speed | Peak speed in km/h |
| Elevation | Current altitude in metres |
| GPS Points | Total number of recorded points |

### Route Management

- **Export GPX** – downloads the current route as a GPX file (compatible with most GPS apps and devices).
- **Export KML** – downloads as KML (Google Earth / Maps).
- **Export JSON** – raw JSON data export.
- The **Route History** list below the export buttons shows all saved routes. Click **Load** to display a past route on the map.

---

## Media on the Map

Photo thumbnails and YouTube icons appear as circular markers on the map.

- **Click** a marker to open the full photo or play the embedded YouTube video.
- In the viewer you can **download** a photo or **open** a YouTube link in a new tab.

---

## Overlander App Setup

The app receives GPS data from the **Overlander** iPhone app via a webhook URL.

1. Open the Overlander app on your iPhone.
2. Go to **Settings → Webhooks**.
3. Enter the URL shown in the *Overlander Setup* section of the control panel.
4. The app will then send your position automatically while tracking.

---

## Logging Out

Click the **Logout** button in the top-right header to end your session.
