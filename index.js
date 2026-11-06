import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";
import cors from "cors";
import jwt from "jsonwebtoken";
const app = express();
const port = 8000;
const client = new MongoClient(process.env.MONGODB_URI);
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      process.env.CLIENT_URL,
    ].filter(Boolean),
    credentials: true,
  })
);
app.use(express.json());
app.get("/", (req, res) => {
  res.send("Work Successfully");
});

function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Unauthorized: No token provided." });
  }
  const token = authHeader.split(" ")[1];
  try {
    const secret = process.env.BETTER_AUTH_SECRET;
    let payload = null;

    if (secret) {
      try {
        payload = jwt.verify(token, secret);
      } catch {
        const decoded = jwt.decode(token, { complete: true });
        if (decoded && decoded.payload) {
          const now = Math.floor(Date.now() / 1000);
          if (decoded.payload.exp && decoded.payload.exp < now) {
            return res.status(401).json({ success: false, message: "Unauthorized: Token has expired." });
          }
          payload = decoded.payload;
        }
      }
    } else {
      const decoded = jwt.decode(token);
      if (decoded) payload = decoded;
    }

    if (!payload) {
      return res.status(401).json({ success: false, message: "Unauthorized: Invalid or expired token." });
    }

    req.jwtUser = payload;
    next();
  } catch {
    return res.status(401).json({ success: false, message: "Unauthorized: Invalid or expired token." });
  }
}
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

app.get("/events/recent", async (_req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

    const events = await eventsCol()
      .find({ eventDate: { $gte: today } })
      .sort({ eventDate: 1 })
      .limit(6)
      .toArray();

    res.json({ success: true, data: events });
  } catch (err) {
    console.error("Error fetching recent events:", err);
    res.status(500).json({ success: false, message: "Failed to fetch recent events." });
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

app.post("/events/:id/join", verifyJWT, async (req, res) => {
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

app.get("/joined-events", verifyJWT, async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email query parameter is required.",
      });
    }

    const normalizedEmail = email.toString().toLowerCase().trim();

    const joinedEvents = await joinedEventsCol()
      .find({ userEmail: normalizedEmail })
      .sort({ eventDate: 1 })
      .toArray();

    res.json({ success: true, data: joinedEvents });
  } catch (err) {
    console.error("Error fetching joined events:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch joined events.",
    });
  }
});

app.delete("/joined-events/:id", verifyJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.query;

    if (!ObjectId.isValid(id) || !email) {
      return res.status(400).json({
        success: false,
        message: "Valid registration ID and email are required.",
      });
    }

    const normalizedEmail = email.toString().toLowerCase().trim();

    const record = await joinedEventsCol().findOne({
      _id: new ObjectId(id),
      userEmail: normalizedEmail,
    });

    if (!record) {
      return res.status(404).json({
        success: false,
        message: "Joined event record not found or unauthorized.",
      });
    }

    await joinedEventsCol().deleteOne({ _id: new ObjectId(id) });
    if (record.eventId && ObjectId.isValid(record.eventId)) {
      await eventsCol().updateOne(
        { _id: new ObjectId(record.eventId), joinedCount: { $gt: 0 } },
        { $inc: { joinedCount: -1 } }
      );
    }

    res.json({
      success: true,
      message: "Successfully cancelled your event attendance.",
    });
  } catch (err) {
    console.error("Error cancelling attendance:", err);
    res.status(500).json({
      success: false,
      message: "Failed to cancel attendance.",
    });
  }
});

app.get("/my-events", verifyJWT, async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email query parameter is required.",
      });
    }

    const normalizedEmail = email.toString().toLowerCase().trim();

    const myEvents = await eventsCol()
      .find({ creatorEmail: normalizedEmail })
      .sort({ createdAt: -1 })
      .toArray();

    res.json({ success: true, data: myEvents });
  } catch (err) {
    console.error("Error fetching my events:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch user created events.",
    });
  }
});

app.put("/events/:id", verifyJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      description,
      eventType,
      thumbnailURL,
      location,
      eventDate,
      creatorEmail,
    } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid event ID." });
    }

    if (!creatorEmail) {
      return res.status(400).json({
        success: false,
        message: "creatorEmail is required to verify ownership.",
      });
    }

    const normalizedEmail = creatorEmail.toLowerCase().trim();
    const existing = await eventsCol().findOne({ _id: new ObjectId(id) });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Event not found." });
    }
    if (existing.creatorEmail !== normalizedEmail) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You are only allowed to update events created by you.",
      });
    }
    if (!title || !description || !eventType || !location || !eventDate) {
      return res.status(400).json({
        success: false,
        message: "All fields are required: title, description, eventType, location, eventDate.",
      });
    }

    const today = new Date().toISOString().split("T")[0];
    if (eventDate <= today) {
      return res.status(400).json({
        success: false,
        message: "Event date must be in the future.",
      });
    }

    const updateDoc = {
      title: title.trim(),
      description: description.trim(),
      eventType,
      thumbnailURL: thumbnailURL?.trim() || null,
      location: location.trim(),
      eventDate,
      updatedAt: new Date(),
    };

    await eventsCol().updateOne(
      { _id: new ObjectId(id) },
      { $set: updateDoc }
    );
    await joinedEventsCol().updateMany(
      { eventId: id },
      {
        $set: {
          eventTitle: updateDoc.title,
          eventDate: updateDoc.eventDate,
          eventType: updateDoc.eventType,
          location: updateDoc.location,
          thumbnailURL: updateDoc.thumbnailURL,
        },
      }
    );

    const updated = await eventsCol().findOne({ _id: new ObjectId(id) });

    res.json({
      success: true,
      message: "Event updated successfully.",
      data: updated,
    });
  } catch (err) {
    console.error("Error updating event:", err);
    res.status(500).json({ success: false, message: "Failed to update event." });
  }
});

app.delete("/events/:id", verifyJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const email = req.query.email || req.body?.creatorEmail;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid event ID." });
    }

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Creator email is required to verify ownership.",
      });
    }

    const normalizedEmail = email.toString().toLowerCase().trim();
    const existing = await eventsCol().findOne({ _id: new ObjectId(id) });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Event not found." });
    }

    if (existing.creatorEmail !== normalizedEmail) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You are only allowed to delete events created by you.",
      });
    }
    await eventsCol().deleteOne({ _id: new ObjectId(id) });
    await joinedEventsCol().deleteMany({ eventId: id });

    res.json({
      success: true,
      message: "Event and associated participant records deleted successfully.",
    });
  } catch (err) {
    console.error("Error deleting event:", err);
    res.status(500).json({ success: false, message: "Failed to delete event." });
  }
});

app.post("/events", verifyJWT, async (req, res) => {
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
      creatorImage,
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
      creatorImage: creatorImage?.trim() || null,
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
