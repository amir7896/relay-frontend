# Relay (Frontend)

Product UI for the NestJS microservices gateway.

## Run

Gateway must be on `http://127.0.0.1:3002`. From repo root:

```bash
npm run dev
```

Or frontend only:

```bash
cd frontend
npm install
npm run dev
```

Open **http://127.0.0.1:5173**.

## Pages

| Route | Description |
| --- | --- |
| `/` | Landing (showcases reactions, voice, AI, analytics) |
| `/login`, `/register` | Accounts |
| `/chat` | Inbox + thread (shared Socket.IO connection) |
| `/profile` | Profile, notifications, branding (admin), demo tour reset |
| `/people` | Admin directory |
| `/analytics` | Admin dashboard + audit log |

## Demo

See [../DEMO.md](../DEMO.md) for the 2-minute buyer script.
