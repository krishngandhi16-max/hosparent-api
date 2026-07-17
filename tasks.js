// tasks.js — Task coordination engine for autonomous agent delegation
// Hoser creates tasks, agents execute and complete them, UI displays live status

const { pool } = require('./db');

// Initialize tasks table if it doesn't exist
async function initTasksTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        type VARCHAR(50) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        assignee VARCHAR(50),
        priority VARCHAR(20) DEFAULT 'normal',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        issue_description TEXT,
        hospital_id INTEGER,
        result TEXT,
        metadata JSONB
      )
    `);
  } catch (e) {
    if (!e.message.includes('already exists')) {
      console.error('[tasks] init failed:', e.message);
    }
  }
}

// Create a new task (Hoser delegates work)
async function createTask(taskData) {
  const { type, assignee, priority, issue_description, hospital_id, metadata } = taskData;
  try {
    const result = await pool.query(
      `INSERT INTO tasks (type, assignee, priority, issue_description, hospital_id, metadata, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING *`,
      [type, assignee, priority || 'normal', issue_description, hospital_id, JSON.stringify(metadata || {})]
    );
    const task = result.rows[0];
    console.log(`[tasks] Created task #${task.id}: ${type} → ${assignee}`);
    return task;
  } catch (e) {
    console.error('[tasks] createTask failed:', e.message);
    throw e;
  }
}

// Get all active tasks (status != 'complete')
async function getActiveTasks() {
  try {
    const result = await pool.query(
      `SELECT * FROM tasks WHERE status != 'completed' ORDER BY priority DESC, created_at ASC`
    );
    return result.rows;
  } catch (e) {
    console.error('[tasks] getActiveTasks failed:', e.message);
    return [];
  }
}

// Get a single task by ID
async function getTask(id) {
  try {
    const result = await pool.query(`SELECT * FROM tasks WHERE id = $1`, [id]);
    return result.rows[0] || null;
  } catch (e) {
    console.error('[tasks] getTask failed:', e.message);
    return null;
  }
}

// Start executing a task (mark started_at)
async function startTask(id) {
  try {
    const result = await pool.query(
      `UPDATE tasks SET status = 'in_progress', started_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
      [id]
    );
    return result.rows[0];
  } catch (e) {
    console.error('[tasks] startTask failed:', e.message);
    throw e;
  }
}

// Complete a task with results
async function completeTask(id, result) {
  try {
    const updateResult = await pool.query(
      `UPDATE tasks SET status = 'completed', result = $1, completed_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
      [result, id]
    );
    console.log(`[tasks] Completed task #${id}`);
    return updateResult.rows[0];
  } catch (e) {
    console.error('[tasks] completeTask failed:', e.message);
    throw e;
  }
}

// Get task stats for office UI (summary of all agents' workload)
async function getTaskStats() {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(DISTINCT assignee) as active_agents,
        assignee,
        status
      FROM tasks
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY assignee, status
      ORDER BY status DESC, assignee ASC
    `);

    const byStatus = {
      pending: 0,
      in_progress: 0,
      completed: 0
    };
    const byAgent = {};

    result.rows.forEach(row => {
      byStatus[row.status] = (byStatus[row.status] || 0) + 1;
      if (!byAgent[row.assignee]) byAgent[row.assignee] = { pending: 0, in_progress: 0, completed: 0 };
      byAgent[row.assignee][row.status] = row.count;
    });

    return { byStatus, byAgent };
  } catch (e) {
    console.error('[tasks] getTaskStats failed:', e.message);
    return { byStatus: {}, byAgent: {} };
  }
}

// Clean up old completed tasks (>48 hours)
async function cleanupOldTasks() {
  try {
    const result = await pool.query(
      `DELETE FROM tasks WHERE status = 'completed' AND completed_at < NOW() - INTERVAL '48 hours'`
    );
    if (result.rowCount > 0) {
      console.log(`[tasks] Cleaned up ${result.rowCount} old tasks`);
    }
  } catch (e) {
    console.error('[tasks] cleanup failed:', e.message);
  }
}

module.exports = {
  initTasksTable,
  createTask,
  getActiveTasks,
  getTask,
  startTask,
  completeTask,
  getTaskStats,
  cleanupOldTasks
};
