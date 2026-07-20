const mongoose = require('mongoose');
require('dotenv').config();

const run = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, { dbName: 'RankedBedwars' });
    console.log(`Connected to MongoDB: ${conn.connection.host}`);
    
    const db = conn.connection.db;
    const collection = db.collection('Punishments');
    
    console.log('Attempting to drop userId_1 index...');
    await collection.dropIndex('userId_1');
    console.log('Successfully dropped userId_1 index from Punishments collection.');
  } catch (error) {
    if (error.code === 27) {
      console.log('Index userId_1 not found, nothing to do.');
    } else {
      console.error('Error dropping index:', error);
    }
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
  }
};

run();
