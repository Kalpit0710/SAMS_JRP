import mongoose from "mongoose";

export async function connectDb(uri: string): Promise<void> {
  await mongoose.connect(uri, {
    autoIndex: true,
    serverSelectionTimeoutMS: 5000
  });
}
