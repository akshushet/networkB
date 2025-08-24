const express = require('express')
const router = express.Router()
const Conversation = require('../models/Conversation')
const Message = require('../models/Message')
const User = require('../models/User')
const { convoKey } = require('../utils')

// List users
router.get('/users', async (req, res) => {
  try {
    const users = await User.find({}, { _id: 0, code: 1, name: 1, online: 1 }).sort({ code: 1 }).lean()
    res.json(users)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Get or create conversation
router.get('/conversation', async (req, res) => {
  const { me, peer } = req.query
  if (!me || !peer) return res.status(400).json({ error: 'me and peer are required' })
  try {
    const key = convoKey(me, peer)
    let convo = await Conversation.findOne({ participantsKey: key }).lean()
    if (!convo) {
      convo = await Conversation.create({ participants: key.split('|'), participantsKey: key })
    }
    res.json(convo)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Messages history
router.get('/messages', async (req, res) => {
  const { me, peer, limit = 50, before } = req.query
  if (!me || !peer) return res.status(400).json({ error: 'me and peer are required' })
  try {
    const key = convoKey(me, peer)
    const convo = await Conversation.findOne({ participantsKey: key }).lean()
    if (!convo) return res.json({ messages: [] })
    const query = { conversation: convo._id }
    if (before) query.timestamp = { $lt: new Date(before) }
    const msgs = await Message.find(query, { __v: 0 })
      .sort({ timestamp: 1 })
      .limit(Number(limit))
      .lean()
    res.json({
      messages: msgs.map(m => ({
        id: String(m._id),
        conversation: String(m.conversation),
        from: m.from, to: m.to,
        type: m.type || 'text',     // <-- include
        text: m.text,
        media: m.media || null,     // <-- include
        timestamp: new Date(m.timestamp).getTime(),
        status: m.status
      }))
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
