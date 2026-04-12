# Server Status Check

## Quick Diagnosis

### 1. Check Browser Console Errors

**Open your admin panel and press F12:**

Look for errors like:
- ❌ `Failed to fetch` → Server not running
- ❌ `401 Unauthorized` → Session expired
- ❌ `500 Internal Server Error` → Server crash
- ❌ `404 Not Found` → Wrong API endpoint

---

### 2. Check Server Terminal

**Look at your server terminal for errors:**

Common errors:
```
❌ SyntaxError: Unexpected token
❌ TypeError: Cannot read property
❌ Error: listen EADDRINUSE :::5000
❌ PostgreSQL connection error
```

---

### 3. Restart Server

**Stop all node processes and restart:**

```bash
# Windows (PowerShell)
Get-Process node | Stop-Process -Force
npm run dev

# Or just:
Ctrl+C (in server terminal)
npm run dev
```

---

### 4. Check Database Connection

**Test if database is accessible:**

```bash
# Check if DATABASE_URL is set
echo $env:DATABASE_URL

# Or check .env file
cat .env | grep DATABASE_URL
```

---

## Common Issues & Fixes

### Issue 1: "Failed to fetch" on every tab

**Cause:** Server not running or crashed

**Fix:**
```bash
# Restart server
npm run dev
```

---

### Issue 2: "401 Unauthorized" everywhere

**Cause:** Session expired or lost

**Fix:**
1. Logout
2. Login again
3. Or clear browser localStorage:
```javascript
// In browser console (F12)
localStorage.clear();
location.reload();
```

---

### Issue 3: "500 Internal Server Error"

**Cause:** Server code error (likely from recent changes)

**Fix:**
1. Check server terminal for error details
2. Look for the exact error message
3. If it's from the cleanup endpoint, comment it out temporarily:

```typescript
// In server/routes.ts, comment out the cleanup endpoint:
/*
app.post("/api/admin/live-classes/cleanup", requireAdmin, async (req: Request, res: Response) => {
  // ... entire function
});
*/
```

4. Restart server

---

### Issue 4: Multiple node processes running

**Cause:** Server started multiple times

**Fix:**
```bash
# Kill all node processes
Get-Process node | Stop-Process -Force

# Start fresh
npm run dev
```

---

### Issue 5: Port already in use

**Error:** `EADDRINUSE :::5000`

**Fix:**
```bash
# Find process using port 5000
netstat -ano | findstr :5000

# Kill that process (replace PID with actual number)
taskkill /PID <PID> /F

# Or change port in .env
PORT=5001
```

---

## Step-by-Step Troubleshooting

### Step 1: Check Server Terminal

Look for any red error messages. Copy the exact error.

### Step 2: Check Browser Console

1. Open admin panel
2. Press F12
3. Click "Console" tab
4. Look for red errors
5. Copy the exact error

### Step 3: Restart Everything

```bash
# 1. Stop server (Ctrl+C)
# 2. Kill all node processes
Get-Process node | Stop-Process -Force

# 3. Clear node_modules cache (if needed)
rm -rf node_modules/.cache

# 4. Restart server
npm run dev
```

### Step 4: Test Basic Endpoint

```bash
# Test if server is responding
curl http://localhost:5000/api/health

# Or in browser:
http://localhost:5000/api/health
```

### Step 5: Check Database

```bash
# Test database connection
# In server terminal, you should see:
# [DB] Connected to database
# [DB] Base tables ensured
```

---

## What to Send Me

If still having issues, send me:

1. **Server terminal output** (last 50 lines)
2. **Browser console errors** (screenshot or copy)
3. **Which tab shows error** (Courses, Tests, Materials, etc.)
4. **Exact error message**

---

## Quick Commands

```bash
# Restart server
Ctrl+C
npm run dev

# Kill all node processes
Get-Process node | Stop-Process -Force

# Check server logs
# (look at terminal where you ran npm run dev)

# Check browser errors
# Press F12 → Console tab

# Test server
curl http://localhost:5000/api/health
```

---

## Most Likely Issue

Based on "showing error everywhere in admin panel":

**99% chance:** Server crashed or not running

**Fix:**
1. Look at server terminal
2. See the error message
3. Restart server with `npm run dev`
4. Refresh browser

---

## Emergency Rollback

If the cleanup endpoint I added is causing issues:

**Option 1: Comment it out**

In `server/routes.ts`, find this section (around line 5180):

```typescript
// POST /api/admin/live-classes/cleanup
app.post("/api/admin/live-classes/cleanup", requireAdmin, async (req: Request, res: Response) => {
```

Add `/*` before it and `*/` after the closing `});`

**Option 2: Revert the change**

```bash
git diff server/routes.ts
git checkout server/routes.ts
```

Then restart server.

---

## Need Immediate Help?

**Do this NOW:**

1. Open server terminal
2. Copy the last 20 lines
3. Send to me
4. Also open browser console (F12)
5. Copy any red errors
6. Send to me

I'll tell you exactly what's wrong! 🚀
