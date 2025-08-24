const path = require('path')
require('dotenv').config({ override: true, path: path.join(__dirname, '..', '.env') })
console.log('[env] MONGO_URL starts with:', (process.env.MONGO_URL || '').slice(0, 20))

const { connect } = require('../src/db')
const User = require('../src/models/User')
const Conversation = require('../src/models/Conversation')
const Message = require('../src/models/Message')
const { convoKey } = require('../src/utils')

async function run() {
  await connect(process.env.MONGO_URL)
  console.log('[db] connected')

  await User.updateOne({ code: 'A' }, { $set: { code: 'A', name: 'Baby', online: false } }, { upsert: true })
  await User.updateOne({ code: 'B' }, { $set: { code: 'B', name: 'Mommy', online: false } }, { upsert: true })
  console.log('[seed] users upserted')

  const key = convoKey('A', 'B')
  let convo = await Conversation.findOne({ participantsKey: key })
  if (!convo) {
    convo = await Conversation.create({ participants: key.split('|'), participantsKey: key })
  }
  console.log('[seed] conversation ensured', String(convo._id))

  const any = await Message.findOne({ conversation: convo._id })
  if (!any) {
    await Message.insertMany([
      { conversation: convo._id, from: 'A', to: 'B', text: 'Hey 👋', timestamp: new Date(), status: 'delivered' },
      { conversation: convo._id, from: 'B', to: 'A', text: 'Hello!', timestamp: new Date(Date.now()+1000), status: 'read' },
    ])
    console.log('[seed] sample messages inserted')
  } else {
    console.log('[seed] messages already present, skipping')
  }

  process.exit(0)
}

run().catch(e => { console.error(e); process.exit(1) })
