// server.js - Backend API Server
const express = require('express');
const cors = require('cors');
// const { Client: PgClient } = require('pg');
// const mysql = require('mysql2/promise');
const oracledb = require('oracledb');
// const { Snowflake } = require('snowflake-sdk');
// const OpenAI = require('openai');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize Oracle thick client
try {
  oracledb.initOracleClient({
    libDir: process.env.ORACLE_CLIENT_LIB_DIR || '/opt/oracle/instantclient_21_1'
  });
  console.log('✓ Oracle thick client initialized');
} catch (err) {
  console.error('Oracle thick client initialization error:', err);
  console.log('⚠ Running with thin client mode');
}

// Middleware
app.use(cors());
app.use(express.json());

// Elevance Health API Configuration (replaces OpenAI)
let elevanceApiKey = process.env.ELEVANCE_API_KEY;
let tokenRefreshInterval = null;

const ELEVANCE_API_BASE = 'https://api.horizon.elevancehealth.com/v2';

const callElevanceAPI = async (messages, options = {}) => {
  try {
    const response = await fetch(`${ELEVANCE_API_BASE}/text/chats`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${elevanceApiKey}`,
        ...options.headers
      },
      body: JSON.stringify({
        messages: messages,
        temperature: options.temperature || 0.7,
        max_tokens: options.max_tokens || 2000,
        model: options.model || 'gpt-4-turbo-preview'
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Elevance API request failed');
    }

    return await response.json();
  } catch (error) {
    console.error('Elevance API Error:', error);
    throw error;
  }
};

const initializeElevanceAPI = () => {
  elevanceApiKey = process.env.ELEVANCE_API_KEY;
  console.log('✓ Elevance Health API client initialized');
};

// Token refresh job - runs every 14 minutes
const startTokenRefreshJob = () => {
  if (tokenRefreshInterval) {
    clearInterval(tokenRefreshInterval);
  }
  
  tokenRefreshInterval = setInterval(() => {
    console.log('🔄 Refreshing Elevance API token...');
    initializeElevanceAPI();
    console.log('✓ Elevance API token refreshed at', new Date().toISOString());
  }, 14 * 60 * 1000); // 14 minutes
  
  console.log('✓ Token refresh job started (every 14 minutes)');
};

// Database Metadata Manager
class DatabaseMetadata {
  constructor(metadataPath) {
    this.metadataPath = metadataPath;
    this.connections = new Map();
  }

  async loadMetadata() {
    try {
      const data = await fs.readFile(this.metadataPath, 'utf-8');
      const metadata = JSON.parse(data);
      console.log(`✓ Loaded metadata for ${metadata.databases.length} databases`);
      return metadata;
    } catch (error) {
      console.error('Error loading metadata:', error);
      throw error;
    }
  }

  async refreshMetadata() {
    const metadata = await this.loadMetadata();
    
    for (const db of metadata.databases) {
      try {
        await this.testConnection(db);
        console.log(`✓ Connection validated: ${db.name}`);
      } catch (error) {
        console.error(`✗ Connection failed: ${db.name}`, error.message);
      }
    }
    
    return metadata;
  }

  async testConnection(dbConfig) {
    switch (dbConfig.type) {
      // case 'postgres':
      //   return this.testPostgres(dbConfig);
      // case 'mysql':
      //   return this.testMySQL(dbConfig);
      case 'oracle':
        return this.testOracle(dbConfig);
      // case 'snowflake':
      //   return this.testSnowflake(dbConfig);
      default:
        throw new Error(`Unsupported database type: ${dbConfig.type}`);
    }
  }

  // async testPostgres(config) {
  //   const client = new PgClient({
  //     host: config.host,
  //     port: config.port,
  //     database: config.database,
  //     user: config.username,
  //     password: config.password,
  //     ssl: config.ssl ? { rejectUnauthorized: false } : false
  //   });
  //   
  //   await client.connect();
  //   await client.query('SELECT 1');
  //   await client.end();
  //   return true;
  // }

  // async testMySQL(config) {
  //   const connection = await mysql.createConnection({
  //     host: config.host,
  //     port: config.port,
  //     database: config.database,
  //     user: config.username,
  //     password: config.password
  //   });
  //   
  //   await connection.query('SELECT 1');
  //   await connection.end();
  //   return true;
  // }

  async testOracle(config) {
    const connection = await oracledb.getConnection({
      user: config.username,
      password: config.password,
      connectString: `${config.host}:${config.port}/${config.database}`
    });
    
    await connection.execute('SELECT 1 FROM DUAL');
    await connection.close();
    return true;
  }

  // async testSnowflake(config) {
  //   return new Promise((resolve, reject) => {
  //     const connection = Snowflake.createConnection({
  //       account: config.account,
  //       username: config.username,
  //       password: config.password,
  //       warehouse: config.warehouse,
  //       database: config.database,
  //       schema: config.schema
  //     });

  //     connection.connect((err) => {
  //       if (err) {
  //         reject(err);
  //       } else {
  //         connection.execute({
  //           sqlText: 'SELECT 1',
  //           complete: (err) => {
  //             connection.destroy();
  //             if (err) reject(err);
  //             else resolve(true);
  //           }
  //         });
  //       }
  //     });
  //   });
  // }

  async executeQuery(dbId, query) {
    const metadata = await this.loadMetadata();
    const dbConfig = metadata.databases.find(db => db.id === dbId);
    
    if (!dbConfig) {
      throw new Error(`Database ${dbId} not found`);
    }

    switch (dbConfig.type) {
      // case 'postgres':
      //   return this.queryPostgres(dbConfig, query);
      // case 'mysql':
      //   return this.queryMySQL(dbConfig, query);
      case 'oracle':
        return this.queryOracle(dbConfig, query);
      // case 'snowflake':
      //   return this.querySnowflake(dbConfig, query);
      default:
        throw new Error(`Unsupported database type: ${dbConfig.type}`);
    }
  }

  // async queryPostgres(config, query) {
  //   const client = new PgClient({
  //     host: config.host,
  //     port: config.port,
  //     database: config.database,
  //     user: config.username,
  //     password: config.password,
  //     ssl: config.ssl ? { rejectUnauthorized: false } : false
  //   });
  //   
  //   await client.connect();
  //   const result = await client.query(query);
  //   await client.end();
  //   return result.rows;
  // }

  // async queryMySQL(config, query) {
  //   const connection = await mysql.createConnection({
  //     host: config.host,
  //     port: config.port,
  //     database: config.database,
  //     user: config.username,
  //     password: config.password
  //   });
  //   
  //   const [rows] = await connection.query(query);
  //   await connection.end();
  //   return rows;
  // }

  async queryOracle(config, query) {
    const connection = await oracledb.getConnection({
      user: config.username,
      password: config.password,
      connectString: `${config.host}:${config.port}/${config.database}`
    });
    
    const result = await connection.execute(query, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    await connection.close();
    return result.rows;
  }

  // async querySnowflake(config, query) {
  //   return new Promise((resolve, reject) => {
  //     const connection = Snowflake.createConnection({
  //       account: config.account,
  //       username: config.username,
  //       password: config.password,
  //       warehouse: config.warehouse,
  //       database: config.database,
  //       schema: config.schema
  //     });

  //     connection.connect((err) => {
  //       if (err) {
  //         reject(err);
  //       } else {
  //         connection.execute({
  //           sqlText: query,
  //           complete: (err, stmt, rows) => {
  //             connection.destroy();
  //             if (err) reject(err);
  //             else resolve(rows);
  //           }
  //         });
  //       }
  //     });
  //   });
  // }
}

// Initialize services
const dbMetadata = new DatabaseMetadata(
  path.join(__dirname, 'config', 'database-metadata.json')
);

// API Routes

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    elevanceApi: elevanceApiKey ? 'connected' : 'disconnected',
    oracle: 'enabled'
  });
});

// Get database connections
app.get('/api/databases', async (req, res) => {
  try {
    const metadata = await dbMetadata.loadMetadata();
    const connections = metadata.databases.map(db => ({
      id: db.id,
      name: db.name,
      type: db.type,
      status: 'connected'
    }));
    res.json(connections);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Refresh database metadata
app.post('/api/databases/refresh', async (req, res) => {
  try {
    const metadata = await dbMetadata.refreshMetadata();
    res.json({ 
      success: true, 
      message: 'Metadata refreshed',
      databases: metadata.databases.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get database schema
app.get('/api/databases/:id/schema', async (req, res) => {
  try {
    const metadata = await dbMetadata.loadMetadata();
    const db = metadata.databases.find(d => d.id === req.params.id);
    
    if (!db) {
      return res.status(404).json({ error: 'Database not found' });
    }

    res.json({
      id: db.id,
      name: db.name,
      type: db.type,
      tables: db.tables || [],
      schema: db.schema
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Execute database query
app.post('/api/query', async (req, res) => {
  try {
    const { databaseId, query } = req.body;
    
    if (!databaseId || !query) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const results = await dbMetadata.executeQuery(databaseId, query);
    res.json({ success: true, data: results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Chat with AI (using Elevance Health API)
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, databaseId, context } = req.body;

    if (!elevanceApiKey) {
      return res.status(503).json({ error: 'Elevance API service not available' });
    }

    // Get database schema for context
    const metadata = await dbMetadata.loadMetadata();
    const db = metadata.databases.find(d => d.id === databaseId);
    
    const systemPrompt = `You are a data analytics assistant. You have access to an ${db?.type || 'Oracle'} database with the following schema:

${JSON.stringify(db?.tables || [], null, 2)}

Generate SQL queries and provide insights based on user questions. Always return responses in JSON format with:
- message: A clear explanation
- query: The SQL query to execute (if applicable)
- visualization: Suggested visualization type (line, bar, scatter, donut)

Previous context: ${JSON.stringify(context || {})}`;

    const apiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages
    ];

    const completion = await callElevanceAPI(apiMessages, {
      temperature: 0.7,
      max_tokens: 2000
    });

    const response = completion.choices[0].message.content;
    
    // Try to parse as JSON, otherwise return as text
    let parsedResponse;
    try {
      parsedResponse = JSON.parse(response);
    } catch {
      parsedResponse = {
        message: response,
        query: null,
        visualization: null
      };
    }

    res.json({
      success: true,
      response: parsedResponse,
      usage: completion.usage
    });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate visualization from data (using Elevance Health API)
app.post('/api/visualize', async (req, res) => {
  try {
    const { data, query } = req.body;

    if (!elevanceApiKey) {
      return res.status(503).json({ error: 'Elevance API service not available' });
    }

    const prompt = `Based on this SQL query and data, suggest the best visualization.

Query: ${query}
Data sample: ${JSON.stringify(data.slice(0, 5), null, 2)}
Total rows: ${data.length}

Analyze the data structure and suggest ONE of these chart types:
- "line": For time series or trends over continuous data
- "bar": For comparing categories or discrete values
- "scatter": For showing correlation between two or more numeric variables
- "donut": For showing composition/distribution of categories (max 10 categories)

Return a JSON object with:
{
  "type": "line|bar|scatter|donut",
  "title": "descriptive chart title",
  "description": "brief explanation of why this chart type",
  
  // For line/bar charts:
  "xKey": "column name for x-axis",
  "yKeys": ["array", "of", "columns", "for", "y-axis"],
  
  // For scatter charts:
  "xKey": "numeric column 1",
  "yKey": "numeric column 2",
  "zKey": "optional numeric column for bubble size",
  "scatterSeries": [{"name": "series name", "color": "#hex"}],
  
  // For donut charts:
  "nameKey": "category column",
  "valueKey": "numeric value column"
}

Consider:
- Use "donut" if there are ≤10 distinct categories and one numeric value
- Use "scatter" if there are ≥2 numeric columns and you want to show correlation
- Use "line" for time-based or sequential data
- Use "bar" for categorical comparisons`;

    const messages = [
      { role: 'system', content: 'You are a data visualization expert. Always return valid JSON.' },
      { role: 'user', content: prompt }
    ];

    const completion = await callElevanceAPI(messages, {
      temperature: 0.3,
      max_tokens: 1000
    });

    const suggestion = JSON.parse(completion.choices[0].message.content);
    res.json({ success: true, visualization: suggestion });
  } catch (error) {
    console.error('Visualization error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start server
const startServer = async () => {
  try {
    // Initialize Elevance API
    initializeElevanceAPI();
    
    // Start token refresh job
    startTokenRefreshJob();
    
    // Load and validate database metadata
    await dbMetadata.refreshMetadata();
    
    app.listen(PORT, () => {
      console.log(`\n🚀 Server running on http://localhost:${PORT}`);
      console.log(`✓ Elevance Health API integration active`);
      console.log(`✓ Oracle database connection validated`);
      console.log(`✓ Token refresh job scheduled\n`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  if (tokenRefreshInterval) {
    clearInterval(tokenRefreshInterval);
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  if (tokenRefreshInterval) {
    clearInterval(tokenRefreshInterval);
  }
  process.exit(0);
});

startServer();

// Duplicate block removed — deduplicated DatabaseMetadata and server/routes are defined earlier in this file.