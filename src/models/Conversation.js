const mongoose = require('mongoose')

const ConversationSchema = new mongoose.Schema({
  participants: { type: [String], required: true },
  participantsKey: { type: String, unique: true, required: true },
}, { timestamps: true })

// Ensure single unique index only (avoid duplicate index warnings)

module.exports = mongoose.model('Conversation', ConversationSchema)
