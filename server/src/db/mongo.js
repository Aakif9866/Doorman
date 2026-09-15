import mongoose from "mongoose";

let connected = false;

export async function connectMongo() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.warn("[db] MONGO_URI not set — running without persistence (console + in-memory only).");
    return false;
  }
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 2000 });
    connected = true;
    console.log("[db] connected to MongoDB");
    return true;
  } catch (err) {
    console.warn(`[db] failed to connect to MongoDB (${err.message}) — running without persistence.`);
    return false;
  }
}

export function isConnected() {
  return connected;
}
