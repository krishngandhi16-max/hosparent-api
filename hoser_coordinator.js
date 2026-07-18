// hoser_coordinator.js — Hoser as the boss that runs the other agents on a daily cadence
// and reports to you by text, exactly as you described:
//   "hoser tells them once a day to find stories where they get posted ... he should
//    text 469-891-3956 and from there i will text him back saying go ahead and do it"
//
// dailyRun():
//   1. Indy researches stories (and refreshes Learn-tab content).
//   2. Hoser TEXTS YOU a summary of what Indy found + "reply GO to post."
//   3. Nothing is posted yet — the stories sit at status='found', waiting for you.
//
// approveAndPost():  (triggered when you text "GO" back — see /sms/incoming in server.js)
//   1. Flips today's found stories to 'approved'.
//   2. Terry drafts + posts them (posting is a no-op stub until Buffer is connected,
//      but the finished drafts are produced and stored).
//   3. Hoser texts you the result.
//
// This is the only place that texts you and the only place that moves stories toward
// posting — so approval is always human-in-the-loop by construction.

require('dotenv').config();
const { pool } = require('./db');
const indy = require('./indy_agent');
const terry = require('./terry_agent');
const { sendSMS } = require('./notify');

async function dailyRun({ storyCount = 5, refreshLearn = true } = {}) {
  const found = await indy.findStories(storyCount);

  // Refresh the public Learn tab content too (bounded; safe to run daily).
  let learnUpdated = [];
  if (refreshLearn) {
    try { learnUpdated = await indy.researchLearnContent(); }
    catch (e) { console.error('[hoser] learn refresh failed:', e.message); }
  }

  let msg;
  if (found.length === 0) {
    msg = 'Hosparent: Indy found no new stories today (nothing not already seen). Nothing to post.';
  } else {
    const list = found.map((s, i) => `${i + 1}. ${s.headline}`).join('\n');
    msg = `Hosparent — Indy found ${found.length} story(ies) today:\n${list}\n\nReply GO to have Terry post them, or IGNORE to skip.`;
  }
  const sms = await sendSMS(msg);

  return { found, learnUpdated, texted: sms.sent, sms_reason: sms.reason || null, message: msg };
}

async function approveAndPost() {
  const upd = await pool.query(`UPDATE stories SET status='approved' WHERE status='found' RETURNING id, headline`);
  if (upd.rows.length === 0) {
    await sendSMS('Hosparent: nothing was waiting to post.');
    return { approved: 0, results: [] };
  }
  const results = await terry.postApproved();
  const posted = results.filter((r) => r.posted).length;
  const drafted = results.filter((r) => r.ok && !r.posted).length;

  const note = posted > 0
    ? `Hosparent: posted ${posted} item(s).`
    : `Hosparent: drafted ${drafted} post(s), but Buffer isn't connected yet so nothing was published. Connect Buffer to go live.`;
  await sendSMS(note);
  return { approved: upd.rows.length, posted, drafted, results };
}

async function rejectPending() {
  const upd = await pool.query(`UPDATE stories SET status='rejected' WHERE status='found' RETURNING id`);
  return { rejected: upd.rows.length };
}

module.exports = { dailyRun, approveAndPost, rejectPending };
