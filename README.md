# Chat Backend (MongoDB + Node.js + Socket.IO)

This is a stable build of the Mongo backend we iterated on: REST + realtime, offline delivery & read receipts, multi-origin CORS, robust env loading.

## 0) Requirements
- Node.js 18+ (Node 20 LTS recommended)
- MongoDB (either local or Atlas)

## 1) Pick your Mongo

### Option A: Local (Docker)
```powershell
docker run -d --name mongo -p 27017:27017 -v %cd%\mongo_data:/data/db mongo:7
```
Then in `.env`:
```
MONGO_URL=mongodb://127.0.0.1:27017/chat
```

### Option B: Atlas (SRV)
- Atlas → Network Access: add your **current IP**, wait until **Active**.
- `.env`:
```
MONGO_URL=mongodb+srv://<USER>:<PASS>@<cluster>.mongodb.net/chat?retryWrites=true&w=majority&appName=chat
```
If you hit TLS/network issues, switch to **non‑SRV** below.

### Option C: Atlas (non‑SRV)
Use your 3 hosts + replica set:
```
MONGO_URL=mongodb://<USER>:<PASS>@ac-xxx-shard-00-00.<cluster>.mongodb.net:27017,ac-xxx-shard-00-01.<cluster>.mongodb.net:27017,ac-xxx-shard-00-02.<cluster>.mongodb.net:27017/chat?ssl=true&replicaSet=<yourReplicaSet>&authSource=admin&retryWrites=true&w=majority&appName=chat
```

> Diagnostics only (don’t leave enabled): set `MONGO_TLS_ALLOW_INVALID=true` to bypass TLS validation if corporate AV is intercepting HTTPS, just to confirm the cause.

## 2) Configure & run
```powershell
copy .env.example .env
# edit .env → set MONGO_URL and CORS_ORIGIN
npm install
npm run seed
npm run dev
# http://localhost:4000
```

Frontend `.env`:
```
VITE_SOCKET_URL=http://localhost:4000
VITE_API_URL=http://localhost:4000
```

## 3) REST checks
```powershell
curl http://localhost:4000/health
curl "http://localhost:4000/api/users"
curl "http://localhost:4000/api/conversation?me=ABC&peer=QWR"
curl "http://localhost:4000/api/messages?me=ABC&peer=QWR&limit=50"
```

## 4) Notes
- Indexes included for fast history/offline delivery.
- For prod: add auth (JWT), input size limits, rate limits, and use the Socket.IO Redis adapter if you run multiple instances behind a load balancer.
