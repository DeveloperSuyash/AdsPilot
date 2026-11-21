# Deploying AdsPilot to ads.pilotworks4u.com

Same box and same pattern as SEOPilot: `devpilot-vps` (Hostinger), nginx + Let's Encrypt, a systemd unit, and a 2-minute deploy timer
that pulls `main`. DevPilot is on 4001 and SEOPilot on 4010; AdsPilot is on **4020**. They share nothing but the machine.

None of this has been run yet. Do it once, in order:

1. **DNS.** In Cloudflare, add an **A record** `ads` → `91.108.104.153`, Proxied. Use a plain A record, not a Tunnel record (SEOPilot's 530 lesson).
2. **Code.** Add a deploy key on the box for `DeveloperSuyash/adspilot`, under **pilot's** `~/.ssh` (the timer runs as `pilot`), then:
   ```bash
   sudo mkdir -p /opt/adspilot && sudo chown pilot /opt/adspilot
   sudo -u pilot git clone git@github.com-adspilot:DeveloperSuyash/adspilot.git /opt/adspilot/repo
   ```
3. **Config.** Copy `server/.env.example` to `server/.env` on the box. Set:
   - `AP_APP_URL=https://ads.pilotworks4u.com`
   - `AP_SETUP_KEY`
   - `AP_MASTER_KEY`, **and keep a copy off the box**
   - the Google client
   - the AI engine
   - email, when there is one
4. **Build.** `cd /opt/adspilot/repo && npm run setup && npm run build`.
5. **Services.**
   - Copy `ops/adspilot.service`, `ops/adspilot-deploy.service` and `ops/adspilot-deploy.timer` to `/etc/systemd/system/`.
   - Copy `ops/deploy.sh` to `/opt/adspilot/deploy.sh`.
   - Let `pilot` restart the service: a sudoers line for `systemctl restart adspilot`, as for SEOPilot.
   - Run `systemctl enable --now adspilot adspilot-deploy.timer`.
6. **nginx.** Copy `ops/nginx-ads.conf` into sites-available, link it, then run `certbot --nginx -d ads.pilotworks4u.com`.
7. **Claim.** Open `https://ads.pilotworks4u.com/app` and create the first account with the setup key. That account runs the install.
8. **Admin.**
   - Add the Google OAuth client, and register the redirect URI shown there in Google Cloud.
   - Add the Google Ads developer token and the API version.
9. **Check.** `curl -s https://ads.pilotworks4u.com/api/health` must show the commit you pushed.

Then work through the NOT-verified checklist in CLAUDE.md on a **test** Google Ads account before connecting a client.

On the marketing site (Pilotworks repo, `src/config/brand.ts`), AdsPilot is still "Coming soon" with `appReady: false`. Flip it only when
step 9 passes and a real login is served (that repo's own rule).
