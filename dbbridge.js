require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const app = express();
app.use(express.json({ limit: "2mb" }));
const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT,
  database: process.env.DB_NAME, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, max: 4,
  statement_timeout: 30 * 60 * 1000,
});
const TOKEN = process.env.DBBRIDGE_TOKEN;
if (!TOKEN || TOKEN.length < 32) { console.error("DBBRIDGE_TOKEN missing from .env"); process.exit(1); }
app.use((req, res, next) => {
  if (req.headers.authorization !== "Bearer " + TOKEN) return res.status(401).json({ error: "unauthorized" });
  next();
});
app.get("/ping", (req, res) => res.json({ ok: true, db: process.env.DB_NAME }));
app.post("/sql", async (req, res) => {
  const { sql, params } = req.body || {};
  if (!sql) return res.status(400).json({ error: "no sql" });
  const t0 = Date.now();
  console.log(new Date().toISOString(), "[sql]", sql.replace(/\s+/g, " ").slice(0, 250));
  try {
    const r = await pool.query(sql, params);
    res.json({ rowCount: r.rowCount, rows: (r.rows || []).slice(0, 5000), ms: Date.now() - t0 });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.listen(3999, "127.0.0.1", () => console.log("DB bridge up. CLOSE THIS WINDOW TO CUT OFF ACCESS."));
