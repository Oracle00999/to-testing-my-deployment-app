# Testing Notes API

Small Express CRUD API for testing the deployer platform.

It intentionally has no Dockerfile so the platform should detect Node from `package.json` and generate one.

## Required Environment Variables

- `APP_NAME`: display name for the API
- `API_KEY`: required as the `x-api-key` header for `/notes` routes
- `PORT`: optional locally, defaults to `3000`

## Deploy Settings

- Internal port: `3000`
- Build command: leave empty
- Start command: leave empty
- Dockerfile path: leave empty

## Local Run

```bash
npm install
APP_NAME="Testing Notes API" API_KEY="secret123" npm start
```

## Test Requests

```bash
curl http://localhost:3000/health
curl -H "x-api-key: secret123" http://localhost:3000/notes
curl -X POST http://localhost:3000/notes \
  -H "content-type: application/json" \
  -H "x-api-key: secret123" \
  -d '{"title":"Hello","body":"Created from curl"}'
```
