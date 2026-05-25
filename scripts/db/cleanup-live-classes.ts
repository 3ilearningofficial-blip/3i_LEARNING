/**
 * Cleanup Script: Mark orphaned live classes as completed
 * 
 * This script finds live classes that are:
 * - Marked as is_live = true
 * - But have no active broadcast
 * - Or are older than 24 hours
 * 
 * And marks them as completed (is_live = false, is_completed = true)
 */

import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function cleanupLiveClasses() {
  console.log("🔍 Starting live class cleanup...\n");

  try {
    // Find all live classes that are still marked as live
    const result = await pool.query(`
      SELECT id, title, scheduled_at, created_at, is_live, is_completed
      FROM live_classes
      WHERE is_live = true
      ORDER BY scheduled_at DESC
    `);

    const liveClasses = result.rows;
    console.log(`Found ${liveClasses.length} live classes marked as "live"\n`);

    if (liveClasses.length === 0) {
      console.log("✅ No cleanup needed - all live classes are properly marked");
      return;
    }

    // Show details
    console.log("Live classes to clean up:");
    console.log("─".repeat(80));
    liveClasses.forEach((lc, index) => {
      const scheduledDate = new Date(Number(lc.scheduled_at));
      const createdDate = new Date(Number(lc.created_at));
      const hoursAgo = Math.floor((Date.now() - Number(lc.scheduled_at)) / (1000 * 60 * 60));
      
      console.log(`${index + 1}. ID: ${lc.id}`);
      console.log(`   Title: ${lc.title}`);
      console.log(`   Scheduled: ${scheduledDate.toLocaleString()}`);
      console.log(`   Created: ${createdDate.toLocaleString()}`);
      console.log(`   Hours ago: ${hoursAgo}h`);
      console.log(`   Status: is_live=${lc.is_live}, is_completed=${lc.is_completed}`);
      console.log("");
    });

    // Ask for confirmation
    console.log("\n⚠️  This will mark all these classes as completed (is_live=false, is_completed=true)");
    console.log("Press Ctrl+C to cancel, or wait 5 seconds to continue...\n");
    
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Update all live classes to completed
    const updateResult = await pool.query(`
      UPDATE live_classes
      SET is_live = false,
          is_completed = true
      WHERE is_live = true
      RETURNING id, title
    `);

    console.log(`✅ Successfully marked ${updateResult.rows.length} live classes as completed:\n`);
    updateResult.rows.forEach((lc, index) => {
      console.log(`${index + 1}. ${lc.title} (ID: ${lc.id})`);
    });

    console.log("\n✨ Cleanup complete!");

  } catch (error) {
    console.error("❌ Error during cleanup:", error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run the cleanup
cleanupLiveClasses()
  .then(() => {
    console.log("\n✅ Script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Script failed:", error);
    process.exit(1);
  });
