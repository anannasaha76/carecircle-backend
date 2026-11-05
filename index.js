import express from "express";
import { MongoClient, ObjectId } from "mongodb";
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

function joinedEventsCol() {
  return db.collection("joinedEvents");
}

app.get("/events", async (req, res) => {
  try {
    const { type, search } = req.query;
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

    const query = {
      eventDate: { $gte: today },
    };

    if (type && type !== "all") {
      query.eventType = type.toString().toLowerCase();
    }

    if (search && typeof search === "string" && search.trim()) {
      query.$or = [
        { title: { $regex: search.trim(), $options: "i" } },
        { location: { $regex: search.trim(), $options: "i" } },
        { description: { $regex: search.trim(), $options: "i" } },
      ];
    }

    const events = await eventsCol()
      .find(query)
      .sort({ eventDate: 1 })
      .toArray();

    res.json({ success: true, data: events });
  } catch (err) {
    console.error("Error fetching events:", err);
    res.status(500).json({ success: false, message: "Failed to fetch events." });
  }
});


app.get("/events/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid event ID." });
    }

    const event = await eventsCol().findOne({ _id: new ObjectId(id) });
    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found." });
    }

    res.json({ success: true, data: event });
  } catch (err) {
    console.error("Error fetching event details:", err);
    res.status(500).json({ success: false, message: "Failed to fetch event." });
  }
});


app.get("/events/:id/join-status", async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.query;

    if (!ObjectId.isValid(id) || !email) {
      return res.json({ success: true, joined: false });
    }

    const record = await joinedEventsCol().findOne({
      eventId: id,
      userEmail: email.toString().toLowerCase().trim(),
    });

    res.json({ success: true, joined: Boolean(record) });
  } catch (err) {
    console.error("Error checking join status:", err);
    res.status(500).json({ success: false, message: "Failed to check join status." });
  }
});

app.post("/events/:id/join", async (req, res) => {
  try {
    const { id } = req.params;
    const { userEmail, userName } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid event ID." });
    }

    if (!userEmail) {
      return res.status(400).json({ success: false, message: "userEmail is required to join an event." });
    }

    const event = await eventsCol().findOne({ _id: new ObjectId(id) });
    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found." });
    }

    
    const today = new Date().toISOString().split("T")[0];
    if (event.eventDate < today) {
      return res.status(400).json({ success: false, message: "Cannot join an event that has already passed." });
    }

    const normalizedEmail = userEmail.toLowerCase().trim();

    
    const alreadyJoined = await joinedEventsCol().findOne({
      eventId: id,
      userEmail: normalizedEmail,
    });

    if (alreadyJoined) {
      return res.status(409).json({ success: false, message: "You have already joined this event." });
    }

    const joinDoc = {
      eventId: id,
      eventTitle: event.title,
      eventDate: event.eventDate,
      eventType: event.eventType,
      location: event.location,
      thumbnailURL: event.thumbnailURL || null,
      userEmail: normalizedEmail,
      userName: userName?.trim() || null,
      joinedAt: new Date(),
    };

    await joinedEventsCol().insertOne(joinDoc);

    await eventsCol().updateOne(
      { _id: new ObjectId(id) },
      { $inc: { joinedCount: 1 } }
    );

    res.status(201).json({
      success: true,
      message: "Successfully joined the event!",
      data: joinDoc,
    });
  } catch (err) {
    console.error("Error joining event:", err);
    res.status(500).json({ success: false, message: "Failed to join event." });
  }
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
