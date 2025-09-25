const path = require('path')
const fs = require('fs')

// Robust .env loader (works from any cwd)
const candidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '..', '.env'),
]
const envPath = candidates.find(p => fs.existsSync(p))
require('dotenv').config({ override: true, path: envPath })
console.log('[env] using:', envPath || '(not found)')
console.log('[env] MONGO_URL starts with:', (process.env.MONGO_URL || '').slice(0, 20))

const express = require('express')
const http = require('http')
const cors = require('cors')
const { Server } = require('socket.io')
const { connect } = require('./db')
const registerPresence = require('./presence');
const User = require('./models/User')
const Conversation = require('./models/Conversation')
const Message = require('./models/Message')
const { convoKey, ensureDir } = require('./utils')

const PORT = process.env.PORT || 4000
const MONGO_URL = process.env.MONGO_URL

const RAW_ORIGINS = (process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',').map(s => s.trim()).filter(Boolean)

function allowOrigin(origin) {
  if (!origin) return true;
  if (RAW_ORIGINS.includes(origin)) return true;
  if (origin.endsWith('.vercel.app')) return true;
  return false;
}

async function getOrCreateConversation(a, b) {
  const key = convoKey(a, b)
  let convo = await Conversation.findOne({ participantsKey: key })
  if (!convo) {
    convo = await Conversation.create({ participants: key.split('|'), participantsKey: key })
  }
  return convo
}

async function main() {
  await connect(MONGO_URL)
  console.log('[db] connected')

  const app = express()
  const upDir = ensureDir(path.join(__dirname, '..', 'uploads'))
  app.use('/uploads', express.static(upDir, { maxAge: '7d', fallthrough: true }))

  app.use(cors({
    origin: (origin, cb) => cb(null, allowOrigin(origin)),
    credentials: true
  }))

  app.use(express.json())

  app.use('/', require('./routes/health'))
  app.use('/api', require('./routes/chat'))
  app.use('/api', require('./routes/upload'))

  const server = http.createServer(app)

  const io = new Server(server, {
    cors: {
      origin: (origin, cb) => cb(null, allowOrigin(origin)),
      methods: ['GET', 'POST'],
      credentials: true
    },
    pingInterval: 25000,
    pingTimeout: 60000,
  })

  registerPresence(io);

  io.on('connection', async (socket) => {
    const code = (socket.handshake?.query?.code || '').toString().toUpperCase()
    if (!code) {
      socket.emit('error', 'Missing code in connection query')
      return socket.disconnect(true)
    }

    socket.join(`user:${code}`)
    console.log(`[socket] ${code} connected: ${socket.id}`)
    const room = io.sockets.adapter.rooms.get(`user:${code}`);
    if ((room?.size || 0) === 1) {
      await User.updateOne({ code }, { $set: { code, name: code, online: true } }, { upsert: true });
    }

    // deliver missed
    try {
      const undelivered = await Message.find({ to: code, status: 'sent' }).sort({ timestamp: 1 })
      for (const m of undelivered) {
        io.to(`user:${code}`).emit('message', {
          id: String(m._id),
          text: m.text,
          from: m.from,
          to: m.to,
          type: m.type || 'text',     // <-- add
          media: m.media || null,     // <-- add
          timestamp: new Date(m.timestamp).getTime()
        })
        await Message.updateOne({ _id: m._id }, { $set: { status: 'delivered' } })
        io.to(`user:${m.from}`).emit('message:delivered', { id: String(m._id) })
      }
    } catch (e) {
      console.error('deliver on connect error', e)
    }

    // socket.on('disconnect', async () => {
    //   await User.updateOne({ code }, { $set: { online: false } })
    //   console.log(`[socket] ${code} disconnected`)
    // })
    socket.on('disconnect', async () => {
      const stillThere = (io.sockets.adapter.rooms.get(`user:${code}`)?.size || 0) > 0;
      if (!stillThere) {
        await User.updateOne({ code }, { $set: { online: false } });
      }
    });

    socket.on('message:send', async (payload, ack) => {
      try {
        const { id: tempId, text, from, to, timestamp, type, media } = payload || {}
        if (!from || !to) return typeof ack === 'function' && ack({ ok: false, error: 'Missing fields' })

        const hasText = typeof text === 'string' && text.trim().length > 0
        const hasMedia = !!media && !!media.url
        if (!hasText && !hasMedia) {
          return typeof ack === 'function' && ack({ ok: false, error: 'Empty message' })
        }

        const msgType = type || (hasMedia ? 'image' : 'text')

        // Save message
        const convo = await getOrCreateConversation(from, to)
        const msg = await Message.create({
          conversation: convo._id,
          from, to,
          type: msgType,
          text: msgType === 'text' ? text : null,
          media: msgType === 'image' ? media : null,
          timestamp: timestamp ? new Date(timestamp) : new Date(),
          status: 'sent'
        })

        // Ack sender that it was saved + reconcile tempId
        if (typeof ack === 'function') ack({ ok: true, id: String(msg._id) })
        socket.emit('message:sent', { tempId, realId: String(msg._id) })

        // Deliver to recipient if online
        const delivered = (io.sockets.adapter.rooms.get(`user:${to}`)?.size || 0) > 0
        if (delivered) {
          io.to(`user:${to}`).emit('message', {
            id: String(msg._id),
            text: msg.text,
            from: msg.from,
            to: msg.to,
            type: msg.type,             // <-- add
            media: msg.media,           // <-- add
            timestamp: new Date(msg.timestamp).getTime()
          })
          await Message.updateOne({ _id: msg._id }, { $set: { status: 'delivered' } })
          io.to(`user:${from}`).emit('message:delivered', { id: String(msg._id) })
        }
      } catch (e) {
        console.error('message:send error', e)
        if (typeof ack === 'function') ack({ ok: false, error: 'server error' })
      }
    })

    socket.on('message:delivered', async ({ id }) => {
      if (!id) return
      const m = await Message.findById(id)
      if (!m) return
      if (m.status !== 'read') {
        await Message.updateOne({ _id: id }, { $set: { status: 'delivered' } })
        io.to(`user:${m.from}`).emit('message:delivered', { id })
      }
    })

    socket.on('message:read', async ({ id }) => {
      if (!id) return
      const m = await Message.findById(id)
      if (!m) return
      await Message.updateOne({ _id: id }, { $set: { status: 'read' } })
      io.to(`user:${m.from}`).emit('message:read', { id })
    })
  })

  server.listen(PORT, () => {
    console.log(`[http] listening on http://localhost:${PORT}`)
  })
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
