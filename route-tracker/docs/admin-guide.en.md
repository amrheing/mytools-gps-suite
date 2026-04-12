# Route Tracker – Admin Guide

## Overview

As an admin you have full access to all features of Route Tracker: user management, API token configuration, media upload and management, shared links, and debugging tools.

---

## Admin Panel (`/admin`)

Access the admin panel via the **Admin** button in the top-right header (only visible to admins).

---

### 1 · User Management

Create and manage user accounts.

| Action | How |
|---|---|
| **Add user** | Click **Add User**, fill in username, password, and select role |
| **Edit user** | Click the pencil icon next to a user |
| **Delete user** | Click the trash icon next to a user |
| **Change password** | Edit the user and enter a new password |

**Roles:**

| Role | Access |
|---|---|
| `admin` | Full access — all features, admin panel, media upload, debug tools |
| `viewer` | Read-only — can view map and routes, no upload or config |

---

### 2 · GPS Incoming Log

The **GPS Incoming Log** section is visible only to admin users who have the **Log Viewer Access** permission enabled on their account.

It shows a real-time record of every HTTP request received by the server, with full details of each incoming GPS push from OwnTracks or any other client.

#### Controls

| Control | Description |
|---|---|
| **Refresh** button | Reloads the log from the server (last 50 entries) |
| **GPS pushes only** checkbox | When checked, filters the log to show only `POST /api/gps` requests — hides all other API calls |
| Summary line | Shows total requests in the log and how many are GPS pushes |

#### Log Entry Fields

Each entry shows:

- **Timestamp** — date and time the request was received
- **Method + Path** — e.g. `POST /api/gps`
- **Status code** — HTTP response sent back (200 = success, 401 = auth failure, etc.)
- **User / Device** — which user and device ID the push was attributed to
- **Payload summary** — latitude, longitude, speed, altitude, accuracy if present
- **Response time** — how long the server took to process the request

#### Enabling Log Access for a User

1. Go to **User Management** → edit an admin user.
2. Check **Log Viewer Access**.
3. Save. The GPS Incoming Log section will appear for that user on next page load.

> Only admin role users can be granted log access. The setting has no effect on viewer accounts.

---

### 3 · API Tokens

API tokens link an incoming GPS webhook to a specific device and user.

| Action | How |
|---|---|
| **Create token** | Click **Add Token**, enter a name and assign device IDs |
| **Revoke token** | Click the trash icon next to a token |
| **Copy token** | Click the copy icon — paste into the Overlander webhook URL |

The token is appended as a query parameter:
```
https://your-domain.com/route-tracker/api/gps?token=YOUR_TOKEN
```

---

### 5 · Device Management

Manage registered GPS devices and configure auto-route settings.

- Each device shows: Device ID, Name, Route Count, GPS Points, Auto-Route Status, Last Update
- **Auto-Route column** displays current scheduling status:
  - **🤖 HH:MM** — Auto-route enabled with daily creation time
  - **✖ Disabled** — Auto-route turned off for this device

| Action | How |
|---|---|
| **Configure auto-route** | Click the robot (🤖) icon next to a device |
| **Rename device** | Click the pencil icon to change the display name |
| **Delete device** | Click the trash icon (permanently removes all routes and media) |

#### Auto-Route Settings

Click the **🤖** button next to any device to configure automatic route creation:

- **Enable auto-route creation** — Toggle daily route generation
- **Daily creation time** — Set when new routes should be created (24-hour format, default: 00:00)
- **Test Now** — Create an auto-route immediately for testing
- **Save Settings** — Apply configuration to the device

**How Auto-Route Works:**
1. Server checks every minute if it's time to create a new route
2. Any active route is automatically completed before creating the new one  
3. New route gets name format: "Auto Route MM/DD/YYYY"
4. GPS tracking continues seamlessly with the new route
5. Previous routes remain available in route history

> **Note:** Auto-route creation only triggers if the device has been active (received GPS data) within the last 24 hours. This prevents creating empty routes for inactive devices.

---

### 6 · Shared Links

Create time-limited public links to share a route view with people who have no account.

| Field | Description |
|---|---|
| Device | Which device's route to share |
| Expires | How long the link is valid (hours) |
| Password | Optional password protection |

Copy the generated link and send it. It opens a read-only map view without requiring login.

---

### 7 · Media Management

View, edit descriptions, reposition, and delete all media entries per device.

- Each device is listed as a collapsible accordion — click to expand.
- The table shows: type (photo/YouTube), description, coordinates, date, and action buttons.
- **Edit** (pencil) — change the description text.
- **Delete** (trash) — permanently removes the entry and its files.

---

## Main View – Admin-Only Features

### Media Upload

Click **Add Media** in the map header to attach a photo or YouTube video to a map location.

#### Photo

1. Select an image file.
2. If the photo contains **EXIF GPS data**, coordinates are extracted automatically and shown.
3. If no GPS data is found, the dialog closes and the cursor changes to a crosshair — **click on the map** to set the location. The dialog reopens with the picked coordinates.
4. Add an optional description.
5. Click **Upload Photo**.

#### YouTube

1. Switch to the **YouTube** tab.
2. Paste a YouTube URL (`youtu.be/...` or `youtube.com/watch?v=...`).
3. Add a description.
4. Click on the map to set the location.
5. Click **Add Video**.

#### Repositioning a Media Marker

As an admin, all media markers on the map have a **grab cursor**. Simply **drag** a thumbnail or YouTube icon to a new position — the new coordinates are saved automatically.

---

### Route Controls

| Button | Description |
|---|---|
| **Test Connection** | Checks connectivity to the GPS API endpoint |
| **Debug** | Opens the system debug panel with session info and live GPS monitor |
| **Clear Route** | Removes the current live route from the map (does not delete from server) |
| **Reset View** | Fits the map back to the full route extent |
| **Show Points** | Toggles small dot markers on the route line for every GPS point. Click a dot for details (coords, speed, altitude, timestamp) |
| **Edit Points** | Enters route point editing mode — see below |

---

### Route Point Editing (admin-only)

Click **Edit Points** in the map header to enter editing mode. A yellow toolbar appears above the map.

#### Interactions

| Action | How |
|---|---|
| **Move a point** | Click and hold a dot, then drag it to the new position. The route line updates live |
| **Add a point** | Right-click a dot → **Add point after**. A new point (shown in blue) is inserted as a midpoint between that point and the next. Drag it to the correct location |
| **Delete a point** | Right-click a dot → **Delete point**. At least 2 points must remain |
| **Dismiss menu** | Click elsewhere on the map, or press **Esc** |

#### Saving

- **Save** — writes the edited points to the server and recalculates the total distance and timestamps. Returns to normal view.
- **Discard** — discards all changes and reloads the original route from the server.

> Edits are **not** auto-saved. You must click Save explicitly.

---

### Test / Simulation Tools

The **Testing Tools** section (admin-only, collapsible) allows simulating GPS input without a real device:

| Button | Description |
|---|---|
| **Start/Stop GPS Sender** | Continuously sends simulated GPS points |
| **Send Single GPS** | Sends one GPS point at the current map center |
| **Send Fake GPS** | Sends a hardcoded test point |
| **Send Random Nearby** | Sends a random point near the last known position |

---

### Overlander Setup

Click **Overlander Setup** in the control panel to display the exact webhook URL and token to use in the Overlander iPhone app.

---

## Deployment Notes

See `.github/DEPLOYMENT.md` for infrastructure details (nginx config path, landing page location, container rebuild commands, static file deployment).
