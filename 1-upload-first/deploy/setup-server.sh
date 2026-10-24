#!/usr/bin/env bash
# Vistr game server setup, made to sit safely NEXT TO an existing website (memoryq.com).
#
# Run these in order, as root (sudo), on the server:
#   sudo bash setup-server.sh check       # 1. look only: reports what is on the server, changes NOTHING
#   sudo bash setup-server.sh             # 2. install (asks before touching the web server)
#   sudo bash /opt/vistr/deploy/setup-server.sh update      # later: newest code from GitHub
#   sudo bash /opt/vistr/deploy/setup-server.sh uninstall   # remove everything Vistr added
#
# Getting this file onto the server, from PowerShell on your PC:
#   scp "$([Environment]::GetFolderPath('MyDocuments'))\vistr\deploy\setup-server.sh" you@your-server:
#
# What it will and won't do to the server:
#   - It never touches memoryq.com's files, databases, services or settings.
#   - It never changes the server's Node.js: if Node 18+ isn't there, Vistr gets its own
#     private copy in /opt/vistr-node.
#   - It picks a port nobody uses (3000 only if free).
#   - Before changing the web server (nginx, Apache or Caddy) it saves a backup in
#     /root/vistr-backups/, checks the existing setup is healthy, adds ONE new site for
#     vistr.memoryq.com, tests it, and undoes it automatically if the test fails.
#     It reloads the web server (no restart, so no downtime) only after a passing test.
#   - Everything it adds is listed by "uninstall", which removes exactly that.
#
# Settings can be given up front: DOMAIN=vistr.memoryq.com REPO=git@github.com:you/vistr.git EMAIL=you@x.com
set -euo pipefail

DOMAIN="${DOMAIN:-vistr.memoryq.com}"
APP=/opt/vistr
NODEDIR=/opt/vistr-node
DATA=/var/lib/vistr
ENVF=/etc/vistr.env
KEYDIR=/etc/vistr
UNIT=/etc/systemd/system/vistr.service
BACKUPS=/root/vistr-backups
MARK_BEGIN="# >>> vistr ($DOMAIN) - added by setup-server.sh"
MARK_END="# <<< vistr"
MODE="${1:-install}"

say()  { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
ok()   { printf '\033[32m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }
die()  { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
# Questions go straight to the terminal (not to the output), so they always show.
ask()  { local q="$1" def="${2:-}" a=""; { printf '%s%s: ' "$q" "${def:+ [$def]}" > /dev/tty && read -r a < /dev/tty; } 2>/dev/null || true; echo "${a:-$def}"; }
ask_secret() { local a=""; { printf '%s: ' "$1" > /dev/tty && read -r -s a < /dev/tty && printf '\n' > /dev/tty; } 2>/dev/null || true; echo "$a"; }
yes_no() { [ "${ASSUME_YES:-}" = 1 ] && return 0; case "$(ask "$1 (yes/no)" no)" in y|Y|yes|YES|Yes) return 0 ;; *) return 1 ;; esac; }

[ "$(id -u)" = 0 ] || die "Run as root: sudo bash $0 $MODE"

as_app()  { runuser -u vistr -- "$@"; }
git_as_app() {
  as_app env HOME="$KEYDIR" GIT_SSH_COMMAND="ssh -i $KEYDIR/deploy_key -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=$KEYDIR/known_hosts" \
    git -c safe.directory="$APP" "$@"
}
listening() { ss -ltnH "( sport = :$1 )" 2>/dev/null | grep -q . ; }
who_listens() { ss -ltnpH "( sport = :$1 )" 2>/dev/null | grep -o 'users:(("[^"]*' | head -1 | sed 's/.*"//'; }
node_major() { "$1" -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/'; }
env_get() { [ -f "$ENVF" ] && sed -n "s/^$1=//p" "$ENVF" | tail -1; }
web_server() {
  local w; w=$(who_listens 80); [ -n "$w" ] || w=$(who_listens 443)
  case "$w" in apache2|httpd) echo apache ;; nginx|caddy) echo "$w" ;; "") echo none ;; *) echo "other:$w" ;; esac
}
nginx_conf_file() {   # where a new nginx site goes: sites-available (+ link) if used, else conf.d
  if grep -rqs 'sites-enabled' /etc/nginx/nginx.conf; then echo /etc/nginx/sites-available/vistr; else echo /etc/nginx/conf.d/vistr.conf; fi
}
caddy_block() {   # the Vistr site for Caddy, between markers so uninstall removes exactly it
  [ -s /etc/caddy/Caddyfile ] && [ "$(tail -c1 /etc/caddy/Caddyfile | od -An -c | tr -d ' ')" != '\n' ] && echo
  printf '%s\n%s {\n\treverse_proxy 127.0.0.1:%s {\n\t\tflush_interval -1\n\t}\n}\n%s\n' "$MARK_BEGIN" "$DOMAIN" "$PORT" "$MARK_END"
}
backup() {   # backup <name> <paths...>
  local name="$1"; shift
  mkdir -p "$BACKUPS"; chmod 700 "$BACKUPS"
  local f="$BACKUPS/$name-$(date +%Y%m%d-%H%M%S).tgz"
  tar czf "$f" "$@" 2>/dev/null && ok "Backup of $* saved to $f"
}

# ─────────────────────────────── check ───────────────────────────────
if [ "$MODE" = check ]; then
  say "Checking this server (nothing will be changed)"
  echo "System:        $( . /etc/os-release 2>/dev/null; echo "${PRETTY_NAME:-unknown}" ), $(uname -m)"
  echo "Package tool:  $(command -v apt-get >/dev/null && echo apt || echo 'not apt (tell Claude)')"
  echo "Memory free:   $(free -m 2>/dev/null | awk '/Mem:/ {print $7 " MB of " $2 " MB"}')"
  echo "Disk free:     $(df -h / 2>/dev/null | awk 'NR==2 {print $4 " on /"}')"
  NM=$(node_major node || true)
  echo "Node.js:       $(command -v node >/dev/null && echo "$(node -v) (the server's own; Vistr will $( [ "${NM:-0}" -ge 18 ] && echo 'use it, unchanged' || echo 'get a private copy and leave it alone'))" || echo 'none (Vistr will get a private copy)')"
  for p in 80 443 3000; do echo "Port $p:       $(listening $p && echo "in use by $(who_listens $p)" || echo free)"; done
  WS=$(web_server); echo "Web server:    $WS"
  case "$WS" in
    nginx)  echo "  config test: $(nginx -t 2>&1 | tail -1)"
            echo "  sites:       $(ls /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null | grep -v ':$' | tr '\n' ' ')"
            { grep -rls "server_name[^;]*$DOMAIN" /etc/nginx 2>/dev/null || true; } | sed "s|^|  ALREADY USES $DOMAIN: |" ;;
    apache) echo "  config test: $(apache2ctl configtest 2>&1 | tail -1)"
            echo "  sites:       $(ls /etc/apache2/sites-enabled 2>/dev/null | tr '\n' ' ')" ;;
    caddy)  echo "  config test: $(caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 | tail -1)" ;;
  esac
  echo "Certbot:       $(command -v certbot >/dev/null && echo "installed ($(command -v certbot))" || echo 'not installed')"
  echo "Docker:        $(command -v docker >/dev/null && echo "installed, $(docker ps -q 2>/dev/null | wc -l) containers running" || echo none)"
  echo "Cloudflare tunnel: $(pgrep -x cloudflared >/dev/null && echo 'running' || echo 'not running')"
  echo "Firewall:      $(command -v ufw >/dev/null && ufw status 2>/dev/null | head -1 || echo 'ufw not installed')"
  echo "Vistr already: $([ -f "$UNIT" ] && echo "installed (port $(env_get PORT))" || echo 'not installed')"
  echo
  ok "Nothing was changed. Send this output to Claude before installing."
  exit 0
fi

# ────────────────────────────── uninstall ──────────────────────────────
if [ "$MODE" = uninstall ]; then
  say "Removing Vistr (memoryq.com and everything else stays as it is)"
  yes_no "Remove the Vistr game from this server?" || die "Nothing was removed."
  systemctl disable --now vistr 2>/dev/null || true; rm -f "$UNIT"; systemctl daemon-reload
  for f in /etc/nginx/sites-enabled/vistr /etc/nginx/sites-available/vistr /etc/nginx/conf.d/vistr.conf; do
    [ -e "$f" ] && { [ "${NGX:-}" = 1 ] || backup nginx /etc/nginx; rm -f "$f"; NGX=1; }
  done
  [ "${NGX:-}" = 1 ] && { nginx -t && systemctl reload nginx; }
  if [ -f /etc/apache2/sites-available/vistr.conf ]; then
    backup apache /etc/apache2; a2dissite -q vistr 2>/dev/null || true; rm -f /etc/apache2/sites-available/vistr.conf
    apache2ctl configtest && systemctl reload apache2
  fi
  if [ -f /etc/caddy/Caddyfile ] && grep -qF "$MARK_BEGIN" /etc/caddy/Caddyfile; then
    backup caddy /etc/caddy
    sed -i "\|$MARK_BEGIN|,\|$MARK_END|d" /etc/caddy/Caddyfile
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null && systemctl reload caddy
  fi
  rm -rf "$APP" "$NODEDIR"
  if [ "${2:-}" = --purge ]; then rm -rf "$DATA" "$ENVF" "$KEYDIR"; userdel vistr 2>/dev/null || true; ok "Settings and data removed too."
  else ok "Kept settings ($ENVF) and data ($DATA). Add --purge to remove them as well."; fi
  ok "Vistr removed. (The HTTPS certificate for $DOMAIN, if any, stays until it expires: certbot delete --cert-name $DOMAIN)"
  exit 0
fi

command -v apt-get >/dev/null || die "This script is for Ubuntu/Debian (apt). Run 'check' and send the output to Claude."
export DEBIAN_FRONTEND=noninteractive

# Node.js for Vistr: the server's own if 18+, else a private copy (the server's stays untouched).
node_bin() {
  if [ -x "$NODEDIR/bin/node" ]; then echo "$NODEDIR/bin/node"; return; fi
  if command -v node >/dev/null && [ "$(node_major node)" -ge 18 ] 2>/dev/null; then command -v node; return; fi
  return 1
}

# ─────────────────────────────── update ───────────────────────────────
if [ "$MODE" = update ]; then
  say "Updating Vistr from GitHub"
  git_as_app -C "$APP" pull --ff-only
  systemctl restart vistr
  PORT=$(env_get PORT); sleep 2
  curl -fsS --max-time 3 "http://127.0.0.1:$PORT/api/health" >/dev/null && ok "Updated and running." || die "The game did not start. See: journalctl -u vistr -n 50"
  exit 0
fi

[ "$MODE" = install ] || die "Unknown command '$MODE'. Use: check, install (no word), update or uninstall."

# ───────────────────────────── 1. tools ─────────────────────────────
say "1/5 Tools"
NEED=""; for c in git curl ssh-keygen tar xz; do command -v $c >/dev/null || NEED="$NEED $c"; done
if [ -n "$NEED" ]; then
  apt-get update -qq
  apt-get install -y -qq git curl ca-certificates openssh-client tar xz-utils >/dev/null   # installs only; upgrades nothing else
fi
if ! NODE=$(node_bin); then
  ARCH=$(uname -m); case "$ARCH" in x86_64) ARCH=x64 ;; aarch64|arm64) ARCH=arm64 ;; *) die "Unsupported processor $ARCH" ;; esac
  FILE=$(curl -fsSL https://nodejs.org/dist/latest-v20.x/SHASUMS256.txt | grep -o "node-v20[^ ]*-linux-$ARCH.tar.xz" | head -1)
  [ -n "$FILE" ] || die "Could not find Node.js 20 for $ARCH."
  mkdir -p "$NODEDIR"
  curl -fsSL "https://nodejs.org/dist/latest-v20.x/$FILE" | tar -xJ -C "$NODEDIR" --strip-components=1
  NODE="$NODEDIR/bin/node"
  ok "Private Node.js $("$NODE" -v) in $NODEDIR (the server's own Node.js was not changed)"
else
  ok "Using Node.js $("$NODE" -v) at $NODE (not changed)"
fi

# ───────────────────────────── 2. code ─────────────────────────────
say "2/5 The game, from GitHub"
id vistr >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin vistr
mkdir -p "$DATA" "$KEYDIR"; chown vistr: "$DATA" "$KEYDIR"
if [ -d "$APP/.git" ]; then
  git_as_app -C "$APP" pull --ff-only; ok "Updated the code in $APP"
else
  [ ! -e "$APP" ] || [ -z "$(ls -A "$APP" 2>/dev/null)" ] || die "$APP exists and isn't a Vistr install. Move it away first; nothing was changed in it."
  REPO="${REPO:-$(ask 'GitHub repository address (for example https://github.com/yourname/vistr)')}"
  [ -n "$REPO" ] || die "A GitHub repository is needed."
  case "$REPO" in https://github.com/*) REPO="git@github.com:${REPO#https://github.com/}"; REPO="${REPO%.git}.git" ;; esac
  [ -f "$KEYDIR/deploy_key" ] || ssh-keygen -q -t ed25519 -N '' -C "vistr-server@$(hostname)" -f "$KEYDIR/deploy_key"
  chown vistr: "$KEYDIR/deploy_key" "$KEYDIR/deploy_key.pub"; chmod 600 "$KEYDIR/deploy_key"
  mkdir -p "$APP"; chown vistr: "$APP"
  if ! git_as_app ls-remote "$REPO" >/dev/null 2>&1; then
    warn "GitHub needs to trust this server once (read-only). On github.com: your repository ->"
    warn "Settings -> Deploy keys -> Add deploy key. Title: vistr server. Leave 'Allow write access' OFF. Key:"
    echo; cat "$KEYDIR/deploy_key.pub"; echo
    ask "Press Enter when the key is added" >/dev/null
    git_as_app ls-remote "$REPO" >/dev/null 2>&1 || die "GitHub still refuses this server. Check the repository name and the deploy key, then run again."
  fi
  git_as_app clone -q "$REPO" "$APP"
fi
[ -f "$APP/server/server.js" ] || die "The repository has no server/server.js at its top level. Upload the vistr files to it first."

# ───────────────────────────── 3. settings ─────────────────────────────
say "3/5 Settings ($ENVF)"
if [ -f "$ENVF" ]; then
  PORT=$(env_get PORT); ok "Keeping existing settings (port $PORT)."
else
  PORT=""
  for p in 3000 $(seq 3700 3799); do listening "$p" || { PORT=$p; break; }; done
  [ -n "$PORT" ] || die "No free port found between 3000 and 3799."
  [ "$PORT" = 3000 ] || ok "Port 3000 is already used by another program; Vistr will use $PORT."
  ADMIN_KEY=$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 16)
  echo "Your Upstash database keeps all players and scores from Render (leave empty to keep data in $DATA)."
  warn "Same Upstash database as Render? Suspend the Render service first, so only one server writes to it."
  UP_URL="${UPSTASH_URL:-$(ask "UPSTASH_REDIS_REST_URL (https://....upstash.io, or just Enter to skip)")}"
  UP_URL=$(printf '%s' "$UP_URL" | tr -d " \"'\r\n")
  case "$UP_URL" in ""|https://*.upstash.io|https://*.upstash.io/) ;; *.upstash.io) UP_URL="https://$UP_URL" ;;
    *) warn "That doesn't look like an Upstash REST URL (https://something.upstash.io). Skipping Upstash; data stays in $DATA."; UP_URL="" ;; esac
  UP_TOKEN="${UPSTASH_TOKEN:-}"; if [ -n "$UP_URL" ] && [ -z "$UP_TOKEN" ]; then UP_TOKEN=$(ask_secret "UPSTASH_REDIS_REST_TOKEN (paste, it stays hidden, then Enter)"); fi
  UP_TOKEN=$(printf '%s' "$UP_TOKEN" | tr -d " \"'\r\n")
  [ -n "$UP_TOKEN" ] || UP_URL=""
  ( umask 077; cat > "$ENVF" <<EOF
# Vistr settings. After changing anything: systemctl restart vistr
HOST=127.0.0.1
PORT=$PORT
VISTR_DB=$DATA/db.json
# Password for https://$DOMAIN/admin.html (messages, reviews, games played)
ADMIN_KEY=$ADMIN_KEY
UPSTASH_REDIS_REST_URL=$UP_URL
UPSTASH_REDIS_REST_TOKEN=$UP_TOKEN
# Optional: email new players their ID and forward contact messages (https://resend.com)
#RESEND_API_KEY=re_xxx
#MAIL_FROM=Vistr <play@memoryq.com>
#CONTACT_TO=you@memoryq.com
EOF
  )
  ok "Saved. Admin key: $ADMIN_KEY"
fi

# ───────────────────────────── 4. service ─────────────────────────────
say "4/5 Vistr as its own service (port $PORT, reachable only from this server)"
cat > "$UNIT" <<EOF
[Unit]
Description=Vistr word game server
After=network-online.target
Wants=network-online.target

[Service]
User=vistr
WorkingDirectory=$APP
EnvironmentFile=$ENVF
ExecStart=$NODE server/server.js
Restart=always
RestartSec=3
# Keep the game from using more than its share of the server
MemoryMax=400M
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=$DATA

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable -q vistr
systemctl restart vistr
for i in $(seq 1 20); do curl -fsS --max-time 3 "http://127.0.0.1:$PORT/api/health" 2>/dev/null | grep -q '"ok":true' && break; sleep 1; done
curl -fsS --max-time 3 "http://127.0.0.1:$PORT/api/health" 2>/dev/null | grep -q '"ok":true' || die "The game did not start (nothing else was changed). See: journalctl -u vistr -n 50"
journalctl -u vistr -n 20 --no-pager 2>/dev/null | grep -E "Data:|Loaded|Upstash" || true
ok "Vistr is running."

# ───────────────────────────── 5. web address ─────────────────────────────
say "5/5 https://$DOMAIN"
WS=$(web_server)
echo "Web server on this machine: $WS"
case "$WS" in
  nginx)
    nginx -t >/dev/null 2>&1 || die "nginx's current setup already fails its own test (nginx -t). Not touching it; fix that first."
    if grep -rqs "server_name[^;]*[[:space:]]$DOMAIN[;[:space:]]" /etc/nginx --exclude=vistr --exclude=vistr.conf; then
      die "nginx already has a site for $DOMAIN. Not touching it."
    fi
    CONF=$(nginx_conf_file)
    echo "Plan: add one file, $CONF (only for $DOMAIN), test it, then reload nginx (no restart)."
    yes_no "Go ahead?" || die "Stopped. Vistr runs, but isn't reachable from outside yet. Nothing in nginx was changed."
    backup nginx /etc/nginx
    cat > "$CONF" <<EOF
$MARK_BEGIN
server {
    listen 80;
    server_name $DOMAIN;
    location /api/events {            # live game events: never buffer, keep open
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
    }
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
$MARK_END
EOF
    [ "$CONF" = /etc/nginx/sites-available/vistr ] && ln -sf "$CONF" /etc/nginx/sites-enabled/vistr
    if ! nginx -t >/dev/null 2>&1; then
      rm -f /etc/nginx/sites-enabled/vistr "$CONF"
      die "nginx rejected the new site, so it was removed again. nginx was not reloaded; your sites are unchanged."
    fi
    systemctl reload nginx
    ok "nginx now also serves $DOMAIN."
    PLUGIN=nginx
    ;;
  apache)
    apache2ctl configtest >/dev/null 2>&1 || die "Apache's current setup already fails its own test. Not touching it; fix that first."
    echo "Plan: enable proxy modules (if off), add one site file (only for $DOMAIN), test, then reload Apache (no restart)."
    yes_no "Go ahead?" || die "Stopped. Nothing in Apache was changed."
    backup apache /etc/apache2
    NEWMODS=""; for m in proxy proxy_http headers; do [ -e "/etc/apache2/mods-enabled/$m.load" ] || NEWMODS="$NEWMODS $m"; done
    [ -n "$NEWMODS" ] && a2enmod -q $NEWMODS >/dev/null
    cat > /etc/apache2/sites-available/vistr.conf <<EOF
$MARK_BEGIN
<VirtualHost *:80>
    ServerName $DOMAIN
    ProxyPreserveHost On
    ProxyPass /api/events http://127.0.0.1:$PORT/api/events flushpackets=on timeout=3600
    ProxyPassReverse /api/events http://127.0.0.1:$PORT/api/events
    ProxyPass / http://127.0.0.1:$PORT/
    ProxyPassReverse / http://127.0.0.1:$PORT/
</VirtualHost>
$MARK_END
EOF
    a2ensite -q vistr >/dev/null
    if ! apache2ctl configtest >/dev/null 2>&1; then
      a2dissite -q vistr >/dev/null 2>&1 || true; rm -f /etc/apache2/sites-available/vistr.conf
      [ -n "$NEWMODS" ] && a2dismod -q $NEWMODS >/dev/null 2>&1 || true
      die "Apache rejected the new site, so it was removed again. Apache was not reloaded; your sites are unchanged."
    fi
    systemctl reload apache2
    ok "Apache now also serves $DOMAIN."
    PLUGIN=apache
    ;;
  caddy)
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || die "Caddy's current setup fails validation. Not touching it."
    if grep -qF "$MARK_BEGIN" /etc/caddy/Caddyfile; then ok "Caddy already has the Vistr site."
    else
      echo "Plan: add one block for $DOMAIN at the end of /etc/caddy/Caddyfile, validate, then reload Caddy (no restart)."
      yes_no "Go ahead?" || die "Stopped. Nothing in Caddy was changed."
      backup caddy /etc/caddy
      cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.before-vistr
      caddy_block >> /etc/caddy/Caddyfile
      if ! caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
        mv /etc/caddy/Caddyfile.before-vistr /etc/caddy/Caddyfile
        die "Caddy rejected the new block, so the old Caddyfile was put back. Caddy was not reloaded."
      fi
      rm -f /etc/caddy/Caddyfile.before-vistr
      systemctl reload caddy
    fi
    ok "Caddy serves $DOMAIN with its own HTTPS certificate."
    PLUGIN=""
    ;;
  none)
    echo "Nothing listens on ports 80/443 here (memoryq.com may come through a Cloudflare tunnel or another port)."
    echo "Plan: install the Caddy web server for $DOMAIN only."
    yes_no "Go ahead?" || die "Stopped. Vistr runs on port $PORT; nothing else was changed."
    if ! command -v caddy >/dev/null; then
      apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https gnupg >/dev/null
      curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
      curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
      apt-get update -qq && apt-get install -y -qq caddy >/dev/null
      printf '# Sites served by Caddy\n' > /etc/caddy/Caddyfile      # fresh install: replace the sample page
    fi
    grep -qF "$MARK_BEGIN" /etc/caddy/Caddyfile || caddy_block >> /etc/caddy/Caddyfile
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null && systemctl reload caddy
    PLUGIN=""
    ;;
  *)
    die "Ports 80/443 belong to '${WS#other:}', which this script won't touch. Vistr is running on 127.0.0.1:$PORT; send the 'check' output to Claude to connect it."
    ;;
esac

# HTTPS certificate for nginx/Apache (Caddy does its own). Uses the server's certbot if there is one.
if [ -n "${PLUGIN:-}" ]; then
  if ! command -v certbot >/dev/null; then apt-get install -y -qq certbot "python3-certbot-$PLUGIN" >/dev/null; fi
  EMAIL="${EMAIL:-$(ask 'Email for certificate expiry notices (optional)')}"
  CERT_EMAIL=(--register-unsafely-without-email); [ -n "$EMAIL" ] && CERT_EMAIL=(-m "$EMAIL")
  if certbot --"$PLUGIN" -d "$DOMAIN" --non-interactive --agree-tos --redirect "${CERT_EMAIL[@]}"; then
    ok "HTTPS certificate for $DOMAIN installed (it renews by itself)."
  else
    warn "The certificate could not be issued yet (usually: $DOMAIN doesn't point at this server yet)."
    warn "Run this script again once DNS works; everything else is kept."
  fi
fi
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q 'Status: active'; then ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; fi

sleep 2
if curl -fsS --max-time 10 "https://$DOMAIN/api/health" 2>/dev/null | grep -q '"ok":true'; then ok "https://$DOMAIN is live."
else warn "https://$DOMAIN isn't answering yet. Make sure $DOMAIN points at this server (deploy/cloudflare-dns.ps1), then run again."; fi
echo
ok "Done. memoryq.com was not touched."
echo "  Game:      https://$DOMAIN"
echo "  Admin:     https://$DOMAIN/admin.html   (key: sudo grep ADMIN_KEY $ENVF)"
echo "  Logs:      journalctl -u vistr -f"
echo "  Update:    sudo bash $APP/deploy/setup-server.sh update"
echo "  Remove:    sudo bash $APP/deploy/setup-server.sh uninstall"
echo "  Backups:   $BACKUPS"
