import express from "express";
import { MongoClient } from "mongodb";
import "dotenv/config";
import cors from "cors";
const app = express();
const port = 8000;
const client = new MongoClient(process.env.MONGODB_URI);
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      process.env.FRONTEND_URL,
    ].filter(Boolean),
    credentials: true,
  })
);
app.use(express.json());


let db;

async function connectToMongoDB() {
  try {
    await client.connect();
    db = client.db("carecircle");
    console.log("✅ Connected to MongoDB!");
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  }
}

function eventsCol() {
  return db.collection("events");
}
app.get("/", (_req, res) => {
  res.json({ message: "CareCircle API is running!" });
});


app.post("/events", async (req, res) => {
  try {
    const {
      title,
      description,
      eventType,
      thumbnailURL,
      location,
      eventDate,
      creatorEmail,
      creatorName,
    } = req.body;

    if (!title || !description || !eventType || !location || !eventDate || !creatorEmail) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: title, description, eventType, location, eventDate, creatorEmail.",
      });
    }
    const today = new Date().toISOString().split("T")[0];
    if (eventDate <= today) {
      return res.status(400).json({
        success: false,
        message: "Event date must be in the future.",
      });
    }

    const doc = {
      title: title.trim(),
      description: description.trim(),
      eventType,
      thumbnailURL: thumbnailURL?.trim() || null,
      location: location.trim(),
      eventDate,
      creatorEmail: creatorEmail.toLowerCase().trim(),
      creatorName: creatorName?.trim() || null,
      joinedCount: 0,
      createdAt: new Date(),
    };

    const result = await eventsCol().insertOne(doc);

    res.status(201).json({
      success: true,
      message: "Event created successfully.",
      data: { _id: result.insertedId, ...doc },
    });
  } catch (err) {
    console.error("Error creating event:", err);
    res.status(500).json({ success: false, message: "Failed to create event." });
  }
});
connectToMongoDB().then(() => {
  app.listen(port, () => {
    console.log(`🚀 CareCircle API running at http://localhost:${port}`);
  });
});
