const mongoose = require('mongoose')

// New optional media subdocument
const MediaSchema = new mongoose.Schema({
  url:   { type: String },   // absolute URL to the image (e.g. http://localhost:4000/uploads/abc.jpg)
  mime:  { type: String },   // image/jpeg, image/png, etc.
  width: { type: Number },
  height:{ type: Number },
  size:  { type: Number }    // bytes
}, { _id: false })

const MessageSchema = new mongoose.Schema({
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
  from: { type: String, required: true },
  to:   { type: String, required: true, index: true },

  // NEW: message type + optional media
  type: { type: String, enum: ['text', 'image'], default: 'text', index: true },
  text: { type: String, trim: true, maxlength: 5000 },           // no longer "required"; may be empty for image messages
  media:{ type: MediaSchema, default: null },

  timestamp: { type: Date, default: Date.now, index: true },
  status: { type: String, enum: ['sent','delivered','read'], default: 'sent', index: true },
}, { timestamps: true })

// Useful indexes
MessageSchema.index({ conversation: 1, timestamp: 1 })
MessageSchema.index({ to: 1, status: 1, timestamp: 1 })

module.exports = mongoose.model('Message', MessageSchema)
