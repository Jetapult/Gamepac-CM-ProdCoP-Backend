require('dotenv').config();
const { Pool } = require('pg');


const databaseConfig = {
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  timezone: 'Asia/Kolkata', // Replace with your desired timezone
};

const pool=new Pool(databaseConfig);

module.exports = {
  databaseConfig,
  pool
};
