require("dotenv").config();

const express = require("express");
const path = require("path");
const mysql = require("mysql2/promise");
const crypto = require("crypto");
const { promisify } = require("util");

const scrypt = promisify(crypto.scrypt);
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

let db;

// Initialize MySQL database and tables
async function initializeDatabase() {
  const config = {
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    port: Number(process.env.DB_PORT || 3306),
  };

  const connection = await mysql.createConnection(config);

  await connection.query("CREATE DATABASE IF NOT EXISTS wastecare_db");

  await connection.end();

  db = await mysql.createPool({
    ...config,
    database: process.env.DB_NAME || "wastecare_db",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(150) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS pickup_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      phone VARCHAR(30) NOT NULL,
      address VARCHAR(255) NOT NULL,
      waste_type VARCHAR(100) NOT NULL,
      pickup_date DATE NOT NULL,
      message TEXT,
      status VARCHAR(30) NOT NULL DEFAULT 'Pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log("MySQL connected successfully!");
}

// Test API
app.get("/api/test", (req, res) => {
  res.json({
    success: true,
    message: "WasteCare API is working!",
  });
});

// Get all pickup requests
app.get("/api/pickups", async (req, res) => {
  try {
    const [requests] = await db.query(
      "SELECT * FROM pickup_requests ORDER BY id DESC",
    );

    res.json({ success: true, requests });
  } catch (error) {
    console.error("Pickup fetch error:", error);
    res.status(500).json({
      success: false,
      message: "Could not load pickup requests.",
    });
  }
});

// Create a pickup request
app.post("/api/pickups", async (req, res) => {
  try {
    const { name, phone, address, waste_type, pickup_date, message } = req.body;

    if (!name || !phone || !address || !waste_type || !pickup_date) {
      return res.status(400).json({
        success: false,
        message: "Please complete all required pickup fields.",
      });
    }

    const [result] = await db.execute(
      `INSERT INTO pickup_requests
       (name, phone, address, waste_type, pickup_date, message)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        name.trim(),
        phone.trim(),
        address.trim(),
        waste_type,
        pickup_date,
        message || null,
      ],
    );

    res.status(201).json({
      success: true,
      message: "Pickup request submitted successfully!",
      requestId: result.insertId,
    });
  } catch (error) {
    console.error("Pickup creation error:", error);
    res.status(500).json({
      success: false,
      message: "Could not submit pickup request.",
    });
  }
});

// Update pickup request status
app.patch("/api/pickups/:id", async (req, res) => {
  try {
    const { status } = req.body;

    if (!["Pending", "Completed"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid request status.",
      });
    }

    const [result] = await db.execute(
      "UPDATE pickup_requests SET status = ? WHERE id = ?",
      [status, req.params.id],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Pickup request not found.",
      });
    }

    res.json({
      success: true,
      message: "Pickup status updated.",
    });
  } catch (error) {
    console.error("Status update error:", error);
    res.status(500).json({
      success: false,
      message: "Could not update pickup status.",
    });
  }
});

// Register a new user
app.post("/api/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password || password.length < 6) {
      return res.status(400).json({
        success: false,
        message:
          "Enter your name, email, and a password of at least 6 characters.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const salt = crypto.randomBytes(16).toString("hex");
    const derivedKey = await scrypt(password, salt, 64);
    const passwordHash = salt + ":" + Buffer.from(derivedKey).toString("hex");

    const [result] = await db.execute(
      `INSERT INTO users (name, email, password_hash)
       VALUES (?, ?, ?)`,
      [name.trim(), normalizedEmail, passwordHash],
    );

    res.status(201).json({
      success: true,
      message: "Account created successfully!",
      user: {
        id: result.insertId,
        name: name.trim(),
        email: normalizedEmail,
      },
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "This email is already registered.",
      });
    }

    console.error("Registration error:", error);
    res.status(500).json({
      success: false,
      message: "Could not create account.",
    });
  }
});

// Login an existing user
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Enter your email and password.",
      });
    }

    const [users] = await db.execute(
      `SELECT id, name, email, password_hash
       FROM users WHERE email = ?`,
      [email.trim().toLowerCase()],
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    const user = users[0];
    const [salt, storedHash] = user.password_hash.split(":");
    const derivedKey = await scrypt(password, salt, 64);
    const suppliedHash = Buffer.from(derivedKey).toString("hex");

    const hashesMatch =
      storedHash.length === suppliedHash.length &&
      crypto.timingSafeEqual(
        Buffer.from(storedHash, "hex"),
        Buffer.from(suppliedHash, "hex"),
      );

    if (!hashesMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    res.json({
      success: true,
      message: "Login successful!",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      message: "Could not log in.",
    });
  }
});

// Admin dashboard overview
app.get("/api/admin/overview", async (req, res) => {
  try {
    const [[userCount]] = await db.query("SELECT COUNT(*) AS total FROM users");

    const [[requestCount]] = await db.query(
      "SELECT COUNT(*) AS total FROM pickup_requests",
    );

    const [[completedCount]] = await db.query(
      "SELECT COUNT(*) AS total FROM pickup_requests WHERE status = 'Completed'",
    );

    const [users] = await db.query(
      "SELECT id, name, email, created_at FROM users ORDER BY id DESC",
    );

    res.json({
      success: true,
      totalUsers: userCount.total,
      totalRequests: requestCount.total,
      completedRequests: completedCount.total,
      users,
    });
  } catch (error) {
    console.error("Admin overview error:", error);
    res.status(500).json({
      success: false,
      message: "Could not load admin overview.",
    });
  }
});

// Homepage
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Start server after database initialization
initializeDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Database startup failed:", error.message);
    console.error("Check your MySQL service and .env settings.");
    process.exit(1);
  });
