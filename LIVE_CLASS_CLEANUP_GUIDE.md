# Live Class Cleanup Guide

## Problem

You have live classes that are still marked as "live" (showing "End Live" button) but they should be marked as completed. This happens when:

- Live class was deleted without properly ending
- Server crashed during live class
- Browser closed during broadcast
- Network error during end process

---

## 🚀 Quick Fix (3 Methods)

### Method 1: API Call (Fastest)

**Using Browser Console:**

1. Open your admin panel in browser
2. Press F12 to open Developer Console
3. Paste this code and press Enter:

```javascript
fetch('/api/admin/live-classes/cleanup', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + localStorage.getItem('sessionToken')
  }
})
.then(r => r.json())
.then(data => {
  console.log('✅ Cleanup Result:', data);
  alert(`Cleaned up ${data.cleaned} live classes!`);
  location.reload(); // Refresh page
})
.catch(err => {
  console.error('❌ Error:', err);
  alert('Cleanup failed. Check console for details.');
});
```

**Using cURL:**

```bash
curl -X POST http://localhost:5000/api/admin/live-classes/cleanup \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"
```

---

### Method 2: SQL Query (Direct Database)

**Connect to your database and run:**

```sql
-- Check which classes will be affected
SELECT 
  id,
  title,
  TO_TIMESTAMP(scheduled_at / 1000) as scheduled_time,
  is_live,
  is_completed
FROM live_classes
WHERE is_live = true;

-- Mark all as completed
UPDATE live_classes 
SET is_live = false, 
    is_completed = true 
WHERE is_live = true;

-- Verify
SELECT COUNT(*) as still_live 
FROM live_classes 
WHERE is_live = true;
```

---

### Method 3: Node.js Script

**Run the cleanup script:**

```bash
# Make sure you have DATABASE_URL in .env
npx tsx scripts/cleanup-live-classes.ts
```

---

## 🔍 How to Check if You Need Cleanup

### Check via Database:

```sql
SELECT COUNT(*) as orphaned_live_classes
FROM live_classes
WHERE is_live = true;
```

If count > 0, you need cleanup.

### Check via API:

```bash
curl http://localhost:5000/api/live-classes
```

Look for classes with `"is_live": true` that shouldn't be live.

---

## 🛡️ Prevent This in the Future

### 1. Always Use "End Live" Button

When ending a live class:
- Click "End Live" button
- Wait for confirmation
- Don't close browser immediately

### 2. Add Auto-Cleanup on Server Restart

Add this to your server startup (in `server/routes.ts`):

```typescript
// Auto-cleanup on server start
async function autoCleanupOnStartup() {
  try {
    const result = await db.query(`
      UPDATE live_classes
      SET is_live = false, is_completed = true
      WHERE is_live = true
      RETURNING id, title
    `);
    if (result.rows.length > 0) {
      console.log(`[Startup] Auto-cleaned ${result.rows.length} orphaned live classes`);
    }
  } catch (err) {
    console.error("[Startup] Auto-cleanup failed:", err);
  }
}

// Call on server start
autoCleanupOnStartup();
```

### 3. Add Scheduled Cleanup (Cron Job)

Run cleanup every hour:

```typescript
// Add to server/routes.ts
setInterval(async () => {
  try {
    const result = await db.query(`
      UPDATE live_classes
      SET is_live = false, is_completed = true
      WHERE is_live = true 
        AND scheduled_at < $1
    `, [Date.now() - (24 * 60 * 60 * 1000)]); // 24 hours ago
    
    if (result.rows.length > 0) {
      console.log(`[Auto-cleanup] Marked ${result.rows.length} old live classes as completed`);
    }
  } catch (err) {
    console.error("[Auto-cleanup] Error:", err);
  }
}, 60 * 60 * 1000); // Every hour
```

---

## 📊 What the Cleanup Does

**Before Cleanup:**
```
live_classes table:
┌────┬───────────┬─────────┬──────────────┐
│ id │ title     │ is_live │ is_completed │
├────┼───────────┼─────────┼──────────────┤
│ 1  │ Math 101  │ true    │ false        │ ← Orphaned
│ 2  │ Physics   │ true    │ false        │ ← Orphaned
│ 3  │ Chemistry │ false   │ true         │ ← OK
└────┴───────────┴─────────┴──────────────┘
```

**After Cleanup:**
```
live_classes table:
┌────┬───────────┬─────────┬──────────────┐
│ id │ title     │ is_live │ is_completed │
├────┼───────────┼─────────┼──────────────┤
│ 1  │ Math 101  │ false   │ true         │ ← Fixed
│ 2  │ Physics   │ false   │ true         │ ← Fixed
│ 3  │ Chemistry │ false   │ true         │ ← OK
└────┴───────────┴─────────┴──────────────┘
```

---

## 🧪 Testing the Cleanup

### Test the API Endpoint:

```bash
# 1. Check current state
curl http://localhost:5000/api/live-classes

# 2. Run cleanup
curl -X POST http://localhost:5000/api/admin/live-classes/cleanup \
  -H "Authorization: Bearer YOUR_TOKEN"

# 3. Verify cleanup worked
curl http://localhost:5000/api/live-classes
```

### Expected Response:

```json
{
  "success": true,
  "message": "Successfully marked 3 live classes as completed",
  "cleaned": 3,
  "classes": [
    { "id": 1, "title": "Math 101" },
    { "id": 2, "title": "Physics" },
    { "id": 3, "title": "Chemistry" }
  ]
}
```

---

## ⚠️ Important Notes

### Safe to Run:
- ✅ Can run multiple times (idempotent)
- ✅ Only affects orphaned live classes
- ✅ Doesn't delete any data
- ✅ Just updates status flags

### What It Does:
- Changes `is_live` from `true` to `false`
- Changes `is_completed` from `false` to `true`
- Removes "End Live" button from UI
- Moves classes to "Completed" section

### What It Doesn't Do:
- ❌ Doesn't delete live classes
- ❌ Doesn't delete recordings
- ❌ Doesn't affect students
- ❌ Doesn't change any other data

---

## 🚨 Troubleshooting

### Issue: "Authorization failed"
**Solution:** Make sure you're logged in as admin and using correct session token.

### Issue: "Database connection failed"
**Solution:** Check DATABASE_URL in .env file.

### Issue: "Still showing End Live button"
**Solution:** 
1. Run cleanup again
2. Hard refresh browser (Ctrl+Shift+R)
3. Clear browser cache

### Issue: "Cleanup runs but nothing changes"
**Solution:** Check if classes are actually marked as `is_live = true` in database.

---

## 📝 Summary

**Fastest Method:**
1. Open browser console (F12)
2. Paste the JavaScript code from Method 1
3. Press Enter
4. Refresh page

**Most Reliable Method:**
1. Connect to database
2. Run SQL UPDATE query from Method 2
3. Verify with SELECT query

**Automated Method:**
1. Add auto-cleanup on server startup
2. Add scheduled cleanup every hour
3. Never worry about orphaned classes again

---

## ✅ Checklist

After running cleanup:

- [ ] "End Live" buttons disappeared from admin panel
- [ ] Live classes moved to "Completed" section
- [ ] Database shows `is_live = false` for all classes
- [ ] Students can still access recordings (if any)
- [ ] No errors in server logs

---

Need help? Check server logs for detailed error messages.
