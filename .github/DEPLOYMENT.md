# myTools GPS Suite — Deployment & Conventions

## Repo location
`/opt/containerd/myTools/` — git remote: https://github.com/amrheing/mytools-gps-suite

## Nginx — mailcow stack (CRITICAL)
- Tools are served by mailcow's nginx, NOT a separate nginx container
- Container name: `mailcowdockerized-nginx-mailcow-1`
- Real config file: `/opt/containerd/mailcow/data/conf/nginx/tools-amrhein-proxy.conf`
  - This is bind-mounted into the container at `/etc/nginx/conf.d/`
  - `/opt/containerd/web/nginx-tools.conf` is a STALE COPY — do NOT edit it
- Reload after config changes: `docker exec mailcowdockerized-nginx-mailcow-1 nginx -s reload`
- Test before reload: `docker exec mailcowdockerized-nginx-mailcow-1 nginx -t`
- Upstreams use host IP `172.22.1.1` + host port (e.g. `172.22.1.1:6050` for route-tracker)

## Landing page — tools.amrhein.info
- Real file: `/opt/containerd/mailcow/data/web/myTools/index.html`
- Served via nginx `alias /web/myTools/; try_files /index.html =404;`
- `/home/gerald/tools-landing-page.html` is a personal COPY — not the live file
- To add a new tool: add a `<a href="tool-name/" class="tool-card">` block inside `.grid-3` or `.grid-4`
- No container restart needed — file is bind-mounted, nginx reload is sufficient
- Shared CSS: `/opt/containerd/mailcow/data/web/myTools/shared/shared-styles.css`

## "Back to Tools" button — every tool page
Pattern (copy exactly from gpx-to-kml-converter):
```html
<header class="header">
    <div class="header-content">
        <div class="breadcrumb">
            <a href="/"><i class="fas fa-arrow-left"></i> Back to Tools</a>
        </div>
        <h1><i class="fas fa-ICON"></i> Tool Name</h1>
        <p class="subtitle">Subtitle here</p>
    </div>
    ...
</header>
```
- `.breadcrumb` CSS is in shared-styles.css — no extra CSS needed
- Link is always `href="/"` (root of tools.amrhein.info)

## route-tracker static file serving (GOTCHA)
- server.js serves static files from `/usr/share/nginx/html` (baked into image at build time)
- The `/app` bind mount does NOT affect what's served to users
- To deploy HTML/JS changes without full rebuild:
  ```
  docker cp ./route-tracker/index.html route-tracker:/usr/share/nginx/html/index.html
  docker cp ./route-tracker/script.js route-tracker:/usr/share/nginx/html/script.js
  ```
- For server.js changes: must rebuild — `docker compose up -d --build route-tracker`

## docker-compose.yml (live secrets file)
- `/opt/containerd/myTools/docker-compose.yml` — in `.gitignore`, NEVER commit
- `/opt/containerd/myTools/docker-compose.template.yml` — committed, has placeholders
- Sensitive vars: `ADMIN_PASSWORD`, `SESSION_SECRET`

## git workflow
- After editing files, check `git status` — only route-tracker/* and myTools code is tracked
- `docker-compose.yml` and `route-tracker/data/*` are gitignored
- Push: `cd /opt/containerd/myTools && git add -A && git commit -m "..." && git push`
