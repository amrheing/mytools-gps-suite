# Route Tracker – User Guide

## Overview

Route Tracker is a live GPS tracking web app that receives position data from the **Overlander** iPhone app and displays it on an interactive map. You can view routes, statistics, photos and videos placed on the map, and export your tracks.

---

## Logging In

Open the Route Tracker URL in your browser. You will be redirected to the login page if you are not already logged in.

- Enter your **username** and **password**.
- After login you are redirected back to the main view.
- Click **Logout** in the top-right header to end your session.

---

## Main View

### Control Panel (left sidebar)

As a regular user you see:

| Element | Description |
|---|---|
| **GPS Monitoring** button | Starts/stops automatic polling for new position data |
| **Device** selector | Switch between available GPS devices |
| **Status** display | Shows device name, connection status and last update time |

> The token setup, controls panel (auto-refresh, disconnect, refresh rate) and configuration section are only visible to admins.

### Map

The map shows the current route as a polyline with a start marker and a current-position marker.

- **Zoom / Pan** freely — the map will not reset its view after you interact with it.
- **Reset View** button (top right of map) — fits the map back to the full route.
- **Show Points** button (top right of map) — toggles small dots on the route line for every recorded GPS point. Click a dot to see its coordinates, speed, altitude, and timestamp.
- Clicking a **photo thumbnail** or **YouTube icon** on the map opens the media viewer.

### Statistics Dashboard

Shows a summary of the currently loaded route:

| Stat | Description |
|---|---|
| Distance | Total route length in km |
| Duration | Elapsed time since route start |
| Avg Speed | Average speed in km/h |
| Max Speed | Peak speed in km/h |
| Elevation | Current altitude in metres |
| GPS Points | Total number of recorded points |

### Route Management

Export buttons are available to all users:

- **Export GPX** – downloads the current route as a GPX file (compatible with most GPS apps and devices).
- **Export KML** – downloads as KML (Google Earth / Maps).
- **Export JSON** – raw JSON data export.

The **Route History** list shows all saved routes. Click **Load** to display a past route on the map.

> The **Share** button is only available to admins.

---

## Media on the Map

Photo thumbnails and YouTube icons appear as circular markers on the map.

- **Click** a marker to open the full photo or play the embedded YouTube video.
- In the viewer you can **download** a photo or **open** a YouTube link in a new tab.

> Uploading and repositioning media is only available to admins.
