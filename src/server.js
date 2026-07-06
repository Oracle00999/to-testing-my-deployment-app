const express = require("express");

const requiredEnv = ["APP_NAME", "API_KEY"];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);

if (missingEnv.length > 0) {
  console.error(`Missing required env variable(s): ${missingEnv.join(", ")}`);
  process.exit(1);
}

const app = express();
const port = Number(process.env.PORT || 3000);
const appName = process.env.APP_NAME;
const apiKey = process.env.API_KEY;
const release = "auto-redeploy-check-002";

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
    ],
  });
});

app.get("/health", (_req, res) => {
  res.json({
    app: appName,
    ok: true,
    release,
    uptime: process.uptime(),
  });
});

app.use("/notes", requireApiKey);

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

app.listen(port, "0.0.0.0", () => {
  console.log(`${appName} ${release} listening on port ${port}`);
});
