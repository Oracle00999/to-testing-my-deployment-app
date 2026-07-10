const express = require("express");
const { Pool } = require("pg");
const { createClient } = require("redis");

const requiredEnv = ["APP_NAME", "API_KEY", "DATABASE_URL", "REDIS_URL"];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);

if (missingEnv.length > 0) {
  console.error(`Missing required env variable(s): ${missingEnv.join(", ")}`);
  process.exit(1);
}

const app = express();
const port = Number(process.env.PORT || 3000);
const appName = process.env.APP_NAME;
const apiKey = process.env.API_KEY;
const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const release = "redis-service-check-001";
const pool = new Pool({
  connectionString: databaseUrl,
});
const redis = createClient({
  socket: {
    connectTimeout: 5000,
    reconnectStrategy: false,
  },
  url: redisUrl,
});

redis.on("error", (error) => {
  console.error("Redis connection error:", error.message);
});

let nextNoteId = 2;
const notes = [
  {
    id: 1,
    title: "First deployed note",
    body: "If you can read this, env vars and deployment worked.",
    createdAt: new Date().toISOString(),
  },
];

app.use(express.json());

const initializeDatabase = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
};

const requireApiKey = (req, res, next) => {
  if (req.header("x-api-key") !== apiKey) {
    return res.status(401).json({
      error: "Invalid or missing x-api-key header",
    });
  }

  return next();
};

app.get("/", (_req, res) => {
  res.json({
    app: appName,
    release,
    message: "Testing API is running after a GitHub push",
    env: {
      apiKeyConfigured: Boolean(apiKey),
      databaseConfigured: Boolean(databaseUrl),
      redisConfigured: Boolean(redisUrl),
      nodeEnv: process.env.NODE_ENV || "development",
      port,
    },
    routes: [
      "GET /health",
      "GET /notes",
      "POST /notes",
      "GET /notes/:id",
      "PATCH /notes/:id",
      "DELETE /notes/:id",
      "GET /users",
      "POST /users",
      "GET /users/:id",
      "GET /cache/:key",
      "PUT /cache/:key",
      "DELETE /cache/:key",
    ],
  });
});

app.get("/health", async (_req, res) => {
  try {
    await Promise.all([pool.query("SELECT 1"), redis.ping()]);

    res.json({
      app: appName,
      database: "connected",
      redis: "connected",
      ok: true,
      release,
      uptime: process.uptime(),
    });
  } catch (error) {
    res.status(503).json({
      app: appName,
      services: "unreachable",
      error: error.message,
      ok: false,
      release,
    });
  }
});

app.use("/notes", requireApiKey);
app.use("/users", requireApiKey);
app.use("/cache", requireApiKey);

app.get("/notes", (_req, res) => {
  res.json({
    count: notes.length,
    data: notes,
  });
});

app.post("/notes", (req, res) => {
  const title = String(req.body.title || "").trim();
  const body = String(req.body.body || "").trim();

  if (!title || !body) {
    return res.status(400).json({
      error: "title and body are required",
    });
  }

  const note = {
    id: nextNoteId,
    title,
    body,
    createdAt: new Date().toISOString(),
  };

  nextNoteId += 1;
  notes.push(note);

  return res.status(201).json({
    data: note,
  });
});

app.get("/notes/:id", (req, res) => {
  const note = notes.find((item) => item.id === Number(req.params.id));

  if (!note) {
    return res.status(404).json({
      error: "Note not found",
    });
  }

  return res.json({
    data: note,
  });
});

app.patch("/notes/:id", (req, res) => {
  const note = notes.find((item) => item.id === Number(req.params.id));

  if (!note) {
    return res.status(404).json({
      error: "Note not found",
    });
  }

  if (typeof req.body.title === "string") {
    note.title = req.body.title.trim() || note.title;
  }

  if (typeof req.body.body === "string") {
    note.body = req.body.body.trim() || note.body;
  }

  note.updatedAt = new Date().toISOString();

  return res.json({
    data: note,
  });
});

app.delete("/notes/:id", (req, res) => {
  const noteIndex = notes.findIndex(
    (item) => item.id === Number(req.params.id),
  );

  if (noteIndex === -1) {
    return res.status(404).json({
      error: "Note not found",
    });
  }

  notes.splice(noteIndex, 1);

  return res.status(204).send();
});

app.get("/users", async (_req, res) => {
  const result = await pool.query(
    "SELECT id, name, email, created_at AS \"createdAt\" FROM users ORDER BY id DESC",
  );

  res.json({
    count: result.rowCount,
    data: result.rows,
  });
});

app.post("/users", async (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();

  if (!name || !email) {
    return res.status(400).json({
      error: "name and email are required",
    });
  }

  try {
    const result = await pool.query(
      `
        INSERT INTO users (name, email)
        VALUES ($1, $2)
        RETURNING id, name, email, created_at AS "createdAt"
      `,
      [name, email],
    );

    return res.status(201).json({
      data: result.rows[0],
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        error: "A user with this email already exists",
      });
    }

    throw error;
  }
});

app.get("/users/:id", async (req, res) => {
  const result = await pool.query(
    "SELECT id, name, email, created_at AS \"createdAt\" FROM users WHERE id = $1",
    [Number(req.params.id)],
  );

  if (result.rowCount === 0) {
    return res.status(404).json({
      error: "User not found",
    });
  }

  return res.json({
    data: result.rows[0],
  });
});

app.get("/cache/:key", async (req, res) => {
  const value = await redis.get(req.params.key);

  if (value === null) {
    return res.status(404).json({
      error: "Cache key not found",
    });
  }

  return res.json({
    data: {
      key: req.params.key,
      value,
    },
  });
});

app.put("/cache/:key", async (req, res) => {
  const value = String(req.body.value ?? "");
  const expiresIn = Number(req.body.expiresIn || 0);

  if (!value) {
    return res.status(400).json({
      error: "value is required",
    });
  }

  if (!Number.isInteger(expiresIn) || expiresIn < 0) {
    return res.status(400).json({
      error: "expiresIn must be a positive whole number",
    });
  }

  if (expiresIn > 0) {
    await redis.set(req.params.key, value, { EX: expiresIn });
  } else {
    await redis.set(req.params.key, value);
  }

  return res.status(201).json({
    data: {
      expiresIn: expiresIn > 0 ? expiresIn : null,
      key: req.params.key,
      value,
    },
  });
});

app.delete("/cache/:key", async (req, res) => {
  const deleted = await redis.del(req.params.key);

  if (deleted === 0) {
    return res.status(404).json({
      error: "Cache key not found",
    });
  }

  return res.status(204).send();
});

Promise.all([initializeDatabase(), redis.connect()])
  .then(() => {
    app.listen(port, "0.0.0.0", () => {
      console.log(`${appName} ${release} listening on port ${port}`);
    });
  })
  .catch((error) => {
    console.error("Service initialization failed:", error.message);
    process.exit(1);
  });
