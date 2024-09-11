const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs'); // Import fs module

const app = express();
const port = 3000;
let logs = [];

// Initialize SQLite database
const db = new sqlite3.Database('moisture.db');

// Create the weekly_reports table if it doesn't exist
db.run(`CREATE TABLE IF NOT EXISTS weekly_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  report_date DATE NOT NULL,
  image TEXT,
  description TEXT
)`);

// Set up storage for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/images/'); // Make sure this folder exists
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS phase_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phase TEXT NOT NULL,
    start_date TEXT NOT NULL
  )`);

  // Initialize with default phase if no records exist
  db.get('SELECT COUNT(*) AS count FROM phase_logs', (err, row) => {
    if (row.count === 0) {
      const defaultPhase = 'vegetative';
      const startDate = new Date().toISOString();
      db.run(`INSERT INTO phase_logs (phase, start_date) VALUES (?, ?)`, [defaultPhase, startDate]);
      console.log('Inserted default phase into phase_logs');
    }
  });
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS daily_water_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    water_usage REAL NOT NULL
  )`);
});

function insertWaterUsage(date, waterUsage) {
  db.run(`INSERT INTO daily_water_usage (date, water_usage) VALUES (?, ?)`, [date, waterUsage], function(err) {
    if (err) {
      return console.error(err.message);
    }
    console.log(`Row(s) inserted ${this.changes}`);
  });
}

// Store sensor data in memory
let sensorData = {
  averageMoisture: null,
  relayStatus: null,
  sensor1: null,
  sensor2: null,
  sensor3: null,
  sensor4: null,
  sensor5: null,
  sensor6: null,
  sensor7: null,
  sensor8: null,
  sensor9: null
};

// Middleware to parse JSON bodies
app.use(express.json());
app.use(express.static('public'));

// Handle GET requests to /update
app.get('/update', (req, res) => {
  console.log('Received query:', req.query); 
  const { moisture, status, sensor1, sensor2, sensor3, sensor4, sensor5, sensor6, sensor7, sensor8, sensor9 } = req.query;

  if (moisture !== undefined && status !== undefined) {
    sensorData = {
      averageMoisture: moisture,
      relayStatus: status,
      sensor1: sensor1 || 'N/A',
      sensor2: sensor2 || 'N/A',
      sensor3: sensor3 || 'N/A',
      sensor4: sensor4 || 'N/A',
      sensor5: sensor5 || 'N/A',
      sensor6: sensor6 || 'N/A',
      sensor7: sensor7 || 'N/A',
      sensor8: sensor8 || 'N/A',
      sensor9: sensor9 || 'N/A'
    };
    console.log('Updated sensor data:', sensorData);
    res.send('Data received');
  } else {
    res.status(400).send('Invalid data');
  }
});


app.post('/log', (req, res) => {
  const timestamp = new Date().toISOString(); // Use server time
  const { moisture, relayStatus, lastSensor } = req.body;

  console.log('Log received:', req.body); // Debugging: Log received data

  // Save log data
  logs.push({ time: timestamp, moisture: moisture, relayStatus: relayStatus, lastSensor: lastSensor });
  res.send("Log received");
});



// Serve sensor data as JSON
app.get('/data', (req, res) => {
  res.json(sensorData);
});

// Serve today's log as JSON
app.get('/today-log', (req, res) => {
  res.json(logs);
});

// Handle POST request to upload a report
app.post('/upload-report', upload.single('reportImage'), (req, res) => {
  const { title, description, reportDate } = req.body;
  const image = req.file ? req.file.filename : null;

  db.run(
    `INSERT INTO weekly_reports (title, report_date, image, description) VALUES (?, ?, ?, ?)`,
    [title, reportDate, image, description],
    function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ message: 'Report saved successfully' }); // Send a response without redirecting
    }
  );
});

// Serve weekly reports as JSON
app.get('/weekly-reports', (req, res) => {
  db.all('SELECT * FROM weekly_reports', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Serve the report images
app.use('/images', express.static('public/images'));


// Handle PUT request to update a report
app.put('/update-report/:id', upload.single('reportImage'), (req, res) => {
  console.log(`PUT request received for report ID: ${req.params.id}`);
    console.log('Request body:', req.body);
    console.log('Uploaded file:', req.file);
  const { id } = req.params;
  const { title, reportDate, description } = req.body;
  const image = req.file ? req.file.filename : null;

  // Validation: Ensure that all required fields are provided
  if (!title || !reportDate || !description) {
    return res.status(400).json({ error: 'Title, date, and description are required.' });
  }

  // Fetch the current report from the database to check if there's an existing image
  db.get('SELECT image FROM weekly_reports WHERE id = ?', [id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to retrieve the current report.' });
    }

    // Update the report in the database
    db.run(
      `UPDATE weekly_reports SET title = ?, report_date = ?, image = ?, description = ? WHERE id = ?`,
      [title, reportDate, image || row.image, description, id],
      function (err) {
        if (err) {
          return res.status(500).json({ error: 'Failed to update the report in the database.' });
        }
        res.json({ message: 'Report updated successfully' });
      }
    );
  });
});

// Handle DELETE request to remove a report
app.delete('/delete-report/:id', (req, res) => {
  const { id } = req.params;

  // Fetch the image filename to delete it from the server
  db.get('SELECT image FROM weekly_reports WHERE id = ?', [id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (row && row.image) {
      // Remove image file from the server
      fs.unlink(path.join('public/images', row.image), (err) => {
        if (err) console.error('Failed to delete image:', err);
      });
    }

    // Delete the report from the database
    db.run('DELETE FROM weekly_reports WHERE id = ?', [id], function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ message: 'Report deleted successfully' });
    });
  });
});

// Handle GET request to fetch a specific report by ID
app.get('/report/:id', (req, res) => {
  const { id } = req.params;

  db.get('SELECT * FROM weekly_reports WHERE id = ?', [id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to retrieve the report.' });
    }

    if (!row) {
      return res.status(404).json({ error: 'Report not found.' });
    }

    res.json(row);
  });
});

app.post('/set-phase', (req, res) => {
  const { phase, startDate } = req.body;

  if (!phase || !startDate) {
    return res.status(400).json({ error: 'Phase and startDate are required' });
  }
  const isValidDate = Date.parse(startDate);
if (isNaN(isValidDate)) {
  return res.status(400).json({ error: 'Invalid startDate format' });
}
db.run(`INSERT INTO phase_logs (phase, start_date) VALUES (?, ?)`, [phase, startDate], function(err) {
  if (err) {
    console.error('Error inserting phase log:', err);
    return res.status(500).json({ error: 'Failed to set phase' });
  }
  res.json({ id: this.lastID, phase, startDate });
  console.log(`Phase set to ${phase} starting from ${startDate}`);
});
});

app.get('/current-phase', (req, res) => {
  db.get(`SELECT phase, start_date FROM phase_logs ORDER BY id DESC LIMIT 1`, (err, row) => {
    if (err) {
      console.error('Error fetching current phase:', err);
      return res.status(500).json({ error: 'Failed to fetch current phase' });
    }
    if (!row) {
      return res.status(404).json({ error: 'No phase data found' });
    }
    res.json({ phase: row.phase, startDate: row.start_date });
  });
});


app.get('/phase-logs', (req, res) => {
  db.all(`SELECT phase, start_date FROM phase_logs ORDER BY start_date DESC`, (err, rows) => {
    if (err) {
      console.error('Error fetching phase logs:', err);
      return res.status(500).json({ error: 'Failed to fetch phase logs' });
    }
    res.setHeader('Content-Type', 'application/json');
    res.json(rows);
  });
});

app.get('/water-usage-today', (req, res) => {
  const query = `SELECT water_usage FROM daily_water_usage
                 WHERE date = DATE('now', 'localtime')`;

  db.get(query, (err, row) => {
    if (err) {
      console.error(err.message);
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    if (row) {
      res.json({ waterUsage: row.water_usage });
    } else {
      res.json({ waterUsage: 0 }); // Default value if no data is found
    }
  });
});




app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
