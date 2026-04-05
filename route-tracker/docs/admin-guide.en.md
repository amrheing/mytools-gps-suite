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

### 2 · API Tokens

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

### 3 · Shared Links

Create time-limited public links to share a route view with people who have no account.

| Field | Description |
|---|---|
| Device | Which device's route to share |
| Expires | How long the link is valid (hours) |
| Password | Optional password protection |

Copy the generated link and send it. It opens a read-only map view without requiring login.

---

### 4 · Media Management

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
