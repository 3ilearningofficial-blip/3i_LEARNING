# Deploy web bundle to EC2

The API (`server_dist`) and SQL migrations do **not** update the React UI. The server serves the Expo web export from `static-build/web`.

After merging classroom fixes to `main`, on EC2:

```bash
cd ~/3i_LEARNING
git pull origin main
npm install
npm run server:build
npm run db:apply-sql
EXPO_PUBLIC_DOMAIN=3ilearning.in npm run deploy:web
pm2 restart backend --update-env
```

Or use the full build script (set `EXPO_PUBLIC_DOMAIN` before running):

```bash
export EXPO_PUBLIC_DOMAIN=3ilearning.in
bash scripts/deploy-build.sh
pm2 restart backend --update-env
```

**Verify:** Hard-refresh the student live page. The activity timer overlay should show a clock icon and seconds only (no long “Answer in chat…” label).
